import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AUDIO_ASSET_MANIFEST, STAGE_A_PATHS } from '../assets/assetManifest';
import { AIRFRAMES, DEFAULT_LOADOUT, WEAPONS } from './arsenalData';
import { createAiBotSquadron, stepAiCombatBot } from './aiDogfight';
import {
  aimAnglesToDirection,
  computeDirectionAngularErrorRad,
  computeInstructorControlInput,
  computeKamikazeImpactPayload,
  computeLeadPoint,
  predictOrdnanceTrajectory,
  stepDroneFlight,
  stepWarThunderAimAngles,
  wrapAngleRad,
} from './flightPhysics';
import {
  BASE_AIM_RAD_PER_PX,
  consumeMouseFrameInput,
  convertMouseDeltaPxToRadians,
  createMouseInputState,
  handleMouseFocusLoss,
  handleMousePointerEnter,
  handleMousePointerLeave,
  handleMousePointerLockChange,
  handleMousePointerLockError,
  handleMousePointerMove,
} from './mouseAimInput';
import { groundHeightAt, THEATERS, worldToLatLon } from './geoTheaters';
import {
  GUN_SUBCATEGORIES,
  checkWeaponCompatibility,
  cycleFireMode,
  getAllowedFireModes,
  normalizeLoadoutConfig,
} from './weaponCompatibility';
import {
  awardSortieRewards,
  canUpgradeSkill,
  computePilotSkillBonuses,
  INITIAL_PROGRESSION,
  rankFromXp,
  resetPilotSkills,
  unlockTechItem,
  upgradePilotSkill,
} from './progression';
import {
  appendAarEvent,
  appendAarSample,
  createAarReport,
  exportAarJson,
  formatSortieClock,
} from './aarLogger';
import { evaluateCyberLink, isPacketAligned } from './cyberWarfare';
import {
  advanceFixedClock,
  createFixedClock,
  FIXED_TIMESTEP_SEC,
  MAX_RAW_FRAME_DT_SEC,
} from './clock/fixedClock';
import { SeededRng } from './clock/seededRng';
import { evaluateConvoyKinematics } from './core/groundConvoys';
import { SimStepInput, SimWorld } from './core/simWorld';
import { applyGraphicsPreset } from './settings';
import { computeAtmosphericGravity, computeSolarState } from './solarGravity';
import { DroneFlightState, GunAudioProfile, SandboxConfig } from './types';

const DEFAULT_SANDBOX: SandboxConfig = {
  enabled: false,
  gravityMultiplier: 1,
  airDensityMultiplier: 1,
  thrustMultiplier: 1,
  wingAreaMultiplier: 1,
  massMultiplier: 1,
  guidanceGainMultiplier: 1,
  timeScale: 1,
  infiniteAmmo: false,
  unlockAllInSandbox: false,
};

function makeBaselineDrone(): DroneFlightState {
  return {
    x: 0,
    y: 450,
    z: 0,
    vx: 0,
    vy: 0,
    vz: -85,
    pitch: 0,
    yaw: 0,
    roll: 0,
    throttle: 0.75,
    airspeedMs: 85,
    groundSpeedMs: 85,
    mach: 0.25,
    aglMeters: 450,
    aoaDeg: 0,
    gLoad: 1,
    stalling: false,
    hp: 120,
    maxHp: 120,
    fuelKg: 240,
    maxFuelKg: 300,
    solarChargeRateW: 0,
  };
}

test('solar ephemeris produces daylight zenith at local noon and darkness at midnight', () => {
  const noon = computeSolarState(34.9, -117.88, 19.85, 172, 0.05);
  assert.equal(noon.isDaylight, true);
  assert.ok(noon.elevationDeg > 70, `Expected high solar elevation at noon, got ${noon.elevationDeg}`);
  assert.ok(noon.irradianceWm2 > 750, `Expected high irradiance at noon, got ${noon.irradianceWm2}`);

  const midnight = computeSolarState(34.9, -117.88, 7.85, 172, 0.05);
  assert.equal(midnight.isDaylight, false);
  assert.equal(midnight.irradianceWm2, 0);
});

test('Somigliana gravity increases at higher latitudes and decays with orbital altitude', () => {
  const equator = computeAtmosphericGravity(0, 0, 0, 0);
  const pole = computeAtmosphericGravity(85, 0, 0, 0);
  assert.ok(pole.localGravityMs2 > equator.localGravityMs2, 'Polar gravity should exceed equatorial gravity');

  const seaLevel = computeAtmosphericGravity(35, 0, 0, 0);
  const highAlt = computeAtmosphericGravity(35, 50000, 0, 0);
  assert.ok(highAlt.localGravityMs2 < seaLevel.localGravityMs2, 'Gravity should decay at 50km altitude');
  assert.ok(highAlt.airDensityKgM3 < seaLevel.airDensityKgM3 * 0.05, 'Air density drops sharply at 50km');
});

test('6-DOF flight physics keeps drone airborne with positive throttle and responds to pitch/roll', () => {
  let drone = makeBaselineDrone();
  for (let i = 0; i < 60; i++) {
    drone = stepDroneFlight(
      drone,
      { pitchInput: 0, rollInput: 0, yawInput: 0, throttleDelta: 0 },
      {
        theaterId: 'edwards',
        weatherId: 'clear',
        utcHours: 19,
        loadout: DEFAULT_LOADOUT,
        sandbox: DEFAULT_SANDBOX,
        ordnanceMassKg: 240,
        elapsedTimeSec: i * 0.03,
      },
      0.03,
    );
  }
  assert.ok(drone.y > 200, 'Drone should sustain altitude in level cruise');
  assert.ok(drone.airspeedMs > 50, 'Drone should maintain forward airspeed');
  assert.ok(drone.solarChargeRateW > 100, 'Daylight sortie should generate solar power');
});

test('ballistic missile achieves higher apogee than glide bomb and glide bomb extends range', () => {
  const drone = makeBaselineDrone();
  drone.y = 950;
  const target = { x: 0, y: 100, z: -2200 };

  const glidePred = predictOrdnanceTrajectory(drone, 'gbu39_sdb', target, {
    theaterId: 'edwards',
    weatherId: 'clear',
    sandbox: DEFAULT_SANDBOX,
  });

  const ballisticPred = predictOrdnanceTrajectory(drone, 'mim140_ballistic', target, {
    theaterId: 'edwards',
    weatherId: 'clear',
    sandbox: DEFAULT_SANDBOX,
  });

  assert.ok(
    ballisticPred.apogeeM > glidePred.apogeeM + 300,
    `Ballistic apogee (${ballisticPred.apogeeM}) should far exceed glide bomb apogee (${glidePred.apogeeM})`,
  );
  assert.ok(ballisticPred.maxMach > 1.5, 'Ballistic missile should exceed Mach 1.5');
});

test('geo theaters share deterministic DEM heightfield and WGS84 coordinate projection', () => {
  const h1 = groundHeightAt('alps', 600, -1200);
  const h2 = groundHeightAt('alps', 600, -1200);
  assert.equal(h1, h2);
  assert.ok(h1 > 20, 'Alpine flank should rise above valley floor');

  const coord = worldToLatLon('edwards', 1113, -1113);
  assert.ok(coord.lat > 34.9054 && coord.lon > -117.8839);
});

test('progression awards XP, ranks up, and gates/unlocks military technology', () => {
  let prog = INITIAL_PROGRESSION;
  const lockedFail = unlockTechItem(prog, 'airframe', 'xq58a');
  assert.equal(lockedFail.ok, false);

  prog = awardSortieRewards(prog, { xpEarned: 1500, rcEarned: 600, groundStrikes: 4, cepMeters: 1.4, completed: true });
  assert.ok(rankFromXp(prog.xp) >= 3);
  assert.equal(prog.bestCepMeters, 1.4);

  const unlockValkyrie = unlockTechItem(prog, 'airframe', 'xq58a');
  assert.equal(unlockValkyrie.ok, true);
  assert.ok(unlockValkyrie.progression.unlockedAirframes.includes('xq58a'));
});

test('cyber warfare link evaluation accounts for EW pods, range, packet sync, and unlocks', () => {
  const stdLink = evaluateCyberLink('scada_sabotage', 1800, 'eoir_das4', 0.2);
  const ewLink = evaluateCyberLink('scada_sabotage', 1800, 'ew_jammer', 0.2);
  assert.equal(stdLink.inRange, true);
  assert.ok(ewLink.effectiveRangeM > stdLink.effectiveRangeM);
  assert.ok(ewLink.breachWindowWidth > stdLink.breachWindowWidth);

  const outOfRange = evaluateCyberLink('firmware_brick', 5200, 'eoir_das4', 0);
  assert.equal(outOfRange.inRange, false);
  assert.equal(outOfRange.success, false);

  assert.equal(isPacketAligned(0.52, 0.5, 0.2), true);
  assert.equal(isPacketAligned(0.85, 0.5, 0.2), false);

  let prog = INITIAL_PROGRESSION;
  const gatedCyber = unlockTechItem(prog, 'cyber', 'scada_sabotage');
  assert.equal(gatedCyber.ok, false);

  prog = awardSortieRewards(prog, { xpEarned: 1200, rcEarned: 600, cyberBreaches: 2 });
  assert.equal(prog.cyberBreaches, 2);
  const unlockedScada = unlockTechItem(prog, 'cyber', 'scada_sabotage');
  assert.equal(unlockedScada.ok, true);
  assert.ok(unlockedScada.progression.unlockedCyber.includes('scada_sabotage'));
});

test('After Action Report logger tracks fuel burn, distance flown, peaks, and events', () => {
  let aar = createAarReport('edwards', 'mq9x', 1769, '2026-11-14T13:00:00.000Z');
  aar = appendAarSample(aar, {
    tSec: 0,
    x: 0,
    yMsl: 1120,
    z: 950,
    aglM: 420,
    airspeedKnots: 180,
    mach: 0.27,
    fuelKg: 1769,
    fuelPct: 100,
    hp: 120,
    throttlePct: 72,
    gLoad: 1.0,
  });
  // Too-close sample should be throttled
  aar = appendAarSample(aar, {
    tSec: 0.4,
    x: 0,
    yMsl: 1120,
    z: 910,
    aglM: 420,
    airspeedKnots: 180,
    mach: 0.27,
    fuelKg: 1768,
    fuelPct: 100,
    hp: 120,
    throttlePct: 72,
    gLoad: 1.0,
  });
  assert.equal(aar.samples.length, 1);

  aar = appendAarSample(aar, {
    tSec: 30,
    x: 300,
    yMsl: 1520,
    z: 550,
    aglM: 820,
    airspeedKnots: 240,
    mach: 0.42,
    fuelKg: 1739,
    fuelPct: 98,
    hp: 120,
    throttlePct: 90,
    gLoad: 2.8,
  });
  assert.equal(aar.samples.length, 2);
  assert.equal(aar.fuelConsumedKg, 30);
  assert.equal(aar.fuelBurnRateKgPerMin, 60);
  assert.equal(aar.distanceFlownM, 640);
  assert.equal(aar.maxAltMsl, 1520);
  assert.equal(aar.maxMach, 0.42);
  assert.equal(aar.maxGLoad, 2.8);

  aar = appendAarEvent(aar, {
    tSec: 12.5,
    type: 'strike',
    title: 'Target Neutralized',
    detail: 'Rogers Dry Lake Control destroyed (CEP 1.2m)',
    x: 120,
    z: 700,
    altMsl: 1320,
    fuelKg: 1756,
  });
  assert.equal(aar.events.length, 1);
  assert.equal(formatSortieClock(75), '01:15');
  assert.ok(exportAarJson(aar).includes('Rogers Dry Lake Control'));
});

test('War Thunder Instructor converts aim vector to smooth bank/pitch and yields to manual overrides', () => {
  const drone = makeBaselineDrone();
  const aimLeft = computeInstructorControlInput(
    drone,
    { x: -0.6, y: 0.2, z: -0.8 },
    { pitchOverride: 0, rollOverride: 0, yawOverride: 0, throttleDelta: 0 },
  );
  assert.ok(aimLeft.rollInput > 0.2, `Expected positive left-bank rollInput, got ${aimLeft.rollInput}`);
  assert.ok(aimLeft.yawInput > 0.2, `Expected positive left yawInput, got ${aimLeft.yawInput}`);
  assert.ok(aimLeft.pitchInput > 0.2, `Expected nose-up pitchInput, got ${aimLeft.pitchInput}`);

  const overridden = computeInstructorControlInput(
    drone,
    { x: -0.6, y: 0.2, z: -0.8 },
    { pitchOverride: -1, rollOverride: -0.9, yawOverride: 0, throttleDelta: 1 },
  );
  assert.equal(overridden.pitchInput, -1);
  assert.equal(overridden.rollInput, -0.9);
  assert.equal(overridden.throttleDelta, 1);
});

test('ballistic lead point, arcade WEP throttle, and graphics presets behave as specified', () => {
  const lead = computeLeadPoint(
    { x: 0, y: 400, z: 0 },
    { x: 0, y: 400, z: -600 },
    { vx: 120, vy: 0, vz: 0 },
    600,
  );
  assert.ok(Math.abs(lead.x - 120) < 1, `Expected lead X ~120m for 1s TOF, got ${lead.x}`);

  let drone = makeBaselineDrone();
  drone.throttle = 0.98;
  drone = stepDroneFlight(
    drone,
    { pitchInput: 0, rollInput: 0, yawInput: 0, throttleDelta: 1 },
    {
      theaterId: 'edwards',
      weatherId: 'clear',
      utcHours: 19,
      loadout: DEFAULT_LOADOUT,
      sandbox: DEFAULT_SANDBOX,
      ordnanceMassKg: 200,
      elapsedTimeSec: 0,
      flightModel: 'arcade',
    },
    0.5,
  );
  assert.ok(drone.throttle > 1.0, `Expected arcade WEP throttle > 1.0, got ${drone.throttle}`);

  const lowGfx = applyGraphicsPreset('low');
  const ultraGfx = applyGraphicsPreset('ultra');
  assert.equal(lowGfx.shadows, false);
  assert.equal(lowGfx.clouds, false);
  assert.equal(ultraGfx.shadows, true);
  assert.equal(ultraGfx.clouds, true);
  assert.ok(ultraGfx.resolutionScale > lowGfx.resolutionScale);
});

test('Pilot Skill Tree enforces prerequisites, computes passive EW/ballistic/flight bonuses, and supports SP respec', () => {
  let prog = INITIAL_PROGRESSION;
  assert.equal(prog.skillPoints, 2);

  // Tier 2 should be locked until Tier 1 is trained
  const prereqFail = canUpgradeSkill(prog, 'ew_intrusion_speed');
  assert.equal(prereqFail.ok, false);

  // Award XP + completion SP and train Electronic Warfare + Flight Efficiency
  prog = awardSortieRewards(prog, { xpEarned: 1000, rcEarned: 300, completed: true });
  assert.ok(prog.skillPoints >= 4);

  const upEw1 = upgradePilotSkill(prog, 'ew_signal_amp');
  assert.equal(upEw1.ok, true);
  prog = upEw1.progression;

  // Now Tier 2 EW unlocks cleanly
  const upEw2 = upgradePilotSkill(prog, 'ew_intrusion_speed');
  assert.equal(upEw2.ok, true);
  prog = upEw2.progression;

  // Train Flight Efficiency Tier 1 and Precision Ballistics Tier 1
  prog = upgradePilotSkill(prog, 'flt_turbomachinery').progression;
  prog = upgradePilotSkill(prog, 'bal_seeker_tuning').progression;

  const bonuses = computePilotSkillBonuses(prog);
  assert.ok(bonuses.cyberRangeMult > 1.1, 'EW Signal Amp should boost cyber range');
  assert.ok(bonuses.cyberCooldownMult < 1.0, 'Zero-Day Pipeline should cut cyber cooldown');
  assert.ok(bonuses.fuelBurnMult < 1.0, 'Variable Stator Tuning should cut fuel burn');
  assert.ok(bonuses.guidanceGainMult > 1.1, 'Proportional Nav Gain should boost guidance gain');

  // Verify live cyber & flight physics respond to skill bonuses
  const baseEval = evaluateCyberLink('scada_sabotage', 2600, 'eoir_das4', 0.1);
  const skilledEval = evaluateCyberLink('scada_sabotage', 2600, 'eoir_das4', 0.1, bonuses);
  assert.ok(skilledEval.effectiveRangeM > baseEval.effectiveRangeM);

  const baseFuelState = stepDroneFlight(
    makeBaselineDrone(),
    { pitchInput: 0, rollInput: 0, yawInput: 0, throttleDelta: 0 },
    {
      theaterId: 'edwards',
      weatherId: 'clear',
      utcHours: 19,
      loadout: DEFAULT_LOADOUT,
      sandbox: DEFAULT_SANDBOX,
      ordnanceMassKg: 200,
      elapsedTimeSec: 0,
    },
    0.05,
  );
  const skilledFuelState = stepDroneFlight(
    makeBaselineDrone(),
    { pitchInput: 0, rollInput: 0, yawInput: 0, throttleDelta: 0 },
    {
      theaterId: 'edwards',
      weatherId: 'clear',
      utcHours: 19,
      loadout: DEFAULT_LOADOUT,
      sandbox: DEFAULT_SANDBOX,
      ordnanceMassKg: 200,
      elapsedTimeSec: 0,
      skillBonuses: bonuses,
    },
    0.05,
  );
  assert.ok(skilledFuelState.fuelKg >= baseFuelState.fuelKg, 'Fuel Efficiency skill should retain more fuel');

  // Respec refunds all invested SP
  const spBeforeRespec = prog.skillPoints;
  const reset = resetPilotSkills(prog);
  assert.equal(reset.skillPoints, spBeforeRespec + 4);
  assert.deepEqual(reset.skillLevels, {});
  assert.equal(computePilotSkillBonuses(reset).cyberRangeMult, 1);
});

test('global Ukraine/Israel/Iran/Russia/Syria fleet, real-world ammo, drop-bomb ballistics, and kamikaze warhead scaling', () => {
  const expectedAirframes = [
    'bayraktar_tb2',
    'baba_yaga',
    'punisher_ua',
    'shahed_136',
    'iai_harop',
    'hermes_900',
    'mohajer_6',
    'orion_ru',
    'zala_lancet',
  ] as const;

  for (const id of expectedAirframes) {
    const spec = AIRFRAMES[id];
    assert.ok(spec, `Missing airframe ${id}`);
    assert.equal(spec.kamikazeCapable, true, `${id} should be kamikaze-capable`);
    assert.ok(spec.kamikazeDamage >= 140, `${id} kamikaze damage should be lethal`);
    assert.ok(spec.defaultPropulsionId, `${id} should specify defaultPropulsionId`);
  }

  const expectedWeapons = [
    'mam_l',
    'mam_c',
    'pg7vl_drop',
    'spike_nlos',
    'kab_20',
    'kornet_d',
    'qaem_5',
    'r73_archer',
  ] as const;

  for (const id of expectedWeapons) {
    const w = WEAPONS[id];
    assert.ok(w, `Missing weapon ${id}`);
    assert.ok(w.origin.length > 0, `${id} should include military origin`);
  }

  // Kamikaze warhead yield scales up with unspent onboard munitions + pilot skill bonuses
  const baseYield = computeKamikazeImpactPayload(
    'shahed_136',
    ['mam_l', 'pg7vl_drop', 'r73_archer', 'm61_vulcan'],
    [0, 0, 0, 0],
  );
  const loadedYield = computeKamikazeImpactPayload(
    'shahed_136',
    ['mam_l', 'pg7vl_drop', 'r73_archer', 'm61_vulcan'],
    [4, 8, 2, 80],
    {
      ...computePilotSkillBonuses(INITIAL_PROGRESSION),
      blastRadiusMult: 1.25,
      damageMult: 1.2,
    },
  );
  assert.ok(loadedYield.warheadKg > baseYield.warheadKg, 'Unspent ammo should add cook-off warhead mass');
  assert.ok(loadedYield.damage > baseYield.damage, 'Cook-off + ordnance skill should amplify kamikaze damage');
  assert.ok(
    loadedYield.blastRadiusM > baseYield.blastRadiusM,
    'Cook-off + ordnance skill should expand kamikaze blast radius',
  );

  // Kamikaze armed mode disables the 6m terrain pull-up cushion so drone can slam straight into targets
  let divingDrone = makeBaselineDrone();
  divingDrone.y = 3;
  divingDrone.vy = -45;
  divingDrone.pitch = -0.7;
  divingDrone = stepDroneFlight(
    divingDrone,
    { pitchInput: -0.5, rollInput: 0, yawInput: 0, throttleDelta: 1 },
    {
      theaterId: 'edwards',
      weatherId: 'clear',
      utcHours: 19,
      loadout: { ...DEFAULT_LOADOUT, airframeId: 'shahed_136', propulsionId: 'piston_md550' },
      sandbox: DEFAULT_SANDBOX,
      ordnanceMassKg: 0,
      elapsedTimeSec: 1,
      kamikazeArmed: true,
    },
    0.05,
  );
  assert.ok(divingDrone.aglMeters < 6, `Kamikaze dive should pierce 6m cushion, got AGL=${divingDrone.aglMeters}`);

  // PG-7VL drop bomb ballistic prediction falls to terrain cleanly
  const highDropDrone = makeBaselineDrone();
  highDropDrone.y = 320;
  const dropPred = predictOrdnanceTrajectory(highDropDrone, 'pg7vl_drop', { x: 0, y: 0, z: -260 }, {
    theaterId: 'edwards',
    weatherId: 'clear',
    sandbox: DEFAULT_SANDBOX,
  });
  assert.ok(dropPred.flightTimeSec > 1.0, 'Drop bomb should fall under gravity');
  assert.ok(dropPred.points.length >= 3, 'Drop bomb trajectory should produce arc points');
});

test('War Thunder 360-deg Mouse Aim updates only from deltas, freezes during C Free-Look, and syncs on manual override', () => {
  // Negative yaw delta turns right in Three.js -Z forward convention
  const slewRight = stepWarThunderAimAngles({
    aimYaw: 0,
    aimPitch: 0,
    aimDeltaYawRad: -0.25,
    aimDeltaPitchRad: 0.12,
    manualOverrideActive: false,
    freeLooking: false,
    droneYaw: 0,
    dronePitch: 0,
    scheme: 'mouse_aim',
  });
  assert.ok(Math.abs(slewRight.aimYaw - -0.25) < 1e-6);
  assert.ok(Math.abs(slewRight.aimPitch - 0.12) < 1e-6);

  // Zero delta keeps desired aim invariant
  const holdStill = stepWarThunderAimAngles({
    aimYaw: slewRight.aimYaw,
    aimPitch: slewRight.aimPitch,
    aimDeltaYawRad: 0,
    aimDeltaPitchRad: 0,
    manualOverrideActive: false,
    freeLooking: false,
    droneYaw: 0,
    dronePitch: 0,
    scheme: 'mouse_aim',
  });
  assert.equal(holdStill.aimYaw, slewRight.aimYaw);
  assert.equal(holdStill.aimPitch, slewRight.aimPitch);

  // Holding Free-Look ('C') keeps aimYaw/aimPitch frozen even if non-zero deltas arrive
  const frozen = stepWarThunderAimAngles({
    aimYaw: 0.55,
    aimPitch: 0.15,
    aimDeltaYawRad: 0.4,
    aimDeltaPitchRad: -0.3,
    manualOverrideActive: false,
    freeLooking: true,
    droneYaw: 0.1,
    dronePitch: 0,
    scheme: 'mouse_aim',
  });
  assert.equal(frozen.aimYaw, 0.55);
  assert.equal(frozen.aimPitch, 0.15);

  // Holding manual override syncs aim back to drone orientation so release never snaps back
  const manualOverride = stepWarThunderAimAngles({
    aimYaw: 1.2,
    aimPitch: 0.4,
    aimDeltaYawRad: 0.2,
    aimDeltaPitchRad: 0.2,
    manualOverrideActive: true,
    freeLooking: false,
    droneYaw: -0.42,
    dronePitch: 0.12,
    scheme: 'mouse_aim',
  });
  assert.equal(manualOverride.aimYaw, -0.42);
  assert.equal(manualOverride.aimPitch, 0.12);
});

test('War Thunder AI squadron policies execute Boom-and-Zoom, defensive flare evasion, and GNSS disruption', () => {
  const squadron = createAiBotSquadron('edwards');
  const allies = squadron.filter((b) => b.team === 'alpha');
  const hostiles = squadron.filter((b) => b.team === 'bravo');
  assert.ok(allies.length >= 2, 'Should deploy allied wingmen');
  assert.ok(hostiles.length >= 4, 'Should deploy hostile BnZ, dogfighter, and striker bots');

  const interceptor = hostiles.find((b) => b.role === 'interceptor')!;
  const playerCandidate = {
    id: 'player',
    team: 'alpha' as const,
    x: interceptor.x,
    y: interceptor.y - 320,
    z: interceptor.z - 600,
    vx: 0,
    vy: 0,
    vz: -100,
  };

  // Interceptor starts in 'climb'; with 320m alt advantage it transitions into 'dive_attack'
  const bnzStep = stepAiCombatBot(interceptor, [playerCandidate], {
    theaterId: 'edwards',
    sortieTimeSec: 12,
    incomingMissileDistM: null,
    compromisedKind: null,
    gnssSpoofed: false,
    dt: 0.04,
  });
  assert.equal(bnzStep.bot.state, 'dive_attack');

  // Incoming missile within 720m triggers flare dump + break-turn evade
  const dogfighter = hostiles.find((b) => b.role === 'dogfighter')!;
  const evadeStep = stepAiCombatBot(dogfighter, [playerCandidate], {
    theaterId: 'edwards',
    sortieTimeSec: 15,
    incomingMissileDistM: 480,
    compromisedKind: null,
    gnssSpoofed: false,
    dt: 0.04,
  });
  assert.equal(evadeStep.wantsFlares, true);
  assert.equal(evadeStep.bot.state, 'evade');
  assert.equal(evadeStep.bot.flaresRemaining, dogfighter.flaresRemaining - 1);

  // GNSS spoofing silences weapon release
  const spoofStep = stepAiCombatBot(dogfighter, [playerCandidate], {
    theaterId: 'edwards',
    sortieTimeSec: 18,
    incomingMissileDistM: null,
    compromisedKind: 'gnss_spoof',
    gnssSpoofed: true,
    dt: 0.04,
  });
  assert.equal(spoofStep.wantsCannon, false);
  assert.equal(spoofStep.wantsMissile, false);
});

const NEUTRAL_STEP_INPUT: SimStepInput = {
  pitchOverride: 0,
  rollOverride: 0,
  yawOverride: 0,
  throttleDelta: 0,
  aimDeltaYawRad: 0,
  aimDeltaPitchRad: 0,
  aimSmoothing: 0,
  freeLooking: false,
  firingHeld: false,
  cameraOrbitMode: false,
  cameraEoirMode: false,
};

function runSimWorldForDuration(
  fps: number,
  durationSec: number,
  seed = 0x13572468,
  configOverrides?: Partial<ReturnType<typeof SimWorld.createDefaultConfig>>,
): SimWorld {
  const world = new SimWorld(SimWorld.createDefaultConfig(configOverrides), seed);
  const dt = 1 / fps;
  const totalFrames = Math.round(durationSec * fps);
  for (let f = 0; f < totalFrames; f++) {
    if (f === Math.round(fps * 1.0)) {
      world.fireActiveOrdnance(true, []);
    }
    const input: SimStepInput =
      f >= Math.round(fps * 2.0) && f < Math.round(fps * 4.0)
        ? { ...NEUTRAL_STEP_INPUT, rollOverride: 0.35, pitchOverride: 0.15 }
        : NEUTRAL_STEP_INPUT;
    world.stepFrame(dt, true, input, []);
  }
  return world;
}

test('Phase 1: SimWorld produces deterministic frame-rate-independent trajectories across 30, 60, and 144 FPS', () => {
  const sim60 = runSimWorldForDuration(60, 6, 0xdeadbeef);
  const sim30 = runSimWorldForDuration(30, 6, 0xdeadbeef);
  const sim144 = runSimWorldForDuration(144, 6, 0xdeadbeef);

  assert.equal(sim60.clock.tickCount, 360);
  assert.equal(sim30.clock.tickCount, 360);
  assert.equal(sim144.clock.tickCount, 360);

  for (const [label, other] of [
    ['30 FPS', sim30],
    ['144 FPS', sim144],
  ] as const) {
    assert.ok(
      Math.abs(other.clock.simTimeSec - sim60.clock.simTimeSec) < 1e-6,
      `${label} simTimeSec drifted`,
    );
    assert.ok(Math.abs(other.drone.x - sim60.drone.x) < 1e-5, `${label} drone.x drifted`);
    assert.ok(Math.abs(other.drone.y - sim60.drone.y) < 1e-5, `${label} drone.y drifted`);
    assert.ok(Math.abs(other.drone.z - sim60.drone.z) < 1e-5, `${label} drone.z drifted`);
    assert.ok(Math.abs(other.drone.fuelKg - sim60.drone.fuelKg) < 1e-6, `${label} fuelKg drifted`);
    assert.ok(
      Math.abs(other.drone.airspeedMs - sim60.drone.airspeedMs) < 1e-5,
      `${label} airspeedMs drifted`,
    );
    assert.ok(
      Math.abs(other.drone.groundSpeedMs - sim60.drone.groundSpeedMs) < 1e-5,
      `${label} groundSpeedMs drifted`,
    );
    assert.equal(other.aiBots.length, sim60.aiBots.length);
    for (let i = 0; i < sim60.aiBots.length; i++) {
      assert.ok(
        Math.abs(other.aiBots[i].x - sim60.aiBots[i].x) < 1e-5,
        `${label} AI bot ${i} x drifted`,
      );
      assert.ok(
        Math.abs(other.aiBots[i].z - sim60.aiBots[i].z) < 1e-5,
        `${label} AI bot ${i} z drifted`,
      );
    }
    assert.equal(other.rng.getState(), sim60.rng.getState(), `${label} RNG state diverged`);
  }
});

test('Phase 1: FixedClock maintains 1.0x real-time parity on 80ms software WebGL frames and clamps tab hitches', () => {
  const swClock = createFixedClock();
  // 25 frames at 80ms (12.5 Hz) = 2.0s real time -> must yield 120 fixed ticks (2.0s sim time, no 0.625x slow-mo)
  for (let i = 0; i < 25; i++) {
    advanceFixedClock(swClock, 0.08, 1.0, false, () => {});
  }
  assert.equal(swClock.tickCount, 120);
  assert.ok(Math.abs(swClock.simTimeSec - 2.0) < 1e-6);

  // Huge 5s background tab hitch is clamped to MAX_RAW_FRAME_DT_SEC (0.25s = 15 substeps)
  const hitchClock = createFixedClock();
  advanceFixedClock(hitchClock, 5.0, 1.0, false, () => {});
  assert.equal(hitchClock.realTimeSec, MAX_RAW_FRAME_DT_SEC);
  assert.equal(hitchClock.lastSubsteps, 15);
  assert.ok(Math.abs(hitchClock.simTimeSec - 15 * FIXED_TIMESTEP_SEC) < 1e-6);
});

test('Phase 1: SimWorld synchronizes sandbox.timeScale across flight, cooldowns, fuel burn, and AI', () => {
  const runNeutral = (durationSec: number, timeScale: number) => {
    const world = new SimWorld(
      SimWorld.createDefaultConfig({
        utcHours: 6,
        sandbox: { ...DEFAULT_SANDBOX, enabled: true, timeScale },
      }),
      0xabcdef01,
    );
    world.fireActiveOrdnance(true, []);
    const totalFrames = Math.round(durationSec * 60);
    const fullThrustInput: SimStepInput = { ...NEUTRAL_STEP_INPUT, throttleDelta: 1 };
    for (let f = 0; f < totalFrames; f++) {
      world.stepFrame(1 / 60, true, fullThrustInput, []);
    }
    return world;
  };

  const halfAt4s = runNeutral(4, 0.5);
  const refAt2s = runNeutral(2, 1.0);
  const normalAt4s = runNeutral(4, 1.0);
  const doubleAt4s = runNeutral(4, 2.0);
  const refAt8s = runNeutral(8, 1.0);

  assert.equal(halfAt4s.clock.tickCount, 120);
  assert.equal(normalAt4s.clock.tickCount, 240);
  assert.equal(doubleAt4s.clock.tickCount, 480);

  // 4s real-time @ 0.5x == 2s real-time @ 1.0x; 4s real-time @ 2.0x == 8s real-time @ 1.0x
  assert.ok(Math.abs(halfAt4s.drone.z - refAt2s.drone.z) < 1e-6);
  assert.ok(Math.abs(halfAt4s.drone.fuelKg - refAt2s.drone.fuelKg) < 1e-6);
  assert.ok(Math.abs(doubleAt4s.drone.z - refAt8s.drone.z) < 1e-6);
  assert.ok(Math.abs(doubleAt4s.drone.fuelKg - refAt8s.drone.fuelKg) < 1e-6);
  assert.equal(halfAt4s.rng.getState(), refAt2s.rng.getState());
  assert.equal(doubleAt4s.rng.getState(), refAt8s.rng.getState());

  // Monotonic progression over equal real-time elapsed: 2.0x > 1.0x > 0.5x
  const startFuel = AIRFRAMES.bayraktar_tb2.maxFuelKg;
  assert.ok(doubleAt4s.drone.z < normalAt4s.drone.z && normalAt4s.drone.z < halfAt4s.drone.z);
  assert.ok(
    startFuel - doubleAt4s.drone.fuelKg > startFuel - normalAt4s.drone.fuelKg &&
      startFuel - normalAt4s.drone.fuelKg > startFuel - halfAt4s.drone.fuelKg,
  );
  assert.ok(doubleAt4s.slotCooldowns[0] <= normalAt4s.slotCooldowns[0]);
});

test('Phase 1: Flight physics distinguishes wind-relative airspeedMs from inertial groundSpeedMs and vertical speed', () => {
  const baseline = makeBaselineDrone();
  const jetstream = stepDroneFlight(
    baseline,
    { pitchInput: 0, rollInput: 0, yawInput: 0, throttleDelta: 0 },
    {
      theaterId: 'edwards',
      weatherId: 'jetstream', // 34 m/s lateral wind heading 90 deg (east/+X)
      utcHours: 19,
      loadout: DEFAULT_LOADOUT,
      sandbox: DEFAULT_SANDBOX,
      ordnanceMassKg: 100,
      elapsedTimeSec: 0,
    },
    FIXED_TIMESTEP_SEC,
  );
  // With 34 m/s pure lateral crosswind while flying north (-Z at ~85 m/s),
  // wind-relative airspeed exceeds inertial groundSpeedMs noticeably.
  assert.ok(
    Math.abs(jetstream.airspeedMs - jetstream.groundSpeedMs) > 2.0,
    `Expected airspeedMs (${jetstream.airspeedMs}) to differ from groundSpeedMs (${jetstream.groundSpeedMs}) under 34 m/s crosswind`,
  );
  const atmos = computeAtmosphericGravity(34.9, jetstream.y + 700, jetstream.vx, jetstream.vz);
  assert.ok(
    Math.abs(jetstream.mach - jetstream.airspeedMs / atmos.speedOfSoundMs) < 1e-4,
    'Mach must match post-integration airspeedMs / ISA speedOfSoundMs',
  );
});

test('Phase 1: predictOrdnanceTrajectory integrates full (>10s) trajectory independent of sandbox.timeScale', () => {
  const highBomber = makeBaselineDrone();
  highBomber.y = 3200;
  const target = { x: 0, y: 100, z: -4800 };

  const predNormal = predictOrdnanceTrajectory(highBomber, 'gbu39_sdb', target, {
    theaterId: 'edwards',
    weatherId: 'clear',
    sandbox: { ...DEFAULT_SANDBOX, enabled: true, timeScale: 1.0 },
  });
  const predSlowMo = predictOrdnanceTrajectory(highBomber, 'gbu39_sdb', target, {
    theaterId: 'edwards',
    weatherId: 'clear',
    sandbox: { ...DEFAULT_SANDBOX, enabled: true, timeScale: 0.25 },
  });

  assert.ok(
    predNormal.flightTimeSec > 10,
    `Expected long glide trajectory >10s (past old 4.8s bug), got ${predNormal.flightTimeSec}`,
  );
  assert.ok(Math.abs(predNormal.flightTimeSec - predSlowMo.flightTimeSec) < 1e-6);
  assert.ok(Math.abs(predNormal.impactX - predSlowMo.impactX) < 1e-6);
  assert.ok(Math.abs(predNormal.impactZ - predSlowMo.impactZ) < 1e-6);
});

test('Phase 1: SeededRng reproducibility and hitstop freezes physics ticks then recovers cleanly', () => {
  const rngA = new SeededRng(0x42424242);
  const rngB = new SeededRng(0x42424242);
  for (let i = 0; i < 10; i++) {
    assert.equal(rngA.next(), rngB.next());
  }
  const saved = rngA.getState();
  const sampleNext = rngA.next();
  rngA.setState(saved);
  assert.equal(rngA.next(), sampleNext);

  const world = new SimWorld(SimWorld.createDefaultConfig(), 0x42424242);
  world.hitstopTimer = 0.05;
  const pausedStep = world.stepFrame(1 / 60, true, NEUTRAL_STEP_INPUT, []);
  assert.equal(pausedStep.substepsExecuted, 0, 'Active hitstop must freeze physics ticks');
  assert.equal(world.clock.tickCount, 0);

  // Advance enough real time to expire 0.05s hitstop
  world.stepFrame(0.04, true, NEUTRAL_STEP_INPUT, []);
  world.stepFrame(0.04, true, NEUTRAL_STEP_INPUT, []);
  assert.ok(world.clock.tickCount >= 2, 'Simulation must resume normal fixed ticks after hitstop expires');
});

test('Stage A: disableFuelDepletion keeps fuel constant at 100%, disables solar draw/charge, and sustains thrust even from 0 fuel', () => {
  let drone = makeBaselineDrone();
  drone.fuelKg = 0;
  drone.maxFuelKg = 300;
  drone.throttle = 1.0;

  for (let i = 0; i < 60; i++) {
    drone = stepDroneFlight(
      drone,
      { pitchInput: 0, rollInput: 0, yawInput: 0, throttleDelta: 1 },
      {
        theaterId: 'edwards',
        weatherId: 'clear',
        utcHours: 19,
        loadout: DEFAULT_LOADOUT,
        sandbox: DEFAULT_SANDBOX,
        ordnanceMassKg: 120,
        elapsedTimeSec: i * FIXED_TIMESTEP_SEC,
        disableFuelDepletion: true,
      },
      FIXED_TIMESTEP_SEC,
    );
  }

  assert.equal(drone.fuelKg, 0, 'stepDroneFlight with disableFuelDepletion should never burn or refill fuel');
  assert.equal(drone.solarChargeRateW, 0, 'solarChargeRateW must be zeroed when fuel/battery depletion is disabled');
  assert.ok(drone.airspeedMs > 70, `Expected sustained propulsor thrust even at 0 fuelKg, got ${drone.airspeedMs}`);

  const simWorld = new SimWorld(
    SimWorld.createDefaultConfig({
      disableFuelDepletion: true,
      utcHours: 19,
    }),
    0x12345678,
  );
  const startFuel = simWorld.drone.fuelKg;
  const fullThrust: SimStepInput = { ...NEUTRAL_STEP_INPUT, throttleDelta: 1 };
  for (let f = 0; f < 180; f++) {
    simWorld.stepFrame(1 / 60, true, fullThrust, []);
  }
  assert.equal(simWorld.drone.fuelKg, startFuel);
  assert.equal(simWorld.drone.solarChargeRateW, 0);
  assert.equal(
    Math.round((simWorld.drone.fuelKg / Math.max(1, simWorld.drone.maxFuelKg)) * 100),
    100,
  );
});

test('Stage A: Sector 04 theater is fictionalized with no real-world Edwards AFB / Rogers Dry Lake strings', () => {
  const sector = THEATERS.edwards;
  assert.ok(sector.name.includes('Mojave Proving Basin — Sector 04'));
  assert.ok(!/Edwards AFB|Rogers Dry Lake/i.test(sector.name));
  assert.ok(!/Edwards AFB|Rogers Dry Lake/i.test(sector.region));
  assert.ok(!/Edwards AFB|Rogers Dry Lake/i.test(sector.description));
  for (const lm of sector.landmarks) {
    assert.ok(!/Edwards|Rogers/i.test(lm.name), `Unexpected non-fictional landmark name: ${lm.name}`);
  }
  assert.ok(sector.landmarks.some((l) => l.name === 'Mesa Dry Lake Airfield'));
  assert.ok(sector.landmarks.some((l) => l.name === 'East Crest Radar Array'));
});

test('Stage A: Combat sound and particle_burst SimEvents emit finite 3D world coordinates from SimWorld', () => {
  const world = new SimWorld(
    SimWorld.createDefaultConfig({
      disableFuelDepletion: true,
      loadout: {
        ...DEFAULT_LOADOUT,
        slots: ['m61_vulcan', 'mam_l', 'agm114_hellfire', 'mim140_ballistic'],
      },
    }),
    0x77771111,
  );
  const gunRes = world.fireActiveOrdnance(true, []);
  assert.equal(gunRes.fired, true);
  world.setActiveSlot(1);
  const ordRes = world.fireActiveOrdnance(true, []);
  assert.equal(ordRes.fired, true);
  const flareRes = world.deployFlares(true);
  assert.equal(flareRes.ok, true);

  const events = [...gunRes.events, ...ordRes.events, ...flareRes.events];
  const sounds = events.filter((e) => e.type === 'sound');
  const bursts = events.filter((e) => e.type === 'particle_burst');
  assert.ok(sounds.length >= 3, `Expected at least 3 sound events, got ${sounds.length}`);
  assert.ok(bursts.length >= 2, `Expected at least 2 particle_burst events, got ${bursts.length}`);

  for (const ev of sounds) {
    if (ev.type !== 'sound') continue;
    assert.ok(typeof ev.x === 'number' && Number.isFinite(ev.x), `Sound ${ev.kind} missing finite x`);
    assert.ok(typeof ev.y === 'number' && Number.isFinite(ev.y), `Sound ${ev.kind} missing finite y`);
    assert.ok(typeof ev.z === 'number' && Number.isFinite(ev.z), `Sound ${ev.kind} missing finite z`);
  }
  for (const ev of bursts) {
    if (ev.type !== 'particle_burst') continue;
    assert.ok(Number.isFinite(ev.x) && Number.isFinite(ev.y) && Number.isFinite(ev.z));
  }
});

test('P0 Test A (Stationary Mouse): moving mouse then stopping keeps world-space aim constant and stops turn after convergence', () => {
  const world = new SimWorld(SimWorld.createDefaultConfig({ disableFuelDepletion: true }), 0x11223344);
  const mouse = createMouseInputState();
  handleMousePointerEnter(mouse, 640, 400);
  // Move mouse right by +180 px over 3 frames and up by -40 px, then stop completely
  for (let i = 1; i <= 3; i++) {
    handleMousePointerMove(mouse, { clientX: 640 + i * 60, clientY: 400 - i * 13 }, 'aim');
  }
  const consumed = consumeMouseFrameInput(mouse, {
    aimSensitivity: 1.0,
    freeLookSensitivity: 1.0,
    invertY: false,
    aimSmoothing: 0,
  });
  world.stepFrame(1 / 60, true, {
    ...NEUTRAL_STEP_INPUT,
    aimDeltaYawRad: consumed.aimDeltaYawRad,
    aimDeltaPitchRad: consumed.aimDeltaPitchRad,
  });

  const savedAimYaw = world.aimYaw;
  const savedAimPitch = world.aimPitch;
  const savedAimDir = world.getDesiredAimDirection();

  // Now mouse is completely stationary for 5 seconds (300 frames @ 60Hz)
  for (let f = 0; f < 300; f++) {
    const zeroConsumed = consumeMouseFrameInput(mouse, {
      aimSensitivity: 1.0,
      freeLookSensitivity: 1.0,
      invertY: false,
      aimSmoothing: 0,
    });
    assert.equal(zeroConsumed.aimDeltaYawRad, 0);
    assert.equal(zeroConsumed.aimDeltaPitchRad, 0);
    world.stepFrame(1 / 60, true, NEUTRAL_STEP_INPUT);
    assert.equal(world.aimYaw, savedAimYaw, 'Stationary mouse must never drift aimYaw');
    assert.equal(world.aimPitch, savedAimPitch, 'Stationary mouse must never drift aimPitch');
    const dirNow = world.getDesiredAimDirection();
    assert.ok(Math.abs(dirNow.x - savedAimDir.x) < 1e-12);
    assert.ok(Math.abs(dirNow.y - savedAimDir.y) < 1e-12);
    assert.ok(Math.abs(dirNow.z - savedAimDir.z) < 1e-12);
  }

  // Aircraft must have converged to saved aim direction and stopped turning
  const noseDir = aimAnglesToDirection(world.drone.yaw, world.drone.pitch);
  const finalErrorDeg = (computeDirectionAngularErrorRad(savedAimDir, noseDir) * 180) / Math.PI;
  assert.ok(finalErrorDeg < 2.5, `Expected aircraft to settle within 2.5 deg of aim, got ${finalErrorDeg.toFixed(2)} deg`);
  assert.ok(Math.abs(world.drone.roll) < 0.08, `Expected wings to level once aligned, got roll=${world.drone.roll}`);

  // Run another 1.5s stationary — yaw must stay locked, not keep spinning indefinitely
  const yawAt5s = world.drone.yaw;
  for (let f = 0; f < 90; f++) {
    world.stepFrame(1 / 60, true, NEUTRAL_STEP_INPUT);
  }
  const yawDrift = Math.abs(wrapAngleRad(world.drone.yaw - yawAt5s));
  assert.ok(yawDrift < 0.03, `Expected aircraft to stop turning once aligned, drifted ${yawDrift.toFixed(4)} rad`);
});

test('P0 Test B (Convergence): left/right/up/down aims converge cleanly without sustained overshoot or roll flip', () => {
  for (const [label, dyaw, dpitch] of [
    ['Right + Level', -0.45, 0.0],
    ['Left + Climb', 0.45, 0.16],
    ['Right + Dive', -0.35, -0.18],
  ] as const) {
    const world = new SimWorld(SimWorld.createDefaultConfig({ disableFuelDepletion: true }), 0x55667788);
    world.stepFrame(1 / 60, true, {
      ...NEUTRAL_STEP_INPUT,
      aimDeltaYawRad: dyaw,
      aimDeltaPitchRad: dpitch,
    });
    const targetDir = world.getDesiredAimDirection();
    const initialErr = computeDirectionAngularErrorRad(
      targetDir,
      aimAnglesToDirection(world.drone.yaw, world.drone.pitch),
    );
    let maxRoll = 0;
    let errAt2s = initialErr;
    for (let f = 0; f < 300; f++) {
      world.stepFrame(1 / 60, true, NEUTRAL_STEP_INPUT);
      maxRoll = Math.max(maxRoll, Math.abs(world.drone.roll));
      if (f === 120) {
        errAt2s = computeDirectionAngularErrorRad(
          targetDir,
          aimAnglesToDirection(world.drone.yaw, world.drone.pitch),
        );
      }
    }
    const finalErrDeg =
      (computeDirectionAngularErrorRad(
        targetDir,
        aimAnglesToDirection(world.drone.yaw, world.drone.pitch),
      ) *
        180) /
      Math.PI;
    assert.ok(errAt2s < initialErr * 0.45, `${label}: expected fast convergence by 2s (${errAt2s} vs ${initialErr})`);
    assert.ok(finalErrDeg < 2.5, `${label}: expected final error < 2.5 deg, got ${finalErrDeg.toFixed(2)}`);
    assert.ok(maxRoll < 1.25, `${label}: expected controlled bank without roll flip, maxRoll=${maxRoll}`);
  }
});

test('P0 Test C (Sensitivity): sensitivity is applied once with linear scaling across 0.5x, 1.0x, 2.0x', () => {
  const r05 = convertMouseDeltaPxToRadians(120, -60, 0.5, BASE_AIM_RAD_PER_PX, false);
  const r10 = convertMouseDeltaPxToRadians(120, -60, 1.0, BASE_AIM_RAD_PER_PX, false);
  const r20 = convertMouseDeltaPxToRadians(120, -60, 2.0, BASE_AIM_RAD_PER_PX, false);

  assert.ok(Math.abs(r10.deltaYawRad / r05.deltaYawRad - 2.0) < 1e-9);
  assert.ok(Math.abs(r20.deltaYawRad / r10.deltaYawRad - 2.0) < 1e-9);
  assert.ok(Math.abs(r10.deltaPitchRad / r05.deltaPitchRad - 2.0) < 1e-9);
  assert.ok(Math.abs(r20.deltaPitchRad / r10.deltaPitchRad - 2.0) < 1e-9);

  // Invert-Y flips only pitch sign
  const rInv = convertMouseDeltaPxToRadians(120, -60, 1.0, BASE_AIM_RAD_PER_PX, true);
  assert.equal(rInv.deltaYawRad, r10.deltaYawRad);
  assert.equal(rInv.deltaPitchRad, -r10.deltaPitchRad);
});

test('P0 Test D (FPS Parity): identical timestamped mouse + keyboard input produces matching trajectories across 30, 60, and 144 FPS', () => {
  const replay = (fps: number) => {
    const world = new SimWorld(SimWorld.createDefaultConfig({ disableFuelDepletion: true }), 0x24681357);
    const dt = 1 / fps;
    const totalFrames = Math.round(5.0 * fps);
    // Timestamped gesture: 150px right over [0.5s..1.0s], then manual roll left over [2.5s..3.0s]
    let lastBucket = -1;
    for (let f = 0; f < totalFrames; f++) {
      const t = f * dt;
      let aimDeltaYawRad = 0;
      let aimDeltaPitchRad = 0;
      if (t >= 0.5 && t < 1.0) {
        const bucket = Math.floor((t - 0.5) / 0.05);
        if (bucket > lastBucket) {
          lastBucket = bucket;
          aimDeltaYawRad = -0.04;
          aimDeltaPitchRad = 0.012;
        }
      }
      const rollOverride = t >= 2.5 && t < 3.0 ? 0.65 : 0;
      world.stepFrame(dt, true, {
        ...NEUTRAL_STEP_INPUT,
        aimDeltaYawRad,
        aimDeltaPitchRad,
        rollOverride,
      });
    }
    return world;
  };

  const w60 = replay(60);
  const w30 = replay(30);
  const w144 = replay(144);

  for (const [label, other] of [
    ['30 FPS', w30],
    ['144 FPS', w144],
  ] as const) {
    assert.ok(
      Math.abs(wrapAngleRad(other.aimYaw - w60.aimYaw)) < 0.015,
      `${label} aimYaw diverged: ${other.aimYaw} vs ${w60.aimYaw}`,
    );
    assert.ok(
      Math.abs(other.aimPitch - w60.aimPitch) < 0.015,
      `${label} aimPitch diverged: ${other.aimPitch} vs ${w60.aimPitch}`,
    );
    assert.ok(
      Math.abs(wrapAngleRad(other.drone.yaw - w60.drone.yaw)) < 0.02,
      `${label} drone.yaw diverged: ${other.drone.yaw} vs ${w60.drone.yaw}`,
    );
  }
});

test('P0 Test E (Free Look): holding C moves free-look offsets while keeping world-space aim completely invariant', () => {
  const world = new SimWorld(SimWorld.createDefaultConfig({ disableFuelDepletion: true }), 0x99887766);
  const mouse = createMouseInputState();
  handleMousePointerEnter(mouse, 500, 400);
  handleMousePointerMove(mouse, { clientX: 580, clientY: 380 }, 'aim');
  const firstMove = consumeMouseFrameInput(mouse, {
    aimSensitivity: 1,
    freeLookSensitivity: 1.5,
    invertY: false,
    aimSmoothing: 0,
  });
  world.stepFrame(1 / 60, true, {
    ...NEUTRAL_STEP_INPUT,
    aimDeltaYawRad: firstMove.aimDeltaYawRad,
    aimDeltaPitchRad: firstMove.aimDeltaPitchRad,
  });
  const lockedAimYaw = world.aimYaw;
  const lockedAimPitch = world.aimPitch;

  // Hold 'C' and sweep mouse hard across screen
  for (let i = 1; i <= 4; i++) {
    handleMousePointerMove(mouse, { clientX: 580 + i * 90, clientY: 380 - i * 40 }, 'freelook');
  }
  const flConsumed = consumeMouseFrameInput(mouse, {
    aimSensitivity: 1,
    freeLookSensitivity: 1.5,
    invertY: false,
    aimSmoothing: 0,
  });
  assert.ok(Math.abs(flConsumed.freeLookDeltaYawRad) > 0.3, 'Expected significant free-look yaw delta');
  assert.equal(flConsumed.aimDeltaYawRad, 0, 'Expected zero aim delta routed while free-looking');

  world.stepFrame(1 / 60, true, {
    ...NEUTRAL_STEP_INPUT,
    aimDeltaYawRad: 0.99, // Even if rogue non-zero deltas arrive, SimWorld must ignore while freeLooking
    aimDeltaPitchRad: 0.99,
    freeLooking: true,
  });
  assert.equal(world.aimYaw, lockedAimYaw);
  assert.equal(world.aimPitch, lockedAimPitch);
});

test('P0 Test F (Keyboard Handoff): manual flight override updates heading cleanly and never snaps back on release', () => {
  const world = new SimWorld(SimWorld.createDefaultConfig({ disableFuelDepletion: true }), 0x31415926);
  // Start with aim straight ahead (yaw = 0)
  assert.equal(world.aimYaw, 0);

  // Hold manual roll left + pull up for 1.5s so drone turns substantially left (+yaw)
  for (let f = 0; f < 90; f++) {
    world.stepFrame(1 / 60, true, {
      ...NEUTRAL_STEP_INPUT,
      rollOverride: 1.0,
      pitchOverride: 0.35,
    });
  }
  const yawAtRelease = world.drone.yaw;
  assert.ok(Math.abs(yawAtRelease) > 0.25, `Expected manual turn > 0.25 rad, got ${yawAtRelease}`);
  assert.ok(
    Math.abs(wrapAngleRad(world.aimYaw - yawAtRelease)) < 0.02,
    'Aim yaw must follow aircraft nose during manual override',
  );

  // Release keys: aim must NOT snap back to 0, and manualHandoffBlend must ramp smoothly from 0 -> 1
  world.stepFrame(1 / 60, true, NEUTRAL_STEP_INPUT);
  assert.ok(world.manualHandoffBlend < 0.2, 'Handoff blend should start near 0 right after key release');
  assert.ok(Math.abs(wrapAngleRad(world.aimYaw - yawAtRelease)) < 0.05, 'Must not snap back toward old aimYaw=0');

  for (let f = 0; f < 45; f++) {
    world.stepFrame(1 / 60, true, NEUTRAL_STEP_INPUT);
  }
  assert.equal(world.manualHandoffBlend, 1);
  assert.ok(Math.abs(wrapAngleRad(world.aimYaw - yawAtRelease)) < 0.08, 'Heading should remain near release direction');
});

test('P0 Test G (Camera Switching): switching Chase -> EO/IR -> Flyby -> Orbit -> Chase preserves world-space aim', () => {
  const world = new SimWorld(SimWorld.createDefaultConfig({ disableFuelDepletion: true }), 0x10203040);
  world.stepFrame(1 / 60, true, { ...NEUTRAL_STEP_INPUT, aimDeltaYawRad: -0.35, aimDeltaPitchRad: 0.14 });
  const expectedYaw = world.aimYaw;
  const expectedPitch = world.aimPitch;

  // EO/IR mode ignores aim deltas
  world.stepFrame(1 / 60, true, {
    ...NEUTRAL_STEP_INPUT,
    aimDeltaYawRad: 0.5,
    aimDeltaPitchRad: -0.5,
    cameraEoirMode: true,
  });
  assert.equal(world.aimYaw, expectedYaw);
  assert.equal(world.aimPitch, expectedPitch);

  // Orbit mode ignores aim deltas
  world.stepFrame(1 / 60, true, {
    ...NEUTRAL_STEP_INPUT,
    aimDeltaYawRad: -0.5,
    aimDeltaPitchRad: 0.5,
    cameraOrbitMode: true,
  });
  assert.equal(world.aimYaw, expectedYaw);
  assert.equal(world.aimPitch, expectedPitch);

  // Return to Chase mode and apply small refinement delta
  world.stepFrame(1 / 60, true, {
    ...NEUTRAL_STEP_INPUT,
    aimDeltaYawRad: -0.05,
    aimDeltaPitchRad: 0.02,
  });
  assert.ok(Math.abs(wrapAngleRad(world.aimYaw - (expectedYaw - 0.05))) < 1e-6);
  assert.ok(Math.abs(world.aimPitch - (expectedPitch + 0.02)) < 1e-6);
});

test('P0 Test H (Pointer Lock, Focus Recovery & Spike Rejection): lock transitions, leave/enter, blur, and large jumps never corrupt aim', () => {
  const mouse = createMouseInputState();

  // Pointer lock acquisition ignores 1 warp sample, then processes clean movementX/Y
  handleMousePointerLockChange(mouse, true);
  const warpIgnored = handleMousePointerMove(
    mouse,
    { clientX: 700, clientY: 450, movementX: 320, movementY: -220 },
    'aim',
  );
  assert.equal(warpIgnored.ignored, true);

  const lockedMove = handleMousePointerMove(
    mouse,
    { clientX: 700, clientY: 450, movementX: 40, movementY: -10 },
    'aim',
  );
  assert.equal(lockedMove.ignored, false);
  assert.equal(lockedMove.dx, 40);
  assert.equal(lockedMove.dy, -10);

  // Pointer lock error / release falls back cleanly to unlocked clientX/Y with fresh anchor
  handleMousePointerLockError(mouse);
  assert.equal(mouse.pointerLocked, false);
  const anchorSample = handleMousePointerMove(mouse, { clientX: 200, clientY: 200 }, 'aim');
  assert.equal(anchorSample.ignored, true);
  const unlockedMove = handleMousePointerMove(mouse, { clientX: 230, clientY: 215 }, 'aim');
  assert.equal(unlockedMove.ignored, false);
  assert.equal(unlockedMove.dx, 30);
  assert.equal(unlockedMove.dy, 15);

  // Pathological OS cursor teleport > MAX_POINTER_DELTA_PX is dropped
  const spike = handleMousePointerMove(mouse, { clientX: 1200, clientY: 215 }, 'aim');
  assert.equal(spike.ignored, true);

  // Blur / pointerleave / pointerenter purges pending deltas cleanly
  handleMouseFocusLoss(mouse);
  const afterBlur = consumeMouseFrameInput(mouse, {
    aimSensitivity: 1,
    freeLookSensitivity: 1,
    invertY: false,
    aimSmoothing: 0,
  });
  assert.equal(afterBlur.aimDeltaYawRad, 0);
  assert.equal(afterBlur.aimDeltaPitchRad, 0);

  handleMousePointerEnter(mouse, 800, 500);
  handleMousePointerLeave(mouse);
  handleMousePointerEnter(mouse, 100, 100);
  const postReenter = consumeMouseFrameInput(mouse, {
    aimSensitivity: 1,
    freeLookSensitivity: 1,
    invertY: false,
    aimSmoothing: 0,
  });
  assert.equal(postReenter.aimDeltaYawRad, 0);
});

// =============================================================================
// M2.0 — LEFT MOUSE BUTTON FIRE & TRIGGER / SLOT / PHASE HYGIENE
// =============================================================================

test('M2.0 Test 1: Single-shot ordnance fires once on click and does NOT auto-repeat while held', () => {
  const world = new SimWorld(SimWorld.createDefaultConfig({ disableFuelDepletion: true }), 0x2001);
  world.setActiveSlot(0); // mam_l (single-shot AGM, 4 rounds, cooldown 0.55s)
  const initialAmmo = world.slotAmmo[0];
  const res1 = world.fireActiveOrdnance(true, []);
  assert.equal(res1.fired, true);
  assert.equal(world.slotAmmo[0], initialAmmo - 1);
  assert.equal(world.activeOrdnance.length, 1);

  // Hold firingHeld across 2 seconds (> cooldown): single-shot must NOT repeat while held
  for (let f = 0; f < 120; f++) {
    world.stepFrame(1 / 60, true, { ...NEUTRAL_STEP_INPUT, firingHeld: true });
  }
  assert.equal(world.slotAmmo[0], initialAmmo - 1, 'Holding trigger on single-shot weapon must not fire extra rounds');
});

test('M2.0 Test 2: Automatic cannon sustains firing while held and stops immediately on release', () => {
  const world = new SimWorld(SimWorld.createDefaultConfig({ disableFuelDepletion: true }), 0x2002);
  world.setActiveSlot(3); // m61_vulcan cannon (0.07s cooldown)
  const startAmmo = world.slotAmmo[3];
  const clickRes = world.fireActiveOrdnance(true, []);
  assert.equal(clickRes.fired, true);

  for (let f = 0; f < 30; f++) {
    world.stepFrame(1 / 60, true, { ...NEUTRAL_STEP_INPUT, firingHeld: true });
  }
  const afterHoldAmmo = world.slotAmmo[3];
  assert.ok(startAmmo - afterHoldAmmo >= 5, `Expected sustained cannon bursts, spent ${startAmmo - afterHoldAmmo}`);

  // Release trigger and step another 0.5s -> zero additional rounds spent
  for (let f = 0; f < 30; f++) {
    world.stepFrame(1 / 60, true, { ...NEUTRAL_STEP_INPUT, firingHeld: false });
  }
  assert.equal(world.slotAmmo[3], afterHoldAmmo, 'Cannon must stop immediately upon trigger release');
});

test('M2.0 Test 3: Switching weapon slot mid-hold suppresses unintended fire until trigger is released', () => {
  const world = new SimWorld(SimWorld.createDefaultConfig({ disableFuelDepletion: true }), 0x2003);
  world.setActiveSlot(0); // mam_l
  const mamStart = world.slotAmmo[0];
  const cannonStart = world.slotAmmo[3];

  // Press trigger on slot 0, then switch to slot 3 (cannon) while still holding trigger
  world.fireActiveOrdnance(true, []);
  assert.equal(world.slotAmmo[0], mamStart - 1);
  world.setActiveSlot(3);

  for (let f = 0; f < 30; f++) {
    world.stepFrame(1 / 60, true, { ...NEUTRAL_STEP_INPUT, firingHeld: true });
  }
  assert.equal(world.slotAmmo[3], cannonStart, 'Switching slot while holding fire must suppress accidental discharge');

  // Release and press again on slot 3 -> now cannon fires cleanly
  world.stepFrame(1 / 60, true, { ...NEUTRAL_STEP_INPUT, firingHeld: false });
  const freshClick = world.fireActiveOrdnance(true, []);
  assert.equal(freshClick.fired, true);
  assert.equal(world.slotAmmo[3], cannonStart - 1);
});

test('M2.0 Test 4: Firing is blocked when paused / non-playing or disrupted', () => {
  const world = new SimWorld(SimWorld.createDefaultConfig({ disableFuelDepletion: true }), 0x2004);
  const startAmmo = world.slotAmmo[0];
  const pausedRes = world.fireActiveOrdnance(false, []);
  assert.equal(pausedRes.fired, false);
  assert.equal(pausedRes.events.length, 0);
  assert.equal(world.slotAmmo[0], startAmmo);

  // Also blocked during C2 hijack cyber disruption
  world.receiveRemoteCyberAttack('c2_hijack', 'BANDIT');
  const disruptedRes = world.fireActiveOrdnance(true, []);
  assert.equal(disruptedRes.fired, false);
  assert.equal(world.slotAmmo[0], startAmmo);
});

test('M2.0 Test 5: Cooldown and zero-ammo guards prevent firing out-of-spec rounds', () => {
  const world = new SimWorld(SimWorld.createDefaultConfig({ disableFuelDepletion: true }), 0x2005);
  world.setActiveSlot(0);
  assert.equal(world.fireActiveOrdnance(true, []).fired, true);
  // Immediate second click inside cooldown must be rejected
  assert.equal(world.fireActiveOrdnance(true, []).fired, false);

  // Drain remaining ammo and verify empty slot rejects firing
  world.slotAmmo[0] = 0;
  world.slotCooldowns[0] = 0;
  assert.equal(world.fireActiveOrdnance(true, []).fired, false);
});

test('M2.0 Test 6: Pointer lock error/unlock never disables mouse aim or clears ordnance readiness', () => {
  const mouse = createMouseInputState();
  handleMousePointerLockError(mouse);
  assert.equal(mouse.pointerLocked, false);
  handleMousePointerEnter(mouse, 400, 300);
  const move = handleMousePointerMove(mouse, { clientX: 440, clientY: 280 }, 'aim');
  assert.equal(move.ignored, false);
  const world = new SimWorld(SimWorld.createDefaultConfig({ disableFuelDepletion: true }), 0x2006);
  // First click in unlocked mode fires immediately
  const res = world.fireActiveOrdnance(true, []);
  assert.equal(res.fired, true);
  assert.equal(world.activeOrdnance.length, 1);
});

test('M2.0 Test 7: Firing ordnance preserves P0 desiredAimDir stability and emits multiplayer net event', () => {
  const world = new SimWorld(SimWorld.createDefaultConfig({ disableFuelDepletion: true }), 0x2007);
  world.stepFrame(1 / 60, true, { ...NEUTRAL_STEP_INPUT, aimDeltaYawRad: -0.2, aimDeltaPitchRad: 0.08 });
  const aimBefore = world.getDesiredAimDirection();

  const res = world.fireActiveOrdnance(true, []);
  assert.equal(res.fired, true);
  const netEv = res.events.find((e) => e.type === 'ordnance_fired_net');
  assert.ok(netEv, 'Expected ordnance_fired_net event on fire');

  const aimAfter = world.getDesiredAimDirection();
  assert.deepEqual(aimAfter, aimBefore, 'Firing must not perturb P0 desiredAimDir');
});

// =============================================================================
// M2.1 — UAV GUN SUBCATEGORIES, VERIFIED COMPATIBILITY & FIRE MODES
// =============================================================================

test('M2.1 Test 1: Four UAV gun subcategories cover all 5 tactical UAV guns + Vulcan', () => {
  const gunWeapons = Object.values(WEAPONS).filter((w) => w.category === 'cannon');
  assert.equal(gunWeapons.length, 6);
  const subKeys = new Set(gunWeapons.map((g) => g.gunSubcategory));
  assert.equal(subKeys.has('cat_a_light_rifle'), true);
  assert.equal(subKeys.has('cat_b_heavy_multirotor'), true);
  assert.equal(subKeys.has('cat_c_rotary_pod'), true);
  assert.equal(subKeys.has('cat_d_rws_turret'), true);
  assert.equal(Object.keys(GUN_SUBCATEGORIES).length, 4);
});

test('M2.1 Test 2: Verified compatibility gates Cat-C heavy rotary pods to heavy UCAVs while Sandbox allows override', () => {
  const tb2Minigun = checkWeaponCompatibility('bayraktar_tb2', 'dap6_minigun_pod', false);
  assert.equal(tb2Minigun.compatible, false);

  const babaYagaMinigun = checkWeaponCompatibility('baba_yaga', 'dap6_minigun_pod', false);
  assert.equal(babaYagaMinigun.compatible, false);

  const mojaveMinigun = checkWeaponCompatibility('mojave_ucav', 'dap6_minigun_pod', false);
  assert.equal(mojaveMinigun.compatible, true);
  assert.equal(mojaveMinigun.sandboxOverrideUsed, false);

  const mq9Minigun = checkWeaponCompatibility('mq9x', 'dap6_minigun_pod', false);
  assert.equal(mq9Minigun.compatible, true);

  const tb2Rws = checkWeaponCompatibility('bayraktar_tb2', 'fire_storm_250', false);
  assert.equal(tb2Rws.compatible, true);

  const sandboxOverride = checkWeaponCompatibility('bayraktar_tb2', 'dap6_minigun_pod', true);
  assert.equal(sandboxOverride.compatible, true);
  assert.equal(sandboxOverride.sandboxOverrideUsed, true);
});

test('M2.1 Test 3: normalizeLoadoutConfig sanitizes incompatible pods when switching back to Verified mode or lighter airframes', () => {
  const normalized = normalizeLoadoutConfig(
    {
      airframeId: 'bayraktar_tb2',
      propulsionId: 'turboprop_900',
      sensorId: 'eoir_das4',
      slots: ['mam_l', 'dap6_minigun_pod', 'm61_vulcan', 'fire_storm_250'],
      slotFireModes: ['single', 'auto', 'auto', 'auto'],
    },
    false,
  );
  assert.equal(checkWeaponCompatibility('bayraktar_tb2', normalized.slots[1], false).compatible, true);
  assert.equal(checkWeaponCompatibility('bayraktar_tb2', normalized.slots[2], false).compatible, true);
  assert.equal(normalized.slots[0], 'mam_l');
  assert.equal(normalized.slots[3], 'fire_storm_250');
});

test('M2.1 Test 4: Gun fire modes cycle cleanly and enforce Single (1/press), Burst (3/press), and Auto (sustained)', () => {
  assert.deepEqual(getAllowedFireModes('songar_556'), ['single', 'burst', 'auto']);
  assert.deepEqual(getAllowedFireModes('dap6_minigun_pod'), ['auto']);
  assert.deepEqual(getAllowedFireModes('m61_vulcan'), ['burst', 'auto']);
  assert.equal(cycleFireMode('songar_556', 'single'), 'burst');
  assert.equal(cycleFireMode('songar_556', 'burst'), 'auto');
  assert.equal(cycleFireMode('songar_556', 'auto'), 'single');

  const cfg = SimWorld.createDefaultConfig({ disableFuelDepletion: true });
  cfg.loadout.slots = ['mam_l', 'pg7vl_drop', 'songar_556', 'dap6_minigun_pod'];
  cfg.loadout.slotFireModes = ['single', 'single', 'single', 'auto'];
  cfg.loadout.airframeId = 'mojave_ucav';
  const world = new SimWorld(cfg, 0x2104);

  // Single mode on songar_556: 1 round per press, even if held
  world.setActiveSlot(2);
  assert.equal(world.getActiveFireMode(), 'single');
  const start556 = world.slotAmmo[2];
  assert.equal(world.fireActiveOrdnance(true, []).fired, true);
  for (let f = 0; f < 40; f++) {
    world.stepFrame(1 / 60, true, { ...NEUTRAL_STEP_INPUT, firingHeld: true });
  }
  assert.equal(world.slotAmmo[2], start556 - 1, 'SINGLE gun mode must fire 1 round per press');
  world.stepFrame(1 / 60, true, { ...NEUTRAL_STEP_INPUT, firingHeld: false });

  // Cycle KeyR -> BURST mode: 3 rounds per press, stops at 3 even if held
  assert.equal(world.cycleActiveFireMode(), 'burst');
  const beforeBurst = world.slotAmmo[2];
  assert.equal(world.fireActiveOrdnance(true, []).fired, true);
  for (let f = 0; f < 45; f++) {
    world.stepFrame(1 / 60, true, { ...NEUTRAL_STEP_INPUT, firingHeld: true });
  }
  assert.equal(world.slotAmmo[2], beforeBurst - 3, 'BURST mode must fire 3 rounds per trigger pull');
  world.stepFrame(1 / 60, true, { ...NEUTRAL_STEP_INPUT, firingHeld: false });

  // Cycle KeyR -> AUTO mode: sustained fire while held + emits matching GunAudioProfile
  assert.equal(world.cycleActiveFireMode(), 'auto');
  const beforeAuto = world.slotAmmo[2];
  const autoClick = world.fireActiveOrdnance(true, []);
  assert.equal(autoClick.fired, true);
  const soundEv = autoClick.events.find((e) => e.type === 'sound' && e.kind === 'cannon');
  assert.equal(soundEv?.type === 'sound' ? soundEv.gunProfile : undefined, 'gun_light_556');
  for (let f = 0; f < 30; f++) {
    world.stepFrame(1 / 60, true, { ...NEUTRAL_STEP_INPUT, firingHeld: true });
  }
  assert.ok(beforeAuto - world.slotAmmo[2] >= 4, 'AUTO mode must sustain rapid fire while trigger is held');
});

// =============================================================================
// M2.2 / M2.3 / M2.4 — AUDIO BANK, GOLDEN HOUR, MOVING CONVOYS & 5-PHASE MISSION
// =============================================================================

test('M2.2 Test: All 22 STAGE_A_PATHS.audio WAV files exist on disk, manifest has verified CC0 provenance, and every GunAudioProfile maps cleanly', () => {
  const audioEntries = Object.entries(STAGE_A_PATHS.audio);
  assert.equal(audioEntries.length, 22, `Expected 22 audio stems, got ${audioEntries.length}`);

  for (const [key, relUrl] of audioEntries) {
    const absPath = path.resolve(process.cwd(), 'public', relUrl.replace(/^\//, ''));
    assert.ok(fs.existsSync(absPath), `Missing audio asset on disk for ${key}: ${absPath}`);
    const stat = fs.statSync(absPath);
    assert.ok(stat.size > 1000, `Audio asset ${key} unexpectedly small (${stat.size} bytes)`);
  }

  const verifiedAudioRecords = AUDIO_ASSET_MANIFEST.filter((r) => r.status === 'LICENSE_VERIFIED_FOR_GAME');
  assert.ok(verifiedAudioRecords.length >= 9, 'Expected CC0 OpenGameArt provenance records in AUDIO_ASSET_MANIFEST');

  const expectedProfiles: GunAudioProfile[] = [
    'gun_light_556',
    'gun_medium_762',
    'gun_enclosed_mg',
    'gun_rotary_minigun',
    'gun_rws_250',
    'cannon_20mm',
  ];
  const weaponProfiles = new Set(
    Object.values(WEAPONS)
      .filter((w) => w.category === 'cannon')
      .map((w) => w.audioProfile),
  );
  for (const prof of expectedProfiles) {
    assert.equal(weaponProfiles.has(prof), true, `Missing GunAudioProfile weapon coverage for ${prof}`);
  }
});

test('M2.3/M2.4 Test 1: evaluateConvoyKinematics moves deterministically along terrain and matches across 30, 60, and 144 FPS', () => {
  const sectorConvoy = THEATERS.edwards.landmarks.find((l) => l.type === 'convoy')!;
  assert.ok(sectorConvoy, 'Expected convoy landmark in Sector 04');

  const k0 = evaluateConvoyKinematics(sectorConvoy, 'edwards', 0);
  const k15 = evaluateConvoyKinematics(sectorConvoy, 'edwards', 15);
  assert.ok(Math.hypot(k15.x - k0.x, k15.z - k0.z) > 80, 'Expected convoy to displace significantly over 15s');
  assert.ok(Math.abs(k15.y - groundHeightAt('edwards', k15.x, k15.z)) < 1e-6, 'Convoy y must match DEM terrain elevation');

  const runForFps = (fps: number) => {
    const world = new SimWorld(SimWorld.createDefaultConfig({ disableFuelDepletion: true }), 0x2304);
    const dt = 1 / fps;
    const frames = Math.round(fps * 6.0);
    for (let f = 0; f < frames; f++) {
      world.stepFrame(dt, true, NEUTRAL_STEP_INPUT, []);
    }
    return world.landmarks.find((l) => l.type === 'convoy')!;
  };

  const c60 = runForFps(60);
  const c30 = runForFps(30);
  const c144 = runForFps(144);
  assert.ok(Math.abs(c30.x - c60.x) < 1e-6 && Math.abs(c30.z - c60.z) < 1e-6, '30 FPS convoy position drifted');
  assert.ok(Math.abs(c144.x - c60.x) < 1e-6 && Math.abs(c144.z - c60.z) < 1e-6, '144 FPS convoy position drifted');
});

test('M2.3/M2.4 Test 2: SimWorld advances 5-phase Combined Experience mission cleanly, marks EO/IR targets once, and opens in Mojave golden hour', () => {
  const world = new SimWorld(SimWorld.createDefaultConfig({ disableFuelDepletion: true }), 0x2405);
  const env = world.getEnvironmentSnapshot();
  assert.ok(
    env.solar.elevationDeg > 6 && env.solar.elevationDeg <= 22,
    `Expected Mojave golden-hour elevation band (6..22 deg), got ${env.solar.elevationDeg.toFixed(2)}`,
  );
  assert.equal(env.solar.skyColorHex, 0xd99b52);
  assert.equal(world.mission.phase, 'deployment');
  assert.equal(world.mission.phaseNumber, 1);

  // Advance simulation ~6s -> enters recon phase (Phase 2)
  for (let f = 0; f < 360; f++) {
    world.stepFrame(1 / 60, true, NEUTRAL_STEP_INPUT, []);
  }
  assert.equal(world.mission.phase, 'recon');
  assert.equal(world.mission.phaseNumber, 2);

  // Mark 2 distinct ground contacts via [T] markReconTarget(), duplicate id ignored
  const firstId = world.landmarks[0].id;
  const mark1 = world.markReconTarget(firstId);
  assert.equal(mark1.marked, true);
  assert.equal(world.score, 50);
  assert.ok(mark1.events.some((e) => e.type === 'sound' && e.kind === 'recon_mark'));

  const dup = world.markReconTarget(firstId);
  assert.equal(dup.marked, false);
  assert.equal(world.score, 50);

  const secondId = world.landmarks[1].id;
  const mark2 = world.markReconTarget(secondId);
  assert.equal(mark2.marked, true);
  assert.equal(world.score, 100);

  // Step 1 frame -> Phase 2 -> Phase 3 (aerial_encounter)
  world.stepFrame(1 / 60, true, NEUTRAL_STEP_INPUT, []);
  assert.equal(world.mission.phase, 'aerial_encounter');
  assert.equal(world.mission.phaseNumber, 3);

  // Simulate hostile air kill -> transitions to Phase 4 (ground_activity)
  world.mission.airKillsCount = 1;
  world.stepFrame(1 / 60, true, NEUTRAL_STEP_INPUT, []);
  assert.equal(world.mission.phase, 'ground_activity');
  assert.equal(world.mission.phaseNumber, 4);

  // Neutralize remaining landmarks -> transitions to Phase 5 (resolution) & victory
  for (const lm of world.landmarks) {
    lm.hp = 0;
  }
  const endStep = world.stepFrame(1 / 60, true, NEUTRAL_STEP_INPUT, []);
  assert.equal(world.mission.phase, 'resolution');
  assert.equal(world.mission.phaseNumber, 5);
  assert.ok(endStep.events.some((e) => e.type === 'game_over' && e.victory === true));
});






