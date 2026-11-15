import React, { useMemo, useState } from 'react';
import {
  Activity,
  Download,
  FileText,
  Fuel,
  MapPin,
  Play,
  RotateCcw,
  Trophy,
  Wrench,
  XCircle,
} from 'lucide-react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AarEventType,
  AarSortieReport,
  exportAarJson,
  formatSortieClock,
} from '../sim/aarLogger';
import { AIRFRAMES } from '../sim/arsenalData';
import { THEATERS } from '../sim/geoTheaters';
import { GamePhase } from '../sim/types';

interface PauseAndDebriefModalProps {
  phase: GamePhase;
  victory: boolean;
  summary: {
    score: number;
    targetsDestroyed: number;
    totalTargets: number;
    bestCep: number | null;
    xpEarned: number;
    rcEarned: number;
  } | null;
  aarReport: AarSortieReport;
  onResume: () => void;
  onRestart: () => void;
  onOpenHangar: () => void;
  onReturnTitle: () => void;
}

const EVENT_BADGE_CLASS: Record<AarEventType, string> = {
  launch: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  ordnance: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  strike: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
  air_kill: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
  cyber: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  damage: 'bg-red-500/25 text-red-300 border-red-500/50',
  defense: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
  end: 'bg-slate-600/30 text-slate-200 border-slate-500/50',
};

const EVENT_LABEL: Record<AarEventType, string> = {
  launch: 'LAUNCH',
  ordnance: 'WEAPONS',
  strike: 'STRIKE',
  air_kill: 'AIR KILL',
  cyber: 'CYBER',
  damage: 'DAMAGE',
  defense: 'DEFENSE',
  end: 'SORTIE',
};

export const PauseAndDebriefModal: React.FC<PauseAndDebriefModalProps> = ({
  phase,
  victory,
  summary,
  aarReport,
  onResume,
  onRestart,
  onOpenHangar,
  onReturnTitle,
}) => {
  const [logTab, setLogTab] = useState<'events' | 'telemetry' | 'all'>('all');

  const theater = THEATERS[aarReport.theaterId];
  const airframe = AIRFRAMES[aarReport.airframeId];

  // Build SVG polyline coordinates for 2D Flight Path Track
  const trackData = useMemo(() => {
    const r = Math.max(2500, theater.worldRadiusM);
    const toX = (wx: number) => 110 + (wx / r) * 94;
    const toY = (wz: number) => 70 + (wz / r) * 58;
    const pts = aarReport.samples
      .map((s) => `${toX(s.x).toFixed(1)},${toY(s.z).toFixed(1)}`)
      .join(' ');
    const first = aarReport.samples[0];
    const last = aarReport.samples[aarReport.samples.length - 1];
    return {
      pts,
      startPt: first ? { cx: toX(first.x), cy: toY(first.z) } : null,
      endPt: last ? { cx: toX(last.x), cy: toY(last.z) } : null,
      landmarks: theater.landmarks.map((lm) => ({
        id: lm.id,
        cx: toX(lm.x),
        cy: toY(lm.z),
      })),
      eventMarkers: aarReport.events
        .filter((ev) => ev.type === 'strike' || ev.type === 'cyber' || ev.type === 'air_kill')
        .map((ev) => ({
          id: ev.id,
          type: ev.type,
          cx: toX(ev.x),
          cy: toY(ev.z),
        })),
    };
  }, [aarReport.samples, aarReport.events, theater]);

  // Format samples for Recharts Altitude & Airspeed Flight Profile LineChart
  const chartData = useMemo(
    () =>
      aarReport.samples.map((s) => ({
        timeLabel: formatSortieClock(s.tSec),
        altMsl: s.yMsl,
        airspeedKt: s.airspeedKnots,
        fuelPct: s.fuelPct,
      })),
    [aarReport.samples],
  );

  if (phase !== 'paused' && phase !== 'gameover') return null;

  const handleDownloadJson = () => {
    const json = exportAarJson(aarReport);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${aarReport.sortieId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const fuelPctRemaining =
    aarReport.initialFuelKg > 0
      ? Math.round((aarReport.finalFuelKg / aarReport.initialFuelKg) * 100)
      : 100;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-5xl bg-[#0b1118] border border-slate-700 rounded-lg shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        <div className="p-6 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* LEFT COLUMN: Pause Menu or Sortie Debrief Summary & Actions */}
          <div className="lg:col-span-4 flex flex-col justify-between gap-5">
            {phase === 'paused' ? (
              <div>
                <h2 className="font-display text-2xl font-bold text-white mb-1">
                  Simulation Paused
                </h2>
                <p className="text-xs text-slate-400 mb-5">
                  Flight kinematics suspended. Live After Action telemetry remains available for review.
                </p>

                <div className="bg-slate-900/80 border border-slate-800 rounded p-3.5 mb-5 space-y-1.5 text-xs font-mono-tabular">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Airframe</span>
                    <span className="text-amber-400 font-semibold">{airframe.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Theater</span>
                    <span className="text-slate-200">{theater.name.split('/')[0]}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Recorded Samples</span>
                    <span className="text-white">{aarReport.samples.length} pts</span>
                  </div>
                </div>

                <div className="flex flex-col gap-2.5">
                  <button
                    type="button"
                    onClick={onResume}
                    className="w-full py-2.5 px-4 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-bold text-sm inline-flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    Resume Flight
                  </button>
                  <button
                    type="button"
                    onClick={onOpenHangar}
                    className="w-full py-2.5 px-4 rounded bg-slate-800 hover:bg-slate-700 text-slate-100 text-sm font-medium inline-flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Wrench className="w-4 h-4 text-amber-400" />
                    Hangar &amp; Sandbox Lab
                  </button>
                  <button
                    type="button"
                    onClick={onRestart}
                    className="w-full py-2.5 px-4 rounded bg-slate-800 hover:bg-slate-700 text-slate-100 text-sm font-medium inline-flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Restart Sortie
                  </button>
                  <button
                    type="button"
                    onClick={onReturnTitle}
                    className="w-full py-2 px-4 rounded border border-slate-700 hover:border-slate-500 text-slate-300 text-sm cursor-pointer"
                  >
                    Return to Title
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-3 mb-3">
                  {victory ? (
                    <Trophy className="w-7 h-7 text-amber-400 shrink-0" />
                  ) : (
                    <XCircle className="w-7 h-7 text-rose-400 shrink-0" />
                  )}
                  <div>
                    <h2 className="font-display text-2xl font-bold text-white">
                      {victory ? 'Theater Neutralized' : 'Airframe Lost'}
                    </h2>
                    <p className="text-xs text-slate-400">
                      {victory
                        ? 'Sortie Debrief & Research Rewards'
                        : 'Telemetry Logged to Flight Recorder'}
                    </p>
                  </div>
                </div>

                {summary && (
                  <div className="grid grid-cols-2 gap-2.5 my-4 font-mono-tabular">
                    <div className="bg-slate-900/90 border border-slate-800 rounded p-3">
                      <div className="text-[11px] text-slate-400">Score</div>
                      <div className="text-xl font-bold text-amber-400">{summary.score}</div>
                    </div>
                    <div className="bg-slate-900/90 border border-slate-800 rounded p-3">
                      <div className="text-[11px] text-slate-400">Targets</div>
                      <div className="text-xl font-bold text-white">
                        {summary.targetsDestroyed}/{summary.totalTargets}
                      </div>
                    </div>
                    <div className="bg-slate-900/90 border border-slate-800 rounded p-3">
                      <div className="text-[11px] text-slate-400">Best CEP</div>
                      <div className="text-lg font-bold text-sky-400">
                        {summary.bestCep !== null ? `${summary.bestCep} m` : '—'}
                      </div>
                    </div>
                    <div className="bg-slate-900/90 border border-slate-800 rounded p-3">
                      <div className="text-[11px] text-slate-400">Earned</div>
                      <div className="text-sm font-bold text-emerald-400">
                        +{summary.xpEarned} XP · +{summary.rcEarned} RC
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-2.5 mt-4">
                  <button
                    type="button"
                    data-start="true"
                    onClick={onRestart}
                    className="w-full py-2.5 px-4 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-bold text-sm inline-flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Fly Again
                  </button>
                  <button
                    type="button"
                    onClick={onOpenHangar}
                    className="w-full py-2.5 px-4 rounded bg-slate-800 hover:bg-slate-700 text-slate-100 text-sm font-medium cursor-pointer"
                  >
                    Spend Research Credits in Hangar
                  </button>
                  <button
                    type="button"
                    onClick={onReturnTitle}
                    className="w-full py-2 px-4 rounded border border-slate-700 hover:border-slate-500 text-slate-300 text-sm cursor-pointer"
                  >
                    Return to Title
                  </button>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={handleDownloadJson}
              className="w-full py-2 px-3 rounded border border-slate-700/90 hover:border-sky-400 bg-slate-900/80 text-xs text-slate-200 inline-flex items-center justify-center gap-2 cursor-pointer transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-sky-400" />
              Export AAR Telemetry (.json)
            </button>
          </div>

          {/* RIGHT COLUMN: Scrollable After Action Report (AAR) Flight Recorder */}
          <div className="lg:col-span-8 bg-[#070b10] border border-slate-800 rounded-lg p-4 flex flex-col gap-3.5 min-h-[420px]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-sky-400" />
                <h3 className="font-display text-sm font-bold uppercase tracking-wider text-white">
                  After Action Report (AAR) · Flight Recorder
                </h3>
              </div>
              <span className="text-[11px] font-mono-tabular text-slate-400">
                {aarReport.events.length} events · {aarReport.samples.length} samples
              </span>
            </div>

            {/* Sortie Fuel, Path & Envelope Metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono-tabular">
              <div className="bg-slate-900/80 border border-slate-800 rounded p-2.5">
                <div className="text-[10px] text-slate-400 uppercase">Sortie Time</div>
                <div className="text-base font-bold text-white">
                  {formatSortieClock(aarReport.durationSec)}
                </div>
              </div>
              <div className="bg-slate-900/80 border border-slate-800 rounded p-2.5">
                <div className="text-[10px] text-slate-400 uppercase flex items-center gap-1">
                  <Fuel className="w-3 h-3 text-emerald-400" />
                  Fuel Burn
                </div>
                <div className="text-base font-bold text-emerald-400">
                  {aarReport.fuelConsumedKg.toFixed(1)} kg
                </div>
                <div className="text-[10px] text-slate-400 whitespace-nowrap">
                  {aarReport.fuelBurnRateKgPerMin.toFixed(1)} kg/m · {fuelPctRemaining}% rem
                </div>
              </div>
              <div className="bg-slate-900/80 border border-slate-800 rounded p-2.5">
                <div className="text-[10px] text-slate-400 uppercase flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-amber-400" />
                  Track Dist
                </div>
                <div className="text-base font-bold text-amber-400">
                  {(aarReport.distanceFlownM / 1000).toFixed(2)} km
                </div>
              </div>
              <div className="bg-slate-900/80 border border-slate-800 rounded p-2.5">
                <div className="text-[10px] text-slate-400 uppercase flex items-center gap-1">
                  <Activity className="w-3 h-3 text-sky-400" />
                  Peak Envelope
                </div>
                <div className="text-xs font-bold text-sky-300 mt-0.5">
                  {aarReport.maxAltMsl}m · M{aarReport.maxMach.toFixed(2)} · {aarReport.maxGLoad.toFixed(1)}G
                </div>
              </div>
            </div>

            {/* Flight Path Track & Altitude/Fuel Curves */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-slate-900/70 border border-slate-800 rounded p-2.5">
                <div className="flex items-center justify-between text-[10px] font-mono-tabular text-slate-400 mb-1">
                  <span>2D FLIGHT PATH TRACK</span>
                  <span>{theater.name.split('/')[0]}</span>
                </div>
                <svg viewBox="0 0 220 140" className="w-full h-28 bg-[#05080d] rounded border border-slate-800/80">
                  <line x1="110" y1="0" x2="110" y2="140" stroke="#1e293b" strokeDasharray="3 3" strokeWidth="0.8" />
                  <line x1="0" y1="70" x2="220" y2="70" stroke="#1e293b" strokeDasharray="3 3" strokeWidth="0.8" />
                  {trackData.landmarks.map((lm) => (
                    <rect
                      key={lm.id}
                      x={lm.cx - 2}
                      y={lm.cy - 2}
                      width="4"
                      height="4"
                      fill="#64748b"
                    />
                  ))}
                  {trackData.pts && (
                    <polyline
                      points={trackData.pts}
                      fill="none"
                      stroke="#f59e0b"
                      strokeWidth="1.8"
                      strokeLinejoin="round"
                    />
                  )}
                  {trackData.eventMarkers.map((ev) => (
                    <circle
                      key={ev.id}
                      cx={ev.cx}
                      cy={ev.cy}
                      r="2.8"
                      fill={ev.type === 'cyber' ? '#22d3ee' : '#f43f5e'}
                    />
                  ))}
                  {trackData.startPt && (
                    <circle cx={trackData.startPt.cx} cy={trackData.startPt.cy} r="3" fill="#34d399" />
                  )}
                  {trackData.endPt && (
                    <circle cx={trackData.endPt.cx} cy={trackData.endPt.cy} r="3" fill="#38bdf8" />
                  )}
                </svg>
              </div>

              <div className="bg-slate-900/70 border border-slate-800 rounded p-2.5 min-w-0">
                <div className="flex items-center justify-between text-[10px] font-mono-tabular text-slate-400 mb-1">
                  <span>ALTITUDE &amp; AIRSPEED PROFILE</span>
                  <span className="text-sky-300">
                    Max {aarReport.maxAltMsl}m · M{aarReport.maxMach.toFixed(2)}
                  </span>
                </div>
                <div className="w-full h-36 bg-[#05080d] rounded border border-slate-800/80 p-1 min-w-0" data-testid="aar-recharts-profile">
                  {chartData.length >= 2 ? (
                    <ResponsiveContainer width="100%" height={134}>
                      <LineChart data={chartData} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                        <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                        <XAxis dataKey="timeLabel" tick={{ fill: '#64748b', fontSize: 9 }} minTickGap={18} />
                        <YAxis yAxisId="alt" tick={{ fill: '#38bdf8', fontSize: 9 }} width={48} />
                        <YAxis yAxisId="spd" orientation="right" tick={{ fill: '#f59e0b', fontSize: 9 }} width={40} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#0b1118',
                            border: '1px solid #334155',
                            borderRadius: '4px',
                            fontSize: '11px',
                            color: '#e2e8f0',
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: '10px' }} />
                        <Line
                          yAxisId="alt"
                          type="monotone"
                          dataKey="altMsl"
                          name="Alt (m MSL)"
                          stroke="#38bdf8"
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={false}
                        />
                        <Line
                          yAxisId="spd"
                          type="monotone"
                          dataKey="airspeedKt"
                          name="Speed (kt)"
                          stroke="#f59e0b"
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[11px] font-mono-tabular text-slate-500">
                      Fly a few seconds to populate altitude &amp; airspeed curves…
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-1 bg-slate-900 p-1 rounded border border-slate-800">
                {[
                  { id: 'all' as const, label: 'All History' },
                  { id: 'events' as const, label: `Key Events (${aarReport.events.length})` },
                  { id: 'telemetry' as const, label: `Telemetry (${aarReport.samples.length})` },
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setLogTab(t.id)}
                    className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                      logTab === t.id
                        ? 'bg-sky-500 text-slate-950 font-bold'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <span className="text-[10px] font-mono-tabular text-slate-400">
                Scroll to inspect full log
              </span>
            </div>

            {/* Scrollable AAR Timeline & Telemetry Table */}
            <div
              data-testid="aar-scroll-panel"
              className="flex-1 max-h-60 min-h-[160px] overflow-y-auto bg-[#05080d] border border-slate-800 rounded p-2.5 space-y-2 font-mono-tabular"
            >
              {(logTab === 'all' || logTab === 'events') && (
                <>
                  {aarReport.events.length === 0 ? (
                    <div className="text-xs text-slate-500 py-3 text-center">
                      No key combat or flight events recorded yet.
                    </div>
                  ) : (
                    aarReport.events
                      .slice()
                      .reverse()
                      .map((ev) => (
                        <div
                          key={ev.id}
                          className="p-2 rounded bg-slate-900/75 border border-slate-800/90 flex flex-wrap items-start justify-between gap-2 text-xs"
                        >
                          <div className="flex items-start gap-2 min-w-0">
                            <span className="text-slate-400 shrink-0">
                              [{formatSortieClock(ev.tSec)}]
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold shrink-0 ${EVENT_BADGE_CLASS[ev.type]}`}
                            >
                              {EVENT_LABEL[ev.type]}
                            </span>
                            <div className="min-w-0">
                              <div className="text-white font-semibold truncate">{ev.title}</div>
                              <div className="text-[11px] text-slate-400">{ev.detail}</div>
                            </div>
                          </div>
                          <div className="text-[10px] text-slate-400 shrink-0 text-right">
                            <div>{ev.altMsl}m MSL</div>
                            <div>{ev.fuelKg.toFixed(1)} kg fuel</div>
                          </div>
                        </div>
                      ))
                  )}
                </>
              )}

              {(logTab === 'all' || logTab === 'telemetry') && aarReport.samples.length > 0 && (
                <div className="pt-1">
                  {logTab === 'all' && (
                    <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1.5 px-1">
                      Flight Recorder Samples
                    </div>
                  )}
                  <table className="w-full text-[11px] text-left border-collapse">
                    <thead className="text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="py-1 px-1.5">Time</th>
                        <th className="py-1 px-1.5">Alt MSL</th>
                        <th className="py-1 px-1.5">Speed</th>
                        <th className="py-1 px-1.5">Pos (X,Z)</th>
                        <th className="py-1 px-1.5">Fuel</th>
                        <th className="py-1 px-1.5">G / HP</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {aarReport.samples
                        .slice()
                        .reverse()
                        .map((s, idx) => (
                          <tr key={`${s.tSec}-${idx}`} className="text-slate-200">
                            <td className="py-1 px-1.5 text-slate-400">{formatSortieClock(s.tSec)}</td>
                            <td className="py-1 px-1.5 text-sky-300">{s.yMsl}m</td>
                            <td className="py-1 px-1.5">{s.airspeedKnots} kt (M{s.mach.toFixed(2)})</td>
                            <td className="py-1 px-1.5 text-slate-400">
                              {Math.round(s.x)},{Math.round(s.z)}
                            </td>
                            <td className="py-1 px-1.5 text-emerald-300">
                              {s.fuelKg.toFixed(1)} kg ({s.fuelPct}%)
                            </td>
                            <td className="py-1 px-1.5">
                              {s.gLoad.toFixed(1)}G · {s.hp}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
