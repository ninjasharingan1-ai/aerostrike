import { SENSOR_MODULES } from './arsenalData';
import { CyberPayloadId, CyberPayloadSpec, PilotSkillBonuses, SensorId } from './types';

export const CYBER_PAYLOADS: Record<CyberPayloadId, CyberPayloadSpec> = {
  radar_spoof: {
    id: 'radar_spoof',
    name: 'IFF & Radar Ghost Spoof',
    targetScope: 'base',
    maxRangeM: 3200,
    durationSec: 22,
    directDamage: 0,
    cooldownSec: 8,
    difficulty: 1,
    unlockCostRc: 0,
    requiredRank: 1,
    effectSummary: 'Blinds SAM & radar batteries for 22s, suppressing missile launches and threat rings.',
  },
  gnss_spoof: {
    id: 'gnss_spoof',
    name: 'GNSS / Seeker Navigation Spoof',
    targetScope: 'both',
    maxRangeM: 3000,
    durationSec: 16,
    directDamage: 10,
    cooldownSec: 7,
    difficulty: 1,
    unlockCostRc: 0,
    requiredRank: 1,
    effectSummary: 'Corrupts GPS/INS coordinates, throwing enemy drones and incoming seekers off course.',
  },
  c2_hijack: {
    id: 'c2_hijack',
    name: 'C2 Datalink Flight Hijack',
    targetScope: 'drone',
    maxRangeM: 2800,
    durationSec: 14,
    directDamage: 35,
    cooldownSec: 11,
    difficulty: 2,
    unlockCostRc: 350,
    requiredRank: 2,
    effectSummary: 'Overrides enemy UAV flight computer, inducing violent roll/pitch instability and weapon lockout.',
  },
  scada_sabotage: {
    id: 'scada_sabotage',
    name: 'SCADA Power & Munitions Sabotage',
    targetScope: 'base',
    maxRangeM: 2900,
    durationSec: 18,
    directDamage: 95,
    cooldownSec: 12,
    difficulty: 2,
    unlockCostRc: 450,
    requiredRank: 2,
    effectSummary: 'Overloads base power/ordnance PLC controllers to trigger internal explosions (95 DMG).',
  },
  firmware_brick: {
    id: 'firmware_brick',
    name: 'Firmware Kill-Switch & Bus Overload',
    targetScope: 'both',
    maxRangeM: 2600,
    durationSec: 20,
    directDamage: 120,
    cooldownSec: 15,
    difficulty: 3,
    unlockCostRc: 750,
    requiredRank: 3,
    effectSummary: 'Injects zero-day bus overvoltage into enemy UAVs or command bunkers for massive subsystem damage.',
  },
};

export interface CyberEvaluation {
  inRange: boolean;
  effectiveRangeM: number;
  signalStrengthPct: number;
  breachWindowWidth: number; // 0.14 .. 0.42 normalized sync bar width
  success: boolean;
}

/**
 * Evaluates cyber-link signal quality and breach success probability based on
 * target range, installed avionics sensor pod, and weather RF/IR conditions.
 */
export function evaluateCyberLink(
  payloadId: CyberPayloadId,
  distanceM: number,
  sensorId: SensorId,
  weatherIrAttenuation: number,
  skillBonuses?: PilotSkillBonuses,
): CyberEvaluation {
  const payload = CYBER_PAYLOADS[payloadId];
  const sensor = SENSOR_MODULES[sensorId];

  const sensorRangeBonus =
    sensorId === 'ew_jammer' ? 1.45 : sensorId === 'aesa_apg81' ? 1.25 : 1.0;
  const skillRangeMult = skillBonuses?.cyberRangeMult ?? 1.0;
  const effectiveRangeM = Math.round(payload.maxRangeM * sensorRangeBonus * skillRangeMult);
  const inRange = distanceM <= effectiveRangeM;

  // Weather attenuates RF slightly less than optical IR, AESA/EW pods resist weather heavily
  const weatherLoss = weatherIrAttenuation * (1 - sensor.weatherPenetration) * 0.35;
  const distFactor = Math.max(0, 1 - distanceM / Math.max(1, effectiveRangeM * 1.12));
  const signalStrengthPct = Math.round(Math.max(0, Math.min(100, distFactor * (1 - weatherLoss) * 100)));

  // Breach sync bar width scales with signal quality & payload complexity
  const baseWindow = payload.difficulty === 1 ? 0.34 : payload.difficulty === 2 ? 0.25 : 0.18;
  const ewBonus = sensorId === 'ew_jammer' ? 0.09 : 0;
  const skillWindowBonus = skillBonuses?.cyberWindowBonus ?? 0;
  const breachWindowWidth = Math.max(
    0.12,
    Math.min(0.52, baseWindow * (0.65 + (signalStrengthPct / 100) * 0.55) + ewBonus + skillWindowBonus),
  );

  return {
    inRange,
    effectiveRangeM,
    signalStrengthPct,
    breachWindowWidth,
    success: inRange && signalStrengthPct >= 15,
  };
}

/**
 * Checks whether a packet-injection timing cursor (0..1) landed inside the target sync window.
 */
export function isPacketAligned(
  cursorPos: number,
  windowCenter: number,
  windowWidth: number,
): boolean {
  return Math.abs(cursorPos - windowCenter) <= windowWidth / 2;
}
