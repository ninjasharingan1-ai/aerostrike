import test from 'node:test';
import assert from 'node:assert/strict';
import { AIRFRAMES, DEFAULT_LOADOUT, WEAPONS } from './arsenalData';
import { createAiBotSquadron, stepAiCombatBot } from './aiDogfight';
import {
  computeInstructorControlInput,
  computeKamikazeImpactPayload,
  computeLeadPoint,
  predictOrdnanceTrajectory,
  stepDroneFlight,
  stepWarThunderAimAngles,
} from './flightPhysics';
import { groundHeightAt, worldToLatLon } from './geoTheaters';
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
import { SimStepInput, SimWorld } from './core/simWorld';
import { applyGraphicsPreset } from './settings';
import { computeAtmosphericGravity, computeSolarState } from './solarGravity';
import { DroneFlightState, SandboxConfig } from './types';

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

test('War Thunder 360-deg Mouse Aim cursor slews smoothly, freezes during C Free-Look, and syncs on manual override', () => {
  // Moving mouse right slews aimYaw negatively (turning right in Three.js -Z forward convention)
  const slewRight = stepWarThunderAimAngles(
    0,
    0,
    0.8,
    0.2,
    { pitchOverride: 0, rollOverride: 0, yawOverride: 0 },
    false,
    0,
    0,
    'mouse_aim',
    0.05,
  );
  assert.ok(slewRight.aimYaw < -0.02, `Expected right slew to decrease yaw, got ${slewRight.aimYaw}`);
  assert.ok(slewRight.aimPitch > 0.005, `Expected upward slew to increase pitch, got ${slewRight.aimPitch}`);

  // Holding Free-Look ('C') keeps aimYaw/aimPitch frozen regardless of cursor displacement
  const frozen = stepWarThunderAimAngles(
    0.55,
    0.15,
    0.9,
    0.9,
    { pitchOverride: 0, rollOverride: 0, yawOverride: 0 },
    true,
    0.1,
    0,
    'mouse_aim',
    0.05,
  );
  assert.equal(frozen.aimYaw, 0.55);
  assert.equal(frozen.aimPitch, 0.15);

  // Holding manual override syncs aim back to drone orientation so release never snaps back
  const manualOverride = stepWarThunderAimAngles(
    1.2,
    0.4,
    0.8,
    0.8,
    { pitchOverride: -1, rollOverride: 0, yawOverride: 0 },
    false,
    -0.42,
    0.12,
    'mouse_aim',
    0.05,
  );
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
  mouseNdcX: 0,
  mouseNdcY: 0,
  mouseSensitivity: 1,
  invertY: false,
  freeLooking: false,
  firingHeld: false,
  cameraOrbitMode: false,
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
    // Fire ordnance on tick 20% through sortie so ordnance + cooldowns + AI combat run across FPS tiers
    if (f === Math.round(fps * 1.0)) {
      world.fireActiveOrdnance(true, []);
    }
    const input: SimStepInput =
      f >= Math.round(fps * 2.0) && f < Math.round(fps * 4.0)
        ? { ...NEUTRAL_STEP_INPUT, mouseNdcX: 0.35, mouseNdcY: 0.15 }
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

