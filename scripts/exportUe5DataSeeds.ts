import fs from 'node:fs';
import path from 'node:path';
import { AIRFRAMES, PROPULSION_MODULES, SENSOR_MODULES, WEAPONS } from '../src/sim/arsenalData';
import { THEATERS } from '../src/sim/geoTheaters';
import { GUN_SUBCATEGORIES } from '../src/sim/weaponCompatibility';
import { AUDIO_ASSET_MANIFEST, VISUAL_ASSET_MANIFEST } from '../src/assets/assetManifest';
import { AirframeClass } from '../src/sim/types';

function mapFlightFamily(airframeId: string, airframeClass: AirframeClass): string {
  if (airframeId === 'shahed_136' || airframeId === 'iai_harop' || airframeId === 'zala_lancet') {
    return 'LoiteringAircraft';
  }
  if (airframeClass === 'light_multirotor' || airframeClass === 'heavy_multirotor') {
    return 'Multirotor';
  }
  if (airframeClass === 'stealth_jet') {
    return 'JetPowered';
  }
  return 'FixedWingPropeller';
}

function mapWeaponFamily(weaponFamily: string, gunSubcategory?: string): string {
  if (weaponFamily === 'uav_gun') {
    switch (gunSubcategory) {
      case 'cat_a_light_rifle':
        return 'FamilyA_LightweightUavGun';
      case 'cat_b_heavy_multirotor':
        return 'FamilyB_MediumUavMachineGun';
      case 'cat_c_rotary_pod':
        return 'FamilyC_RotaryAircraftGunPod';
      case 'cat_d_rws_turret':
        return 'FamilyD_TacticalRwsTurret';
      default:
        return 'FamilyA_LightweightUavGun';
    }
  }
  if (weaponFamily === 'glide_bomb' || weaponFamily === 'drop_bomb') {
    return 'FamilyF_BombAndReleaseSystem';
  }
  return 'FamilyE_GuidedGameOrdnance';
}

const jsonDir = path.resolve(process.cwd(), 'AeroStrike/Content/DataAssets/JSON');
const manifestDir = path.resolve(process.cwd(), 'AeroStrike/SourceAssetManifests');
fs.mkdirSync(jsonDir, { recursive: true });
fs.mkdirSync(manifestDir, { recursive: true });

// 1. Airframes Seed
const airframesOut = Object.values(AIRFRAMES).map((af) => ({
  Name: af.id,
  DisplayName: af.name,
  Designation: af.designation,
  Origin: af.origin,
  AirframeClass: af.airframeClass,
  FlightModelFamily: mapFlightFamily(af.id, af.airframeClass),
  DryMassKg: af.dryMassKg,
  WingAreaM2: af.wingAreaM2,
  WingspanM: af.wingspanM,
  AspectRatio: af.aspectRatio,
  Cd0: af.cd0,
  ClMax: af.clMax,
  StallAngleDeg: af.stallAngleDeg,
  MaxPitchRateRadSec: af.maxPitchRateRad,
  MaxRollRateRadSec: af.maxRollRateRad,
  MaxYawRateRadSec: af.maxYawRateRad,
  MaxPylonPayloadKg: af.maxPylonPayloadKg,
  Hardpoints: af.hardpoints,
  MaxG: af.maxG,
  MaxHp: af.maxHp,
  RcsM2: af.rcsM2,
  bDisableFuelDepletion: true,
  ReferenceNotes: af.description,
}));
fs.writeFileSync(path.join(jsonDir, 'Airframes.json'), JSON.stringify(airframesOut, null, 2));

// 2. Weapon Families Seed (Families A–G)
const familiesOut = [
  ...Object.values(GUN_SUBCATEGORIES).map((g) => ({
    FamilyId: mapWeaponFamily('uav_gun', g.id),
    Domain: 'ProjectileGuns',
    Badge: g.badge,
    Title: g.title,
    ReferenceSystems: g.referenceSystems,
    Summary: g.summary,
    UsesRotarySpinUp: g.id === 'cat_c_rotary_pod',
  })),
  {
    FamilyId: 'FamilyE_GuidedGameOrdnance',
    Domain: 'GuidedOrdnance',
    Badge: 'FAMILY E',
    Title: 'Guided Game Ordnance (ATGMs / AAMs / Cruise / Ballistic)',
    ReferenceSystems: 'Fictionalized standoff guided munitions',
    Summary: 'Shared guided ordnance contract for rail launch, seeker lock, cooldown, and replication.',
    UsesRotarySpinUp: false,
  },
  {
    FamilyId: 'FamilyF_BombAndReleaseSystem',
    Domain: 'ReleaseOrdnance',
    Badge: 'FAMILY F',
    Title: 'Bomb & Release Systems (Glide & Drop Munitions)',
    ReferenceSystems: 'Fictionalized unpowered glide and drop racks',
    Summary: 'Gravity release and deployable wing-glide munitions separate from automatic gunfire.',
    UsesRotarySpinUp: false,
  },
  {
    FamilyId: 'FamilyG_DefensiveAndUtility',
    Domain: 'DefensiveUtility',
    Badge: 'FAMILY G',
    Title: 'Defensive Countermeasures & EO/IR Utility',
    ReferenceSystems: 'IR Flares & EO/IR Target Designator',
    Summary: 'Non-lethal defensive flares and optical sensor utilities decoupled from primary weapon fire.',
    UsesRotarySpinUp: false,
  },
];
fs.writeFileSync(path.join(jsonDir, 'WeaponFamilies.json'), JSON.stringify(familiesOut, null, 2));

// 3. Weapon Variants Seed (Audited verifiedAirframeIds separated from compatibleAirframeClasses)
const variantsOut = Object.values(WEAPONS).map((w) => ({
  WeaponId: w.id,
  DisplayName: w.name,
  NatoCode: w.natoCode,
  Origin: w.origin,
  Domain: w.category === 'cannon' ? 'ProjectileGuns' : w.category === 'glide_bomb' || w.category === 'drop_bomb' ? 'ReleaseOrdnance' : 'GuidedOrdnance',
  WeaponFamily: mapWeaponFamily(w.weaponFamily, w.gunSubcategory),
  AudioProfile: w.audioProfile ?? (w.category === 'glide_bomb' || w.category === 'drop_bomb' ? 'glide_release' : 'ordnance_launch'),
  CompatibleAirframeClasses: w.compatibleAirframeClasses ?? ['light_multirotor', 'heavy_multirotor', 'tactical_uav', 'heavy_pod_uav', 'stealth_jet'],
  HistoricallyDocumentedAirframeIds: w.verifiedAirframeIds ?? [],
  HistoricallyDocumentedAuditNote:
    w.verifiedAirframeIds && w.verifiedAirframeIds.length > 0
      ? 'Explicitly documented list provided; check strictly against HistoricallyDocumentedAirframeIds.'
      : 'UNVERIFIED_CLASS_COMPATIBLE_ONLY — Do not infer historical airframe verification from class compatibility.',
  AllowedFireModes: w.fireModes ?? ['single'],
  DefaultFireMode: w.defaultFireMode ?? 'single',
  BurstCount: w.burstCount ?? 1,
  BurstIntervalSec: w.burstIntervalSec ?? 0.09,
  CooldownSec: w.cooldownSec,
  MassKg: w.massKg,
  AmmoPerSlot: w.ammoPerSlot,
  RotaryBarrels: w.rotaryBarrels ?? 0,
  FictionalGameStats: {
    Damage: w.damage,
    WarheadKg: w.warheadKg,
    BlastRadiusM: w.blastRadiusM,
    InitialSpeedMs: w.initialSpeedMs,
    MaxRangeKm: w.maxRangeKm,
    MachMax: w.machMax,
  },
}));
fs.writeFileSync(path.join(jsonDir, 'WeaponVariants.json'), JSON.stringify(variantsOut, null, 2));

// 4. Propulsion & Sensors & Sector 04 Theater
fs.writeFileSync(path.join(jsonDir, 'Propulsion.json'), JSON.stringify(Object.values(PROPULSION_MODULES), null, 2));
fs.writeFileSync(path.join(jsonDir, 'Sensors.json'), JSON.stringify(Object.values(SENSOR_MODULES), null, 2));
fs.writeFileSync(path.join(jsonDir, 'Sector04_Mojave.json'), JSON.stringify(THEATERS.edwards, null, 2));

// 5. Canonical Source Asset Database (fixes manifest mismatch by listing all 22 audio files explicitly)
const audioFilesOnDisk = fs
  .readdirSync(path.resolve(process.cwd(), 'public/assets/audio'))
  .filter((f) => f.endsWith('.wav'))
  .sort();

const canonicalDb = {
  schemaVersion: '2.5.0',
  generatedAtIso: new Date().toISOString(),
  note: 'Canonical source asset database uniting Stage A/M2 visual & audio assets and reconciling all 22 bundled WAV stems.',
  visualRecords: VISUAL_ASSET_MANIFEST,
  audioRecords: AUDIO_ASSET_MANIFEST,
  bundledAudioFilesCount: audioFilesOnDisk.length,
  bundledAudioFiles: audioFilesOnDisk.map((fileName) => ({
    fileName,
    browserPath: `/assets/audio/${fileName}`,
    ue5TargetPath: `/Game/Audio/LegacyBaseline/${fileName.replace('.wav', '')}`,
    replacesRequiredInM25E: true,
  })),
};
fs.writeFileSync(path.join(manifestDir, 'canonical_asset_database.json'), JSON.stringify(canonicalDb, null, 2));

console.log(
  `Exported UE5 DataAsset JSON seeds (${airframesOut.length} airframes, ${familiesOut.length} families, ${variantsOut.length} variants) + canonical asset DB (${audioFilesOnDisk.length} WAVs).`,
);
