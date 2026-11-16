import fs from 'node:fs';
import path from 'node:path';

const SAMPLE_RATE = 44100;
const OUT_DIR = path.resolve(process.cwd(), 'public/assets/audio');
fs.mkdirSync(OUT_DIR, { recursive: true });

// Deterministic LCG PRNG so audio samples are 100% reproducible
function createRng(seed = 0x51a9e001) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function writeMonoWav16(filename: string, samples: Float32Array, sampleRate = SAMPLE_RATE): { sizeBytes: number; durationSec: number } {
  const numSamples = samples.length;
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // PCM chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(1, 22); // Mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  let peak = 0;
  for (let i = 0; i < numSamples; i++) {
    peak = Math.max(peak, Math.abs(samples[i]));
  }
  const norm = peak > 0.96 ? 0.94 / peak : 1.0;

  for (let i = 0; i < numSamples; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] * norm));
    buffer.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }

  const outPath = path.join(OUT_DIR, filename);
  fs.writeFileSync(outPath, buffer);
  return { sizeBytes: buffer.length, durationSec: Number((numSamples / sampleRate).toFixed(3)) };
}

function makeLowpass(input: Float32Array, cutoffHz: number): Float32Array {
  const out = new Float32Array(input.length);
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / SAMPLE_RATE;
  const alpha = dt / (rc + dt);
  let prev = 0;
  for (let i = 0; i < input.length; i++) {
    prev = prev + alpha * (input[i] - prev);
    out[i] = prev;
  }
  return out;
}

function makeBandpass(input: Float32Array, lowHz: number, highHz: number): Float32Array {
  const lp = makeLowpass(input, highHz);
  const out = new Float32Array(input.length);
  const rc = 1 / (2 * Math.PI * lowHz);
  const dt = 1 / SAMPLE_RATE;
  const alpha = rc / (rc + dt);
  let prevIn = 0;
  let prevOut = 0;
  for (let i = 0; i < input.length; i++) {
    prevOut = alpha * (prevOut + lp[i] - prevIn);
    prevIn = lp[i];
    out[i] = prevOut;
  }
  return out;
}

function genPropNear(): Float32Array {
  // 2.0s seamless integer-harmonic Rotax 912-style pusher prop loop (base ~54 Hz blade pass = 108 cycles)
  const dur = 2.0;
  const n = Math.floor(SAMPLE_RATE * dur);
  const buf = new Float32Array(n);
  const rng = createRng(101);
  const rawNoise = new Float32Array(n);
  for (let i = 0; i < n; i++) rawNoise[i] = rng() * 2 - 1;
  const exhaustAir = makeBandpass(rawNoise, 90, 620);

  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const f0 = 54; // 108 exact cycles in 2.0s -> zero seam discontinuity
    const bladePulse =
      Math.sin(2 * Math.PI * f0 * t) * 0.45 +
      Math.sin(2 * Math.PI * f0 * 2 * t + 0.4) * 0.28 +
      Math.sin(2 * Math.PI * f0 * 3 * t + 1.1) * 0.14 +
      Math.sin(2 * Math.PI * f0 * 4 * t) * 0.08;
    // Slight cylinder firing asymmetry modulation (27 Hz 4-stroke sub-fundamental = 54 cycles)
    const pistonThrum = Math.sin(2 * Math.PI * 27 * t) * 0.24;
    const flutter = 0.72 + 0.28 * Math.sin(2 * Math.PI * f0 * t);
    buf[i] = Math.tanh((bladePulse + pistonThrum + exhaustAir[i] * flutter * 0.55) * 0.9);
  }
  return buf;
}

function genPropFar(): Float32Array {
  const near = genPropNear();
  const filtered = makeLowpass(near, 310);
  for (let i = 0; i < filtered.length; i++) {
    filtered[i] *= 0.85;
  }
  return filtered;
}

function genCannonTransient(): Float32Array {
  const n = Math.floor(SAMPLE_RATE * 0.18);
  const buf = new Float32Array(n);
  const rng = createRng(202);
  const noise = new Float32Array(n);
  for (let i = 0; i < n; i++) noise[i] = rng() * 2 - 1;
  const crisp = makeBandpass(noise, 700, 7200);

  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const click = Math.sin(2 * Math.PI * (1450 * Math.exp(-t * 95) + 180) * t) * Math.exp(-t * 58);
    const mech = Math.sin(2 * Math.PI * 520 * t) * Math.exp(-t * 42) * 0.45;
    const snapEnv = Math.exp(-t * 36);
    buf[i] = Math.tanh((click * 0.65 + mech + crisp[i] * snapEnv * 1.45) * 1.2);
  }
  return buf;
}

function genCannonBody(): Float32Array {
  const n = Math.floor(SAMPLE_RATE * 0.24);
  const buf = new Float32Array(n);
  const rng = createRng(203);
  const noise = new Float32Array(n);
  for (let i = 0; i < n; i++) noise[i] = rng() * 2 - 1;
  const punchNoise = makeBandpass(noise, 110, 950);

  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const sub = Math.sin(2 * Math.PI * (165 * Math.exp(-t * 28) + 46) * t) * Math.exp(-t * 17);
    const body = punchNoise[i] * Math.exp(-t * 16) * 1.3;
    buf[i] = Math.tanh((sub * 0.72 + body) * 1.15);
  }
  return buf;
}

function genCannonTail(): Float32Array {
  const n = Math.floor(SAMPLE_RATE * 0.85);
  const rng = createRng(204);
  const noise = new Float32Array(n);
  for (let i = 0; i < n; i++) noise[i] = rng() * 2 - 1;
  const desertReflection = makeBandpass(noise, 120, 1450);
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const attack = Math.min(1, t / 0.025);
    const slap = 1 + 0.32 * Math.exp(-Math.pow((t - 0.14) / 0.04, 2)) + 0.18 * Math.exp(-Math.pow((t - 0.31) / 0.06, 2));
    buf[i] = desertReflection[i] * attack * Math.exp(-t * 3.8) * slap * 1.3;
  }
  return buf;
}

function genMissileLaunch(): Float32Array {
  const n = Math.floor(SAMPLE_RATE * 0.95);
  const rng = createRng(303);
  const noise = new Float32Array(n);
  for (let i = 0; i < n; i++) noise[i] = rng() * 2 - 1;
  const mid = makeBandpass(noise, 240, 2900);
  const low = makeLowpass(noise, 210);
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const ign = Math.exp(-t * 18) * Math.sin(2 * Math.PI * 190 * t);
    const sustain = Math.min(1, t / 0.04) * Math.exp(-t * 2.4);
    buf[i] = Math.tanh((ign * 0.45 + mid[i] * sustain * 0.95 + low[i] * sustain * 1.35) * 1.1);
  }
  return buf;
}

function genGlideRelease(): Float32Array {
  const n = Math.floor(SAMPLE_RATE * 0.28);
  const rng = createRng(304);
  const noise = new Float32Array(n);
  for (let i = 0; i < n; i++) noise[i] = rng() * 2 - 1;
  const rush = makeBandpass(noise, 320, 2200);
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const latch = Math.sin(2 * Math.PI * 260 * t) * Math.exp(-t * 48) * 0.55;
    const pneu = rush[i] * Math.exp(-t * 14) * 1.1;
    buf[i] = Math.tanh(latch + pneu);
  }
  return buf;
}

function genExplosionSub(): Float32Array {
  const n = Math.floor(SAMPLE_RATE * 1.45);
  const rng = createRng(401);
  const noise = new Float32Array(n);
  for (let i = 0; i < n; i++) noise[i] = rng() * 2 - 1;
  const rumble = makeLowpass(noise, 130);
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const boom = Math.sin(2 * Math.PI * (120 * Math.exp(-t * 6.5) + 24) * t) * Math.exp(-t * 2.6);
    buf[i] = Math.tanh((boom * 0.85 + rumble[i] * Math.exp(-t * 1.9) * 1.55) * 1.15);
  }
  return buf;
}

function genExplosionCrack(): Float32Array {
  const n = Math.floor(SAMPLE_RATE * 0.55);
  const rng = createRng(402);
  const noise = new Float32Array(n);
  for (let i = 0; i < n; i++) noise[i] = rng() * 2 - 1;
  const sharp = makeBandpass(noise, 380, 5800);
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const shock = Math.sin(2 * Math.PI * 360 * Math.exp(-t * 22) * t) * Math.exp(-t * 28);
    buf[i] = Math.tanh((shock * 0.65 + sharp[i] * Math.exp(-t * 8.5) * 1.4) * 1.2);
  }
  return buf;
}

function genExplosionDebris(): Float32Array {
  const n = Math.floor(SAMPLE_RATE * 1.6);
  const rng = createRng(403);
  const noise = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // Crackle impulses + ejecta sand
    const burst = rng() > 0.996 ? (rng() * 2 - 1) * 4.5 : rng() * 2 - 1;
    noise[i] = burst;
  }
  const debrisBand = makeBandpass(noise, 180, 3200);
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const attack = Math.min(1, t / 0.08);
    buf[i] = Math.tanh(debrisBand[i] * attack * Math.exp(-t * 1.95) * 1.1);
  }
  return buf;
}

function genAaaFlakBurst(): Float32Array {
  const n = Math.floor(SAMPLE_RATE * 0.55);
  const rng = createRng(501);
  const noise = new Float32Array(n);
  for (let i = 0; i < n; i++) noise[i] = rng() * 2 - 1;
  const crisp = makeBandpass(noise, 250, 2600);
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const doubleTap = Math.exp(-t * 16) + 0.55 * Math.exp(-Math.max(0, t - 0.09) * 18) * (t > 0.09 ? 1 : 0);
    const pop = Math.sin(2 * Math.PI * 135 * t) * Math.exp(-t * 24) * 0.4;
    buf[i] = Math.tanh((crisp[i] * doubleTap * 1.25 + pop) * 1.15);
  }
  return buf;
}

function genFlarePop(): Float32Array {
  const n = Math.floor(SAMPLE_RATE * 0.38);
  const rng = createRng(601);
  const noise = new Float32Array(n);
  for (let i = 0; i < n; i++) noise[i] = rng() * 2 - 1;
  const hiss = makeBandpass(noise, 1100, 6200);
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const thump = Math.sin(2 * Math.PI * 240 * Math.exp(-t * 18) * t) * Math.exp(-t * 32) * 0.7;
    buf[i] = Math.tanh(thump + hiss[i] * Math.exp(-t * 6.5) * 0.75);
  }
  return buf;
}

function genDesertWindLoop(): Float32Array {
  // 3.0s seamlessly cross-faded high-desert wind bed
  const dur = 3.0;
  const n = Math.floor(SAMPLE_RATE * dur);
  const rng = createRng(701);
  const raw = new Float32Array(n + SAMPLE_RATE);
  for (let i = 0; i < raw.length; i++) raw[i] = rng() * 2 - 1;
  const wind = makeBandpass(raw, 65, 580);
  const buf = new Float32Array(n);
  const fadeLen = Math.floor(SAMPLE_RATE * 0.5);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const swell = 0.65 + 0.35 * Math.sin(2 * Math.PI * (t / dur));
    let sample = wind[i] * swell;
    if (i < fadeLen) {
      const a = i / fadeLen;
      sample = sample * a + wind[n + i] * (0.65 + 0.35 * Math.sin(2 * Math.PI * ((n + i) / SAMPLE_RATE / dur))) * (1 - a);
    }
    buf[i] = sample * 0.7;
  }
  return buf;
}

function genToneSample(freqStart: number, freqEnd: number, durSec: number, wave: 'sine' | 'triangle' = 'sine'): Float32Array {
  const n = Math.floor(SAMPLE_RATE * durSec);
  const buf = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const u = i / n;
    const freq = freqStart + (freqEnd - freqStart) * u;
    phase += (2 * Math.PI * freq) / SAMPLE_RATE;
    const env = Math.min(1, t / 0.008) * Math.exp(-u * 4.2);
    const val = wave === 'sine' ? Math.sin(phase) : (2 / Math.PI) * Math.asin(Math.sin(phase));
    buf[i] = val * env * 0.72;
  }
  return buf;
}

const specs: [string, Float32Array][] = [
  ['prop_turboprop_near.wav', genPropNear()],
  ['prop_turboprop_far.wav', genPropFar()],
  ['cannon_transient.wav', genCannonTransient()],
  ['cannon_body.wav', genCannonBody()],
  ['cannon_tail.wav', genCannonTail()],
  ['missile_launch.wav', genMissileLaunch()],
  ['glide_release.wav', genGlideRelease()],
  ['explosion_sub.wav', genExplosionSub()],
  ['explosion_crack.wav', genExplosionCrack()],
  ['explosion_debris.wav', genExplosionDebris()],
  ['aaa_flak_burst.wav', genAaaFlakBurst()],
  ['flare_pop.wav', genFlarePop()],
  ['desert_wind_loop.wav', genDesertWindLoop()],
  ['rwr_chirp.wav', genToneSample(1220, 1520, 0.14, 'sine')],
  ['hit_confirm.wav', genToneSample(2100, 1280, 0.12, 'triangle')],
  ['cyber_alert.wav', genToneSample(640, 420, 0.24, 'triangle')],
];

for (const [name, data] of specs) {
  const meta = writeMonoWav16(name, data);
  console.log(`Generated ${name}: ${meta.sizeBytes} bytes (${meta.durationSec}s)`);
}
