import {
  AIRFRAMES,
  PROPULSION_MODULES,
  SENSOR_MODULES,
  WEAPONS,
  WEATHERS,
} from './arsenalData';
import { groundHeightAt, THEATERS } from './geoTheaters';
import { computeAtmosphericGravity, computeSolarState } from './solarGravity';
import {
  ActiveOrdnanceState,
  DroneFlightState,
  LoadoutConfig,
  PilotSkillBonuses,
  PredictedImpact,
  SandboxConfig,
  TheaterId,
  TrajectoryPoint,
  WeaponId,
  WeatherId,
} from './types';

export interface FlightControlInput {
  pitchInput: number; // -1 (nose down) .. +1 (nose up)
  rollInput: number; // -1 (left) .. +1 (right)
  yawInput: number; // -1 (left) .. +1 (right)
  throttleDelta: number; // -1 .. +1
}

export interface FlightStepContext {
  theaterId: TheaterId;
  weatherId: WeatherId;
  utcHours: number;
  loadout: LoadoutConfig;
  sandbox: SandboxConfig;
  ordnanceMassKg: number;
  elapsedTimeSec: number;
  flightModel?: 'arcade' | 'realistic';
  skillBonuses?: PilotSkillBonuses;
  kamikazeArmed?: boolean;
  disableFuelDepletion?: boolean;
}

export interface KamikazeImpactYield {
  damage: number;
  blastRadiusM: number;
  warheadKg: number;
}

/**
 * Computes total kinetic + HE-frag warhead yield when a drone dives into a target,
 * factoring in the airframe's internal warhead, unspent onboard munitions cook-off, and pilot skills.
 */
export function computeKamikazeImpactPayload(
  airframeId: LoadoutConfig['airframeId'],
  slots: LoadoutConfig['slots'],
  slotAmmo: [number, number, number, number],
  skillBonuses?: PilotSkillBonuses,
): KamikazeImpactYield {
  const af = AIRFRAMES[airframeId];
  let extraWarheadKg = 0;
  for (let i = 0; i < 4; i++) {
    const w = WEAPONS[slots[i]];
    const count = Math.max(0, slotAmmo[i] ?? 0);
    extraWarheadKg += w.warheadKg * count * 0.28;
  }
  const totalWarheadKg = Math.round((af.kamikazeWarheadKg + extraWarheadKg) * 10) / 10;
  const ammoBoost = Math.min(1.65, 1 + extraWarheadKg / Math.max(30, af.kamikazeWarheadKg * 2.5));
  const dmgMult = skillBonuses?.damageMult ?? 1;
  const blastMult = skillBonuses?.blastRadiusMult ?? 1;
  return {
    warheadKg: totalWarheadKg,
    damage: Math.round(af.kamikazeDamage * ammoBoost * dmgMult),
    blastRadiusM: Math.round(af.kamikazeBlastRadiusM * (0.9 + ammoBoost * 0.12) * blastMult),
  };
}

export interface InstructorManualOverride {
  pitchOverride: number;
  rollOverride: number;
  yawOverride: number;
  throttleDelta: number;
}

/**
 * War Thunder-style Mouse Aim Instructor: converts a desired 3D aim direction vector
 * into smooth bank-into-turn roll, elevator pitch, and coordinated rudder yaw while
 * yielding immediately whenever manual W/S/A/D stick overrides are held.
 */
export function computeInstructorControlInput(
  drone: DroneFlightState,
  aimDir: { x: number; y: number; z: number },
  manual: InstructorManualOverride,
  options: { autoLevel?: boolean } = {},
): FlightControlInput {
  const autoLevel = options.autoLevel ?? true;
  const hasManualPitch = Math.abs(manual.pitchOverride) > 0.05;
  const hasManualRoll = Math.abs(manual.rollOverride) > 0.05;

  const aimLen = Math.max(0.0001, Math.hypot(aimDir.x, aimDir.y, aimDir.z));
  const ax = aimDir.x / aimLen;
  const ay = Math.max(-0.9, Math.min(0.9, aimDir.y / aimLen));
  const az = aimDir.z / aimLen;

  const desiredYaw = Math.atan2(-ax, -az);
  const desiredPitch = Math.asin(ay);

  // Shortest signed yaw angle in [-PI, PI]
  let dYaw = desiredYaw - drone.yaw;
  while (dYaw > Math.PI) dYaw -= Math.PI * 2;
  while (dYaw < -Math.PI) dYaw += Math.PI * 2;

  const dPitch = desiredPitch - drone.pitch;

  // Desired bank-into-turn angle (negative yaw error -> positive right-wing-down / vice versa)
  // Note: in our Three.js convention, +rollInput turns nose left (-roll -> bankRight turns right)
  let desiredRoll = 0;
  if (Math.abs(dYaw) > 0.035) {
    desiredRoll = Math.max(-1.05, Math.min(1.05, dYaw * 2.25));
  } else if (!autoLevel) {
    desiredRoll = drone.roll;
  }

  const dRoll = desiredRoll - drone.roll;
  const instructorRoll = Math.max(-1, Math.min(1, dRoll * 2.4));
  const instructorYaw = Math.max(-1, Math.min(1, dYaw * 2.1));
  const instructorPitch = Math.max(
    -1,
    Math.min(1, dPitch * 3.1 + Math.min(0.45, Math.abs(dYaw) * 0.65) * Math.abs(Math.sin(drone.roll))),
  );

  return {
    pitchInput: hasManualPitch ? manual.pitchOverride : instructorPitch,
    rollInput: hasManualRoll ? manual.rollOverride : instructorRoll,
    yawInput: Math.abs(manual.yawOverride) > 0.05 ? manual.yawOverride : instructorYaw,
    throttleDelta: manual.throttleDelta,
  };
}

export interface MouseAimResult {
  aimYaw: number;
  aimPitch: number;
  targetDir: { x: number; y: number; z: number };
}

/**
 * War Thunder continuous spherical Mouse Aim cursor controller:
 * - Cursor deflection from screen center continuously slews desired 3D aim (full 360° yaw, +-75° pitch)
 *   plus fine immediate offset so small aiming adjustments feel razor sharp.
 * - Holding manual W/S/A/D/Q/E yields to stick overrides and syncs aim to current nose so releasing never snaps back.
 * - Holding Free-Look ('C') freezes the aim vector while camera orbits freely around the aircraft.
 */
export function stepWarThunderAimAngles(
  aimYaw: number,
  aimPitch: number,
  mouseNdcX: number,
  mouseNdcY: number,
  manual: { pitchOverride: number; rollOverride: number; yawOverride: number },
  freeLooking: boolean,
  droneYaw: number,
  dronePitch: number,
  scheme: 'mouse_aim' | 'direct_stick',
  dt: number,
): MouseAimResult {
  const stepDt = Math.min(0.05, Math.max(0.001, dt));
  let nextYaw = aimYaw;
  let nextPitch = aimPitch;

  const hasManual =
    Math.abs(manual.pitchOverride) > 0.05 ||
    Math.abs(manual.rollOverride) > 0.05 ||
    Math.abs(manual.yawOverride) > 0.05;

  if (scheme !== 'mouse_aim' || hasManual) {
    nextYaw = droneYaw;
    nextPitch = dronePitch;
  } else if (!freeLooking) {
    const deadzone = 0.035;
    const mag = Math.hypot(mouseNdcX, mouseNdcY);
    if (mag > deadzone) {
      const scaledX = Math.abs(mouseNdcX) > deadzone ? mouseNdcX - Math.sign(mouseNdcX) * deadzone : 0;
      const scaledY = Math.abs(mouseNdcY) > deadzone ? mouseNdcY - Math.sign(mouseNdcY) * deadzone : 0;
      // Nonlinear War Thunder slew response: delicate precision near center, crisp turn rate at edge
      const yawSlew = -Math.sign(scaledX) * Math.pow(Math.min(1, Math.abs(scaledX)), 1.25) * 1.9;
      const pitchSlew = Math.sign(scaledY) * Math.pow(Math.min(1, Math.abs(scaledY)), 1.25) * 1.45;
      nextYaw += yawSlew * stepDt;
      nextPitch = Math.max(-1.22, Math.min(1.22, nextPitch + pitchSlew * stepDt));
    }
  }

  // Normalize aimYaw to [-PI, PI]
  while (nextYaw > Math.PI) nextYaw -= Math.PI * 2;
  while (nextYaw < -Math.PI) nextYaw += Math.PI * 2;

  const cosP = Math.cos(nextPitch);
  return {
    aimYaw: nextYaw,
    aimPitch: nextPitch,
    targetDir: {
      x: -Math.sin(nextYaw) * cosP,
      y: Math.sin(nextPitch),
      z: -Math.cos(nextYaw) * cosP,
    },
  };
}

/**
 * Computes first-order ballistic/missile lead intercept point for moving aerial targets.
 */
export function computeLeadPoint(
  shooterPos: { x: number; y: number; z: number },
  targetPos: { x: number; y: number; z: number },
  targetVel: { vx: number; vy: number; vz: number },
  projectileSpeedMs: number,
): { x: number; y: number; z: number } {
  const dx = targetPos.x - shooterPos.x;
  const dy = targetPos.y - shooterPos.y;
  const dz = targetPos.z - shooterPos.z;
  const dist = Math.hypot(dx, dy, dz);
  const speed = Math.max(120, projectileSpeedMs);
  const tLead = Math.max(0.04, Math.min(4.0, dist / speed));
  return {
    x: targetPos.x + targetVel.vx * tLead,
    y: targetPos.y + targetVel.vy * tLead,
    z: targetPos.z + targetVel.vz * tLead,
  };
}

/**
 * Advances 6-DOF aerodynamic drone physics with lift, induced drag, stall,
 * crosswind & turbulence, solar photovoltaic charging, WEP afterburner, and local Somigliana gravity.
 */
export function stepDroneFlight(
  state: DroneFlightState,
  input: FlightControlInput,
  ctx: FlightStepContext,
  dt: number,
): DroneFlightState {
  const airframe = AIRFRAMES[ctx.loadout.airframeId];
  const propulsion = PROPULSION_MODULES[ctx.loadout.propulsionId];
  const sensor = SENSOR_MODULES[ctx.loadout.sensorId];
  const weather = WEATHERS[ctx.weatherId];
  const theater = THEATERS[ctx.theaterId];
  const isArcade = (ctx.flightModel ?? 'arcade') === 'arcade';

  const simDt = Math.min(0.05, Math.max(0.001, dt)) * ctx.sandbox.timeScale;

  // Clone mutable values cleanly
  let { x, y, z, vx, vy, vz, pitch, yaw, roll, throttle, fuelKg, hp } = state;

  const maxThrottle = isArcade ? 1.1 : 1.05;
  throttle = Math.max(0.05, Math.min(maxThrottle, throttle + input.throttleDelta * 0.78 * simDt));

  // Solar + Gravitational environment at current position
  const solar = computeSolarState(theater.latDeg, theater.lonDeg, ctx.utcHours, 172, weather.cloudCover);
  const atmos = computeAtmosphericGravity(
    theater.latDeg,
    y + theater.baseElevationM,
    vx,
    vz,
    ctx.sandbox.enabled ? ctx.sandbox.gravityMultiplier : 1.0,
    ctx.sandbox.enabled ? ctx.sandbox.airDensityMultiplier : 1.0,
  );

  // Wind vector (m/s)
  const windRad = (weather.windHeadingDeg * Math.PI) / 180;
  const gust =
    weather.turbulenceIntensity *
    8.5 *
    Math.sin(ctx.elapsedTimeSec * 2.1 + x * 0.01) *
    Math.cos(ctx.elapsedTimeSec * 1.4 + z * 0.01);
  const windVx = Math.sin(windRad) * (weather.windSpeedMs + gust);
  const windVz = -Math.cos(windRad) * (weather.windSpeedMs + gust);
  const windVy = solar.thermalUpdraftMs + weather.turbulenceIntensity * 3.2 * Math.sin(ctx.elapsedTimeSec * 3.3);

  // Control surface authority scales smoothly with dynamic pressure
  const vRelX = vx - windVx;
  const vRelY = vy - windVy;
  const vRelZ = vz - windVz;
  const airspeedMs = Math.max(1, Math.hypot(vRelX, vRelY, vRelZ));
  const skillAgility = ctx.skillBonuses?.agilityMult ?? 1.0;
  const kamikazeAgility = ctx.kamikazeArmed ? 1.22 : 1.0;
  const authority =
    Math.min(1.0, Math.max(isArcade ? 0.55 : 0.38, airspeedMs / 56)) *
    (isArcade ? 1.28 : 1.0) *
    skillAgility *
    kamikazeAgility;

  // Apply pitch, roll, yaw inputs + subtle turbulence kick
  const turbScale = isArcade ? 0.55 : 1.0;
  const turbPitch = weather.turbulenceIntensity * 0.09 * turbScale * Math.sin(ctx.elapsedTimeSec * 5.7);
  const turbRoll = weather.turbulenceIntensity * 0.14 * turbScale * Math.cos(ctx.elapsedTimeSec * 4.9);

  roll += (input.rollInput * airframe.maxRollRateRad * authority + turbRoll) * simDt;
  // Auto-level gently when no roll input is held
  if (Math.abs(input.rollInput) < 0.05) {
    roll *= Math.exp(-(isArcade ? 2.1 : 1.25) * simDt);
  }
  roll = Math.max(-Math.PI * 0.72, Math.min(Math.PI * 0.72, roll));

  pitch += (input.pitchInput * airframe.maxPitchRateRad * authority + turbPitch) * simDt;
  if (Math.abs(input.pitchInput) < 0.05) {
    pitch *= Math.exp(-(isArcade ? 0.45 : 0.32) * simDt);
  }
  pitch = Math.max(-Math.PI * 0.45, Math.min(Math.PI * 0.45, pitch));

  // Coordinated bank-to-turn + rudder yaw
  const bankTurnRate = Math.sin(roll) * (atmos.localGravityMs2 / Math.max(35, airspeedMs)) * (isArcade ? 2.85 : 2.35);
  yaw += (input.yawInput * airframe.maxYawRateRad * authority - bankTurnRate) * simDt;

  // Forward unit vector in Three.js space (+X East, +Y Up, -Z North)
  const cosP = Math.cos(pitch);
  const fwdX = -Math.sin(yaw) * cosP;
  const fwdY = Math.sin(pitch);
  const fwdZ = -Math.cos(yaw) * cosP;

  // Wing up vector rotated by roll around forward axis
  const rightX = Math.cos(yaw);
  const rightZ = Math.sin(yaw);
  const sinR = Math.sin(roll);
  const cosR = Math.cos(roll);

  const upBaseX = Math.sin(yaw) * Math.sin(pitch);
  const upBaseY = Math.cos(pitch);
  const upBaseZ = Math.cos(yaw) * Math.sin(pitch);

  const wingUpX = upBaseX * cosR + rightX * sinR;
  const wingUpY = upBaseY * cosR;
  const wingUpZ = upBaseZ * cosR + rightZ * sinR;

  // Angle of attack (AoA) between relative airspeed and body forward vector
  const dirX = vRelX / airspeedMs;
  const dirY = vRelY / airspeedMs;
  const dirZ = vRelZ / airspeedMs;
  const upDot = dirX * wingUpX + dirY * wingUpY + dirZ * wingUpZ;
  const aoaRad = Math.atan2(-upDot, Math.max(0.1, dirX * fwdX + dirY * fwdY + dirZ * fwdZ));
  const aoaDeg = (aoaRad * 180) / Math.PI;

  const stallRad = (airframe.stallAngleDeg * Math.PI) / 180;
  const minStallSpeedMs = Math.min(isArcade ? 38 : 46, 16 + Math.sqrt(airframe.dryMassKg / Math.max(1, airframe.wingAreaM2)) * 2.8);
  const stalling = Math.abs(aoaRad) > stallRad && airspeedMs < minStallSpeedMs;

  // Effective aerodynamic parameters (including Sandbox modifiers)
  const wingArea =
    airframe.wingAreaM2 * (ctx.sandbox.enabled ? ctx.sandbox.wingAreaMultiplier : 1.0);
  const totalMassKg =
    (airframe.dryMassKg + propulsion.massKg + sensor.massKg + fuelKg + ctx.ordnanceMassKg) *
    (ctx.sandbox.enabled ? ctx.sandbox.massMultiplier : 1.0);

  // Lift coefficient Cl(alpha) with smooth post-stall drop
  const clSlope = (2 * Math.PI * airframe.aspectRatio) / (airframe.aspectRatio + 2);
  const clBase = isArcade ? 0.34 : 0.28; // Cambered wing baseline lift
  let cl = clBase + clSlope * aoaRad;
  if (Math.abs(aoaRad) > stallRad) {
    cl *= isArcade ? 0.72 : 0.55;
  }
  cl = Math.max(-airframe.clMax * 0.65, Math.min(airframe.clMax * (isArcade ? 1.15 : 1.0), cl));

  // Induced + parasitic drag (energy retention tuned for dive-climb Boom-and-Zoom + turn bleed)
  const eOswald = 0.84;
  const turnBleed = 1 + Math.min(0.42, Math.abs(aoaRad) * 0.65);
  const cdInduced = ((cl * cl) / (Math.PI * airframe.aspectRatio * eOswald)) * turnBleed;
  const mach = airspeedMs / atmos.speedOfSoundMs;
  const waveDrag = mach > 0.88 ? Math.pow(mach - 0.88, 2) * 0.12 : 0;
  const skillDragMult = ctx.skillBonuses?.dragMult ?? 1.0;
  const cd = (airframe.cd0 * (isArcade ? 0.82 : 1.0) * skillDragMult) + cdInduced + waveDrag;

  const dynamicPressure = 0.5 * atmos.airDensityKgM3 * airspeedMs * airspeedMs;
  const liftN = dynamicPressure * wingArea * cl;
  const dragN = dynamicPressure * wingArea * cd;

  // Propulsion thrust (with airframe thrust-class scaling, WEP afterburner, Turbomachinery skill & Kamikaze terminal surge)
  const thrustMult = (ctx.sandbox.enabled ? ctx.sandbox.thrustMultiplier : 1.0) * (ctx.skillBonuses?.thrustMult ?? 1.0);
  const airframeThrustScale =
    airframe.dryMassKg < 550 ? Math.min(1.0, Math.max(0.22, (airframe.dryMassKg + 140) / 840)) : 1.0;
  const kamikazeBoost = ctx.kamikazeArmed ? 1.45 : 1.0;
  const hasFuel = ctx.disableFuelDepletion ? true : fuelKg > 0.5;
  const machFactor = mach > propulsion.maxMach ? Math.max(0.18, 1 - (mach - propulsion.maxMach) * 1.35) : 1.0;
  const airDensityThrustFactor = Math.min(1.15, Math.pow(atmos.airDensityKgM3 / 1.225, 0.55));
  const wepThrustMult = throttle > 1.0 ? 1.0 + (throttle - 1.0) * 2.8 : 1.0;
  const thrustN = hasFuel
    ? propulsion.maxThrustN *
      airframeThrustScale *
      kamikazeBoost *
      Math.min(1.0, throttle) *
      wepThrustMult *
      thrustMult *
      machFactor *
      airDensityThrustFactor *
      (isArcade ? 1.15 : 1.0)
    : 0;

  // Solar photovoltaic regeneration & fuel state (disabled in Stage A+ gameplay when disableFuelDepletion is true)
  let solarChargeRateW = 0;
  if (!ctx.disableFuelDepletion) {
    solarChargeRateW =
      solar.irradianceWm2 *
      airframe.solarWingAreaM2 *
      0.24 *
      sensor.solarEfficiencyBonus *
      (ctx.skillBonuses?.solarChargeMult ?? 1.0);
    const wepBurnMult = throttle > 1.0 ? 1.65 : 1.0;
    const skillFuelBurnMult = ctx.skillBonuses?.fuelBurnMult ?? 1.0;
    const fuelBurnKg = thrustN * propulsion.specificFuelConsumption * wepBurnMult * skillFuelBurnMult * 1e-5 * simDt;
    const solarFuelEquivalent = (solarChargeRateW / 45000) * simDt;
    fuelKg = Math.max(0, Math.min(airframe.maxFuelKg, fuelKg - fuelBurnKg + solarFuelEquivalent));
  }

  // Sum forces in world space
  // Lift acts perpendicular to relative airflow along wingUp projection
  const fx = thrustN * fwdX + liftN * wingUpX - dragN * dirX + totalMassKg * atmos.coriolisAccelX;
  const fy = thrustN * fwdY + liftN * wingUpY - dragN * dirY - totalMassKg * atmos.localGravityMs2;
  const fz = thrustN * fwdZ + liftN * wingUpZ - dragN * dirZ + totalMassKg * atmos.coriolisAccelZ;

  // Smooth aerodynamic weathervaning stability (align velocity gradually with nose)
  const ax = fx / totalMassKg;
  const ay = fy / totalMassKg;
  const az = fz / totalMassKg;

  vx += ax * simDt;
  vy += ay * simDt;
  vz += az * simDt;

  // Lateral & vertical weathercock damping keeps flight crisp and responsive for players
  const speed = Math.hypot(vx, vy, vz);
  const alignRate = Math.min(1, (isArcade ? 3.85 : 2.35) * simDt);
  vx += (fwdX * speed - vx) * alignRate;
  vy += (fwdY * speed - vy) * alignRate * 0.42;
  vz += (fwdZ * speed - vz) * alignRate;

  x += vx * simDt;
  y += vy * simDt;
  z += vz * simDt;

  // Soft ceiling & world perimeter turn-back / boundary clamp
  const maxRadius = theater.worldRadiusM * 0.96;
  const distFromCenter = Math.hypot(x, z);
  if (distFromCenter > maxRadius) {
    const scale = maxRadius / distFromCenter;
    x *= scale;
    z *= scale;
    // Gently steer inward
    const inwardYaw = Math.atan2(x, z);
    yaw = yaw + Math.sin(inwardYaw - yaw) * 0.15;
  }

  // Terrain collision & ground clearance floor (disabled pull-up cushion when kamikaze dive is armed)
  const groundY = Math.max(theater.waterLevelM, groundHeightAt(ctx.theaterId, x, z));
  let aglMeters = y - groundY;
  if (ctx.kamikazeArmed) {
    if (aglMeters < 0.5) {
      y = groundY + 0.5;
      aglMeters = 0.5;
    }
  } else if (aglMeters < 6) {
    // Terrain scrape / automatic terrain-following recovery cushion (deals damage if diving hard)
    if (vy < -22) {
      hp = Math.max(0, hp - Math.abs(vy) * 0.85);
    }
    y = groundY + 6;
    vy = Math.max(4, Math.abs(vy) * 0.25);
    pitch = Math.max(0.08, pitch);
    aglMeters = 6;
  }

  y = Math.min(28000, y);

  // Instantaneous G-load felt by airframe
  const gLoad = Math.max(-3, Math.min(airframe.maxG + 2, (liftN / (totalMassKg * 9.80665))));

  // Recompute authoritative post-integration telemetry:
  // distinguish wind-relative airspeed from inertial ground speed & Mach
  const postRelVx = vx - windVx;
  const postRelVy = vy - windVy;
  const postRelVz = vz - windVz;
  const postAirspeedMs = Math.hypot(postRelVx, postRelVy, postRelVz);
  const groundSpeedMs = Math.hypot(vx, vy, vz);
  const postMach = postAirspeedMs / atmos.speedOfSoundMs;

  return {
    ...state,
    x,
    y,
    z,
    vx,
    vy,
    vz,
    pitch,
    yaw,
    roll,
    throttle,
    airspeedMs: postAirspeedMs,
    groundSpeedMs,
    mach: postMach,
    aglMeters,
    aoaDeg,
    gLoad,
    stalling,
    hp,
    fuelKg,
    solarChargeRateW,
  };
}

/**
 * Advances a fired missile, glide bomb, ballistic missile, cruise missile, or cannon projectile
 * using real boost-glide-ballistic equations, L/D lift, proportional navigation, wind, and Coriolis.
 */
export function stepOrdnance(
  ord: ActiveOrdnanceState,
  ctx: {
    theaterId: TheaterId;
    weatherId: WeatherId;
    sandbox: SandboxConfig;
    targetPos?: { x: number; y: number; z: number } | null;
    skillBonuses?: PilotSkillBonuses;
  },
  dt: number,
): ActiveOrdnanceState {
  const spec = WEAPONS[ord.weaponId];
  const weather = WEATHERS[ctx.weatherId];
  const theater = THEATERS[ctx.theaterId];
  const simDt = Math.min(0.05, Math.max(0.001, dt)) * ctx.sandbox.timeScale;

  let { x, y, z, vx, vy, vz, ageSec, wingDeployed, phase } = ord;
  ageSec += simDt;

  if (ctx.targetPos) {
    ord.targetX = ctx.targetPos.x;
    ord.targetY = ctx.targetPos.y;
    ord.targetZ = ctx.targetPos.z;
  }

  const atmos = computeAtmosphericGravity(
    theater.latDeg,
    y + theater.baseElevationM,
    vx,
    vz,
    ctx.sandbox.enabled ? ctx.sandbox.gravityMultiplier : 1.0,
    ctx.sandbox.enabled ? ctx.sandbox.airDensityMultiplier : 1.0,
  );

  const windRad = (weather.windHeadingDeg * Math.PI) / 180;
  const windVx = Math.sin(windRad) * weather.windSpeedMs;
  const windVz = -Math.cos(windRad) * weather.windSpeedMs;

  const vRelX = vx - windVx;
  const vRelY = vy;
  const vRelZ = vz - windVz;
  const speed = Math.max(1, Math.hypot(vRelX, vRelY, vRelZ));

  let ax = atmos.coriolisAccelX;
  let ay = -atmos.localGravityMs2;
  let az = atmos.coriolisAccelZ;

  const guidanceMult =
    (ctx.sandbox.enabled ? ctx.sandbox.guidanceGainMultiplier : 1.0) *
    (ord.ownerId === 'player' ? (ctx.skillBonuses?.guidanceGainMult ?? 1.0) : 1.0);

  if (spec.category === 'cannon') {
    phase = 'bullet';
    // Pure ballistic drop + aerodynamic drag + wind drift
    const dragDecel = 0.00045 * (atmos.airDensityKgM3 / 1.225) * speed;
    ax -= (vRelX / speed) * dragDecel;
    ay -= (vRelY / speed) * dragDecel;
    az -= (vRelZ / speed) * dragDecel;
  } else if (spec.category === 'drop_bomb') {
    phase = 'glide';
    wingDeployed = true;
    // Free-fall shaped-charge drop bomb with fin stabilization + minor optical wind-correction trim
    const dragDecel = 0.00062 * (atmos.airDensityKgM3 / 1.225) * speed;
    ax -= (vRelX / speed) * dragDecel;
    ay -= (vRelY / speed) * dragDecel;
    az -= (vRelZ / speed) * dragDecel;

    const dx = ord.targetX - x;
    const dz = ord.targetZ - z;
    const horizDist = Math.hypot(dx, dz);
    if (horizDist > 4 && horizDist < 1200 && spec.guidanceGain > 0) {
      const trim = spec.guidanceGain * guidanceMult * 0.16;
      ax += (dx / horizDist) * trim * 8;
      az += (dz / horizDist) * trim * 8;
    }
  } else if (spec.category === 'glide_bomb') {
    // Wing deployment 0.35s after release -> high L/D aerodynamic glide
    wingDeployed = ageSec > 0.35;
    phase = 'glide';

    if (wingDeployed) {
      // Lift opposes gravity scaled by glide ratio L/D and air density
      const densityScale = Math.min(1.2, atmos.airDensityKgM3 / 1.0);
      const liftRatio = Math.min(0.92, (spec.glideLiftToDrag / 15.0) * densityScale);
      ay += atmos.localGravityMs2 * liftRatio;
      // Gentle forward glide sustain when descending
      const horizSpeed = Math.hypot(vx, vz);
      if (horizSpeed > 1) {
        const dragDecel = (atmos.localGravityMs2 / Math.max(4, spec.glideLiftToDrag)) * 0.35;
        ax -= (vRelX / speed) * dragDecel;
        az -= (vRelZ / speed) * dragDecel;
      }

      // Terminal GPS/INS/Laser steering toward target
      const dx = ord.targetX - x;
      const dy = ord.targetY - y;
      const dz = ord.targetZ - z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > 5 && dist < 4500) {
        const gain = spec.guidanceGain * guidanceMult;
        const desiredVx = (dx / dist) * speed;
        const desiredVy = (dy / dist) * speed;
        const desiredVz = (dz / dist) * speed;
        ax += (desiredVx - vx) * gain * 0.45;
        ay += (desiredVy - vy) * gain * 0.35;
        az += (desiredVz - vz) * gain * 0.45;
      }
    }
  } else if (spec.category === 'ballistic_missile') {
    const isBoosting = ageSec < spec.boostDurationSec;
    if (isBoosting) {
      phase = 'ballistic_ascent';
      // Lofted 52-degree climb toward target bearing
      const dx = ord.targetX - x;
      const dz = ord.targetZ - z;
      const horizDist = Math.max(1, Math.hypot(dx, dz));
      const loftAngle = 0.88; // ~50 deg boost trajectory
      const dirX = (dx / horizDist) * Math.cos(loftAngle);
      const dirY = Math.sin(loftAngle);
      const dirZ = (dz / horizDist) * Math.cos(loftAngle);
      const thrustAccel = spec.boostThrustN / spec.massKg;
      ax += dirX * thrustAccel;
      ay += dirY * thrustAccel;
      az += dirZ * thrustAccel;
    } else {
      phase = vy > 0 ? 'ballistic_ascent' : 'ballistic_terminal';
      // Atmospheric drag in lower altitudes only
      const dragDecel = 0.00018 * (atmos.airDensityKgM3 / 1.225) * speed;
      ax -= (vRelX / speed) * dragDecel;
      ay -= (vRelY / speed) * dragDecel;
      az -= (vRelZ / speed) * dragDecel;

      // Terminal INS/MaRV correction in final 2.5 seconds / descent
      if (vy < 0) {
        const dx = ord.targetX - x;
        const dy = ord.targetY - y;
        const dz = ord.targetZ - z;
        const dist = Math.max(1, Math.hypot(dx, dy, dz));
        const gain = spec.guidanceGain * guidanceMult * 0.6;
        ax += ((dx / dist) * speed - vx) * gain;
        az += ((dz / dist) * speed - vz) * gain;
      }
    }
  } else {
    // ATGM, AAM, or Cruise Missile with boost/cruise thrust + proportional navigation
    const isBoosting = ageSec < spec.boostDurationSec;
    phase = spec.category === 'cruise_missile' ? 'cruise' : isBoosting ? 'boost' : 'glide';
    const dx = ord.targetX - x;
    const dy = ord.targetY - y;
    const dz = ord.targetZ - z;
    const dist = Math.max(1, Math.hypot(dx, dy, dz));

    if (isBoosting) {
      const thrustAccel = spec.boostThrustN / spec.massKg;
      const maxSpeed = spec.machMax * atmos.speedOfSoundMs;
      if (speed < maxSpeed) {
        ax += (dx / dist) * thrustAccel;
        ay += (dy / dist) * thrustAccel;
        az += (dz / dist) * thrustAccel;
      }
    }

    // Aerodynamic lift balances gravity during powered cruise/homing
    ay += atmos.localGravityMs2 * 0.95;

    const gain = spec.guidanceGain * guidanceMult;
    const desiredSpeed = Math.max(speed, spec.initialSpeedMs + 140);
    const steerScale = Math.min(3.5, gain * 0.85);
    ax += ((dx / dist) * desiredSpeed - vx) * steerScale;
    ay += ((dy / dist) * desiredSpeed - vy) * steerScale;
    az += ((dz / dist) * desiredSpeed - vz) * steerScale;
  }

  vx += ax * simDt;
  vy += ay * simDt;
  vz += az * simDt;

  x += vx * simDt;
  y += vy * simDt;
  z += vz * simDt;

  return {
    ...ord,
    x,
    y,
    z,
    vx,
    vy,
    vz,
    ageSec,
    wingDeployed,
    phase,
  };
}

/**
 * Predicts the full 3D flight trajectory, apogee, flight time, and ground impact
 * coordinates for the selected ordnance (for CCRP/CCIP HUD trajectory arc).
 */
export function predictOrdnanceTrajectory(
  drone: DroneFlightState,
  weaponId: WeaponId,
  targetPos: { x: number; y: number; z: number },
  ctx: {
    theaterId: TheaterId;
    weatherId: WeatherId;
    sandbox: SandboxConfig;
    skillBonuses?: PilotSkillBonuses;
  },
): PredictedImpact {
  const spec = WEAPONS[weaponId];
  const cosP = Math.cos(drone.pitch);
  const fwdX = -Math.sin(drone.yaw) * cosP;
  const fwdY = Math.sin(drone.pitch);
  const fwdZ = -Math.cos(drone.yaw) * cosP;

  let sim: ActiveOrdnanceState = {
    id: 'preview',
    ownerId: 'player',
    weaponId,
    x: drone.x,
    y: drone.y - 1.5,
    z: drone.z,
    vx: drone.vx + fwdX * spec.initialSpeedMs,
    vy: drone.vy + fwdY * spec.initialSpeedMs,
    vz: drone.vz + fwdZ * spec.initialSpeedMs,
    ageSec: 0,
    maxLifetimeSec: 45,
    targetId: null,
    targetX: targetPos.x,
    targetY: targetPos.y,
    targetZ: targetPos.z,
    wingDeployed: false,
    phase: 'glide',
  };

  const points: TrajectoryPoint[] = [{ x: sim.x, y: sim.y, z: sim.z, t: 0 }];
  let apogeeM = sim.y;
  let maxMach = drone.mach;

  // Use a 0.05s integration step aligned with stepOrdnance's stability bound and
  // normalize timeScale to 1.0 so CCRP/CCIP prediction arcs are invariant to slow-motion.
  const stepDt = 0.05;
  const maxSteps = spec.category === 'cannon' ? 80 : 480;
  const sampleStride = spec.category === 'cannon' ? 4 : 10;
  const previewCtx = {
    ...ctx,
    sandbox: { ...ctx.sandbox, timeScale: 1.0 },
    targetPos,
  };
  const theater = THEATERS[ctx.theaterId];
  const densityMult = ctx.sandbox.enabled ? ctx.sandbox.airDensityMultiplier : 1.0;
  const gravMult = ctx.sandbox.enabled ? ctx.sandbox.gravityMultiplier : 1.0;

  for (let i = 0; i < maxSteps; i++) {
    sim = stepOrdnance(sim, previewCtx, stepDt);
    apogeeM = Math.max(apogeeM, sim.y);
    const atmos = computeAtmosphericGravity(
      theater.latDeg,
      sim.y + theater.baseElevationM,
      sim.vx,
      sim.vz,
      gravMult,
      densityMult,
    );
    maxMach = Math.max(maxMach, Math.hypot(sim.vx, sim.vy, sim.vz) / atmos.speedOfSoundMs);

    if (i % sampleStride === 0) {
      points.push({ x: sim.x, y: sim.y, z: sim.z, t: sim.ageSec });
    }

    const groundY = Math.max(
      theater.waterLevelM,
      groundHeightAt(ctx.theaterId, sim.x, sim.z),
    );
    if (sim.y <= groundY) {
      points.push({ x: sim.x, y: groundY, z: sim.z, t: sim.ageSec });
      return {
        points,
        impactX: sim.x,
        impactY: groundY,
        impactZ: sim.z,
        flightTimeSec: sim.ageSec,
        apogeeM,
        maxMach,
      };
    }
  }

  return {
    points,
    impactX: sim.x,
    impactY: sim.y,
    impactZ: sim.z,
    flightTimeSec: sim.ageSec,
    apogeeM,
    maxMach,
  };
}
