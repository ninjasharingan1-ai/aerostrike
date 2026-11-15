import { AIRFRAMES, PROPULSION_MODULES, SENSOR_MODULES, WEAPONS } from './arsenalData';
import { CYBER_PAYLOADS } from './cyberWarfare';
import {
  AirframeId,
  CyberPayloadId,
  PilotProgression,
  PilotSkillBonuses,
  PilotSkillId,
  PropulsionId,
  SensorId,
  SkillBranchId,
  SkillSpec,
  WeaponId,
} from './types';

const STORAGE_KEY = 'aerostrike_pilot_progression_v1';

export const SKILL_BRANCHES: {
  id: SkillBranchId;
  name: string;
  tagline: string;
  accent: 'cyan' | 'amber' | 'emerald';
}[] = [
  {
    id: 'electronic_warfare',
    name: 'Electronic Warfare',
    tagline: 'RF intrusion range, carrier-sync tolerance, and active ECM threat suppression.',
    accent: 'cyan',
  },
  {
    id: 'precision_ballistics',
    name: 'Precision Ballistics',
    tagline: 'Higher proportional navigation gain, lethal warheads, and faster pylon cycling.',
    accent: 'amber',
  },
  {
    id: 'flight_efficiency',
    name: 'Flight Efficiency',
    tagline: 'Lower specific fuel burn, clean laminar drag, and reinforced solar airframes.',
    accent: 'emerald',
  },
];

export const PILOT_SKILLS: Record<PilotSkillId, SkillSpec> = {
  ew_signal_amp: {
    id: 'ew_signal_amp',
    branch: 'electronic_warfare',
    tier: 1,
    name: 'RF Signal Amplification',
    maxLevel: 3,
    costPerLevelSp: 1,
    prereqSkillId: null,
    bonusPerLevelSummary: '+12% Cyber Range · +4% Sync Window',
    description: 'Boosts phased-array datalink TX power to inject cyber payloads from standoff distance.',
  },
  ew_intrusion_speed: {
    id: 'ew_intrusion_speed',
    branch: 'electronic_warfare',
    tier: 2,
    name: 'Zero-Day Pipeline',
    maxLevel: 3,
    costPerLevelSp: 1,
    prereqSkillId: 'ew_signal_amp',
    bonusPerLevelSummary: '-12% Cyber Cooldown · +15% Lockout Duration',
    description: 'Pipelined handshake scripts shorten transmitter recharge and extend facility blackouts.',
  },
  ew_ecm_hardening: {
    id: 'ew_ecm_hardening',
    branch: 'electronic_warfare',
    tier: 3,
    name: 'Adaptive ECM Shielding',
    maxLevel: 2,
    costPerLevelSp: 2,
    prereqSkillId: 'ew_intrusion_speed',
    bonusPerLevelSummary: '+18% SAM Suppression · -25% Hostile C2 Lock Time',
    description: 'Hardens flight buses against enemy C2 hijacks and disrupts SAM fire-control radars.',
  },
  bal_seeker_tuning: {
    id: 'bal_seeker_tuning',
    branch: 'precision_ballistics',
    tier: 1,
    name: 'Proportional Nav Gain',
    maxLevel: 3,
    costPerLevelSp: 1,
    prereqSkillId: null,
    bonusPerLevelSummary: "+12% Seeker Gain (N')",
    description: 'Tightens missile and glide-bomb terminal correction loops for surgical CEP accuracy.',
  },
  bal_warhead_yield: {
    id: 'bal_warhead_yield',
    branch: 'precision_ballistics',
    tier: 2,
    name: 'Shaped-Charge Lethality',
    maxLevel: 3,
    costPerLevelSp: 1,
    prereqSkillId: 'bal_seeker_tuning',
    bonusPerLevelSummary: '+10% Ordnance Damage · +10% Blast Radius',
    description: 'Precision fuzing maximizes fragmentation and armor penetration across hardpoints.',
  },
  bal_autoloader: {
    id: 'bal_autoloader',
    branch: 'precision_ballistics',
    tier: 3,
    name: 'Rapid Pylon Cycling',
    maxLevel: 2,
    costPerLevelSp: 2,
    prereqSkillId: 'bal_warhead_yield',
    bonusPerLevelSummary: '-15% Weapon Cooldown · +2 Sortie Flares',
    description: 'Pneumatic rail cycling speeds up follow-on salvos and packs extra IR decoy pods.',
  },
  flt_turbomachinery: {
    id: 'flt_turbomachinery',
    branch: 'flight_efficiency',
    tier: 1,
    name: 'Variable Stator Tuning',
    maxLevel: 3,
    costPerLevelSp: 1,
    prereqSkillId: null,
    bonusPerLevelSummary: '-12% Fuel Burn · +6% Propulsion Thrust',
    description: 'Optimizes compressor vane schedules for higher specific impulse and combat climb.',
  },
  flt_aerodynamics: {
    id: 'flt_aerodynamics',
    branch: 'flight_efficiency',
    tier: 2,
    name: 'Laminar Airfoil Polish',
    maxLevel: 3,
    costPerLevelSp: 1,
    prereqSkillId: 'flt_turbomachinery',
    bonusPerLevelSummary: '-10% Parasitic Drag · +8% Turn Authority',
    description: 'Reduces boundary-layer separation for crisp sustained turns and dive energy retention.',
  },
  flt_solar_cell: {
    id: 'flt_solar_cell',
    branch: 'flight_efficiency',
    tier: 3,
    name: 'Perovskite Solar Wing',
    maxLevel: 2,
    costPerLevelSp: 2,
    prereqSkillId: 'flt_aerodynamics',
    bonusPerLevelSummary: '+25% Solar Recharge · +10% Max Hull HP',
    description: 'High-efficiency tandem cells and carbon spar reinforcement extend endurance under fire.',
  },
};

export const DEFAULT_SKILL_BONUSES: PilotSkillBonuses = {
  cyberRangeMult: 1,
  cyberWindowBonus: 0,
  cyberCooldownMult: 1,
  cyberDurationMult: 1,
  ecmSuppressionBonus: 0,
  hostileCyberDurationMult: 1,
  guidanceGainMult: 1,
  damageMult: 1,
  blastRadiusMult: 1,
  weaponCooldownMult: 1,
  bonusFlares: 0,
  fuelBurnMult: 1,
  thrustMult: 1,
  dragMult: 1,
  agilityMult: 1,
  solarChargeMult: 1,
  maxHpMult: 1,
};

export const INITIAL_PROGRESSION: PilotProgression = {
  xp: 0,
  researchCredits: 450,
  rank: 1,
  skillPoints: 2,
  skillLevels: {},
  kills: 0,
  groundStrikes: 0,
  cyberBreaches: 0,
  sortiesCompleted: 0,
  bestCepMeters: null,
  unlockedAirframes: ['bayraktar_tb2', 'baba_yaga', 'shahed_136', 'iai_harop', 'zala_lancet', 'mq9x'],
  unlockedPropulsion: ['turboprop_900', 'piston_md550', 'hex_electric'],
  unlockedSensors: ['eoir_das4'],
  unlockedWeapons: ['mam_l', 'mam_c', 'pg7vl_drop', 'kab_20', 'qaem_5', 'r73_archer', 'agm114_hellfire', 'gbu39_sdb', 'm61_vulcan'],
  unlockedCyber: ['radar_spoof', 'gnss_spoof'],
};

export function rankFromXp(xp: number): number {
  return Math.max(1, Math.floor(Math.sqrt(xp / 250)) + 1);
}

export function xpForNextRank(rank: number): number {
  return rank * rank * 250;
}

export function computePilotSkillBonuses(prog: PilotProgression): PilotSkillBonuses {
  const lv = prog.skillLevels ?? {};
  const sig = lv.ew_signal_amp ?? 0;
  const spd = lv.ew_intrusion_speed ?? 0;
  const ecm = lv.ew_ecm_hardening ?? 0;

  const seek = lv.bal_seeker_tuning ?? 0;
  const war = lv.bal_warhead_yield ?? 0;
  const auto = lv.bal_autoloader ?? 0;

  const turbo = lv.flt_turbomachinery ?? 0;
  const aero = lv.flt_aerodynamics ?? 0;
  const solar = lv.flt_solar_cell ?? 0;

  return {
    cyberRangeMult: 1 + sig * 0.12,
    cyberWindowBonus: sig * 0.04,
    cyberCooldownMult: Math.max(0.5, 1 - spd * 0.12),
    cyberDurationMult: 1 + spd * 0.15,
    ecmSuppressionBonus: ecm * 0.18,
    hostileCyberDurationMult: Math.max(0.4, 1 - ecm * 0.25),
    guidanceGainMult: 1 + seek * 0.12,
    damageMult: 1 + war * 0.1,
    blastRadiusMult: 1 + war * 0.1,
    weaponCooldownMult: Math.max(0.55, 1 - auto * 0.15),
    bonusFlares: auto * 2,
    fuelBurnMult: Math.max(0.5, 1 - turbo * 0.12),
    thrustMult: 1 + turbo * 0.06,
    dragMult: Math.max(0.55, 1 - aero * 0.1),
    agilityMult: 1 + aero * 0.08,
    solarChargeMult: 1 + solar * 0.25,
    maxHpMult: 1 + solar * 0.1,
  };
}

export function canUpgradeSkill(
  prog: PilotProgression,
  skillId: PilotSkillId,
): { ok: boolean; reason?: string } {
  const spec = PILOT_SKILLS[skillId];
  if (!spec) return { ok: false, reason: 'Unknown skill' };
  const current = prog.skillLevels?.[skillId] ?? 0;
  if (current >= spec.maxLevel) {
    return { ok: false, reason: 'Max level reached' };
  }
  if (spec.prereqSkillId) {
    const prereqLevel = prog.skillLevels?.[spec.prereqSkillId] ?? 0;
    if (prereqLevel < 1) {
      return {
        ok: false,
        reason: `Requires ${PILOT_SKILLS[spec.prereqSkillId].name}`,
      };
    }
  }
  if ((prog.skillPoints ?? 0) < spec.costPerLevelSp) {
    return { ok: false, reason: `Requires ${spec.costPerLevelSp} SP` };
  }
  return { ok: true };
}

export function upgradePilotSkill(
  prog: PilotProgression,
  skillId: PilotSkillId,
): { ok: boolean; reason?: string; progression: PilotProgression } {
  const check = canUpgradeSkill(prog, skillId);
  if (!check.ok) {
    return { ok: false, reason: check.reason, progression: prog };
  }
  const spec = PILOT_SKILLS[skillId];
  const current = prog.skillLevels?.[skillId] ?? 0;
  return {
    ok: true,
    progression: {
      ...prog,
      skillPoints: (prog.skillPoints ?? 0) - spec.costPerLevelSp,
      skillLevels: {
        ...(prog.skillLevels ?? {}),
        [skillId]: current + 1,
      },
    },
  };
}

export function resetPilotSkills(prog: PilotProgression): PilotProgression {
  let refunded = 0;
  for (const [id, lvl] of Object.entries(prog.skillLevels ?? {})) {
    const spec = PILOT_SKILLS[id as PilotSkillId];
    if (spec && typeof lvl === 'number' && lvl > 0) {
      refunded += lvl * spec.costPerLevelSp;
    }
  }
  return {
    ...prog,
    skillPoints: (prog.skillPoints ?? 0) + refunded,
    skillLevels: {},
  };
}

export function awardSortieRewards(
  prog: PilotProgression,
  delta: {
    xpEarned: number;
    rcEarned: number;
    kills?: number;
    groundStrikes?: number;
    cyberBreaches?: number;
    cepMeters?: number | null;
    completed?: boolean;
  },
): PilotProgression {
  const nextXp = prog.xp + Math.max(0, Math.round(delta.xpEarned));
  const nextRank = rankFromXp(nextXp);
  const rankDiff = Math.max(0, nextRank - prog.rank);
  const rankBonusRc = rankDiff * 250;
  const earnedSp = rankDiff + (delta.completed ? 1 : 0);

  let bestCep = prog.bestCepMeters;
  if (typeof delta.cepMeters === 'number' && delta.cepMeters >= 0) {
    bestCep = bestCep === null ? delta.cepMeters : Math.min(bestCep, delta.cepMeters);
  }

  return {
    ...prog,
    xp: nextXp,
    rank: nextRank,
    skillPoints: (prog.skillPoints ?? 0) + earnedSp,
    researchCredits: prog.researchCredits + Math.max(0, Math.round(delta.rcEarned)) + rankBonusRc,
    kills: prog.kills + (delta.kills ?? 0),
    groundStrikes: prog.groundStrikes + (delta.groundStrikes ?? 0),
    cyberBreaches: (prog.cyberBreaches ?? 0) + (delta.cyberBreaches ?? 0),
    sortiesCompleted: prog.sortiesCompleted + (delta.completed ? 1 : 0),
    bestCepMeters: bestCep,
  };
}

export function unlockTechItem(
  prog: PilotProgression,
  category: 'airframe' | 'propulsion' | 'sensor' | 'weapon' | 'cyber',
  id: string,
): { ok: boolean; reason?: string; progression: PilotProgression } {
  if (category === 'airframe') {
    const spec = AIRFRAMES[id as AirframeId];
    if (!spec) return { ok: false, reason: 'Unknown airframe', progression: prog };
    if (prog.unlockedAirframes.includes(spec.id)) return { ok: true, progression: prog };
    if (prog.rank < spec.requiredRank) {
      return { ok: false, reason: `Requires Pilot Rank ${spec.requiredRank}`, progression: prog };
    }
    if (prog.researchCredits < spec.unlockCostRc) {
      return { ok: false, reason: `Requires ${spec.unlockCostRc} RC`, progression: prog };
    }
    return {
      ok: true,
      progression: {
        ...prog,
        researchCredits: prog.researchCredits - spec.unlockCostRc,
        unlockedAirframes: [...prog.unlockedAirframes, spec.id],
      },
    };
  }

  if (category === 'propulsion') {
    const spec = PROPULSION_MODULES[id as PropulsionId];
    if (!spec) return { ok: false, reason: 'Unknown propulsion', progression: prog };
    if (prog.unlockedPropulsion.includes(spec.id)) return { ok: true, progression: prog };
    if (prog.rank < spec.requiredRank) {
      return { ok: false, reason: `Requires Pilot Rank ${spec.requiredRank}`, progression: prog };
    }
    if (prog.researchCredits < spec.unlockCostRc) {
      return { ok: false, reason: `Requires ${spec.unlockCostRc} RC`, progression: prog };
    }
    return {
      ok: true,
      progression: {
        ...prog,
        researchCredits: prog.researchCredits - spec.unlockCostRc,
        unlockedPropulsion: [...prog.unlockedPropulsion, spec.id],
      },
    };
  }

  if (category === 'sensor') {
    const spec = SENSOR_MODULES[id as SensorId];
    if (!spec) return { ok: false, reason: 'Unknown sensor', progression: prog };
    if (prog.unlockedSensors.includes(spec.id)) return { ok: true, progression: prog };
    if (prog.rank < spec.requiredRank) {
      return { ok: false, reason: `Requires Pilot Rank ${spec.requiredRank}`, progression: prog };
    }
    if (prog.researchCredits < spec.unlockCostRc) {
      return { ok: false, reason: `Requires ${spec.unlockCostRc} RC`, progression: prog };
    }
    return {
      ok: true,
      progression: {
        ...prog,
        researchCredits: prog.researchCredits - spec.unlockCostRc,
        unlockedSensors: [...prog.unlockedSensors, spec.id],
      },
    };
  }

  if (category === 'weapon') {
    const spec = WEAPONS[id as WeaponId];
    if (!spec) return { ok: false, reason: 'Unknown weapon', progression: prog };
    if (prog.unlockedWeapons.includes(spec.id)) return { ok: true, progression: prog };
    if (prog.rank < spec.requiredRank) {
      return { ok: false, reason: `Requires Pilot Rank ${spec.requiredRank}`, progression: prog };
    }
    if (prog.researchCredits < spec.unlockCostRc) {
      return { ok: false, reason: `Requires ${spec.unlockCostRc} RC`, progression: prog };
    }
    return {
      ok: true,
      progression: {
        ...prog,
        researchCredits: prog.researchCredits - spec.unlockCostRc,
        unlockedWeapons: [...prog.unlockedWeapons, spec.id],
      },
    };
  }

  const cyberSpec = CYBER_PAYLOADS[id as CyberPayloadId];
  if (!cyberSpec) return { ok: false, reason: 'Unknown cyber payload', progression: prog };
  if (prog.unlockedCyber.includes(cyberSpec.id)) return { ok: true, progression: prog };
  if (prog.rank < cyberSpec.requiredRank) {
    return { ok: false, reason: `Requires Pilot Rank ${cyberSpec.requiredRank}`, progression: prog };
  }
  if (prog.researchCredits < cyberSpec.unlockCostRc) {
    return { ok: false, reason: `Requires ${cyberSpec.unlockCostRc} RC`, progression: prog };
  }
  return {
    ok: true,
    progression: {
      ...prog,
      researchCredits: prog.researchCredits - cyberSpec.unlockCostRc,
      unlockedCyber: [...prog.unlockedCyber, cyberSpec.id],
    },
  };
}

export function loadProgression(): PilotProgression {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return INITIAL_PROGRESSION;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return INITIAL_PROGRESSION;
    const parsed = JSON.parse(raw) as Partial<PilotProgression>;
    return {
      ...INITIAL_PROGRESSION,
      ...parsed,
      skillPoints:
        typeof parsed.skillPoints === 'number'
          ? parsed.skillPoints
          : INITIAL_PROGRESSION.skillPoints,
      skillLevels:
        parsed.skillLevels && typeof parsed.skillLevels === 'object'
          ? parsed.skillLevels
          : INITIAL_PROGRESSION.skillLevels,
      unlockedAirframes: Array.isArray(parsed.unlockedAirframes)
        ? Array.from(new Set([...INITIAL_PROGRESSION.unlockedAirframes, ...parsed.unlockedAirframes]))
        : INITIAL_PROGRESSION.unlockedAirframes,
      unlockedPropulsion: Array.isArray(parsed.unlockedPropulsion)
        ? Array.from(new Set([...INITIAL_PROGRESSION.unlockedPropulsion, ...parsed.unlockedPropulsion]))
        : INITIAL_PROGRESSION.unlockedPropulsion,
      unlockedSensors: Array.isArray(parsed.unlockedSensors)
        ? Array.from(new Set([...INITIAL_PROGRESSION.unlockedSensors, ...parsed.unlockedSensors]))
        : INITIAL_PROGRESSION.unlockedSensors,
      unlockedWeapons: Array.isArray(parsed.unlockedWeapons)
        ? Array.from(new Set([...INITIAL_PROGRESSION.unlockedWeapons, ...parsed.unlockedWeapons]))
        : INITIAL_PROGRESSION.unlockedWeapons,
      unlockedCyber: Array.isArray(parsed.unlockedCyber)
        ? Array.from(new Set([...INITIAL_PROGRESSION.unlockedCyber, ...parsed.unlockedCyber]))
        : INITIAL_PROGRESSION.unlockedCyber,
    };
  } catch {
    return INITIAL_PROGRESSION;
  }
}

export function saveProgression(prog: PilotProgression): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prog));
    }
  } catch {
    // Ignore storage quota errors
  }
}

