import { PropulsionSpec } from '../sim/types';

export class TacticalAudioSynth {
  private ctx: AudioContext | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineSubOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private muted = false;
  private active = false;

  public setMuted(muted: boolean) {
    this.muted = muted;
    if (this.engineGain && this.ctx) {
      this.engineGain.gain.setTargetAtTime(muted || !this.active ? 0 : 0.045, this.ctx.currentTime, 0.05);
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setActive(active: boolean) {
    this.active = active;
    if (this.engineGain && this.ctx) {
      this.engineGain.gain.setTargetAtTime(this.muted || !active ? 0 : 0.045, this.ctx.currentTime, 0.08);
    }
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this.setupEngineLoop(this.ctx);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private setupEngineLoop(ctx: AudioContext) {
    const osc = ctx.createOscillator();
    const subOsc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = 68;
    subOsc.type = 'triangle';
    subOsc.frequency.value = 34;
    filter.type = 'lowpass';
    filter.frequency.value = 260;
    gain.gain.value = 0;
    osc.connect(filter);
    subOsc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    subOsc.start();
    this.engineOsc = osc;
    this.engineSubOsc = subOsc;
    this.engineFilter = filter;
    this.engineGain = gain;
  }

  public updateEngine(
    throttle: number,
    mach: number,
    propulsionType: PropulsionSpec['type'] = 'Turboprop',
  ) {
    if (!this.ctx || !this.engineOsc || !this.engineSubOsc || !this.engineGain || !this.engineFilter) return;
    if (this.muted || !this.active) {
      this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      return;
    }

    let baseFreq = 54 + throttle * 65 + mach * 38;
    let subFreq = baseFreq * 0.5;
    let filterHz = 240 + throttle * 220;
    let targetGain = 0.022 + throttle * 0.036;

    if (propulsionType === 'Piston Pusher') {
      // Shahed-136 / Mohajer-6 raspy two-stroke "moped" pulse buzz
      this.engineOsc.type = 'sawtooth';
      baseFreq = 78 + throttle * 68;
      subFreq = baseFreq * 0.48;
      filterHz = 420 + throttle * 300;
      targetGain = 0.028 + throttle * 0.036;
    } else if (propulsionType === 'Heavy Hexacopter') {
      // Baba Yaga multi-rotor electric blade chop
      this.engineOsc.type = 'triangle';
      baseFreq = 112 + throttle * 95;
      subFreq = 26 + throttle * 16;
      filterHz = 360 + throttle * 280;
      targetGain = 0.02 + throttle * 0.028;
    } else if (propulsionType === 'Electric Ducted Fan') {
      this.engineOsc.type = 'sine';
      baseFreq = 165 + throttle * 140;
      subFreq = baseFreq * 0.5;
      filterHz = 520;
      targetGain = 0.015 + throttle * 0.022;
    } else if (propulsionType === 'Turbofan' || propulsionType === 'Ramjet Booster') {
      this.engineOsc.type = 'sawtooth';
      baseFreq = 82 + throttle * 105 + mach * 55;
      subFreq = baseFreq * 0.5;
      filterHz = 480 + throttle * 450;
      targetGain = 0.026 + throttle * 0.044;
    } else {
      this.engineOsc.type = 'sawtooth';
    }

    this.engineOsc.frequency.setTargetAtTime(baseFreq, this.ctx.currentTime, 0.08);
    this.engineSubOsc.frequency.setTargetAtTime(subFreq, this.ctx.currentTime, 0.08);
    this.engineFilter.frequency.setTargetAtTime(filterHz, this.ctx.currentTime, 0.08);
    this.engineGain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.08);
  }

  public playMissileLaunch(heavy = false) {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const dur = heavy ? 0.95 : 0.48;
    const bufferSize = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.42));
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(heavy ? 340 : 680, now);
    filter.frequency.exponentialRampToValueAtTime(heavy ? 110 : 220, now + dur);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(heavy ? 0.28 : 0.19, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(now);
  }

  public playGlideRelease() {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(340, now);
    osc.frequency.exponentialRampToValueAtTime(115, now + 0.19);
    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.21);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.21);
  }

  public playCannonShot() {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const jitter = 0.9 + Math.random() * 0.2;

    // Sharp mechanical punch
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220 * jitter, now);
    osc.frequency.exponentialRampToValueAtTime(52, now + 0.065);
    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.075);

    // Supersonic muzzle crack noise burst
    const len = Math.floor(ctx.sampleRate * 0.055);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      ch[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.28));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 650;
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.11, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(ctx.destination);
    noise.start(now);
  }

  public playAntiAirBurst() {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(140 + Math.random() * 40, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.14);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  public playKamikazeLockSiren() {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      const t0 = now + i * 0.09;
      osc.frequency.setValueAtTime(880, t0);
      osc.frequency.exponentialRampToValueAtTime(1320, t0 + 0.07);
      gain.gain.setValueAtTime(0.065, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.085);
    }
  }

  public playExplosion(scale = 1.0) {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const effScale = Math.min(2.4, scale);
    const dur = 0.65 * effScale;

    // Deep sub-bass concussion shockwave
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(135, now);
    osc.frequency.exponentialRampToValueAtTime(22, now + dur * 0.85);
    oscGain.gain.setValueAtTime(Math.min(0.42, 0.28 * effScale), now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(oscGain);
    oscGain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + dur);

    // Crackle & rumbling shrapnel debris noise
    const bufLen = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) {
      ch[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufLen * 0.34));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1350, now);
    filter.frequency.exponentialRampToValueAtTime(110, now + dur);
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(Math.min(0.36, 0.24 * effScale), now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(ctx.destination);
    noise.start(now);
  }

  public playLockChirp() {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1180, now);
    osc.frequency.setValueAtTime(1480, now + 0.05);
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.13);
  }

  public playCyberInject() {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const freqs = [780, 1140, 1560, 2080];
    freqs.forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      const t0 = now + idx * 0.045;
      osc.frequency.setValueAtTime(f, t0);
      gain.gain.setValueAtTime(0.055, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.06);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.065);
    });
  }

  public playCyberAlert() {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      const t0 = now + i * 0.12;
      osc.frequency.setValueAtTime(520, t0);
      osc.frequency.linearRampToValueAtTime(360, t0 + 0.09);
      gain.gain.setValueAtTime(0.06, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.11);
    }
  }

  public playCyberPurge() {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(640, now);
    osc.frequency.exponentialRampToValueAtTime(1720, now + 0.16);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.19);
  }

  public playHitMarker(isKill = false) {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(isKill ? 1950 : 2300, now);
    osc.frequency.exponentialRampToValueAtTime(isKill ? 920 : 1250, now + 0.055);
    gain.gain.setValueAtTime(isKill ? 0.15 : 0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.065);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.07);

    if (isKill) {
      const chime = ctx.createOscillator();
      const cGain = ctx.createGain();
      chime.type = 'sine';
      chime.frequency.setValueAtTime(1046, now + 0.05);
      chime.frequency.setValueAtTime(1568, now + 0.12);
      cGain.gain.setValueAtTime(0.11, now + 0.05);
      cGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      chime.connect(cGain);
      cGain.connect(ctx.destination);
      chime.start(now + 0.05);
      chime.stop(now + 0.29);
    }
  }

  public playFlarePop() {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.08);
    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.095);
  }

  public dispose() {
    try {
      this.engineOsc?.stop();
      this.engineSubOsc?.stop();
      this.ctx?.close();
    } catch {
      // Ignore cleanup error
    }
    this.ctx = null;
  }
}
