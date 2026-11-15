import { THEATERS } from './geoTheaters';
import { AirframeId, TheaterId } from './types';

export type AarEventType =
  | 'launch'
  | 'ordnance'
  | 'strike'
  | 'air_kill'
  | 'cyber'
  | 'damage'
  | 'defense'
  | 'end';

export interface AarEventEntry {
  id: string;
  tSec: number;
  type: AarEventType;
  title: string;
  detail: string;
  x: number;
  z: number;
  altMsl: number;
  fuelKg: number;
}

export interface AarTelemetrySample {
  tSec: number;
  x: number;
  yMsl: number;
  z: number;
  aglM: number;
  airspeedKnots: number;
  mach: number;
  fuelKg: number;
  fuelPct: number;
  hp: number;
  throttlePct: number;
  gLoad: number;
}

export interface AarSortieReport {
  sortieId: string;
  theaterId: TheaterId;
  airframeId: AirframeId;
  startedAtIso: string;
  durationSec: number;
  initialFuelKg: number;
  finalFuelKg: number;
  fuelConsumedKg: number;
  fuelBurnRateKgPerMin: number;
  distanceFlownM: number;
  maxAltMsl: number;
  maxMach: number;
  maxGLoad: number;
  samples: AarTelemetrySample[];
  events: AarEventEntry[];
}

const MAX_AAR_SAMPLES = 450;

export function createAarReport(
  theaterId: TheaterId,
  airframeId: AirframeId,
  initialFuelKg: number,
  startedAtIso = new Date().toISOString(),
): AarSortieReport {
  return {
    sortieId: `aar-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    theaterId,
    airframeId,
    startedAtIso,
    durationSec: 0,
    initialFuelKg: Math.max(0, initialFuelKg),
    finalFuelKg: Math.max(0, initialFuelKg),
    fuelConsumedKg: 0,
    fuelBurnRateKgPerMin: 0,
    distanceFlownM: 0,
    maxAltMsl: THEATERS[theaterId]?.baseElevationM ?? 0,
    maxMach: 0,
    maxGLoad: 1,
    samples: [],
    events: [],
  };
}

export function appendAarSample(
  report: AarSortieReport,
  sample: AarTelemetrySample,
  minIntervalSec = 1.0,
): AarSortieReport {
  const last = report.samples[report.samples.length - 1];
  if (last && sample.tSec - last.tSec < minIntervalSec) {
    return report;
  }

  const segDist = last
    ? Math.hypot(sample.x - last.x, sample.yMsl - last.yMsl, sample.z - last.z)
    : 0;
  const nextDist = report.distanceFlownM + segDist;
  const nextDuration = Math.max(report.durationSec, sample.tSec);
  const fuelConsumedKg = Math.max(0, report.initialFuelKg - sample.fuelKg);
  const fuelBurnRateKgPerMin =
    nextDuration > 0.5 ? (fuelConsumedKg / nextDuration) * 60 : 0;

  let nextSamples = [...report.samples, sample];
  if (nextSamples.length > MAX_AAR_SAMPLES) {
    // Preserve first and last sample while thinning older even indices
    nextSamples = nextSamples.filter(
      (_s, idx) => idx === 0 || idx === nextSamples.length - 1 || idx % 2 === 1,
    );
  }

  return {
    ...report,
    durationSec: nextDuration,
    finalFuelKg: sample.fuelKg,
    fuelConsumedKg: Math.round(fuelConsumedKg * 10) / 10,
    fuelBurnRateKgPerMin: Math.round(fuelBurnRateKgPerMin * 10) / 10,
    distanceFlownM: Math.round(nextDist),
    maxAltMsl: Math.max(report.maxAltMsl, Math.round(sample.yMsl)),
    maxMach: Math.max(report.maxMach, sample.mach),
    maxGLoad: Math.max(report.maxGLoad, sample.gLoad),
    samples: nextSamples,
  };
}

export function appendAarEvent(
  report: AarSortieReport,
  event: Omit<AarEventEntry, 'id'>,
): AarSortieReport {
  const entry: AarEventEntry = {
    ...event,
    id: `ev-${report.events.length + 1}-${Math.round(event.tSec * 10)}`,
  };
  return {
    ...report,
    durationSec: Math.max(report.durationSec, event.tSec),
    events: [...report.events, entry],
  };
}

export function formatSortieClock(tSec: number): string {
  const clamped = Math.max(0, Math.floor(tSec));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function exportAarJson(report: AarSortieReport): string {
  return JSON.stringify(report, null, 2);
}
