import { AIRFRAMES, WEAPONS } from './arsenalData';
import {
  AirframeClass,
  AirframeId,
  GunFireMode,
  GunSubcategory,
  LoadoutConfig,
  WeaponId,
} from './types';

export interface GunSubcategoryMeta {
  id: GunSubcategory;
  badge: string;
  title: string;
  referenceSystems: string;
  summary: string;
}

export const GUN_SUBCATEGORIES: Record<GunSubcategory, GunSubcategoryMeta> = {
  cat_a_light_rifle: {
    id: 'cat_a_light_rifle',
    badge: 'CAT A',
    title: 'Light Rifle-Class Drone Guns',
    referenceSystems: 'ASİSGUARD SONGAR 5.56 Ref',
    summary: 'Lightweight 5.56mm stabilized gimbals for multirotors & light tactical UAVs.',
  },
  cat_b_heavy_multirotor: {
    id: 'cat_b_heavy_multirotor',
    badge: 'CAT B',
    title: 'Heavy Multirotor Weapon Stations',
    referenceSystems: 'SONGAR 7.62 / Duke TIKAD Ref',
    summary: 'Stabilized 7.62mm / enclosed recoil-damped weapon stations for heavy hover-capable drones.',
  },
  cat_c_rotary_pod: {
    id: 'cat_c_rotary_pod',
    badge: 'CAT C',
    title: 'Heavy Rotary Aircraft Gun Pods',
    referenceSystems: 'GA Mojave + Dillon Aero DAP-6 Ref',
    summary: 'High-rate 6-barrel rotary gun pods verified strictly for Mojave / MQ-9X / Heavy Pod UAVs.',
  },
  cat_d_rws_turret: {
    id: 'cat_d_rws_turret',
    badge: 'CAT D',
    title: 'Compact Tactical Remote Weapon Stations',
    referenceSystems: 'IAI / SIG FIRE STORM 250 · M250 Ref',
    summary: 'Low-profile gyro-stabilized electro-optical RWS turrets for tactical & heavy UAVs.',
  },
};

export interface CompatibilityResult {
  compatible: boolean;
  verified: boolean;
  sandboxOverrideUsed: boolean;
  reason: string | null;
}

const AIRFRAME_CLASS_LABELS: Record<AirframeClass, string> = {
  light_multirotor: 'Light Multirotor',
  heavy_multirotor: 'Heavy Multirotor',
  tactical_uav: 'Tactical UAV',
  heavy_pod_uav: 'Heavy Pod UCAV',
  stealth_jet: 'Stealth Jet UCAV',
};

export function checkWeaponCompatibility(
  airframeId: AirframeId,
  weaponId: WeaponId,
  sandboxEnabled = false,
): CompatibilityResult {
  const airframe = AIRFRAMES[airframeId];
  const weapon = WEAPONS[weaponId];
  if (!airframe || !weapon) {
    return {
      compatible: false,
      verified: false,
      sandboxOverrideUsed: false,
      reason: 'Unknown airframe or weapon.',
    };
  }

  const classAllowed =
    !weapon.compatibleAirframeClasses ||
    weapon.compatibleAirframeClasses.includes(airframe.airframeClass);

  const slotMass =
    weapon.category === 'cannon' ? weapon.massKg + weapon.ammoPerSlot * 0.08 : weapon.massKg;
  const massAllowed = slotMass <= airframe.maxPylonPayloadKg;

  const isVerified = classAllowed && massAllowed;
  if (isVerified) {
    return {
      compatible: true,
      verified: true,
      sandboxOverrideUsed: false,
      reason: null,
    };
  }

  const reqLabels = (weapon.compatibleAirframeClasses ?? ['heavy_pod_uav'])
    .map((c) => AIRFRAME_CLASS_LABELS[c])
    .join(' / ');

  const reason = !classAllowed
    ? `${weapon.name} requires ${reqLabels} — restricted on ${airframe.name} (${AIRFRAME_CLASS_LABELS[airframe.airframeClass]}) in Verified mode.`
    : `${weapon.name} (${Math.round(slotMass)} kg) exceeds ${airframe.name} pylon limit (${airframe.maxPylonPayloadKg} kg).`;

  if (sandboxEnabled) {
    return {
      compatible: true,
      verified: false,
      sandboxOverrideUsed: true,
      reason,
    };
  }

  return {
    compatible: false,
    verified: false,
    sandboxOverrideUsed: false,
    reason,
  };
}

export function getAllowedFireModes(weaponId: WeaponId): GunFireMode[] {
  const w = WEAPONS[weaponId];
  if (!w || w.category !== 'cannon') return ['single'];
  return w.fireModes && w.fireModes.length > 0 ? w.fireModes : ['auto'];
}

export function getDefaultFireMode(weaponId: WeaponId): GunFireMode {
  const w = WEAPONS[weaponId];
  if (!w || w.category !== 'cannon') return 'single';
  return w.defaultFireMode ?? getAllowedFireModes(weaponId)[0] ?? 'auto';
}

export function resolveSlotFireMode(
  weaponId: WeaponId,
  requested?: GunFireMode,
): GunFireMode {
  const allowed = getAllowedFireModes(weaponId);
  if (requested && allowed.includes(requested)) return requested;
  return getDefaultFireMode(weaponId);
}

export function cycleFireMode(weaponId: WeaponId, current: GunFireMode): GunFireMode {
  const allowed = getAllowedFireModes(weaponId);
  if (allowed.length <= 1) return allowed[0] ?? 'single';
  const idx = allowed.indexOf(current);
  return allowed[(idx + 1) % allowed.length];
}

export function normalizeLoadoutConfig(
  raw: LoadoutConfig,
  sandboxEnabled = false,
): LoadoutConfig {
  const airframeId = AIRFRAMES[raw.airframeId] ? raw.airframeId : 'bayraktar_tb2';
  const safeSlots = raw.slots.map((wId, idx) => {
    const candidate = WEAPONS[wId] ? wId : idx === 3 ? 'fire_storm_250' : 'mam_l';
    if (checkWeaponCompatibility(airframeId, candidate, sandboxEnabled).compatible) {
      return candidate;
    }
    return idx === 3 ? 'fire_storm_250' : 'mam_l';
  }) as [WeaponId, WeaponId, WeaponId, WeaponId];

  const slotFireModes = safeSlots.map((wId, idx) =>
    resolveSlotFireMode(wId, raw.slotFireModes?.[idx]),
  ) as [GunFireMode, GunFireMode, GunFireMode, GunFireMode];

  return {
    ...raw,
    airframeId,
    slots: safeSlots,
    slotFireModes,
  };
}
