export type GamePhase = 'title' | 'playing' | 'paused' | 'gameover';

export type AirframeId =
  | 'mq9x'
  | 'bayraktar_tb2'
  | 'punisher_ua'
  | 'baba_yaga'
  | 'hermes_900'
  | 'iai_harop'
  | 'shahed_136'
  | 'mohajer_6'
  | 'orion_ru'
  | 'zala_lancet'
  | 'akinci'
  | 'xq58a'
  | 'switchblade_x';

export type PropulsionId = 'turboprop_900' | 'piston_md550' | 'hex_electric' | 'edf_quiet' | 'turbofan_22kn' | 'ramjet_exp';
export type SensorId = 'eoir_das4' | 'aesa_apg81' | 'ew_jammer' | 'solar_optical';
export type WeaponId =
  | 'mam_l'
  | 'mam_c'
  | 'pg7vl_drop'
  | 'spike_nlos'
  | 'kab_20'
  | 'kornet_d'
  | 'qaem_5'
  | 'r73_archer'
  | 'agm114_hellfire'
  | 'gbu39_sdb'
  | 'agm158_jassm'
  | 'mim140_ballistic'
  | 'aim9x_sidewinder'
  | 'm61_vulcan';

export type CyberPayloadId =
  | 'radar_spoof'
  | 'gnss_spoof'
  | 'c2_hijack'
  | 'scada_sabotage'
  | 'firmware_brick';

export type CyberTargetScope = 'base' | 'drone' | 'both';

export interface CyberPayloadSpec {
  id: CyberPayloadId;
  name: string;
  targetScope: CyberTargetScope;
  maxRangeM: number;
  durationSec: number;
  directDamage: number;
  cooldownSec: number;
  difficulty: 1 | 2 | 3;
  unlockCostRc: number;
  requiredRank: number;
  effectSummary: string;
}

export type WeaponCategory =
  | 'atgm'
  | 'glide_bomb'
  | 'drop_bomb'
  | 'cruise_missile'
  | 'ballistic_missile'
  | 'aam'
  | 'cannon';

export type WeatherId =
  | 'clear'
  | 'overcast_crosswind'
  | 'thunderstorm'
  | 'jetstream'
  | 'desert_dust';

export type TheaterId = 'edwards' | 'alps' | 'hormuz' | 'baltic';

export type CameraMode = 'chase' | 'eoir' | 'orbit';

export interface AirframeSpec {
  id: AirframeId;
  name: string;
  designation: string;
  role: string;
  origin: string;
  dryMassKg: number;
  maxFuelKg: number;
  wingAreaM2: number;
  wingspanM: number;
  aspectRatio: number;
  cd0: number;
  clMax: number;
  stallAngleDeg: number;
  maxPitchRateRad: number;
  maxRollRateRad: number;
  maxYawRateRad: number;
  maxG: number;
  maxHp: number;
  rcsM2: number;
  hardpoints: number;
  solarWingAreaM2: number;
  kamikazeCapable: boolean;
  kamikazeWarheadKg: number;
  kamikazeDamage: number;
  kamikazeBlastRadiusM: number;
  defaultPropulsionId: PropulsionId;
  unlockCostRc: number;
  requiredRank: number;
  description: string;
}

export interface PropulsionSpec {
  id: PropulsionId;
  name: string;
  type: 'Turboprop' | 'Piston Pusher' | 'Heavy Hexacopter' | 'Turbofan' | 'Electric Ducted Fan' | 'Ramjet Booster';
  maxThrustN: number;
  specificFuelConsumption: number;
  optimalMach: number;
  maxMach: number;
  irSignature: number;
  massKg: number;
  unlockCostRc: number;
  requiredRank: number;
  description: string;
}

export interface SensorSpec {
  id: SensorId;
  name: string;
  type: string;
  lockRangeM: number;
  lockConeDeg: number;
  weatherPenetration: number;
  solarEfficiencyBonus: number;
  massKg: number;
  unlockCostRc: number;
  requiredRank: number;
  description: string;
}

export interface WeaponSpec {
  id: WeaponId;
  name: string;
  natoCode: string;
  origin: string;
  category: WeaponCategory;
  massKg: number;
  warheadKg: number;
  blastRadiusM: number;
  damage: number;
  ammoPerSlot: number;
  cooldownSec: number;
  initialSpeedMs: number;
  boostThrustN: number;
  boostDurationSec: number;
  glideLiftToDrag: number;
  guidanceGain: number;
  cepMeters: number;
  maxRangeKm: number;
  machMax: number;
  unlockCostRc: number;
  requiredRank: number;
  flightProfileLabel: string;
  summary: string;
}

export interface WeatherSpec {
  id: WeatherId;
  name: string;
  windSpeedMs: number;
  windHeadingDeg: number;
  turbulenceIntensity: number;
  visibilityM: number;
  fogDensity: number;
  precipitation: 'none' | 'rain' | 'dust';
  cloudCover: number;
  irAttenuation: number;
  description: string;
}

export interface TheaterLandmark {
  id: string;
  name: string;
  type: 'airbase' | 'sam' | 'radar' | 'bunker' | 'depot' | 'convoy';
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  points: number;
  threatRadiusM?: number;
}

export interface TheaterSpec {
  id: TheaterId;
  name: string;
  region: string;
  latDeg: number;
  lonDeg: number;
  worldRadiusM: number;
  baseElevationM: number;
  waterLevelM: number;
  defaultWeather: WeatherId;
  description: string;
  landmarks: Omit<TheaterLandmark, 'hp'>[];
}

export interface SandboxConfig {
  enabled: boolean;
  gravityMultiplier: number;
  airDensityMultiplier: number;
  thrustMultiplier: number;
  wingAreaMultiplier: number;
  massMultiplier: number;
  guidanceGainMultiplier: number;
  timeScale: number;
  infiniteAmmo: boolean;
  unlockAllInSandbox: boolean;
}

export interface LoadoutConfig {
  airframeId: AirframeId;
  propulsionId: PropulsionId;
  sensorId: SensorId;
  slots: [WeaponId, WeaponId, WeaponId, WeaponId];
}

export interface SolarState {
  elevationDeg: number;
  azimuthDeg: number;
  sunDirX: number;
  sunDirY: number;
  sunDirZ: number;
  irradianceWm2: number;
  thermalUpdraftMs: number;
  isDaylight: boolean;
  skyColorHex: number;
  fogColorHex: number;
  sunColorHex: number;
}

export interface AtmosphericGravityState {
  localGravityMs2: number;
  airDensityKgM3: number;
  speedOfSoundMs: number;
  temperatureK: number;
  coriolisAccelX: number;
  coriolisAccelZ: number;
}

export interface DroneFlightState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  pitch: number;
  yaw: number;
  roll: number;
  throttle: number;
  airspeedMs: number;
  mach: number;
  aglMeters: number;
  aoaDeg: number;
  gLoad: number;
  stalling: boolean;
  hp: number;
  maxHp: number;
  fuelKg: number;
  maxFuelKg: number;
  solarChargeRateW: number;
}

export interface ActiveOrdnanceState {
  id: string;
  ownerId: string;
  weaponId: WeaponId;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  ageSec: number;
  maxLifetimeSec: number;
  targetId: string | null;
  targetX: number;
  targetY: number;
  targetZ: number;
  wingDeployed: boolean;
  phase: 'boost' | 'glide' | 'ballistic_ascent' | 'ballistic_terminal' | 'cruise' | 'bullet';
}

export interface TrajectoryPoint {
  x: number;
  y: number;
  z: number;
  t: number;
}

export interface PredictedImpact {
  points: TrajectoryPoint[];
  impactX: number;
  impactY: number;
  impactZ: number;
  flightTimeSec: number;
  apogeeM: number;
  maxMach: number;
}

export type SkillBranchId = 'electronic_warfare' | 'precision_ballistics' | 'flight_efficiency';

export type PilotSkillId =
  | 'ew_signal_amp'
  | 'ew_intrusion_speed'
  | 'ew_ecm_hardening'
  | 'bal_seeker_tuning'
  | 'bal_warhead_yield'
  | 'bal_autoloader'
  | 'flt_turbomachinery'
  | 'flt_aerodynamics'
  | 'flt_solar_cell';

export interface SkillSpec {
  id: PilotSkillId;
  branch: SkillBranchId;
  tier: 1 | 2 | 3;
  name: string;
  maxLevel: number;
  costPerLevelSp: number;
  prereqSkillId: PilotSkillId | null;
  bonusPerLevelSummary: string;
  description: string;
}

export interface PilotSkillBonuses {
  cyberRangeMult: number;
  cyberWindowBonus: number;
  cyberCooldownMult: number;
  cyberDurationMult: number;
  ecmSuppressionBonus: number;
  hostileCyberDurationMult: number;
  guidanceGainMult: number;
  damageMult: number;
  blastRadiusMult: number;
  weaponCooldownMult: number;
  bonusFlares: number;
  fuelBurnMult: number;
  thrustMult: number;
  dragMult: number;
  agilityMult: number;
  solarChargeMult: number;
  maxHpMult: number;
}

export interface PilotProgression {
  xp: number;
  researchCredits: number;
  rank: number;
  skillPoints: number;
  skillLevels: Partial<Record<PilotSkillId, number>>;
  kills: number;
  groundStrikes: number;
  cyberBreaches: number;
  sortiesCompleted: number;
  bestCepMeters: number | null;
  unlockedAirframes: AirframeId[];
  unlockedPropulsion: PropulsionId[];
  unlockedSensors: SensorId[];
  unlockedWeapons: WeaponId[];
  unlockedCyber: CyberPayloadId[];
}

export interface RemotePilotState {
  id: string;
  callsign: string;
  airframeId: AirframeId;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  pitch: number;
  yaw: number;
  roll: number;
  hp: number;
  maxHp: number;
  kills: number;
  isAi?: boolean;
  team?: 'alpha' | 'bravo';
}

export interface KillFeedEntry {
  id: string;
  text: string;
  timestamp: number;
  kind: 'strike' | 'air' | 'system';
}

export type BotTeam = 'alpha' | 'bravo';
export type BotRole = 'wingman' | 'interceptor' | 'dogfighter' | 'striker';

export interface AirContactHud {
  id: string;
  callsign: string;
  team: BotTeam;
  role: BotRole;
  screenX: number;
  screenY: number;
  distM: number;
  hpPct: number;
  locked: boolean;
  leadX: number | null;
  leadY: number | null;
}

export interface HudSnapshot {
  airspeedKnots: number;
  mach: number;
  altitudeMsl: number;
  altitudeAgl: number;
  headingDeg: number;
  pitchDeg: number;
  rollDeg: number;
  gLoad: number;
  throttlePct: number;
  hp: number;
  maxHp: number;
  fuelPct: number;
  stalling: boolean;
  activeSlot: number;
  slotAmmo: [number, number, number, number];
  slotCooldowns: [number, number, number, number];
  lockedTargetId: string | null;
  lockedTargetKind: 'base' | 'drone' | 'waypoint' | null;
  lockedTargetName: string | null;
  lockedTargetDistM: number | null;
  lockedTargetHpPct: number | null;
  lockedTargetCompromisedSec: number;
  incomingCyberThreat: string | null;
  playerCyberDisruptedSec: number;
  cyberCooldownSec: number;
  predictedCepM: number | null;
  predictedApogeeM: number | null;
  score: number;
  targetsDestroyed: number;
  totalTargets: number;
  localGravityMs2: number;
  solarElevationDeg: number;
  solarChargeW: number;
  windSpeedKnots: number;
  sortieTimeSec: number;
  missilesIncoming: number;
  radarLocked: boolean;
  flaresRemaining: number;
  flareCooldownSec: number;
  mouseAimScreenX: number;
  mouseAimScreenY: number;
  noseScreenX: number;
  noseScreenY: number;
  targetScreenX: number | null;
  targetScreenY: number | null;
  leadScreenX: number | null;
  leadScreenY: number | null;
  zoomed: boolean;
  wepActive: boolean;
  kamikazeArmed: boolean;
  kamikazeCapable: boolean;
  reserveDrones: number;
  blueTickets: number;
  redTickets: number;
  freeLooking: boolean;
  combatHitCallout: string | null;
  airContacts: AirContactHud[];
}
