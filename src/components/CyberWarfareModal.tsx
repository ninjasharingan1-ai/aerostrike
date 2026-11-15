import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Lock, Radio, ShieldAlert, Terminal, X, Zap } from 'lucide-react';
import { SENSOR_MODULES, WEATHERS } from '../sim/arsenalData';
import { CYBER_PAYLOADS, evaluateCyberLink, isPacketAligned } from '../sim/cyberWarfare';
import { computePilotSkillBonuses } from '../sim/progression';
import {
  CyberPayloadId,
  LoadoutConfig,
  PilotProgression,
  SandboxConfig,
  WeatherId,
} from '../sim/types';

export interface CyberTargetOption {
  id: string;
  name: string;
  kind: 'base' | 'drone';
  subtype: string;
  distanceM: number;
  hpPct: number;
  compromisedSec: number;
  activePayload: CyberPayloadId | null;
}

interface CyberWarfareModalProps {
  open: boolean;
  targets: CyberTargetOption[];
  initialTargetId: string | null;
  loadout: LoadoutConfig;
  weatherId: WeatherId;
  progression: PilotProgression;
  sandbox: SandboxConfig;
  cooldownSec: number;
  onExecuteAttack: (targetId: string, payloadId: CyberPayloadId) => { ok: boolean; message: string };
  onClose: () => void;
}

export const CyberWarfareModal: React.FC<CyberWarfareModalProps> = ({
  open,
  targets,
  initialTargetId,
  loadout,
  weatherId,
  progression,
  sandbox,
  cooldownSec,
  onExecuteAttack,
  onClose,
}) => {
  const [selectedTargetId, setSelectedTargetId] = useState<string>('');
  const [selectedPayloadId, setSelectedPayloadId] = useState<CyberPayloadId>('radar_spoof');
  const [cursorPos, setCursorPos] = useState<number>(0.5);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const windowCenterRef = useRef<number>(0.5);

  const targetsRef = useRef(targets);
  targetsRef.current = targets;
  const initialTargetIdRef = useRef(initialTargetId);
  initialTargetIdRef.current = initialTargetId;

  // Pick a sensible initial target & compatible payload once when opening
  useEffect(() => {
    if (!open) return;
    setFeedback(null);
    windowCenterRef.current = 0.25 + Math.random() * 0.5;
    const currentTargets = targetsRef.current;
    const preferred =
      currentTargets.find((t) => t.id === initialTargetIdRef.current) ??
      currentTargets.slice().sort((a, b) => a.distanceM - b.distanceM)[0];
    if (preferred) {
      setSelectedTargetId(preferred.id);
      setSelectedPayloadId((prev) => {
        if (preferred.kind === 'drone' && CYBER_PAYLOADS[prev].targetScope === 'base') {
          return 'gnss_spoof';
        }
        if (preferred.kind === 'base' && CYBER_PAYLOADS[prev].targetScope === 'drone') {
          return 'radar_spoof';
        }
        return prev;
      });
    }
  }, [open]);

  // Smooth carrier sync cursor oscillation while open
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = (now - start) / 1000;
      const freq = CYBER_PAYLOADS[selectedPayloadId].difficulty === 3 ? 1.45 : CYBER_PAYLOADS[selectedPayloadId].difficulty === 2 ? 1.15 : 0.85;
      const pos = 0.5 + 0.46 * Math.sin(elapsed * freq * Math.PI);
      setCursorPos(pos);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open, selectedPayloadId]);

  const activeTarget = useMemo(
    () => targets.find((t) => t.id === selectedTargetId) ?? targets[0] ?? null,
    [targets, selectedTargetId],
  );

  const weather = WEATHERS[weatherId];
  const sensor = SENSOR_MODULES[loadout.sensorId];
  const payload = CYBER_PAYLOADS[selectedPayloadId];

  const freeUnlock = sandbox.enabled && sandbox.unlockAllInSandbox;
  const isPayloadUnlocked = (id: CyberPayloadId) =>
    freeUnlock || progression.unlockedCyber.includes(id);

  const scopeCompatible =
    !activeTarget ||
    payload.targetScope === 'both' ||
    payload.targetScope === activeTarget.kind;

  const skillBonuses = useMemo(() => computePilotSkillBonuses(progression), [progression]);

  const linkEval = useMemo(() => {
    const dist = activeTarget ? activeTarget.distanceM : 99999;
    return evaluateCyberLink(
      selectedPayloadId,
      dist,
      loadout.sensorId,
      weather.irAttenuation,
      skillBonuses,
    );
  }, [activeTarget, selectedPayloadId, loadout.sensorId, weather.irAttenuation, skillBonuses]);

  const canAttemptInject =
    Boolean(activeTarget) &&
    isPayloadUnlocked(selectedPayloadId) &&
    scopeCompatible &&
    linkEval.success &&
    cooldownSec <= 0;

  const handleInject = (autoBrute = false) => {
    if (!activeTarget) return;
    if (!isPayloadUnlocked(selectedPayloadId)) {
      setFeedback({ ok: false, text: 'Payload locked — unlock it in Hangar Tech Tree or Sandbox.' });
      return;
    }
    if (!scopeCompatible) {
      setFeedback({
        ok: false,
        text: `${payload.name} only targets ${payload.targetScope === 'base' ? 'military bases' : 'airborne drones'}.`,
      });
      return;
    }
    if (!linkEval.success) {
      setFeedback({
        ok: false,
        text: `Out of RF datalink range (${activeTarget.distanceM}m > ${linkEval.effectiveRangeM}m max).`,
      });
      return;
    }
    if (cooldownSec > 0) {
      setFeedback({ ok: false, text: `EW Transmitter recharging (${cooldownSec.toFixed(1)}s).` });
      return;
    }

    const aligned =
      autoBrute ||
      isPacketAligned(cursorPos, windowCenterRef.current, linkEval.breachWindowWidth);

    if (!aligned) {
      setFeedback({
        ok: false,
        text: 'Carrier frame desync — trigger Inject when the marker crosses the cyan sync window.',
      });
      return;
    }

    const res = onExecuteAttack(activeTarget.id, selectedPayloadId);
    setFeedback({ ok: res.ok, text: res.message });
    windowCenterRef.current = 0.22 + Math.random() * 0.56;
  };

  if (!open) return null;

  const winLeftPct = Math.max(2, (windowCenterRef.current - linkEval.breachWindowWidth / 2) * 100);
  const winWidthPct = Math.min(96, linkEval.breachWindowWidth * 100);
  const alignedNow = isPacketAligned(cursorPos, windowCenterRef.current, linkEval.breachWindowWidth);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-5xl bg-[#0b1118] border border-cyan-500/45 rounded-lg shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <Terminal className="w-5 h-5 text-cyan-400" />
            <div>
              <h2 className="font-display text-xl font-bold text-white">
                Cyber Warfare &amp; EW Intrusion Deck
              </h2>
              <div className="text-xs text-slate-400 font-mono-tabular">
                Pod: {sensor.name} · Weather RF Loss: {Math.round(weather.irAttenuation * (1 - sensor.weatherPenetration) * 35)}% · Breaches: {progression.cyberBreaches}
              </div>
            </div>
          </div>

          <button
            type="button"
            aria-label="Close Cyber Warfare Deck"
            onClick={onClose}
            className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1 grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left: Target Host Selection (Bases & Drones) */}
          <div className="lg:col-span-5 space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                1. Select Hostile Node (Bases &amp; Drones)
              </h3>
              <span className="text-[11px] font-mono-tabular text-slate-400">
                {targets.length} nodes active
              </span>
            </div>

            <div className="space-y-2 max-h-[370px] overflow-y-auto pr-1">
              {targets.map((t) => {
                const selected = activeTarget?.id === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setSelectedTargetId(t.id);
                      setFeedback(null);
                      if (t.kind === 'drone' && CYBER_PAYLOADS[selectedPayloadId].targetScope === 'base') {
                        setSelectedPayloadId('gnss_spoof');
                      } else if (t.kind === 'base' && CYBER_PAYLOADS[selectedPayloadId].targetScope === 'drone') {
                        setSelectedPayloadId('radar_spoof');
                      }
                    }}
                    className={`w-full p-3 rounded border text-left transition-colors cursor-pointer ${
                      selected
                        ? 'bg-cyan-500/15 border-cyan-400 text-white'
                        : 'bg-slate-900/75 border-slate-800 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold truncate">{t.name}</span>
                      <span
                        className={`text-[10px] font-mono-tabular px-1.5 py-0.5 rounded uppercase ${
                          t.kind === 'drone'
                            ? 'bg-rose-500/20 text-rose-300'
                            : 'bg-amber-500/20 text-amber-300'
                        }`}
                      >
                        {t.subtype}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] font-mono-tabular text-slate-400">
                      <span>Range {t.distanceM}m · Hull {t.hpPct}%</span>
                      {t.compromisedSec > 0 ? (
                        <span className="text-cyan-300 font-semibold">
                          PWNED {t.compromisedSec}s
                        </span>
                      ) : (
                        <span>Secure</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: Exploit Payloads + Carrier Sync Injection */}
          <div className="lg:col-span-7 flex flex-col justify-between gap-4">
            <div className="space-y-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                2. Select Cyber / EW Payload
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {(Object.keys(CYBER_PAYLOADS) as CyberPayloadId[]).map((id) => {
                  const p = CYBER_PAYLOADS[id];
                  const unlocked = isPayloadUnlocked(id);
                  const compatible =
                    !activeTarget || p.targetScope === 'both' || p.targetScope === activeTarget.kind;
                  const active = selectedPayloadId === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setSelectedPayloadId(id);
                        setFeedback(null);
                      }}
                      className={`p-3 rounded border text-left transition-colors cursor-pointer ${
                        active
                          ? 'bg-cyan-500/15 border-cyan-400 text-white'
                          : !unlocked || !compatible
                            ? 'bg-slate-950/70 border-slate-800/70 text-slate-500'
                            : 'bg-slate-900/75 border-slate-800 text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs font-semibold">
                        <span className="truncate">{p.name}</span>
                        {!unlocked && <Lock className="w-3.5 h-3.5 text-slate-500 shrink-0" />}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[10px] font-mono-tabular text-cyan-300">
                        <span className="uppercase">{p.targetScope}</span>
                        <span aria-hidden="true">·</span>
                        <span>{p.directDamage > 0 ? `${p.directDamage} DMG` : 'EW Blind'}</span>
                        <span aria-hidden="true">·</span>
                        <span>{p.durationSec}s</span>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-400 line-clamp-2">
                        {p.effectSummary}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* RF Link Evaluation & Packet Sync Timing Bar */}
            <div className="bg-slate-900/90 border border-slate-800 rounded p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono-tabular">
                <div className="flex items-center gap-2 text-slate-200">
                  <Radio className="w-4 h-4 text-cyan-400" />
                  <span>
                    Datalink Strength:{' '}
                    <strong className={linkEval.success ? 'text-cyan-300' : 'text-rose-400'}>
                      {linkEval.signalStrengthPct}%
                    </strong>
                  </span>
                </div>
                <div className="text-slate-400">
                  Max Effective Range: <strong className="text-white">{linkEval.effectiveRangeM}m</strong>
                  {cooldownSec > 0 ? ` · Cooldown ${cooldownSec.toFixed(1)}s` : ''}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1.5">
                  <span>RF Carrier Sync Window — Inject when marker enters cyan zone</span>
                  <span className={alignedNow ? 'text-emerald-400 font-semibold' : 'text-slate-400'}>
                    {alignedNow ? 'SYNC LOCKED' : 'SCANNING'}
                  </span>
                </div>
                <div className="relative h-6 bg-slate-950 border border-slate-700 rounded overflow-hidden">
                  {/* Target sync zone */}
                  <div
                    className="absolute top-0 bottom-0 bg-cyan-500/35 border-x border-cyan-400"
                    style={{ left: `${winLeftPct}%`, width: `${winWidthPct}%` }}
                  />
                  {/* Moving packet cursor */}
                  <div
                    className={`absolute top-0 bottom-0 w-1.5 -translate-x-1/2 ${
                      alignedNow ? 'bg-emerald-400' : 'bg-amber-400'
                    }`}
                    style={{ left: `${cursorPos * 100}%` }}
                  />
                </div>
              </div>

              {feedback && (
                <div
                  className={`px-3 py-2 rounded border text-xs flex items-center gap-2 ${
                    feedback.ok
                      ? 'bg-emerald-950/60 border-emerald-500/60 text-emerald-200'
                      : 'bg-rose-950/60 border-rose-500/60 text-rose-200'
                  }`}
                >
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  <span>{feedback.text}</span>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-end gap-2.5 pt-1">
                {(loadout.sensorId === 'ew_jammer' || sandbox.enabled) && (
                  <button
                    type="button"
                    disabled={!canAttemptInject}
                    onClick={() => handleInject(true)}
                    className={`px-4 py-2 rounded border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
                      canAttemptInject
                        ? 'border-cyan-400/70 bg-cyan-950/60 hover:bg-cyan-900/70 text-cyan-200 cursor-pointer'
                        : 'border-slate-800 bg-slate-900 text-slate-500 cursor-not-allowed'
                    }`}
                  >
                    <Zap className="w-3.5 h-3.5" />
                    Auto-Brute ({loadout.sensorId === 'ew_jammer' ? 'EW Pod' : 'Sandbox'})
                  </button>
                )}
                <button
                  type="button"
                  disabled={!canAttemptInject}
                  onClick={() => handleInject(false)}
                  className={`px-5 py-2 rounded font-display font-bold text-xs tracking-wide transition-colors ${
                    canAttemptInject
                      ? 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 cursor-pointer'
                      : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  }`}
                >
                  Inject Payload
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
