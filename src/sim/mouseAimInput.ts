export const BASE_AIM_RAD_PER_PX = 0.0024;
export const BASE_FREELOOK_RAD_PER_PX = 0.0038;
export const MAX_POINTER_DELTA_PX = 380;

export type PointerRoute = 'aim' | 'freelook' | 'eoir' | 'none';

export interface MouseAimInputConfig {
  aimSensitivity: number;
  freeLookSensitivity: number;
  invertY: boolean;
  aimSmoothing: number; // 0 .. 1
}

export interface MouseInputState {
  pointerLocked: boolean;
  pointerInside: boolean;
  lastClientX: number | null;
  lastClientY: number | null;
  skipNextSamples: number;
  accumAimPxX: number;
  accumAimPxY: number;
  accumFreeLookPxX: number;
  accumFreeLookPxY: number;
  accumEoirPxX: number;
  accumEoirPxY: number;
  lastRawDeltaX: number;
  lastRawDeltaY: number;
}

export interface ConsumedMouseInput {
  aimDeltaYawRad: number;
  aimDeltaPitchRad: number;
  freeLookDeltaYawRad: number;
  freeLookDeltaPitchRad: number;
  eoirDeltaYawRad: number;
  eoirDeltaPitchRad: number;
  rawDeltaX: number;
  rawDeltaY: number;
  appliedAimSensitivity: number;
  appliedFreeLookSensitivity: number;
}

export function createMouseInputState(): MouseInputState {
  return {
    pointerLocked: false,
    pointerInside: false,
    lastClientX: null,
    lastClientY: null,
    skipNextSamples: 0,
    accumAimPxX: 0,
    accumAimPxY: 0,
    accumFreeLookPxX: 0,
    accumFreeLookPxY: 0,
    accumEoirPxX: 0,
    accumEoirPxY: 0,
    lastRawDeltaX: 0,
    lastRawDeltaY: 0,
  };
}

/**
 * Single sensitivity mapping stage: converts pixel deltas to angular radians.
 * Sensitivity is applied ONCE here and nowhere else downstream.
 */
export function convertMouseDeltaPxToRadians(
  deltaPxX: number,
  deltaPxY: number,
  sensitivity: number,
  radPerPx: number,
  invertY: boolean,
): { deltaYawRad: number; deltaPitchRad: number } {
  const safeSens = Number.isFinite(sensitivity) ? Math.max(0.1, Math.min(4.0, sensitivity)) : 1.0;
  // Moving mouse right (+X) decreases yaw (rightward turn in Three.js -Z forward convention)
  const deltaYawRad = -deltaPxX * radPerPx * safeSens || 0;
  // Moving mouse up on screen (clientY decreases -> -Y) increases pitch (+Y up) unless invertY
  const ySign = invertY ? 1 : -1;
  const deltaPitchRad = deltaPxY * radPerPx * safeSens * ySign || 0;
  return { deltaYawRad, deltaPitchRad };
}

export function clearMousePendingDeltas(state: MouseInputState, resetAnchor = false): void {
  state.accumAimPxX = 0;
  state.accumAimPxY = 0;
  state.accumFreeLookPxX = 0;
  state.accumFreeLookPxY = 0;
  state.accumEoirPxX = 0;
  state.accumEoirPxY = 0;
  state.lastRawDeltaX = 0;
  state.lastRawDeltaY = 0;
  if (resetAnchor) {
    state.lastClientX = null;
    state.lastClientY = null;
  }
}

export function handleMouseFocusLoss(state: MouseInputState): void {
  state.pointerInside = false;
  state.pointerLocked = false;
  state.skipNextSamples = 1;
  clearMousePendingDeltas(state, true);
}

export function handleMousePointerEnter(state: MouseInputState, clientX: number, clientY: number): void {
  state.pointerInside = true;
  if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
    state.lastClientX = clientX;
    state.lastClientY = clientY;
  }
  state.skipNextSamples = 0;
}

export function handleMousePointerLeave(state: MouseInputState): void {
  state.pointerInside = false;
  clearMousePendingDeltas(state, true);
}

export function handleMousePointerLockChange(state: MouseInputState, isLocked: boolean): void {
  state.pointerLocked = isLocked;
  // Ignore up to 1 transient OS cursor-warp sample immediately across lock transition
  state.skipNextSamples = 1;
  clearMousePendingDeltas(state, true);
}

export function handleMousePointerLockError(state: MouseInputState): void {
  state.pointerLocked = false;
  state.skipNextSamples = 1;
  clearMousePendingDeltas(state, true);
}

export function handleMousePointerMove(
  state: MouseInputState,
  event: {
    clientX: number;
    clientY: number;
    movementX?: number;
    movementY?: number;
  },
  route: PointerRoute,
): { dx: number; dy: number; ignored: boolean } {
  if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
    return { dx: 0, dy: 0, ignored: true };
  }

  let dx = 0;
  let dy = 0;

  if (state.pointerLocked) {
    dx = Number.isFinite(event.movementX) ? (event.movementX as number) : 0;
    dy = Number.isFinite(event.movementY) ? (event.movementY as number) : 0;
    if (state.skipNextSamples > 0) {
      state.skipNextSamples -= 1;
      state.lastClientX = event.clientX;
      state.lastClientY = event.clientY;
      return { dx: 0, dy: 0, ignored: true };
    }
  } else {
    state.pointerInside = true;
    // First valid sample establishes reference anchor with zero delta
    if (state.lastClientX === null || state.lastClientY === null || state.skipNextSamples > 0) {
      state.lastClientX = event.clientX;
      state.lastClientY = event.clientY;
      if (state.skipNextSamples > 0) state.skipNextSamples -= 1;
      return { dx: 0, dy: 0, ignored: true };
    }
    dx = event.clientX - state.lastClientX;
    dy = event.clientY - state.lastClientY;
    state.lastClientX = event.clientX;
    state.lastClientY = event.clientY;
  }

  // Clamp/drop pathological pointer warp spikes caused by OS cursor jumps or window restore
  if (Math.abs(dx) > MAX_POINTER_DELTA_PX || Math.abs(dy) > MAX_POINTER_DELTA_PX) {
    return { dx: 0, dy: 0, ignored: true };
  }

  if (dx === 0 && dy === 0) {
    return { dx: 0, dy: 0, ignored: false };
  }

  state.lastRawDeltaX = dx;
  state.lastRawDeltaY = dy;

  if (route === 'aim') {
    state.accumAimPxX += dx;
    state.accumAimPxY += dy;
  } else if (route === 'freelook') {
    state.accumFreeLookPxX += dx;
    state.accumFreeLookPxY += dy;
  } else if (route === 'eoir') {
    state.accumEoirPxX += dx;
    state.accumEoirPxY += dy;
  }

  return { dx, dy, ignored: false };
}

export function consumeMouseFrameInput(
  state: MouseInputState,
  config: MouseAimInputConfig,
): ConsumedMouseInput {
  const aimRad = convertMouseDeltaPxToRadians(
    state.accumAimPxX,
    state.accumAimPxY,
    config.aimSensitivity,
    BASE_AIM_RAD_PER_PX,
    config.invertY,
  );
  const freeLookRad = convertMouseDeltaPxToRadians(
    state.accumFreeLookPxX,
    state.accumFreeLookPxY,
    config.freeLookSensitivity,
    BASE_FREELOOK_RAD_PER_PX,
    config.invertY,
  );
  const eoirRad = convertMouseDeltaPxToRadians(
    state.accumEoirPxX,
    state.accumEoirPxY,
    config.freeLookSensitivity,
    BASE_FREELOOK_RAD_PER_PX * 0.65,
    config.invertY,
  );

  const rawDeltaX = state.lastRawDeltaX;
  const rawDeltaY = state.lastRawDeltaY;

  state.accumAimPxX = 0;
  state.accumAimPxY = 0;
  state.accumFreeLookPxX = 0;
  state.accumFreeLookPxY = 0;
  state.accumEoirPxX = 0;
  state.accumEoirPxY = 0;
  state.lastRawDeltaX = 0;
  state.lastRawDeltaY = 0;

  return {
    aimDeltaYawRad: aimRad.deltaYawRad,
    aimDeltaPitchRad: aimRad.deltaPitchRad,
    freeLookDeltaYawRad: freeLookRad.deltaYawRad,
    freeLookDeltaPitchRad: freeLookRad.deltaPitchRad,
    eoirDeltaYawRad: eoirRad.deltaYawRad,
    eoirDeltaPitchRad: eoirRad.deltaPitchRad,
    rawDeltaX,
    rawDeltaY,
    appliedAimSensitivity: config.aimSensitivity,
    appliedFreeLookSensitivity: config.freeLookSensitivity,
  };
}
