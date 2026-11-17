import { groundHeightAt } from '../geoTheaters';
import { TheaterId, TheaterLandmark } from '../types';

export interface ConvoyWaypoint {
  x: number;
  z: number;
}

const CONVOY_ROUTES: Record<string, ConvoyWaypoint[]> = {
  // Sector 04 Mojave Proving Basin — advances along northern desert wash east-to-west loop
  'edw-cnv1': [
    { x: 420, z: -1680 },
    { x: 180, z: -1650 },
    { x: -160, z: -1540 },
    { x: -390, z: -1320 },
    { x: -120, z: -1080 },
    { x: 260, z: -1240 },
  ],
  'alp-cnv1': [
    { x: 420, z: -1020 },
    { x: 180, z: -1240 },
    { x: -80, z: -1460 },
    { x: 160, z: -1680 },
    { x: 380, z: -1380 },
  ],
  'hor-cnv1': [
    { x: 60, z: -1580 },
    { x: -240, z: -1480 },
    { x: -420, z: -1680 },
    { x: -120, z: -1820 },
    { x: 220, z: -1720 },
  ],
  'bal-cnv1': [
    { x: -240, z: -1420 },
    { x: -460, z: -1580 },
    { x: -180, z: -1760 },
    { x: 140, z: -1620 },
    { x: -40, z: -1460 },
  ],
};

export interface ConvoySegmentState {
  route: ConvoyWaypoint[];
  totalLengthM: number;
  segmentLengths: number[];
}

const cachedRoutes = new Map<string, ConvoySegmentState>();

export function getConvoyRoute(landmarkId: string, originX: number, originZ: number): ConvoySegmentState {
  const cached = cachedRoutes.get(landmarkId);
  if (cached) return cached;

  const base = CONVOY_ROUTES[landmarkId] ?? [
    { x: originX, z: originZ },
    { x: originX - 240, z: originZ + 180 },
    { x: originX - 420, z: originZ - 60 },
    { x: originX - 160, z: originZ - 260 },
  ];

  const segmentLengths: number[] = [];
  let totalLengthM = 0;
  for (let i = 0; i < base.length; i++) {
    const a = base[i];
    const b = base[(i + 1) % base.length];
    const len = Math.max(1, Math.hypot(b.x - a.x, b.z - a.z));
    segmentLengths.push(len);
    totalLengthM += len;
  }

  const built: ConvoySegmentState = { route: base, totalLengthM, segmentLengths };
  cachedRoutes.set(landmarkId, built);
  return built;
}

/**
 * Computes deterministic, terrain-grounded convoy position and travel heading (radians around +Y, Three.js convention)
 * as a pure function of simulation time so 30/60/144 FPS stay bit-identical.
 */
export function evaluateConvoyKinematics(
  lm: Pick<TheaterLandmark, 'id' | 'x' | 'z'>,
  theaterId: TheaterId,
  simTimeSec: number,
  speedMs = 11.5,
): { x: number; y: number; z: number; headingRad: number; speedMs: number } {
  const routeInfo = getConvoyRoute(lm.id, lm.x, lm.z);
  const distAlong = ((simTimeSec * speedMs) % routeInfo.totalLengthM + routeInfo.totalLengthM) % routeInfo.totalLengthM;

  let accum = 0;
  for (let i = 0; i < routeInfo.route.length; i++) {
    const segLen = routeInfo.segmentLengths[i];
    if (accum + segLen >= distAlong || i === routeInfo.route.length - 1) {
      const a = routeInfo.route[i];
      const b = routeInfo.route[(i + 1) % routeInfo.route.length];
      const t = Math.max(0, Math.min(1, (distAlong - accum) / segLen));
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const y = groundHeightAt(theaterId, x, z);
      // Forward of convoy mesh is -Z in Three.js model coordinates -> yaw = atan2(-dx, -dz)
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const headingRad = Math.atan2(-dx, -dz);
      return { x, y, z, headingRad, speedMs };
    }
    accum += segLen;
  }

  return {
    x: lm.x,
    y: groundHeightAt(theaterId, lm.x, lm.z),
    z: lm.z,
    headingRad: 0,
    speedMs,
  };
}
