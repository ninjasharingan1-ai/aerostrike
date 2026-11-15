import React, { useState } from 'react';
import {
  Award,
  Bomb,
  Check,
  Cpu,
  Crosshair,
  FlaskConical,
  Lock,
  Plane,
  Play,
  Radio,
  RotateCcw,
  Shield,
  Sliders,
  Wind,
  Wrench,
  X,
} from 'lucide-react';
import {
  AIRFRAMES,
  PROPULSION_MODULES,
  SENSOR_MODULES,
  WEAPONS,
} from '../sim/arsenalData';
import { CYBER_PAYLOADS } from '../sim/cyberWarfare';
import {
  canUpgradeSkill,
  PILOT_SKILLS,
  SKILL_BRANCHES,
  xpForNextRank,
} from '../sim/progression';
import {
  AirframeId,
  CyberPayloadId,
  LoadoutConfig,
  PilotProgression,
  PilotSkillBonuses,
  PilotSkillId,
  PropulsionId,
  SandboxConfig,
  SensorId,
  WeaponCategory,
  WeaponId,
} from '../sim/types';
import { HangarPreviewCanvas } from './HangarPreviewCanvas';

interface HangarSandboxModalProps {
  open: boolean;
  loadout: LoadoutConfig;
  progression: PilotProgression;
  skillBonuses: PilotSkillBonuses;
  sandbox: SandboxConfig;
  onChangeLoadout: (next: LoadoutConfig) => void;
  onChangeSandbox: (next: SandboxConfig) => void;
  onUnlockItem: (category: 'airframe' | 'propulsion' | 'sensor' | 'weapon' | 'cyber', id: string) => void;
  onUpgradeSkill: (skillId: PilotSkillId) => void;
  onResetSkills: () => void;
  onApplyAndLaunch: () => void;
  onLaunchSandboxTestFlight: () => void;
  onClose: () => void;
}

type OriginFilter = 'all' | 'Ukraine' | 'Israel' | 'Iran / Syria' | 'Russia' | 'USA / Exp';
type AmmoCatFilter = 'all' | WeaponCategory;

export const HangarSandboxModal: React.FC<HangarSandboxModalProps> = ({
  open,
  loadout,
  progression,
  skillBonuses,
  sandbox,
  onChangeLoadout,
  onChangeSandbox,
  onUnlockItem,
  onUpgradeSkill,
  onResetSkills,
  onApplyAndLaunch,
  onLaunchSandboxTestFlight,
  onClose,
}) => {
  const [tab, setTab] = useState<'gear' | 'ammo' | 'skills' | 'tech' | 'sandbox'>('gear');
  const [originFilter, setOriginFilter] = useState<OriginFilter>('all');
  const [ammoFilter, setAmmoFilter] = useState<AmmoCatFilter>('all');
  const [selectedPylonIdx, setSelectedPylonIdx] = useState<number>(0);

  if (!open) return null;

  const airframe = AIRFRAMES[loadout.airframeId];
  const propulsion = PROPULSION_MODULES[loadout.propulsionId];
  const sensor = SENSOR_MODULES[loadout.sensorId];

  const ordnanceMass = loadout.slots.reduce((sum, wid) => {
    const w = WEAPONS[wid];
    return sum + (w.category === 'cannon' ? w.massKg + w.ammoPerSlot * 0.16 : w.massKg * w.ammoPerSlot);
  }, 0);
  const totalWarheadSalvoKg = loadout.slots.reduce(
    (sum, wid) => sum + WEAPONS[wid].warheadKg * WEAPONS[wid].ammoPerSlot,
    0,
  );
  const baseTotalMass =
    airframe.dryMassKg + airframe.maxFuelKg * 0.65 + propulsion.massKg + sensor.massKg + ordnanceMass;
  const effMass = baseTotalMass * (sandbox.enabled ? sandbox.massMultiplier : 1);
  const airframeThrustScale =
    airframe.dryMassKg < 550 ? Math.min(1.0, Math.max(0.22, (airframe.dryMassKg + 140) / 840)) : 1.0;
  const effThrust =
    propulsion.maxThrustN *
    airframeThrustScale *
    (sandbox.enabled ? sandbox.thrustMultiplier : 1) *
    skillBonuses.thrustMult;
  const effWing = airframe.wingAreaM2 * (sandbox.enabled ? sandbox.wingAreaMultiplier : 1);
  const effG = 9.80665 * (sandbox.enabled ? sandbox.gravityMultiplier : 1);

  const twr = effThrust / (effMass * effG);
  const wingLoading = effMass / effWing;
  const nextRankXp = xpForNextRank(progression.rank);
  const freeUnlock = sandbox.enabled && sandbox.unlockAllInSandbox;

  const topSpeedKmh = Math.round(
    propulsion.maxMach *
      1225 *
      (sandbox.enabled ? Math.sqrt(sandbox.thrustMultiplier) : 1) *
      Math.sqrt(skillBonuses.thrustMult / skillBonuses.dragMult),
  );
  const climbRateMs = Math.round(Math.max(8, twr * 85 - wingLoading * 0.08));
  const turnTimeSec = Number(
    Math.max(
      6.5,
      (28 / Math.max(0.8, airframe.maxPitchRateRad * skillBonuses.agilityMult)) *
        Math.max(0.45, Math.min(1.5, effMass / 1800)),
    ).toFixed(1),
  );
  const burstMassKgS = Number(
    loadout.slots
      .reduce((acc, wId) => {
        const w = WEAPONS[wId];
        return (
          acc +
          (w.warheadKg * skillBonuses.damageMult) /
            Math.max(0.15, w.cooldownSec * skillBonuses.weaponCooldownMult)
        );
      }, 0)
      .toFixed(1),
  );
  const investedSkillPoints = Object.values(progression.skillLevels ?? {}).reduce(
    (sum, lvl) => sum + (lvl ?? 0),
    0,
  );

  const isUnlocked = (cat: 'airframe' | 'propulsion' | 'sensor' | 'weapon' | 'cyber', id: string) => {
    if (freeUnlock) return true;
    if (cat === 'airframe') return progression.unlockedAirframes.includes(id as AirframeId);
    if (cat === 'propulsion') return progression.unlockedPropulsion.includes(id as PropulsionId);
    if (cat === 'sensor') return progression.unlockedSensors.includes(id as SensorId);
    if (cat === 'weapon') return progression.unlockedWeapons.includes(id as WeaponId);
    return progression.unlockedCyber.includes(id as CyberPayloadId);
  };

  const filteredAirframes = (Object.keys(AIRFRAMES) as AirframeId[]).filter((id) => {
    if (originFilter === 'all') return true;
    const orig = AIRFRAMES[id].origin;
    if (originFilter === 'Iran / Syria') return orig.includes('Iran') || orig.includes('Syria');
    if (originFilter === 'USA / Exp') return orig.includes('USA') || orig.includes('Experimental');
    return orig.includes(originFilter);
  });

  const filteredWeapons = (Object.keys(WEAPONS) as WeaponId[]).filter(
    (wId) => ammoFilter === 'all' || WEAPONS[wId].category === ammoFilter,
  );

  const mountWeaponToPylon = (wId: WeaponId, pylonIdx: number) => {
    const nextSlots = [...loadout.slots] as [WeaponId, WeaponId, WeaponId, WeaponId];
    nextSlots[pylonIdx] = wId;
    onChangeLoadout({ ...loadout, slots: nextSlots });
  };

  const fillAllPylons = (wId: WeaponId) => {
    onChangeLoadout({ ...loadout, slots: [wId, wId, wId, wId] });
  };

  const pylonLabels = ['Pylon 1 · Left Outer', 'Pylon 2 · Left Inner', 'Pylon 3 · Right Inner', 'Pylon 4 · Right Outer'];

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-3 sm:p-5">
      <div className="w-full max-w-6xl bg-[#0b1118] border border-slate-700 rounded-lg shadow-2xl flex flex-col max-h-[94vh] overflow-hidden">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <Wrench className="w-5 h-5 text-amber-400" />
            <div>
              <h2 className="font-display text-xl font-bold text-white">
                Airframe Hangar, Hardpoint Ammo Bay &amp; Sandbox Lab
              </h2>
              <div className="text-xs text-slate-400 font-mono-tabular">
                Rank {progression.rank} · {progression.xp}/{nextRankXp} XP · {progression.researchCredits} RC ·{' '}
                <span className="text-amber-300 font-semibold">{progression.skillPoints ?? 0} SP</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-900 rounded border border-slate-800">
              <button
                type="button"
                onClick={() => setTab('gear')}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  tab === 'gear' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-300 hover:text-white'
                }`}
              >
                Fleet &amp; Gear
              </button>
              <button
                type="button"
                onClick={() => setTab('ammo')}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors cursor-pointer whitespace-nowrap inline-flex items-center gap-1.5 ${
                  tab === 'ammo' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-300 hover:text-white'
                }`}
              >
                <Bomb className="w-3.5 h-3.5" />
                Ammo &amp; Hardpoints
              </button>
              <button
                type="button"
                onClick={() => setTab('skills')}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors cursor-pointer whitespace-nowrap inline-flex items-center gap-1.5 ${
                  tab === 'skills' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-300 hover:text-white'
                }`}
              >
                <Award className="w-3.5 h-3.5" />
                Skills ({progression.skillPoints ?? 0})
              </button>
              <button
                type="button"
                onClick={() => setTab('tech')}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  tab === 'tech' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-300 hover:text-white'
                }`}
              >
                Tech Tree ({progression.researchCredits} RC)
              </button>
              <button
                type="button"
                onClick={() => setTab('sandbox')}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  tab === 'sandbox' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-300 hover:text-white'
                }`}
              >
                Sandbox Lab
              </button>
            </div>
            <button
              type="button"
              aria-label="Close Hangar"
              onClick={onClose}
              className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-4">
          {/* Top Showcase Row: Interactive 3D Drone Inspector + War Thunder Stat Bars */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
            <div className="lg:col-span-6">
              <HangarPreviewCanvas airframeId={loadout.airframeId} slots={loadout.slots} />
            </div>

            <div className="lg:col-span-6 bg-slate-900/80 border border-slate-800 rounded-lg p-4 flex flex-col justify-between gap-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-base font-display font-bold text-white">{airframe.name}</div>
                  <div className="text-xs text-amber-400 font-mono-tabular">
                    {airframe.designation} · {airframe.origin}
                  </div>
                </div>
                <span className="text-xs font-mono-tabular text-slate-300 text-right">
                  Mass {Math.round(effMass)} kg · TWR {twr.toFixed(2)}
                  <br />
                  <span className="text-rose-300">Kamikaze {airframe.kamikazeWarheadKg} kg WH</span>
                </span>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">{airframe.description}</p>

              {/* War Thunder-Style Performance Metric Bars */}
              <div className="space-y-2 font-mono-tabular text-xs">
                {[
                  { label: 'Max Speed', val: `${topSpeedKmh} km/h`, pct: Math.min(100, (topSpeedKmh / 2400) * 100), color: 'bg-sky-400' },
                  { label: 'Turn Time', val: `${turnTimeSec} s`, pct: Math.min(100, Math.max(18, 115 - turnTimeSec * 2.5)), color: 'bg-amber-400' },
                  { label: 'Climb Rate', val: `${climbRateMs} m/s`, pct: Math.min(100, (climbRateMs / 160) * 100), color: 'bg-emerald-400' },
                  { label: 'Burst Salvo', val: `${burstMassKgS} kg/s`, pct: Math.min(100, (burstMassKgS / 220) * 100), color: 'bg-rose-400' },
                  { label: 'Stealth RCS', val: `${airframe.rcsM2.toFixed(2)} m²`, pct: Math.min(100, Math.max(15, 100 - airframe.rcsM2 * 35)), color: 'bg-cyan-400' },
                ].map((bar) => (
                  <div key={bar.label} className="grid grid-cols-12 items-center gap-2">
                    <span className="col-span-3 text-slate-400 truncate">{bar.label}</span>
                    <div className="col-span-6 h-2 bg-slate-950 rounded-xs overflow-hidden border border-slate-800">
                      <div className={`h-full ${bar.color}`} style={{ width: `${Math.round(bar.pct)}%` }} />
                    </div>
                    <span className="col-span-3 text-right text-slate-200 font-semibold whitespace-nowrap">{bar.val}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {tab === 'gear' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Airframes with Regional Operator Filter */}
              <div className="space-y-5">
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                    <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                      <Plane className="w-4 h-4 text-amber-400" />
                      Combat Drone Fleet ({filteredAirframes.length})
                    </h3>
                    <div className="flex flex-wrap gap-1">
                      {(['all', 'Ukraine', 'Israel', 'Iran / Syria', 'Russia', 'USA / Exp'] as OriginFilter[]).map((f) => (
                        <button
                          key={f}
                          type="button"
                          onClick={() => setOriginFilter(f)}
                          className={`px-2 py-0.5 rounded text-[10px] font-medium cursor-pointer border ${
                            originFilter === f
                              ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                              : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {f === 'all' ? 'All Fleets' : f}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[370px] overflow-y-auto pr-1">
                    {filteredAirframes.map((id) => {
                      const a = AIRFRAMES[id];
                      const unlocked = isUnlocked('airframe', id);
                      const active = loadout.airframeId === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          disabled={!unlocked}
                          onClick={() =>
                            onChangeLoadout({
                              ...loadout,
                              airframeId: id,
                              propulsionId: isUnlocked('propulsion', a.defaultPropulsionId)
                                ? a.defaultPropulsionId
                                : loadout.propulsionId,
                            })
                          }
                          className={`p-3 rounded border text-left transition-colors ${
                            !unlocked
                              ? 'bg-slate-950/60 border-slate-800/70 text-slate-500 cursor-not-allowed'
                              : active
                                ? 'bg-amber-500/15 border-amber-400 text-white cursor-pointer'
                                : 'bg-slate-900/70 border-slate-800 text-slate-300 hover:border-slate-600 cursor-pointer'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 text-xs font-semibold">
                            <span className="truncate">{a.name}</span>
                            {!unlocked && <Lock className="w-3.5 h-3.5 text-slate-500 shrink-0" />}
                          </div>
                          <div className="text-[11px] text-amber-300/90 mt-0.5 font-mono-tabular">
                            {a.origin} · {a.dryMassKg} kg · {a.wingspanM}m span
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5 font-mono-tabular">
                            {a.maxG}G · Kamikaze {a.kamikazeWarheadKg}kg WH · RCS {a.rcsM2}m²
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-white mb-2.5 flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-sky-400" />
                    Propulsion Module
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {(Object.keys(PROPULSION_MODULES) as PropulsionId[]).map((id) => {
                      const p = PROPULSION_MODULES[id];
                      const unlocked = isUnlocked('propulsion', id);
                      const active = loadout.propulsionId === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          disabled={!unlocked}
                          onClick={() => onChangeLoadout({ ...loadout, propulsionId: id })}
                          className={`p-3 rounded border text-left transition-colors ${
                            !unlocked
                              ? 'bg-slate-950/60 border-slate-800/70 text-slate-500 cursor-not-allowed'
                              : active
                                ? 'bg-amber-500/15 border-amber-400 text-white cursor-pointer'
                                : 'bg-slate-900/70 border-slate-800 text-slate-300 hover:border-slate-600 cursor-pointer'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 text-xs font-semibold">
                            <span className="truncate">{p.name}</span>
                            {!unlocked && <Lock className="w-3.5 h-3.5 text-slate-500 shrink-0" />}
                          </div>
                          <div className="text-[11px] text-slate-400 mt-1 font-mono-tabular">
                            {(p.maxThrustN / 1000).toFixed(1)} kN · Mach {p.maxMach} · IR {Math.round(p.irSignature * 100)}%
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Sensors & Quick Pylon Summary */}
              <div className="space-y-5">
                <div>
                  <h3 className="text-sm font-semibold text-white mb-2.5 flex items-center gap-2">
                    <Shield className="w-4 h-4 text-emerald-400" />
                    Avionics &amp; Sensor Pod
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {(Object.keys(SENSOR_MODULES) as SensorId[]).map((id) => {
                      const s = SENSOR_MODULES[id];
                      const unlocked = isUnlocked('sensor', id);
                      const active = loadout.sensorId === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          disabled={!unlocked}
                          onClick={() => onChangeLoadout({ ...loadout, sensorId: id })}
                          className={`p-3 rounded border text-left transition-colors ${
                            !unlocked
                              ? 'bg-slate-950/60 border-slate-800/70 text-slate-500 cursor-not-allowed'
                              : active
                                ? 'bg-amber-500/15 border-amber-400 text-white cursor-pointer'
                                : 'bg-slate-900/70 border-slate-800 text-slate-300 hover:border-slate-600 cursor-pointer'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 text-xs font-semibold">
                            <span className="truncate">{s.name}</span>
                            {!unlocked && <Lock className="w-3.5 h-3.5 text-slate-500 shrink-0" />}
                          </div>
                          <div className="text-[11px] text-slate-400 mt-1 font-mono-tabular">
                            Lock {(s.lockRangeM / 1000).toFixed(1)} km · Weather Pen {Math.round(s.weatherPenetration * 100)}%
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2.5">
                    <h3 className="text-sm font-semibold text-white">
                      Active Pylon Loadout (Slots 1–4)
                    </h3>
                    <button
                      type="button"
                      onClick={() => setTab('ammo')}
                      className="text-xs font-semibold text-amber-400 hover:text-amber-300 cursor-pointer inline-flex items-center gap-1"
                    >
                      <Bomb className="w-3.5 h-3.5" />
                      Open Full Ammo Bay →
                    </button>
                  </div>
                  <div className="space-y-2.5">
                    {[0, 1, 2, 3].map((slotIdx) => {
                      const currentW = loadout.slots[slotIdx];
                      return (
                        <div
                          key={slotIdx}
                          className="bg-slate-900/75 border border-slate-800 rounded p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                        >
                          <div>
                            <label
                              htmlFor={`pylon-slot-${slotIdx}`}
                              className="text-xs font-semibold text-amber-400 font-mono-tabular"
                            >
                              {pylonLabels[slotIdx]}
                            </label>
                            <div className="text-[11px] text-slate-400">
                              {WEAPONS[currentW].origin} · x{WEAPONS[currentW].ammoPerSlot} · {WEAPONS[currentW].warheadKg}kg WH
                            </div>
                          </div>
                          <select
                            id={`pylon-slot-${slotIdx}`}
                            value={currentW}
                            onChange={(e) => mountWeaponToPylon(e.target.value as WeaponId, slotIdx)}
                            className="bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white focus:border-amber-400 outline-none"
                          >
                            {(Object.keys(WEAPONS) as WeaponId[]).map((wId) => {
                              const w = WEAPONS[wId];
                              const unlocked = isUnlocked('weapon', wId);
                              return (
                                <option key={wId} value={wId} disabled={!unlocked}>
                                  {w.name} ({w.natoCode}){!unlocked ? ' [Locked]' : ''}
                                </option>
                              );
                            })}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === 'ammo' && (
            <div className="space-y-5">
              {/* Interactive 4-Pylon Schematic + Presets */}
              <div className="bg-slate-900/85 border border-slate-800 rounded-lg p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-display font-bold text-white flex items-center gap-2">
                      <Bomb className="w-4 h-4 text-amber-400" />
                      Hardpoint Munition Choosing &amp; Pylon Placement
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Select a pylon below, then choose any real-world munition to mount onto your wings/belly bay (live-rendered on the 3D airframe above).
                    </p>
                  </div>
                  <div className="text-right font-mono-tabular text-xs">
                    <div className="text-slate-300">
                      Payload Weight: <strong className="text-white">{Math.round(ordnanceMass)} kg</strong>
                    </div>
                    <div className="text-amber-300">
                      Total Warhead Explosive: <strong>{Math.round(totalWarheadSalvoKg)} kg</strong>
                    </div>
                  </div>
                </div>

                {/* 4 Clickable Pylon Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {[0, 1, 2, 3].map((idx) => {
                    const wId = loadout.slots[idx];
                    const w = WEAPONS[wId];
                    const isSelected = selectedPylonIdx === idx;
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setSelectedPylonIdx(idx)}
                        className={`p-3 rounded border text-left transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-amber-500/15 border-amber-400 ring-1 ring-amber-400/50'
                            : 'bg-slate-950/75 border-slate-800 hover:border-slate-600'
                        }`}
                      >
                        <div className="flex items-center justify-between text-[11px] font-mono-tabular">
                          <span className={isSelected ? 'text-amber-300 font-bold' : 'text-slate-400'}>
                            {pylonLabels[idx]}
                          </span>
                          <span className="text-white font-semibold">x{w.ammoPerSlot}</span>
                        </div>
                        <div className="text-xs font-semibold text-white mt-1 truncate">{w.name}</div>
                        <div className="text-[11px] text-slate-400 font-mono-tabular mt-0.5">
                          {w.natoCode} · {w.warheadKg}kg WH · {w.blastRadiusM}m blast
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Preset Doctrine Quick-Packs + Category Filter */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-slate-400 mr-1">Doctrine Presets:</span>
                    {[
                      { label: 'Bayraktar Anti-Armor', slots: ['mam_l', 'mam_c', 'r73_archer', 'm61_vulcan'] as [WeaponId, WeaponId, WeaponId, WeaponId] },
                      { label: 'Baba Yaga Drop Raid', slots: ['pg7vl_drop', 'pg7vl_drop', 'mam_c', 'm61_vulcan'] as [WeaponId, WeaponId, WeaponId, WeaponId] },
                      { label: 'Iran/Russia OWA Raid', slots: ['qaem_5', 'kab_20', 'mam_c', 'r73_archer'] as [WeaponId, WeaponId, WeaponId, WeaponId] },
                      { label: 'Israel Spike SEAD', slots: ['spike_nlos', 'gbu39_sdb', 'aim9x_sidewinder', 'm61_vulcan'] as [WeaponId, WeaponId, WeaponId, WeaponId] },
                    ].map((preset) => {
                      const allOk = preset.slots.every((w) => isUnlocked('weapon', w));
                      return (
                        <button
                          key={preset.label}
                          type="button"
                          disabled={!allOk}
                          title={allOk ? 'Apply 4-pylon doctrine preset' : 'Unlock required weapons below first'}
                          onClick={() => {
                            if (allOk) {
                              onChangeLoadout({ ...loadout, slots: preset.slots });
                            }
                          }}
                          className={`px-2.5 py-1 rounded border text-[11px] inline-flex items-center gap-1 ${
                            allOk
                              ? 'bg-slate-950 hover:bg-slate-800 border-slate-700 text-slate-200 cursor-pointer'
                              : 'bg-slate-950/50 border-slate-800/70 text-slate-500 cursor-not-allowed'
                          }`}
                        >
                          {!allOk && <Lock className="w-3 h-3" />}
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Weapon Category Filter Strip */}
              <div className="flex flex-wrap gap-1.5">
                {[
                  { id: 'all', label: 'All Munitions' },
                  { id: 'glide_bomb', label: 'Glide Bombs' },
                  { id: 'drop_bomb', label: 'HEAT / Mortar Drop Racks' },
                  { id: 'atgm', label: 'ATGMs' },
                  { id: 'aam', label: 'Air-to-Air' },
                  { id: 'cruise_missile', label: 'Cruise Missiles' },
                  { id: 'ballistic_missile', label: 'Ballistic' },
                  { id: 'cannon', label: 'Autocannons' },
                ].map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setAmmoFilter(cat.id as AmmoCatFilter)}
                    className={`px-3 py-1.5 rounded border text-xs font-medium cursor-pointer ${
                      ammoFilter === cat.id
                        ? 'bg-amber-500 text-slate-950 border-amber-400 font-bold'
                        : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              {/* Wide Real-World Munition Catalog */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredWeapons.map((wId) => {
                  const w = WEAPONS[wId];
                  const unlocked = isUnlocked('weapon', wId);
                  const canAfford = progression.researchCredits >= w.unlockCostRc && progression.rank >= w.requiredRank;
                  const mountedCount = loadout.slots.filter((s) => s === wId).length;
                  const onActiveSlot = loadout.slots[selectedPylonIdx] === wId;

                  return (
                    <div
                      key={wId}
                      className={`rounded-lg border p-3.5 flex flex-col justify-between gap-2.5 ${
                        onActiveSlot
                          ? 'bg-amber-500/10 border-amber-400'
                          : unlocked
                            ? 'bg-slate-900/75 border-slate-800'
                            : 'bg-slate-950/65 border-slate-800/70 opacity-85'
                      }`}
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-[10px] font-mono-tabular uppercase tracking-wider text-amber-400">
                              {w.origin} · {w.natoCode}
                            </div>
                            <div className="text-sm font-bold text-white mt-0.5">{w.name}</div>
                          </div>
                          {mountedCount > 0 && (
                            <span className="text-[10px] font-mono-tabular font-bold text-emerald-300 shrink-0">
                              [{mountedCount}x Mounted]
                            </span>
                          )}
                        </div>

                        <p className="text-[11px] text-slate-400 mt-1.5 leading-snug">{w.summary}</p>

                        <div className="grid grid-cols-3 gap-1.5 mt-2.5 pt-2 border-t border-slate-800/80 text-[10px] font-mono-tabular text-slate-300">
                          <div>DMG: <strong className="text-white">{w.damage}</strong></div>
                          <div>WH: <strong className="text-rose-300">{w.warheadKg}kg</strong></div>
                          <div>Ammo: <strong className="text-amber-300">x{w.ammoPerSlot}</strong></div>
                          <div>Blast: <strong className="text-white">{w.blastRadiusM}m</strong></div>
                          <div>Range: <strong className="text-sky-300">{w.maxRangeKm}km</strong></div>
                          <div>Mach: <strong className="text-white">{w.machMax}</strong></div>
                        </div>
                      </div>

                      {unlocked ? (
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => mountWeaponToPylon(wId, selectedPylonIdx)}
                            className="flex-1 px-2.5 py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs cursor-pointer"
                          >
                            Mount Pylon [{selectedPylonIdx + 1}]
                          </button>
                          <button
                            type="button"
                            onClick={() => fillAllPylons(wId)}
                            className="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium cursor-pointer"
                          >
                            Fill All 4
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={!canAfford}
                          onClick={() => onUnlockItem('weapon', wId)}
                          className={`w-full px-3 py-1.5 rounded text-xs font-semibold ${
                            canAfford
                              ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 cursor-pointer'
                              : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                          }`}
                        >
                          Unlock {w.unlockCostRc} RC (Rank {w.requiredRank}+)
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tab === 'skills' && (
            <div className="space-y-5">
              {/* Pilot Skill Specialization Header & Active Modifiers */}
              <div className="bg-slate-900/85 border border-slate-800 rounded p-4 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-white flex items-center gap-2">
                    <Award className="w-4 h-4 text-amber-400" />
                    Specialized Pilot Skill Tree
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    Earn Skill Points (SP) from rank promotions and completed sorties. Passive bonuses apply across all drone loadouts.
                  </div>
                </div>

                <div className="flex items-center gap-3 font-mono-tabular">
                  <div className="text-right">
                    <div className="text-[11px] text-slate-400">Available Skill Points</div>
                    <div className="text-xl font-bold text-amber-400">
                      {progression.skillPoints ?? 0} SP
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={investedSkillPoints === 0}
                    onClick={onResetSkills}
                    className={`px-3 py-2 rounded border text-xs font-medium inline-flex items-center gap-1.5 ${
                      investedSkillPoints > 0
                        ? 'border-slate-600 hover:border-amber-400 text-slate-200 cursor-pointer'
                        : 'border-slate-800 text-slate-600 cursor-not-allowed'
                    }`}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Respec Skills
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5 font-mono-tabular text-xs">
                <div className="bg-slate-900/75 border border-slate-800 rounded p-2.5">
                  <div className="text-[10px] text-slate-400 uppercase">Cyber Range</div>
                  <div className="text-sm font-bold text-cyan-300">
                    +{Math.round((skillBonuses.cyberRangeMult - 1) * 100)}%
                  </div>
                </div>
                <div className="bg-slate-900/75 border border-slate-800 rounded p-2.5">
                  <div className="text-[10px] text-slate-400 uppercase">SAM Suppress</div>
                  <div className="text-sm font-bold text-cyan-300">
                    +{Math.round(skillBonuses.ecmSuppressionBonus * 100)}%
                  </div>
                </div>
                <div className="bg-slate-900/75 border border-slate-800 rounded p-2.5">
                  <div className="text-[10px] text-slate-400 uppercase">Seeker Gain N&apos;</div>
                  <div className="text-sm font-bold text-amber-300">
                    +{Math.round((skillBonuses.guidanceGainMult - 1) * 100)}%
                  </div>
                </div>
                <div className="bg-slate-900/75 border border-slate-800 rounded p-2.5">
                  <div className="text-[10px] text-slate-400 uppercase">Ordnance DMG</div>
                  <div className="text-sm font-bold text-amber-300">
                    +{Math.round((skillBonuses.damageMult - 1) * 100)}%
                  </div>
                </div>
                <div className="bg-slate-900/75 border border-slate-800 rounded p-2.5">
                  <div className="text-[10px] text-slate-400 uppercase">Fuel Burn</div>
                  <div className="text-sm font-bold text-emerald-300">
                    -{Math.round((1 - skillBonuses.fuelBurnMult) * 100)}%
                  </div>
                </div>
                <div className="bg-slate-900/75 border border-slate-800 rounded p-2.5">
                  <div className="text-[10px] text-slate-400 uppercase">Hull &amp; Solar</div>
                  <div className="text-sm font-bold text-emerald-300">
                    +{Math.round((skillBonuses.maxHpMult - 1) * 100)}% / +{Math.round((skillBonuses.solarChargeMult - 1) * 100)}%
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {SKILL_BRANCHES.map((branch) => {
                  const branchSkills = Object.values(PILOT_SKILLS)
                    .filter((s) => s.branch === branch.id)
                    .sort((a, b) => a.tier - b.tier);

                  const branchBorder =
                    branch.accent === 'cyan'
                      ? 'border-cyan-500/35'
                      : branch.accent === 'amber'
                        ? 'border-amber-500/35'
                        : 'border-emerald-500/35';
                  const branchTitleColor =
                    branch.accent === 'cyan'
                      ? 'text-cyan-300'
                      : branch.accent === 'amber'
                        ? 'text-amber-300'
                        : 'text-emerald-300';
                  const BranchIcon =
                    branch.accent === 'cyan'
                      ? Radio
                      : branch.accent === 'amber'
                        ? Crosshair
                        : Wind;

                  return (
                    <div
                      key={branch.id}
                      className={`bg-slate-900/70 border ${branchBorder} rounded-lg p-4 flex flex-col gap-3`}
                    >
                      <div>
                        <div className={`text-sm font-display font-bold flex items-center gap-2 ${branchTitleColor}`}>
                          <BranchIcon className="w-4 h-4" />
                          {branch.name}
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                          {branch.tagline}
                        </p>
                      </div>

                      <div className="space-y-3">
                        {branchSkills.map((skill) => {
                          const lvl = progression.skillLevels?.[skill.id] ?? 0;
                          const maxed = lvl >= skill.maxLevel;
                          const check = canUpgradeSkill(progression, skill.id);
                          const prereqMet =
                            !skill.prereqSkillId ||
                            (progression.skillLevels?.[skill.prereqSkillId] ?? 0) >= 1;

                          return (
                            <div
                              key={skill.id}
                              className={`rounded border p-3 transition-colors ${
                                lvl > 0
                                  ? 'bg-slate-950/90 border-slate-600'
                                  : prereqMet
                                    ? 'bg-slate-950/60 border-slate-800'
                                    : 'bg-slate-950/35 border-slate-800/60 opacity-75'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <div className="text-[10px] font-mono-tabular uppercase tracking-wider text-slate-400">
                                    Tier {skill.tier}
                                    {skill.prereqSkillId
                                      ? ` · Req: ${PILOT_SKILLS[skill.prereqSkillId].name}`
                                      : ''}
                                  </div>
                                  <div className="text-xs font-semibold text-white mt-0.5">
                                    {skill.name}
                                  </div>
                                </div>
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono-tabular font-bold shrink-0 ${
                                    maxed
                                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                      : lvl > 0
                                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                        : 'bg-slate-800 text-slate-400'
                                  }`}
                                >
                                  {lvl}/{skill.maxLevel}
                                </span>
                              </div>

                              <div className={`text-[11px] font-mono-tabular font-medium mt-1.5 ${branchTitleColor}`}>
                                {skill.bonusPerLevelSummary}
                              </div>
                              <p className="text-[11px] text-slate-400 mt-1 leading-snug">
                                {skill.description}
                              </p>

                              <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1">
                                  {Array.from({ length: skill.maxLevel }).map((_, i) => (
                                    <span
                                      key={i}
                                      className={`h-2 w-5 rounded-xs ${
                                        i < lvl
                                          ? branch.accent === 'cyan'
                                            ? 'bg-cyan-400'
                                            : branch.accent === 'amber'
                                              ? 'bg-amber-400'
                                              : 'bg-emerald-400'
                                          : 'bg-slate-800 border border-slate-700'
                                      }`}
                                    />
                                  ))}
                                </div>

                                {maxed ? (
                                  <span className="text-[11px] font-semibold text-emerald-400 inline-flex items-center gap-1">
                                    <Check className="w-3.5 h-3.5" />
                                    Mastered
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={!check.ok}
                                    aria-label={`Upgrade ${skill.name}`}
                                    onClick={() => onUpgradeSkill(skill.id)}
                                    className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors whitespace-nowrap ${
                                      check.ok
                                        ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 cursor-pointer'
                                        : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                                    }`}
                                  >
                                    {prereqMet ? `Train (${skill.costPerLevelSp} SP)` : 'Locked'}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tab === 'tech' && (
            <div className="space-y-5">
              <div className="bg-slate-900/80 border border-slate-800 rounded p-4 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-white">
                    Pilot Career Rank {progression.rank}
                  </div>
                  <div className="text-xs text-slate-400 font-mono-tabular mt-0.5">
                    {progression.xp} XP · Next Rank at {nextRankXp} XP · {progression.groundStrikes} Strikes ·{' '}
                    {progression.kills} Air Kills
                    {progression.bestCepMeters !== null ? ` · Best CEP ${progression.bestCepMeters}m` : ''}
                  </div>
                </div>
                <div className="text-right font-mono-tabular">
                  <div className="text-xs text-slate-400">Available Research Credits</div>
                  <div className="text-2xl font-bold text-amber-400">{progression.researchCredits} RC</div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  ...Object.values(AIRFRAMES).map((item) => ({ cat: 'airframe' as const, item, label: 'Airframe' })),
                  ...Object.values(PROPULSION_MODULES).map((item) => ({ cat: 'propulsion' as const, item, label: 'Propulsion' })),
                  ...Object.values(SENSOR_MODULES).map((item) => ({ cat: 'sensor' as const, item, label: 'Sensor Pod' })),
                  ...Object.values(WEAPONS).map((item) => ({ cat: 'weapon' as const, item, label: 'Ordnance' })),
                  ...Object.values(CYBER_PAYLOADS).map((item) => ({ cat: 'cyber' as const, item, label: 'Cyber Payload' })),
                ].map(({ cat, item, label }) => {
                  const owned = isUnlocked(cat, item.id);
                  const canAfford = progression.researchCredits >= item.unlockCostRc && progression.rank >= item.requiredRank;
                  const summaryText =
                    'description' in item
                      ? item.description
                      : 'summary' in item
                        ? item.summary
                        : item.effectSummary;
                  return (
                    <div
                      key={`${cat}-${item.id}`}
                      className="bg-slate-900/70 border border-slate-800 rounded p-3.5 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-[11px] text-slate-400 font-mono-tabular">
                          {label} · Rank {item.requiredRank}+
                        </div>
                        <div className="text-sm font-semibold text-white truncate">{item.name}</div>
                        <div className="text-xs text-slate-400 line-clamp-1">
                          {summaryText}
                        </div>
                      </div>
                      {owned ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400 shrink-0">
                          <Check className="w-4 h-4" />
                          Unlocked
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={!canAfford}
                          onClick={() => onUnlockItem(cat, item.id)}
                          className={`px-3 py-1.5 rounded text-xs font-semibold shrink-0 transition-colors ${
                            canAfford
                              ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 cursor-pointer'
                              : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                          }`}
                        >
                          Unlock {item.unlockCostRc} RC
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tab === 'sandbox' && (
            <div className="space-y-5">
              <div className="bg-slate-900/85 border border-cyan-500/40 rounded p-4 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <FlaskConical className="w-6 h-6 text-cyan-400 shrink-0" />
                  <div>
                    <div className="text-sm font-bold text-white">
                      Aerodynamic &amp; Ballistic Theory Sandbox
                    </div>
                    <p className="text-xs text-slate-300">
                      Override physical constants (gravity, air density, wing lift area, guidance gain, and time scale) or unlock every drone &amp; munition freely.
                    </p>
                  </div>
                </div>
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-white cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sandbox.enabled}
                    onChange={(e) => onChangeSandbox({ ...sandbox, enabled: e.target.checked })}
                    className="w-4 h-4 accent-cyan-400"
                  />
                  Enable Sandbox Overrides
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-400 mr-1">Gravity Presets:</span>
                {[
                  { label: 'Lunar 0.16g', g: 0.16 },
                  { label: 'Martian 0.38g', g: 0.38 },
                  { label: 'Earth 1.00g', g: 1.0 },
                  { label: 'Super-Earth 1.80g', g: 1.8 },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() =>
                      onChangeSandbox({ ...sandbox, enabled: true, gravityMultiplier: preset.g })
                    }
                    className="px-3 py-1.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs text-slate-200 cursor-pointer"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[
                  { key: 'gravityMultiplier' as const, label: 'Gravitational Multiplier', min: 0.15, max: 2.5, step: 0.05, unit: 'g' },
                  { key: 'airDensityMultiplier' as const, label: 'Atmospheric Density (rho)', min: 0.2, max: 2.0, step: 0.05, unit: 'x' },
                  { key: 'thrustMultiplier' as const, label: 'Propulsion Thrust Multiplier', min: 0.5, max: 3.0, step: 0.1, unit: 'x' },
                  { key: 'wingAreaMultiplier' as const, label: 'Wing Planform Area Multiplier', min: 0.5, max: 2.5, step: 0.1, unit: 'x' },
                  { key: 'massMultiplier' as const, label: 'Airframe Mass Multiplier', min: 0.5, max: 2.0, step: 0.1, unit: 'x' },
                  { key: 'guidanceGainMultiplier' as const, label: "Proportional Nav Gain (N')", min: 0.2, max: 3.0, step: 0.1, unit: 'x' },
                  { key: 'timeScale' as const, label: 'Simulation Time Dilation', min: 0.25, max: 2.5, step: 0.25, unit: 'x' },
                ].map((ctrl) => (
                  <div key={ctrl.key} className="bg-slate-900/70 border border-slate-800 rounded p-3.5">
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <label htmlFor={`sb-${ctrl.key}`} className="text-slate-200 font-medium flex items-center gap-1.5">
                        <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                        {ctrl.label}
                      </label>
                      <span className="font-mono-tabular font-bold text-cyan-300">
                        {sandbox[ctrl.key].toFixed(2)}{ctrl.unit}
                      </span>
                    </div>
                    <input
                      id={`sb-${ctrl.key}`}
                      type="range"
                      min={ctrl.min}
                      max={ctrl.max}
                      step={ctrl.step}
                      value={sandbox[ctrl.key]}
                      onChange={(e) =>
                        onChangeSandbox({
                          ...sandbox,
                          enabled: true,
                          [ctrl.key]: Number(e.target.value),
                        })
                      }
                      className="w-full accent-cyan-400 cursor-pointer"
                    />
                  </div>
                ))}

                <div className="bg-slate-900/70 border border-slate-800 rounded p-3.5 flex flex-col justify-center gap-2.5">
                  <label className="inline-flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sandbox.infiniteAmmo}
                      onChange={(e) =>
                        onChangeSandbox({ ...sandbox, enabled: true, infiniteAmmo: e.target.checked })
                      }
                      className="w-4 h-4 accent-cyan-400"
                    />
                    Unlimited Ordnance Test Magazine
                  </label>
                  <label className="inline-flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sandbox.unlockAllInSandbox}
                      onChange={(e) =>
                        onChangeSandbox({
                          ...sandbox,
                          enabled: true,
                          unlockAllInSandbox: e.target.checked,
                        })
                      }
                      className="w-4 h-4 accent-cyan-400"
                    />
                    Unlock All Drones &amp; Ordnance in Sandbox
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-4 bg-[#080d13]">
          <div className="text-xs text-slate-400">
            Test any airframe &amp; hardpoint ammo combo freely in Sandbox Range or deploy directly.
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded border border-slate-700 hover:border-slate-500 text-xs text-slate-200 cursor-pointer"
            >
              Close
            </button>
            <button
              type="button"
              onClick={onLaunchSandboxTestFlight}
              className="px-4 py-2 rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-display font-bold text-xs tracking-wide inline-flex items-center gap-1.5 cursor-pointer"
            >
              <FlaskConical className="w-3.5 h-3.5" />
              Test Flight (Sandbox)
            </button>
            <button
              type="button"
              onClick={onApplyAndLaunch}
              className="px-5 py-2 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-bold text-xs tracking-wide inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              Deploy Configuration
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
