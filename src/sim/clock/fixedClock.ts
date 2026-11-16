/**
 * Fixed-timestep accumulator clock ensuring frame-rate-independent simulation
 * progression across 30/60/144 FPS and software WebGL (~12.5 Hz) environments.
 */
export const FIXED_TIMESTEP_SEC = 1 / 60;
export const MAX_RAW_FRAME_DT_SEC = 0.25;
export const MAX_SUBSTEPS_PER_FRAME = 16;

export interface FixedClockState {
  realTimeSec: number;
  simTimeSec: number;
  accumulatorSec: number;
  tickCount: number;
  lastSubsteps: number;
}

export function createFixedClock(): FixedClockState {
  return {
    realTimeSec: 0,
    simTimeSec: 0,
    accumulatorSec: 0,
    tickCount: 0,
    lastSubsteps: 0,
  };
}

/**
 * Advances the fixed-timestep accumulator from a variable render frame delta.
 *
 * - Clamps rawFrameDtSec to MAX_RAW_FRAME_DT_SEC so background tab switches or long
 *   hitches never trigger spiral-of-death CPU lockups, while permitting slow renderers
 *   (e.g. SwiftShader at ~80ms/frame) to catch up to 1.0x real-time without slow-motion.
 * - Accumulates scaledDt = clampedRaw * timeScale and drains exact FIXED_TIMESTEP_SEC
 *   steps so 30/60/144 FPS scenarios execute identical discrete dt physics integration.
 */
export function advanceFixedClock(
  clock: FixedClockState,
  rawFrameDtSec: number,
  timeScale: number,
  paused: boolean,
  onFixedStep: (fixedDt: number, simTimeSec: number, stepIndex: number) => void,
): FixedClockState {
  const safeRawDt = Number.isFinite(rawFrameDtSec)
    ? Math.max(0, Math.min(MAX_RAW_FRAME_DT_SEC, rawFrameDtSec))
    : 0;

  clock.realTimeSec += safeRawDt;

  if (paused) {
    clock.lastSubsteps = 0;
    return clock;
  }

  const clampedScale = Number.isFinite(timeScale)
    ? Math.max(0.05, Math.min(4.0, timeScale))
    : 1.0;

  const maxAccum = MAX_SUBSTEPS_PER_FRAME * FIXED_TIMESTEP_SEC;
  clock.accumulatorSec = Math.min(
    maxAccum,
    clock.accumulatorSec + safeRawDt * clampedScale,
  );

  let steps = 0;
  // Tiny epsilon avoids stalling at exact multiples due to binary floating point representation
  while (
    clock.accumulatorSec + 1e-11 >= FIXED_TIMESTEP_SEC &&
    steps < MAX_SUBSTEPS_PER_FRAME
  ) {
    clock.accumulatorSec = Math.max(0, clock.accumulatorSec - FIXED_TIMESTEP_SEC);
    clock.simTimeSec += FIXED_TIMESTEP_SEC;
    clock.tickCount += 1;
    steps += 1;
    onFixedStep(FIXED_TIMESTEP_SEC, clock.simTimeSec, clock.tickCount);
  }

  clock.lastSubsteps = steps;
  return clock;
}
