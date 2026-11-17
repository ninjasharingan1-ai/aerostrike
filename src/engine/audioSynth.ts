import { STAGE_A_PATHS } from '../assets/assetManifest';
import { CameraMode, GunAudioProfile, PropulsionSpec } from '../sim/types';

export interface SpatialAudioCoords {
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
}

export interface AudioTelemetrySnapshot {
  contextState: string;
  sampleBuffersLoaded: number;
  sampleBuffersTotal: number;
  activeVoices: number;
  listenerPos: [number, number, number];
  hasMasterCompressor: boolean;
  hasBuses: boolean;
  lastSpatialEvent: {
    kind: string;
    x: number;
    y: number;
    z: number;
    doppler: number;
  } | null;
}

const AUDIO_STEM_ENTRIES = Object.entries(STAGE_A_PATHS.audio) as [
  keyof typeof STAGE_A_PATHS.audio,
  string,
][];

const MAX_ACTIVE_VOICES = 28;
const SPEED_OF_SOUND_MS = 343;

export class TacticalAudioSynth {
  private ctx: AudioContext | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private masterGain: GainNode | null = null;

  private buses: {
    propulsion: GainNode;
    weapons: GainNode;
    explosions: GainNode;
    ambience: GainNode;
    ui: GainNode;
  } | null = null;

  private readonly buffers = new Map<keyof typeof STAGE_A_PATHS.audio, AudioBuffer>();
  private loadingStarted = false;

  // Fallback oscillator loop while WAV buffers are still fetching/decoding
  private fallbackOsc: OscillatorNode | null = null;
  private fallbackSubOsc: OscillatorNode | null = null;
  private fallbackFilter: BiquadFilterNode | null = null;
  private fallbackGain: GainNode | null = null;

  // Sample-based continuous loops
  private propNearSrc: AudioBufferSourceNode | null = null;
  private propFarSrc: AudioBufferSourceNode | null = null;
  private windSrc: AudioBufferSourceNode | null = null;
  private propNearGain: GainNode | null = null;
  private propFarGain: GainNode | null = null;
  private propFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private sampleLoopsStarted = false;

  private muted = false;
  private active = false;
  private activeVoiceCount = 0;

  private listenerPos: [number, number, number] = [0, 0, 0];
  private listenerVel: [number, number, number] = [0, 0, 0];
  private duckUntilSec = 0;
  private lastSpatialEvent: AudioTelemetrySnapshot['lastSpatialEvent'] = null;

  public setMuted(muted: boolean) {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.92, this.ctx.currentTime, 0.04);
    }
    this.syncBusActiveGains();
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setActive(active: boolean) {
    this.active = active;
    if (active && !this.ctx && !this.muted && typeof window !== 'undefined') {
      // Context will still safely resume upon pointer/key gesture
    }
    this.syncBusActiveGains();
  }

  private syncBusActiveGains() {
    if (!this.ctx || !this.buses) return;
    const now = this.ctx.currentTime;
    const isAudible = this.active && !this.muted;
    if (!isAudible) {
      this.buses.propulsion.gain.setTargetAtTime(0, now, 0.06);
      this.buses.ambience.gain.setTargetAtTime(0, now, 0.06);
      if (this.fallbackGain) this.fallbackGain.gain.setTargetAtTime(0, now, 0.05);
    }
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this.setupAudioGraph(this.ctx);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    if (!this.loadingStarted) {
      this.preloadSampleBank();
    }
    return this.ctx;
  }

  private setupAudioGraph(ctx: AudioContext) {
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-12, ctx.currentTime);
    compressor.knee.setValueAtTime(18, ctx.currentTime);
    compressor.ratio.setValueAtTime(8, ctx.currentTime);
    compressor.attack.setValueAtTime(0.003, ctx.currentTime);
    compressor.release.setValueAtTime(0.25, ctx.currentTime);

    const masterGain = ctx.createGain();
    masterGain.gain.value = this.muted ? 0 : 0.92;

    const propulsion = ctx.createGain();
    const weapons = ctx.createGain();
    const explosions = ctx.createGain();
    const ambience = ctx.createGain();
    const ui = ctx.createGain();

    propulsion.gain.value = 0;
    weapons.gain.value = 0.85;
    explosions.gain.value = 0.95;
    ambience.gain.value = 0;
    ui.gain.value = 0.72;

    propulsion.connect(compressor);
    weapons.connect(compressor);
    explosions.connect(compressor);
    ambience.connect(compressor);
    ui.connect(compressor);
    compressor.connect(masterGain);
    masterGain.connect(ctx.destination);

    this.compressor = compressor;
    this.masterGain = masterGain;
    this.buses = { propulsion, weapons, explosions, ambience, ui };

    // Low-cost fallback oscillator until sample loops are decoded
    const osc = ctx.createOscillator();
    const subOsc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const fGain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = 58;
    subOsc.type = 'triangle';
    subOsc.frequency.value = 29;
    filter.type = 'lowpass';
    filter.frequency.value = 240;
    fGain.gain.value = 0;
    osc.connect(filter);
    subOsc.connect(filter);
    filter.connect(fGain);
    fGain.connect(propulsion);
    osc.start();
    subOsc.start();
    this.fallbackOsc = osc;
    this.fallbackSubOsc = subOsc;
    this.fallbackFilter = filter;
    this.fallbackGain = fGain;
  }

  public preloadSampleBank(): void {
    if (this.loadingStarted || typeof window === 'undefined' || typeof fetch === 'undefined') return;
    const ctx = this.ctx;
    if (!ctx) return;
    this.loadingStarted = true;

    for (const [key, url] of AUDIO_STEM_ENTRIES) {
      fetch(url)
        .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`HTTP ${res.status}`))))
        .then((arr) => ctx.decodeAudioData(arr))
        .then((decoded) => {
          if (!this.ctx) return;
          this.buffers.set(key, decoded);
          if (
            !this.sampleLoopsStarted &&
            this.buffers.has('propTurbopropNear') &&
            this.buffers.has('propTurbopropFar') &&
            this.buffers.has('desertWindLoop')
          ) {
            this.startSampleLoops();
          }
        })
        .catch(() => {
          // Graceful resilience if browser context blocks decode before user interaction
        });
    }
  }

  public warmUp(): void {
    this.ensureContext();
  }

  private startSampleLoops() {
    if (!this.ctx || !this.buses || this.sampleLoopsStarted) return;
    const nearBuf = this.buffers.get('propTurbopropNear');
    const farBuf = this.buffers.get('propTurbopropFar');
    const windBuf = this.buffers.get('desertWindLoop');
    if (!nearBuf || !farBuf || !windBuf) return;

    this.sampleLoopsStarted = true;
    const ctx = this.ctx;

    const propFilter = ctx.createBiquadFilter();
    propFilter.type = 'lowpass';
    propFilter.frequency.value = 1800;
    propFilter.connect(this.buses.propulsion);

    const nearGain = ctx.createGain();
    nearGain.gain.value = 0.36;
    nearGain.connect(propFilter);

    const farGain = ctx.createGain();
    farGain.gain.value = 0.14;
    farGain.connect(propFilter);

    const nearSrc = ctx.createBufferSource();
    nearSrc.buffer = nearBuf;
    nearSrc.loop = true;
    nearSrc.connect(nearGain);
    nearSrc.start();

    const farSrc = ctx.createBufferSource();
    farSrc.buffer = farBuf;
    farSrc.loop = true;
    farSrc.connect(farGain);
    farSrc.start();

    const windGain = ctx.createGain();
    windGain.gain.value = 0.16;
    windGain.connect(this.buses.ambience);

    const windSrc = ctx.createBufferSource();
    windSrc.buffer = windBuf;
    windSrc.loop = true;
    windSrc.connect(windGain);
    windSrc.start();

    this.propFilter = propFilter;
    this.propNearGain = nearGain;
    this.propFarGain = farGain;
    this.propNearSrc = nearSrc;
    this.propFarSrc = farSrc;
    this.windGain = windGain;
    this.windSrc = windSrc;

    if (this.fallbackGain) {
      this.fallbackGain.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
    }
  }

  public updateListener(
    pos: { x: number; y: number; z: number },
    fwd: { x: number; y: number; z: number },
    up: { x: number; y: number; z: number },
    vel: { vx: number; vy: number; vz: number },
  ) {
    this.listenerPos = [pos.x, pos.y, pos.z];
    this.listenerVel = [vel.vx, vel.vy, vel.vz];
    const ctx = this.ctx;
    if (!ctx) return;

    const l = ctx.listener;
    const t = ctx.currentTime;
    if (l.positionX) {
      l.positionX.setValueAtTime(pos.x, t);
      l.positionY.setValueAtTime(pos.y, t);
      l.positionZ.setValueAtTime(pos.z, t);
      l.forwardX.setValueAtTime(fwd.x, t);
      l.forwardY.setValueAtTime(fwd.y, t);
      l.forwardZ.setValueAtTime(fwd.z, t);
      l.upX.setValueAtTime(up.x, t);
      l.upY.setValueAtTime(up.y, t);
      l.upZ.setValueAtTime(up.z, t);
    } else if (typeof l.setPosition === 'function') {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  public updateEngine(
    throttle: number,
    mach: number,
    propulsionType: PropulsionSpec['type'] = 'Turboprop',
    cameraMode: CameraMode = 'chase',
    windSpeedMs = 8,
  ) {
    if (!this.ctx || !this.buses) return;
    const now = this.ctx.currentTime;
    if (this.muted || !this.active) {
      this.buses.propulsion.gain.setTargetAtTime(0, now, 0.05);
      this.buses.ambience.gain.setTargetAtTime(0, now, 0.05);
      if (this.fallbackGain) this.fallbackGain.gain.setTargetAtTime(0, now, 0.05);
      return;
    }

    const duckFactor = now < this.duckUntilSec ? 0.55 : 1.0;
    const isInterior = cameraMode === 'eoir';
    const isFarCam = cameraMode === 'flyby' || cameraMode === 'orbit';

    this.buses.propulsion.gain.setTargetAtTime(0.65 * duckFactor, now, 0.08);
    this.buses.ambience.gain.setTargetAtTime((isInterior ? 0.22 : 0.48) * duckFactor, now, 0.12);

    if (
      this.sampleLoopsStarted &&
      this.propNearSrc &&
      this.propFarSrc &&
      this.propNearGain &&
      this.propFarGain &&
      this.propFilter &&
      this.windGain
    ) {
      let typePitch = 1.0;
      if (propulsionType === 'Piston Pusher') typePitch = 0.88;
      else if (propulsionType === 'Heavy Hexacopter') typePitch = 1.18;
      else if (propulsionType === 'Turbofan' || propulsionType === 'Ramjet Booster') typePitch = 1.32;

      const playback = Math.max(0.62, Math.min(1.65, (0.78 + throttle * 0.44 + mach * 0.25) * typePitch));
      this.propNearSrc.playbackRate.setTargetAtTime(playback, now, 0.08);
      this.propFarSrc.playbackRate.setTargetAtTime(playback * 0.995, now, 0.08);

      const nearMix = isInterior ? 0.1 : isFarCam ? 0.18 : 0.3 + throttle * 0.22;
      const farMix = isInterior ? 0.22 : isFarCam ? 0.34 : 0.14 + throttle * 0.1;
      this.propNearGain.gain.setTargetAtTime(nearMix, now, 0.08);
      this.propFarGain.gain.setTargetAtTime(farMix, now, 0.08);
      this.propFilter.frequency.setTargetAtTime(
        isInterior ? 620 : isFarCam ? 1350 : 1850 + throttle * 1600,
        now,
        0.08,
      );

      const windLvl = Math.min(0.45, 0.12 + windSpeedMs * 0.008 + mach * 0.28);
      this.windGain.gain.setTargetAtTime(windLvl, now, 0.12);
      if (this.windSrc) {
        this.windSrc.playbackRate.setTargetAtTime(0.92 + Math.min(0.4, mach * 0.65), now, 0.12);
      }
      if (this.fallbackGain) {
        this.fallbackGain.gain.setTargetAtTime(0, now, 0.06);
      }
      return;
    }

    // Fallback oscillator path while buffers are decoding
    if (this.fallbackOsc && this.fallbackSubOsc && this.fallbackFilter && this.fallbackGain) {
      const baseFreq = 54 + throttle * 65 + mach * 38;
      this.fallbackOsc.frequency.setTargetAtTime(baseFreq, now, 0.08);
      this.fallbackSubOsc.frequency.setTargetAtTime(baseFreq * 0.5, now, 0.08);
      this.fallbackFilter.frequency.setTargetAtTime(isInterior ? 180 : 280 + throttle * 220, now, 0.08);
      this.fallbackGain.gain.setTargetAtTime(0.025 + throttle * 0.032, now, 0.08);
    }
  }

  private computeDopplerRate(coords?: SpatialAudioCoords, baseRate = 1.0): { rate: number; dist: number } {
    if (!coords || typeof coords.x !== 'number' || typeof coords.y !== 'number' || typeof coords.z !== 'number') {
      return { rate: baseRate, dist: 0 };
    }
    const dx = coords.x - this.listenerPos[0];
    const dy = coords.y - this.listenerPos[1];
    const dz = coords.z - this.listenerPos[2];
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1) return { rate: baseRate, dist: 0 };

    const nx = dx / dist;
    const ny = dy / dist;
    const nz = dz / dist;
    const relVx = (coords.vx ?? 0) - this.listenerVel[0];
    const relVy = (coords.vy ?? 0) - this.listenerVel[1];
    const relVz = (coords.vz ?? 0) - this.listenerVel[2];
    const radialVel = relVx * nx + relVy * ny + relVz * nz; // >0 receding, <0 approaching
    const doppler = Math.max(0.68, Math.min(1.42, SPEED_OF_SOUND_MS / Math.max(120, SPEED_OF_SOUND_MS + radialVel)));
    return { rate: baseRate * doppler, dist };
  }

  private playBufferStem(
    stemKey: keyof typeof STAGE_A_PATHS.audio,
    bus: GainNode,
    gainLevel: number,
    coords?: SpatialAudioCoords,
    pitchJitter = 0.04,
    kindLabel = String(stemKey),
    rateScale = 1.0,
  ): boolean {
    const ctx = this.ctx;
    const buffer = this.buffers.get(stemKey);
    if (!ctx || !buffer || this.activeVoiceCount >= MAX_ACTIVE_VOICES) {
      return false;
    }

    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const jitter = (1 + (Math.random() * 2 - 1) * pitchJitter) * rateScale;
    const { rate, dist } = this.computeDopplerRate(coords, jitter);
    src.playbackRate.setValueAtTime(Math.max(0.55, Math.min(1.85, rate)), now);

    const g = ctx.createGain();
    g.gain.setValueAtTime(gainLevel, now);

    if (coords && typeof coords.x === 'number' && typeof coords.y === 'number' && typeof coords.z === 'number') {
      const panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 48;
      panner.maxDistance = 4600;
      panner.rolloffFactor = 1.05;
      panner.positionX.setValueAtTime(coords.x, now);
      panner.positionY.setValueAtTime(coords.y, now);
      panner.positionZ.setValueAtTime(coords.z, now);

      // Distance air-absorption filter (far combat sounds roll off crisp highs)
      const distCutoff = Math.max(650, Math.min(18000, 18000 * Math.exp(-dist * 0.00085)));
      const airFilter = ctx.createBiquadFilter();
      airFilter.type = 'lowpass';
      airFilter.frequency.setValueAtTime(distCutoff, now);

      src.connect(airFilter);
      airFilter.connect(g);
      g.connect(panner);
      panner.connect(bus);

      this.lastSpatialEvent = {
        kind: kindLabel,
        x: Math.round(coords.x),
        y: Math.round(coords.y),
        z: Math.round(coords.z),
        doppler: Number((rate / jitter).toFixed(3)),
      };
    } else {
      src.connect(g);
      g.connect(bus);
    }

    this.activeVoiceCount++;
    src.onended = () => {
      this.activeVoiceCount = Math.max(0, this.activeVoiceCount - 1);
      src.disconnect();
      g.disconnect();
    };
    src.start(now);
    return true;
  }

  public playMissileLaunch(heavy = false, coords?: SpatialAudioCoords) {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.buses) return;

    if (this.playBufferStem('missileLaunch', this.buses.weapons, heavy ? 0.92 : 0.72, coords, 0.05, 'missile_launch')) {
      return;
    }

    const now = ctx.currentTime;
    const dur = heavy ? 0.85 : 0.45;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(heavy ? 180 : 320, now);
    osc.frequency.exponentialRampToValueAtTime(70, now + dur);
    g.gain.setValueAtTime(0.14, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(g);
    g.connect(this.buses.weapons);
    osc.start(now);
    osc.stop(now + dur);
  }

  public playGlideRelease(coords?: SpatialAudioCoords) {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.buses) return;

    if (this.playBufferStem('glideRelease', this.buses.weapons, 0.72, coords, 0.03, 'glide_release')) {
      return;
    }

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(340, now);
    osc.frequency.exponentialRampToValueAtTime(115, now + 0.19);
    g.gain.setValueAtTime(0.12, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(g);
    g.connect(this.buses.weapons);
    osc.start(now);
    osc.stop(now + 0.21);
  }

  public playCannonShot(coords?: SpatialAudioCoords, profile: GunAudioProfile = 'cannon_20mm') {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.buses) return;

    const profileTuning: Record<
      GunAudioProfile,
      {
        stem: keyof typeof STAGE_A_PATHS.audio;
        layerStem: keyof typeof STAGE_A_PATHS.audio;
        tailStem: keyof typeof STAGE_A_PATHS.audio | null;
        rate: number;
        gain: number;
        layerGain: number;
        tailGain: number;
        oscType: OscillatorType;
        fStart: number;
        fEnd: number;
        dur: number;
      }
    > = {
      gun_light_556: {
        stem: 'gun556',
        layerStem: 'cannonTransient',
        tailStem: null,
        rate: 1.06,
        gain: 0.56,
        layerGain: 0.24,
        tailGain: 0,
        oscType: 'triangle',
        fStart: 320,
        fEnd: 95,
        dur: 0.045,
      },
      gun_medium_762: {
        stem: 'gun762',
        layerStem: 'cannonBody',
        tailStem: null,
        rate: 1.0,
        gain: 0.64,
        layerGain: 0.28,
        tailGain: 0,
        oscType: 'sawtooth',
        fStart: 215,
        fEnd: 58,
        dur: 0.065,
      },
      gun_enclosed_mg: {
        stem: 'gunEnclosed',
        layerStem: 'cannonBody',
        tailStem: null,
        rate: 0.94,
        gain: 0.58,
        layerGain: 0.26,
        tailGain: 0,
        oscType: 'square',
        fStart: 185,
        fEnd: 48,
        dur: 0.06,
      },
      gun_rotary_minigun: {
        stem: 'gunRotary',
        layerStem: 'cannonTransient',
        tailStem: 'cannonTail',
        rate: 1.14,
        gain: 0.58,
        layerGain: 0.34,
        tailGain: 0.16,
        oscType: 'sawtooth',
        fStart: 270,
        fEnd: 74,
        dur: 0.042,
      },
      gun_rws_250: {
        stem: 'gunRws250',
        layerStem: 'cannonBody',
        tailStem: null,
        rate: 0.96,
        gain: 0.66,
        layerGain: 0.3,
        tailGain: 0,
        oscType: 'sawtooth',
        fStart: 260,
        fEnd: 68,
        dur: 0.055,
      },
      cannon_20mm: {
        stem: 'cannon20mm',
        layerStem: 'cannonBody',
        tailStem: 'cannonTail',
        rate: 0.96,
        gain: 0.72,
        layerGain: 0.36,
        tailGain: 0.28,
        oscType: 'sawtooth',
        fStart: 155,
        fEnd: 40,
        dur: 0.085,
      },
    };
    const tune = profileTuning[profile] ?? profileTuning.cannon_20mm;

    const okPrimary = this.playBufferStem(
      tune.stem,
      this.buses.weapons,
      tune.gain,
      coords,
      0.05,
      `cannon_${profile}`,
      tune.rate,
    );
    const okLayer = this.playBufferStem(
      tune.layerStem,
      this.buses.weapons,
      tune.layerGain,
      coords,
      0.06,
      `cannon_layer_${profile}`,
      tune.rate * 1.02,
    );
    const okTail = tune.tailStem
      ? this.playBufferStem(
          tune.tailStem,
          this.buses.weapons,
          tune.tailGain,
          coords,
          0.04,
          `cannon_tail_${profile}`,
          tune.rate * 0.98,
        )
      : false;
    if (okPrimary || okLayer || okTail) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = tune.oscType;
    osc.frequency.setValueAtTime(tune.fStart, now);
    osc.frequency.exponentialRampToValueAtTime(tune.fEnd, now + tune.dur);
    g.gain.setValueAtTime(0.11, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + tune.dur + 0.01);
    if (profile === 'gun_enclosed_mg') {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(950, now);
      osc.connect(lp);
      lp.connect(g);
    } else {
      osc.connect(g);
    }
    g.connect(this.buses.weapons);
    osc.start(now);
    osc.stop(now + tune.dur + 0.015);
  }

  public playAntiAirBurst(coords?: SpatialAudioCoords) {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.buses) return;

    if (this.playBufferStem('aaaFlakBurst', this.buses.explosions, 0.62, coords, 0.08, 'aaa_burst')) {
      return;
    }

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.14);
    g.gain.setValueAtTime(0.08, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(g);
    g.connect(this.buses.explosions);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  public playExplosion(scale = 1.0, coords?: SpatialAudioCoords) {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.buses) return;

    const eff = Math.max(0.45, Math.min(2.0, scale));
    this.duckUntilSec = Math.max(this.duckUntilSec, ctx.currentTime + 0.55);

    const okSub = this.playBufferStem('explosionSub', this.buses.explosions, Math.min(1.0, 0.72 * eff), coords, 0.05, 'explosion_sub');
    const okCrack = this.playBufferStem('explosionCrack', this.buses.explosions, Math.min(0.95, 0.62 * eff), coords, 0.06, 'explosion');
    const okDebris = this.playBufferStem('explosionDebris', this.buses.explosions, Math.min(0.8, 0.48 * eff), coords, 0.07, 'explosion_debris');
    if (okSub || okCrack || okDebris) return;

    const now = ctx.currentTime;
    const dur = 0.65 * Math.min(2.2, eff);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(130, now);
    osc.frequency.exponentialRampToValueAtTime(24, now + dur * 0.85);
    g.gain.setValueAtTime(0.24, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(g);
    g.connect(this.buses.explosions);
    osc.start(now);
    osc.stop(now + dur);
  }

  public playFlarePop(coords?: SpatialAudioCoords) {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.buses) return;

    if (this.playBufferStem('flarePop', this.buses.weapons, 0.66, coords, 0.05, 'flare_pop')) {
      return;
    }

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.08);
    g.gain.setValueAtTime(0.08, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc.connect(g);
    g.connect(this.buses.weapons);
    osc.start(now);
    osc.stop(now + 0.095);
  }

  public playLockChirp() {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.buses) return;
    if (this.playBufferStem('rwrChirp', this.buses.ui, 0.52, undefined, 0.01)) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1180, now);
    osc.frequency.setValueAtTime(1480, now + 0.05);
    g.gain.setValueAtTime(0.06, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.connect(g);
    g.connect(this.buses.ui);
    osc.start(now);
    osc.stop(now + 0.13);
  }

  public playReconMark() {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.buses) return;
    const now = ctx.currentTime;
    [980, 1460].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      const t0 = now + idx * 0.065;
      osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.08, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.09);
      osc.connect(g);
      g.connect(this.buses!.ui);
      osc.start(t0);
      osc.stop(t0 + 0.095);
    });
  }

  public playHitMarker(isKill = false) {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.buses) return;
    if (this.playBufferStem('hitConfirm', this.buses.ui, isKill ? 0.85 : 0.6, undefined, isKill ? 0.01 : 0.04)) {
      return;
    }

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(isKill ? 1950 : 2300, now);
    osc.frequency.exponentialRampToValueAtTime(isKill ? 920 : 1250, now + 0.055);
    g.gain.setValueAtTime(isKill ? 0.14 : 0.09, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.065);
    osc.connect(g);
    g.connect(this.buses.ui);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  public playCyberAlert() {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.buses) return;
    if (this.playBufferStem('cyberAlert', this.buses.ui, 0.58, undefined, 0.01)) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.linearRampToValueAtTime(360, now + 0.12);
    g.gain.setValueAtTime(0.06, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
    osc.connect(g);
    g.connect(this.buses.ui);
    osc.start(now);
    osc.stop(now + 0.14);
  }

  public playCyberInject() {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.buses) return;
    const now = ctx.currentTime;
    [780, 1140, 1560].forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'square';
      const t0 = now + idx * 0.045;
      osc.frequency.setValueAtTime(f, t0);
      g.gain.setValueAtTime(0.05, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.06);
      osc.connect(g);
      g.connect(this.buses!.ui);
      osc.start(t0);
      osc.stop(t0 + 0.065);
    });
  }

  public playCyberPurge() {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.buses) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(640, now);
    osc.frequency.exponentialRampToValueAtTime(1720, now + 0.16);
    g.gain.setValueAtTime(0.07, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(g);
    g.connect(this.buses.ui);
    osc.start(now);
    osc.stop(now + 0.19);
  }

  public playKamikazeLockSiren() {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.buses) return;
    const now = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sawtooth';
      const t0 = now + i * 0.09;
      osc.frequency.setValueAtTime(880, t0);
      osc.frequency.exponentialRampToValueAtTime(1320, t0 + 0.07);
      g.gain.setValueAtTime(0.06, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.08);
      osc.connect(g);
      g.connect(this.buses.ui);
      osc.start(t0);
      osc.stop(t0 + 0.085);
    }
  }

  public getAudioTelemetry(): AudioTelemetrySnapshot {
    return {
      contextState: this.ctx?.state ?? 'uninitialized',
      sampleBuffersLoaded: this.buffers.size,
      sampleBuffersTotal: AUDIO_STEM_ENTRIES.length,
      activeVoices: this.activeVoiceCount,
      listenerPos: [...this.listenerPos] as [number, number, number],
      hasMasterCompressor: Boolean(this.compressor),
      hasBuses: Boolean(this.buses),
      lastSpatialEvent: this.lastSpatialEvent ? { ...this.lastSpatialEvent } : null,
    };
  }

  public dispose() {
    try {
      this.fallbackOsc?.stop();
      this.fallbackSubOsc?.stop();
      this.propNearSrc?.stop();
      this.propFarSrc?.stop();
      this.windSrc?.stop();
      this.ctx?.close();
    } catch {
      // Ignore Web Audio cleanup errors on teardown
    }
    this.buffers.clear();
    this.sampleLoopsStarted = false;
    this.loadingStarted = false;
    this.ctx = null;
    this.compressor = null;
    this.masterGain = null;
    this.buses = null;
    this.activeVoiceCount = 0;
  }
}
