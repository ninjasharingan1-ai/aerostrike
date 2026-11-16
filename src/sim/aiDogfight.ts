import { computeLeadPoint } from './flightPhysics';
import { groundHeightAt, THEATERS } from './geoTheaters';
import { AirframeId, BotRole, BotTeam, TheaterId } from './types';

export interface AiCombatBot {
  id: string;
  callsign: string;
  team: BotTeam;
  role: BotRole;
  airframeId: AirframeId;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  roll: number;
  speedMs: number;
  hp: number;
  maxHp: number;
  state: 'patrol' | 'climb' | 'dive_attack' | 'turn_fight' | 'evade' | 'strafing';
  targetId: string | null;
  cannonCooldown: number;
  missileCooldown: number;
  flareCooldown: number;
  flaresRemaining: number;
  evadeTimer: number;
  maneuverSeed: number;
  hitFlash: number;
  respawnTimer: number;
}

export interface AiTargetCandidate {
  id: string;
  team: BotTeam;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  isGround?: boolean;
}

export interface AiStepResult {
  bot: AiCombatBot;
  wantsCannon: boolean;
  wantsMissile: boolean;
  wantsFlares: boolean;
  aimPoint: { x: number; y: number; z: number };
  targetId: string | null;
}

export function createAiBotSquadron(theaterId: TheaterId): AiCombatBot[] {
  const th = THEATERS[theaterId];
  const defs: {
    id: string;
    callsign: string;
    team: BotTeam;
    role: BotRole;
    airframeId: AirframeId;
    x: number;
    z: number;
    altOffset: number;
    hp: number;
    seed: number;
  }[] = [
    // Allied Alpha Wingmen
    {
      id: 'ally-falcon-2',
      callsign: 'ALPHA-2 FALCON',
      team: 'alpha',
      role: 'wingman',
      airframeId: 'bayraktar_tb2',
      x: -180,
      z: 860,
      altOffset: 430,
      hp: 115,
      seed: 0.4,
    },
    {
      id: 'ally-viper-3',
      callsign: 'ALPHA-3 VIPER',
      team: 'alpha',
      role: 'wingman',
      airframeId: 'iai_harop',
      x: 190,
      z: 880,
      altOffset: 460,
      hp: 110,
      seed: 2.1,
    },
    // Hostile Bravo Squadron with distinct War Thunder AI policies
    {
      id: 'bravo-orion-1',
      callsign: 'ORION-RED-1',
      team: 'bravo',
      role: 'interceptor',
      airframeId: 'orion_ru',
      x: -750,
      z: -1250,
      altOffset: 680,
      hp: 120,
      seed: 1.2,
    },
    {
      id: 'bravo-lancet-2',
      callsign: 'LANCET-ACE-2',
      team: 'bravo',
      role: 'dogfighter',
      airframeId: 'zala_lancet',
      x: 680,
      z: -1050,
      altOffset: 490,
      hp: 95,
      seed: 2.8,
    },
    {
      id: 'bravo-geran-3',
      callsign: 'GERAN-STRIKER-3',
      team: 'bravo',
      role: 'striker',
      airframeId: 'shahed_136',
      x: 220,
      z: -1650,
      altOffset: 310,
      hp: 105,
      seed: 4.1,
    },
    {
      id: 'bravo-mohajer-4',
      callsign: 'MOHAJER-PATROL-4',
      team: 'bravo',
      role: 'dogfighter',
      airframeId: 'mohajer_6',
      x: -1050,
      z: -800,
      altOffset: 540,
      hp: 110,
      seed: 5.3,
    },
  ];

  return defs.map((d) => {
    const gy = Math.max(th.waterLevelM, groundHeightAt(theaterId, d.x, d.z));
    const yaw = d.team === 'alpha' ? 0 : Math.PI;
    const speed = d.role === 'interceptor' ? 128 : d.role === 'striker' ? 105 : 118;
    return {
      id: d.id,
      callsign: d.callsign,
      team: d.team,
      role: d.role,
      airframeId: d.airframeId,
      x: d.x,
      y: gy + d.altOffset,
      z: d.z,
      vx: -Math.sin(yaw) * speed,
      vy: 0,
      vz: -Math.cos(yaw) * speed,
      yaw,
      pitch: 0,
      roll: 0,
      speedMs: speed,
      hp: d.hp,
      maxHp: d.hp,
      state: d.role === 'interceptor' ? 'climb' : d.role === 'striker' ? 'strafing' : 'turn_fight',
      targetId: null,
      cannonCooldown: 1.5 + d.seed * 0.4,
      missileCooldown: 5 + d.seed * 1.2,
      flareCooldown: 0,
      flaresRemaining: 6,
      evadeTimer: 0,
      maneuverSeed: d.seed,
      hitFlash: 0,
      respawnTimer: 0,
    };
  });
}

function normalizeAngle(a: number): number {
  let out = a;
  while (out > Math.PI) out -= Math.PI * 2;
  while (out < -Math.PI) out += Math.PI * 2;
  return out;
}

/**
 * Steps a War Thunder-style tactical AI combat bot using Boom-and-Zoom energy cycles,
 * turn-fight lead pursuit, missile flare evasion, terrain clearance, and GNSS cyber disruption.
 */
export function stepAiCombatBot(
  bot: AiCombatBot,
  candidates: AiTargetCandidate[],
  ctx: {
    theaterId: TheaterId;
    sortieTimeSec: number;
    incomingMissileDistM: number | null;
    compromisedKind: string | null;
    gnssSpoofed: boolean;
    dt: number;
    rng?: () => number;
  },
): AiStepResult {
  const rand = ctx.rng ?? Math.random;
  const dt = Math.min(0.05, Math.max(0.001, ctx.dt));
  const next = { ...bot };
  next.cannonCooldown = Math.max(0, next.cannonCooldown - dt);
  next.missileCooldown = Math.max(0, next.missileCooldown - dt);
  next.flareCooldown = Math.max(0, next.flareCooldown - dt);
  next.evadeTimer = Math.max(0, next.evadeTimer - dt);
  next.hitFlash = Math.max(0, next.hitFlash - dt);

  const isCompromised = ctx.compromisedKind !== null;
  const isHijacked = ctx.compromisedKind === 'c2_hijack' || ctx.compromisedKind === 'firmware_brick';

  // Filter enemy candidates opposite to bot's team
  const hostiles = candidates.filter((c) => c.team !== next.team);
  let chosenTarget: AiTargetCandidate | null = null;
  let bestScore = Infinity;

  for (const h of hostiles) {
    const d = Math.hypot(h.x - next.x, h.y - next.y, h.z - next.z);
    // Strikers prefer ground or forward sector targets; interceptors/dogfighters prefer air targets
    const roleBias =
      next.role === 'striker'
        ? h.isGround
          ? 0.45
          : 1.5
        : h.isGround
          ? 2.4
          : 1.0;
    const sc = d * roleBias;
    if (sc < bestScore) {
      bestScore = sc;
      chosenTarget = h;
    }
  }

  // Trigger defensive flare pop & hard break-turn if an incoming missile threatens
  let wantsFlares = false;
  if (
    !isCompromised &&
    ctx.incomingMissileDistM !== null &&
    ctx.incomingMissileDistM < 720 &&
    next.flareCooldown <= 0 &&
    next.flaresRemaining > 0
  ) {
    wantsFlares = true;
    next.flaresRemaining -= 1;
    next.flareCooldown = 4.2;
    next.evadeTimer = 2.6;
    next.state = 'evade';
  }

  const th = THEATERS[ctx.theaterId];
  const groundAhead = Math.max(th.waterLevelM, groundHeightAt(ctx.theaterId, next.x + next.vx * 1.4, next.z + next.vz * 1.4));

  // Choose steering aim point in world space
  let aimPoint: { x: number; y: number; z: number } = {
    x: next.x + Math.sin(ctx.sortieTimeSec * 0.35 + next.maneuverSeed) * 600,
    y: groundAhead + 480,
    z: next.z + Math.cos(ctx.sortieTimeSec * 0.35 + next.maneuverSeed) * 600,
  };

  if (ctx.gnssSpoofed) {
    // GNSS spoofing drags navigation off-axis in wild oscillations
    aimPoint = {
      x: next.x + Math.sin(ctx.sortieTimeSec * 1.9 + next.maneuverSeed) * 900,
      y: groundAhead + 420 + Math.cos(ctx.sortieTimeSec * 2.3) * 140,
      z: next.z + Math.cos(ctx.sortieTimeSec * 1.9 + next.maneuverSeed) * 900,
    };
  } else if (next.evadeTimer > 0) {
    // Hard defensive break-turn + barrel jink
    const breakDir = next.maneuverSeed % 2 > 1 ? 1 : -1;
    const evadeYaw = next.yaw + breakDir * 1.55;
    aimPoint = {
      x: next.x - Math.sin(evadeYaw) * 650,
      y: Math.max(groundAhead + 240, next.y + Math.sin(ctx.sortieTimeSec * 4.2) * 180),
      z: next.z - Math.cos(evadeYaw) * 650,
    };
  } else if (chosenTarget) {
    const dist = Math.hypot(chosenTarget.x - next.x, chosenTarget.y - next.y, chosenTarget.z - next.z);
    if (next.role === 'interceptor') {
      // Boom-and-Zoom policy: climb above target, then dive at high speed
      const altAdvantage = next.y - chosenTarget.y;
      if (next.state === 'climb') {
        aimPoint = {
          x: chosenTarget.x * 0.4,
          y: Math.max(groundAhead + 520, chosenTarget.y + 360),
          z: chosenTarget.z * 0.4,
        };
        if (altAdvantage > 260 || dist > 2100) {
          next.state = 'dive_attack';
        }
      } else {
        aimPoint = computeLeadPoint(next, chosenTarget, chosenTarget, 460);
        next.state = 'dive_attack';
        if (dist < 260 || altAdvantage < -90) {
          next.state = 'climb';
        }
      }
    } else if (next.role === 'striker') {
      // Terrain-hugging strafing pass with sinusoidal flak weave
      const weave = Math.sin(ctx.sortieTimeSec * 1.4 + next.maneuverSeed) * 260;
      const dx = chosenTarget.x - next.x;
      const dz = chosenTarget.z - next.z;
      const horiz = Math.max(1, Math.hypot(dx, dz));
      const perpX = -dz / horiz;
      const perpZ = dx / horiz;
      aimPoint = {
        x: chosenTarget.x + perpX * (dist > 650 ? weave : 0),
        y: Math.max(groundAhead + 180, chosenTarget.y + (dist > 650 ? 220 : 40)),
        z: chosenTarget.z + perpZ * (dist > 650 ? weave : 0),
      };
      next.state = 'strafing';
    } else {
      // Dogfighter & Wingman: aggressive lead pursuit + lag displacement when too close
      next.state = 'turn_fight';
      if (dist < 240) {
        // High-yo-yo overshoot recovery so bot doesn't collide
        aimPoint = {
          x: chosenTarget.x + Math.sin(next.maneuverSeed + ctx.sortieTimeSec) * 320,
          y: Math.max(groundAhead + 260, chosenTarget.y + 210),
          z: chosenTarget.z + Math.cos(next.maneuverSeed + ctx.sortieTimeSec) * 320,
        };
      } else {
        aimPoint = computeLeadPoint(next, chosenTarget, chosenTarget, 480);
      }
    }
  }

  // Enforce terrain avoidance floor & world boundary tether
  const groundNow = Math.max(th.waterLevelM, groundHeightAt(ctx.theaterId, next.x, next.z));
  if (next.y < groundNow + 95) {
    aimPoint.y = Math.max(aimPoint.y, groundNow + 320);
  }
  const distCenter = Math.hypot(next.x, next.z);
  if (distCenter > th.worldRadiusM * 0.72) {
    aimPoint.x = 0;
    aimPoint.z = -500;
    aimPoint.y = Math.max(aimPoint.y, groundNow + 420);
  }

  // Desired bearing & pitch
  const adx = aimPoint.x - next.x;
  const ady = aimPoint.y - next.y;
  const adz = aimPoint.z - next.z;
  const aimDist = Math.max(1, Math.hypot(adx, ady, adz));
  const desiredYaw = Math.atan2(-adx, -adz);
  const desiredPitch = Math.max(-0.55, Math.min(0.55, Math.asin(Math.max(-0.85, Math.min(0.85, ady / aimDist)))));

  const yawErr = normalizeAngle(desiredYaw - next.yaw);
  const pitchErr = desiredPitch - next.pitch;

  // Turn authority scales by role
  const maxTurnRate =
    next.role === 'dogfighter' ? 1.35 : next.role === 'wingman' ? 1.25 : next.role === 'interceptor' ? 1.05 : 0.85;
  const turnMult = isCompromised ? 0.55 : next.evadeTimer > 0 ? 1.3 : 1.0;

  next.yaw = normalizeAngle(next.yaw + Math.max(-maxTurnRate * turnMult, Math.min(maxTurnRate * turnMult, yawErr * 2.2)) * dt);
  next.pitch = Math.max(
    -0.62,
    Math.min(0.62, next.pitch + Math.max(-1.1, Math.min(1.1, pitchErr * 2.4)) * dt),
  );

  // Authentic War Thunder bank-into-turn visual roll (with cyber hijack jitter)
  const desiredRoll = isHijacked
    ? Math.sin(ctx.sortieTimeSec * 10.5) * 1.4
    : Math.max(-1.05, Math.min(1.05, yawErr * 2.1));
  next.roll += (desiredRoll - next.roll) * Math.min(1, 5.5 * dt);

  // Energy-aware speed update (dive speeds up, climb/hard turn bleeds gently)
  const baseSpeed =
    next.role === 'interceptor' ? 138 : next.role === 'dogfighter' ? 124 : next.role === 'wingman' ? 126 : 108;
  const targetSpeed = Math.max(
    78,
    Math.min(185, baseSpeed - Math.sin(next.pitch) * 34 - Math.abs(yawErr) * 14),
  ) * (isCompromised ? 0.72 : 1.0);
  next.speedMs += (targetSpeed - next.speedMs) * Math.min(1, 1.8 * dt);

  const cosP = Math.cos(next.pitch);
  const fwdX = -Math.sin(next.yaw) * cosP;
  const fwdY = Math.sin(next.pitch);
  const fwdZ = -Math.cos(next.yaw) * cosP;

  next.vx = fwdX * next.speedMs;
  next.vy = fwdY * next.speedMs;
  next.vz = fwdZ * next.speedMs;
  next.x += next.vx * dt;
  next.y = Math.max(groundNow + 48, next.y + next.vy * dt);
  next.z += next.vz * dt;
  next.targetId = chosenTarget?.id ?? null;

  // Firing decision based on nose cone alignment & range
  let wantsCannon = false;
  let wantsMissile = false;
  if (!isCompromised && !ctx.gnssSpoofed && chosenTarget) {
    const tdx = chosenTarget.x - next.x;
    const tdy = chosenTarget.y - next.y;
    const tdz = chosenTarget.z - next.z;
    const tDist = Math.max(1, Math.hypot(tdx, tdy, tdz));
    const noseDot = (fwdX * tdx + fwdY * tdy + fwdZ * tdz) / tDist;

    // Fire 20mm tracer bursts when nose is aligned (< 22 deg) and inside gun envelope (< 1250m)
    if (noseDot > 0.92 && tDist < 1250 && next.cannonCooldown <= 0) {
      wantsCannon = true;
      next.cannonCooldown = 0.24 + rand() * 0.14;
    }

    // Fire AAM/ATGM when aligned (< 32 deg) and in range (350m - 2100m)
    if (noseDot > 0.84 && tDist > 340 && tDist < 2100 && next.missileCooldown <= 0) {
      wantsMissile = true;
      next.missileCooldown = next.team === 'alpha' ? 7.5 : 8.5 + rand() * 3.5;
    }
  }

  return {
    bot: next,
    wantsCannon,
    wantsMissile,
    wantsFlares,
    aimPoint,
    targetId: chosenTarget?.id ?? null,
  };
}
