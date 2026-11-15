import React from 'react';
import {
  Bomb,
  BookOpen,
  Camera,
  CloudSun,
  Crosshair,
  Flame,
  Globe,
  Pause,
  Sliders,
  Terminal,
  Users,
  Volume2,
  VolumeX,
  Wrench,
} from 'lucide-react';
import { AIRFRAMES, WEAPONS } from '../sim/arsenalData';
import { THEATERS } from '../sim/geoTheaters';
import { GameSettings } from '../sim/settings';
import {
  CameraMode,
  HudSnapshot,
  KillFeedEntry,
  LoadoutConfig,
  SandboxConfig,
  TheaterId,
  WeatherId,
} from '../sim/types';

interface FlightHudProps {
  hud: HudSnapshot;
  theaterId: TheaterId;
  weatherId: WeatherId;
  loadout: LoadoutConfig;
  sandbox: SandboxConfig;
  settings: GameSettings;
  cameraMode: CameraMode;
  muted: boolean;
  wsConnected: boolean;
  remotePilotCount: number;
  killFeed: KillFeedEntry[];
  onToggleMute: () => void;
  onPause: () => void;
  onOpenHangar: () => void;
  onOpenGeoMap: () => void;
  onOpenInfographics: () => void;
  onOpenWeatherSolar: () => void;
  onOpenMultiplayer: () => void;
  onOpenCyber: () => void;
  onOpenSettings: () => void;
  onDeployFlares: () => void;
  onArmKamikaze: () => void;
  onCycleCamera: () => void;
  onSelectSlot: (slot: number) => void;
  onFire: () => void;
  onCycleTarget: () => void;
}

export const FlightHud: React.FC<FlightHudProps> = ({
  hud,
  theaterId,
  loadout,
  sandbox,
  settings,
  cameraMode,
  muted,
  wsConnected,
  remotePilotCount,
  killFeed,
  onToggleMute,
  onPause,
  onOpenHangar,
  onOpenGeoMap,
  onOpenInfographics,
  onOpenWeatherSolar,
  onOpenMultiplayer,
  onOpenCyber,
  onOpenSettings,
  onDeployFlares,
  onArmKamikaze,
  onCycleCamera,
  onSelectSlot,
  onFire,
  onCycleTarget,
}) => {
  const airframe = AIRFRAMES[loadout.airframeId];
  const theater = THEATERS[theaterId];
  const hpRatio = Math.max(0, Math.min(1, hud.hp / Math.max(1, hud.maxHp)));
  const hullPips = 5;
  const filledPips = Math.ceil(hpRatio * hullPips);

  const metricUnits = settings.gameplay.hudUnits === 'knots_m';
  const speedVal = metricUnits ? hud.airspeedKnots : Math.round(hud.airspeedKnots * 1.852);
  const speedUnit = metricUnits ? 'kt' : 'km/h';
  const altAglVal = metricUnits ? hud.altitudeAgl : Math.round(hud.altitudeAgl * 3.28084);
  const altMslVal = metricUnits ? hud.altitudeMsl : Math.round(hud.altitudeMsl * 3.28084);
  const altUnit = metricUnits ? 'm' : 'ft';

  return (
    <div className="fixed inset-0 z-10 pointer-events-none flex flex-col justify-between p-4 md:p-5">
      {/* Low-HP subtle peripheral vignette */}
      {hpRatio < 0.35 && (
        <div
          className="fixed inset-0 pointer-events-none"
          style={{
            boxShadow: 'inset 0 0 110px rgba(239, 68, 68, 0.45)',
          }}
        />
      )}

      {/* Center (0,0) SVG Tactical Avionics Pitch Ladder & 3D Projected Layer */}
      <div className="fixed inset-0 z-0 pointer-events-none">
      <div
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
        aria-hidden="true"
      >
        <svg viewBox="-120 -120 240 240" className="w-52 h-52 overflow-visible">
          <g transform={`rotate(${-hud.rollDeg}) translate(0, ${Math.max(-45, Math.min(45, hud.pitchDeg * 1.4))})`}>
            <line x1="-68" y1="0" x2="-22" y2="0" stroke={hud.kamikazeArmed ? '#fb7185' : '#38bdf8'} strokeWidth="1.2" strokeOpacity="0.65" />
            <line x1="22" y1="0" x2="68" y2="0" stroke={hud.kamikazeArmed ? '#fb7185' : '#38bdf8'} strokeWidth="1.2" strokeOpacity="0.65" />
            <line x1="-40" y1="-26" x2="-16" y2="-26" stroke="#38bdf8" strokeWidth="1" strokeDasharray="4 3" strokeOpacity="0.45" />
            <line x1="16" y1="-26" x2="40" y2="-26" stroke="#38bdf8" strokeWidth="1" strokeDasharray="4 3" strokeOpacity="0.45" />
            <line x1="-40" y1="26" x2="-16" y2="26" stroke="#38bdf8" strokeWidth="1" strokeDasharray="4 3" strokeOpacity="0.45" />
            <line x1="16" y1="26" x2="40" y2="26" stroke="#38bdf8" strokeWidth="1" strokeDasharray="4 3" strokeOpacity="0.45" />
          </g>
          <polyline
            points="-10,0 -4,0 0,5 4,0 10,0"
            fill="none"
            stroke={hud.kamikazeArmed ? '#ef4444' : '#f59e0b'}
            strokeWidth="1.6"
            strokeOpacity="0.7"
          />
        </svg>
      </div>

      {/* War Thunder-Style Dynamic 3D Projected HUD Overlay */}
      {/* 1. Projected Aircraft Nose Vector Crosshair */}
      <div
        aria-hidden="true"
        className="fixed -translate-x-1/2 -translate-y-1/2 pointer-events-none"
        style={{ left: `${hud.noseScreenX}%`, top: `${hud.noseScreenY}%` }}
      >
        <svg viewBox="-14 -14 28 28" className="w-7 h-7">
          <line x1="-10" y1="0" x2="-4" y2="0" stroke={hud.kamikazeArmed ? '#ef4444' : '#38bdf8'} strokeWidth="1.8" />
          <line x1="4" y1="0" x2="10" y2="0" stroke={hud.kamikazeArmed ? '#ef4444' : '#38bdf8'} strokeWidth="1.8" />
          <line x1="0" y1="-10" x2="0" y2="-4" stroke={hud.kamikazeArmed ? '#ef4444' : '#38bdf8'} strokeWidth="1.8" />
          <line x1="0" y1="4" x2="0" y2="10" stroke={hud.kamikazeArmed ? '#ef4444' : '#38bdf8'} strokeWidth="1.8" />
        </svg>
      </div>

      {/* 2. Mouse Aim Instructor Cursor Ring */}
      {settings.controls.scheme === 'mouse_aim' && (
        <div
          aria-hidden="true"
          className="fixed -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          style={{ left: `${hud.mouseAimScreenX}%`, top: `${hud.mouseAimScreenY}%` }}
        >
          <svg viewBox="-20 -20 40 40" className="w-10 h-10">
            <circle cx="0" cy="0" r="15" fill="none" stroke={hud.kamikazeArmed ? '#fb7185' : '#f8fafc'} strokeWidth="1.4" strokeOpacity="0.88" />
            <circle cx="0" cy="0" r="2.2" fill={hud.kamikazeArmed ? '#ef4444' : '#f59e0b'} />
            <line x1="-19" y1="0" x2="-12" y2="0" stroke="#f8fafc" strokeWidth="1.4" />
            <line x1="12" y1="0" x2="19" y2="0" stroke="#f8fafc" strokeWidth="1.4" />
            <line x1="0" y1="-19" x2="0" y2="-12" stroke="#f8fafc" strokeWidth="1.4" />
            <line x1="0" y1="12" x2="0" y2="19" stroke="#f8fafc" strokeWidth="1.4" />
          </svg>
        </div>
      )}

      {/* 3. Locked Target 3D Bracket Box */}
      {hud.targetScreenX !== null && hud.targetScreenY !== null && (
        <div
          aria-hidden="true"
          className="fixed -translate-x-1/2 -translate-y-1/2 pointer-events-none flex flex-col items-center"
          style={{ left: `${hud.targetScreenX}%`, top: `${hud.targetScreenY}%` }}
        >
          <div className="w-8 h-8 border-2 border-rose-400/90 rounded-xs shadow-sm" />
          <span className="mt-0.5 text-[10px] font-mono-tabular font-bold text-rose-300 bg-black/55 px-1 rounded-xs">
            {hud.lockedTargetDistM}m
          </span>
        </div>
      )}

      {/* 4. Multi-Contact War Thunder Air Brackets & Automatic Lead Pips */}
      {hud.airContacts.map((c) => {
        const isAlly = c.team === 'alpha';
        const distLabel = c.distM >= 1000 ? `${(c.distM / 1000).toFixed(1)}km` : `${c.distM}m`;
        return (
          <React.Fragment key={c.id}>
            {c.leadX !== null && c.leadY !== null && (
              <>
                <svg
                  aria-hidden="true"
                  className="fixed inset-0 w-full h-full pointer-events-none"
                >
                  <line
                    x1={`${c.screenX}%`}
                    y1={`${c.screenY}%`}
                    x2={`${c.leadX}%`}
                    y2={`${c.leadY}%`}
                    stroke={c.locked ? '#fbbf24' : '#f87171'}
                    strokeWidth="1.2"
                    strokeDasharray="3 3"
                    strokeOpacity="0.65"
                  />
                </svg>
                <div
                  aria-hidden="true"
                  className="fixed -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ left: `${c.leadX}%`, top: `${c.leadY}%` }}
                >
                  <svg viewBox="-16 -16 32 32" className="w-7 h-7">
                    <circle
                      cx="0"
                      cy="0"
                      r="10"
                      fill="none"
                      stroke={c.locked ? '#fbbf24' : '#f87171'}
                      strokeWidth="1.8"
                      strokeDasharray="4 2"
                    />
                    <circle cx="0" cy="0" r="2.2" fill={c.locked ? '#fbbf24' : '#f87171'} />
                  </svg>
                </div>
              </>
            )}
            <div
              aria-hidden="true"
              className="fixed -translate-x-1/2 -translate-y-1/2 pointer-events-none flex flex-col items-center"
              style={{ left: `${c.screenX}%`, top: `${c.screenY}%` }}
            >
              <div
                className={`w-3.5 h-3.5 rotate-45 border-2 ${
                  isAlly
                    ? 'border-sky-400 bg-sky-500/20'
                    : c.locked
                      ? 'border-amber-300 bg-rose-500/35'
                      : 'border-rose-500 bg-rose-500/20'
                }`}
              />
              <div
                className={`mt-1 px-1 py-0.5 rounded-xs text-[9px] leading-none font-mono-tabular whitespace-nowrap bg-black/65 ${
                  isAlly ? 'text-sky-300' : 'text-rose-200'
                }`}
              >
                {c.callsign} · {distLabel}
              </div>
              {!isAlly && (
                <div className="w-10 h-1 bg-slate-900/90 border border-slate-700/80 rounded-xs overflow-hidden mt-0.5">
                  <div
                    className="h-full bg-rose-500"
                    style={{ width: `${Math.max(0, Math.min(100, c.hpPct))}%` }}
                  />
                </div>
              )}
            </div>
          </React.Fragment>
        );
      })}

      {/* 5. Locked Ground/Remote Fallback Lead Pip */}
      {hud.leadScreenX !== null &&
        hud.leadScreenY !== null &&
        !hud.airContacts.some((c) => c.locked && c.leadX !== null) && (
          <div
            aria-hidden="true"
            className="fixed -translate-x-1/2 -translate-y-1/2 pointer-events-none"
            style={{ left: `${hud.leadScreenX}%`, top: `${hud.leadScreenY}%` }}
          >
            <svg viewBox="-16 -16 32 32" className="w-8 h-8">
              <circle
                cx="0"
                cy="0"
                r="11"
                fill="none"
                stroke="#fbbf24"
                strokeWidth="2"
                strokeDasharray="4 2"
              />
              <circle cx="0" cy="0" r="2.5" fill="#fbbf24" />
            </svg>
          </div>
        )}

      {/* 6. Floating War Thunder Hit / Destruction Confirmation Callout */}
      {hud.combatHitCallout && (
        <div className="fixed left-1/2 top-[34%] -translate-x-1/2 pointer-events-none z-20">
          <div className="px-3.5 py-1 rounded bg-amber-500/95 border border-amber-200 text-slate-950 font-display font-bold text-xs tracking-wider shadow-lg whitespace-nowrap">
            {hud.combatHitCallout}
          </div>
        </div>
      )}
      </div>

      {/* TOP BAR: Compact Left & Right Perimeter Clusters */}
      <div className="relative z-20 flex items-start justify-between gap-4">
        {/* Top-Left: Theater, Airframe & Solar/Gravity Telemetry */}
        <div className="bg-[#090e16]/85 border border-slate-700/70 rounded px-3.5 py-2.5 pointer-events-auto max-w-xs sm:max-w-md">
          <div className="flex items-center gap-2 text-xs text-slate-300 font-mono-tabular">
            <span className="font-semibold text-amber-400">{airframe.name}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{theater.name.split('/')[0]}</span>
            {hud.zoomed && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-sky-300 font-bold">ZOOM</span>
              </>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-slate-300 font-mono-tabular">
            <span>g {hud.localGravityMs2.toFixed(2)} m/s²</span>
            <span aria-hidden="true">·</span>
            <span>Sun {hud.solarElevationDeg}° ({hud.solarChargeW}W)</span>
            <span aria-hidden="true">·</span>
            <span>Wind {hud.windSpeedKnots} kt</span>
            {sandbox.enabled && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-cyan-400 font-semibold">Sandbox</span>
              </>
            )}
          </div>
          {hud.lockedTargetName && (
            <div className="mt-1.5 pt-1.5 border-t border-slate-800 flex items-center justify-between gap-3 text-xs font-mono-tabular">
              <span className="text-rose-400 font-medium truncate">
                Target: {hud.lockedTargetName}
                {hud.lockedTargetCompromisedSec > 0 && (
                  <span className="ml-1.5 text-cyan-300 font-bold">
                    [PWNED {hud.lockedTargetCompromisedSec}s]
                  </span>
                )}
              </span>
              <span className="text-slate-200 shrink-0">
                {hud.lockedTargetDistM}m
                {hud.predictedCepM !== null ? ` · CEP ${hud.predictedCepM}m` : ''}
              </span>
            </div>
          )}
        </div>

        {/* Top-Center: War Thunder Battle Ticket Bar + Active Alerts */}
        <div className="flex flex-col items-center gap-1.5 pointer-events-none shrink-0">
          <div
            data-testid="battle-tickets-bar"
            className="bg-[#090e16]/88 border border-slate-700/80 rounded px-3 py-1.5 flex items-center gap-2.5 font-mono-tabular shadow-md"
          >
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold text-sky-400 w-9 text-right">{hud.blueTickets}</span>
              <div className="w-20 sm:w-28 h-2.5 bg-slate-900 rounded-xs overflow-hidden border border-slate-700/80 flex justify-end">
                <div
                  className="h-full bg-sky-500 transition-all duration-150"
                  style={{ width: `${Math.max(0, Math.min(100, (hud.blueTickets / 1000) * 100))}%` }}
                />
              </div>
            </div>
            <span className="text-[10px] font-bold text-slate-300 px-1.5 py-0.5 rounded bg-slate-800/90 border border-slate-700 whitespace-nowrap">
              {hud.targetsDestroyed}/{hud.totalTargets} BASE
            </span>
            <div className="flex items-center gap-1.5">
              <div className="w-20 sm:w-28 h-2.5 bg-slate-900 rounded-xs overflow-hidden border border-slate-700/80">
                <div
                  className="h-full bg-rose-500 transition-all duration-150"
                  style={{ width: `${Math.max(0, Math.min(100, (hud.redTickets / 1000) * 100))}%` }}
                />
              </div>
              <span className="text-[11px] font-bold text-rose-400 w-9">{hud.redTickets}</span>
            </div>
          </div>

          {hud.freeLooking && (
            <div className="bg-amber-500/90 border border-amber-300 rounded px-2.5 py-0.5 text-[10px] font-mono-tabular font-bold text-slate-950 tracking-wider">
              FREE-LOOK [C] · AIM LOCKED
            </div>
          )}

          {hud.kamikazeArmed && (
            <div className="bg-rose-950/90 border border-rose-500 rounded px-3.5 py-1 text-xs font-display font-bold text-rose-100 tracking-wide">
              TERMINAL KAMIKAZE STRIKE ARMED · {airframe.kamikazeWarheadKg}KG WARHEAD · STEER NOSE TO IMPACT
            </div>
          )}
        </div>

        {/* Top-Right: Score + Compact Utility Icon Buttons */}
        <div className="flex flex-col items-end gap-2 pointer-events-auto">
          <div className="flex flex-wrap justify-end items-center gap-1.5">
            <button
              type="button"
              tabIndex={-1}
              aria-label="Open Hangar and Sandbox"
              title="Hangar, Ammo Bay & Sandbox [H]"
              onClick={(e) => {
                e.currentTarget.blur();
                onOpenHangar();
              }}
              className="w-9 h-9 rounded bg-[#090e16]/90 hover:bg-slate-800 border border-slate-700/80 flex items-center justify-center text-amber-400 transition-colors cursor-pointer"
            >
              <Wrench className="w-4 h-4" />
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-label="Open Topographical Geo-Map"
              title="Topographical Geo-Map [G]"
              onClick={(e) => {
                e.currentTarget.blur();
                onOpenGeoMap();
              }}
              className="w-9 h-9 rounded bg-[#090e16]/90 hover:bg-slate-800 border border-slate-700/80 flex items-center justify-center text-sky-400 transition-colors cursor-pointer"
            >
              <Globe className="w-4 h-4" />
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-label="Open Ordnance Infographics"
              title="Military Ordnance Infographics [I]"
              onClick={(e) => {
                e.currentTarget.blur();
                onOpenInfographics();
              }}
              className="w-9 h-9 rounded bg-[#090e16]/90 hover:bg-slate-800 border border-slate-700/80 flex items-center justify-center text-slate-200 transition-colors cursor-pointer"
            >
              <BookOpen className="w-4 h-4" />
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-label="Weather and Solar Controls"
              title="Weather & Solar Model [V]"
              onClick={(e) => {
                e.currentTarget.blur();
                onOpenWeatherSolar();
              }}
              className="w-9 h-9 rounded bg-[#090e16]/90 hover:bg-slate-800 border border-slate-700/80 flex items-center justify-center text-amber-300 transition-colors cursor-pointer"
            >
              <CloudSun className="w-4 h-4" />
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-label="Open Cyber Warfare Intrusion Deck"
              title="Cyber Warfare & EW Deck [K]"
              onClick={(e) => {
                e.currentTarget.blur();
                onOpenCyber();
              }}
              className="w-9 h-9 rounded bg-[#090e16]/90 hover:bg-slate-800 border border-cyan-500/60 flex items-center justify-center text-cyan-300 transition-colors cursor-pointer"
            >
              <Terminal className="w-4 h-4" />
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-label="Multiplayer Arenas"
              title="Multiplayer Arenas"
              onClick={(e) => {
                e.currentTarget.blur();
                onOpenMultiplayer();
              }}
              className="w-9 h-9 rounded bg-[#090e16]/90 hover:bg-slate-800 border border-slate-700/80 flex items-center justify-center text-cyan-400 transition-colors cursor-pointer"
            >
              <Users className="w-4 h-4" />
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-label={`Switch Camera Mode (${cameraMode})`}
              title="Cycle Camera [U]"
              onClick={(e) => {
                e.currentTarget.blur();
                onCycleCamera();
              }}
              className="w-9 h-9 rounded bg-[#090e16]/90 hover:bg-slate-800 border border-slate-700/80 flex items-center justify-center text-slate-200 transition-colors cursor-pointer"
            >
              <Camera className="w-4 h-4" />
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-label={muted ? 'Unmute Audio' : 'Mute Audio'}
              title="Toggle Mute [M]"
              onClick={(e) => {
                e.currentTarget.blur();
                onToggleMute();
              }}
              className="w-9 h-9 rounded bg-[#090e16]/90 hover:bg-slate-800 border border-slate-700/80 flex items-center justify-center text-slate-200 transition-colors cursor-pointer"
            >
              {muted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-label="Open Settings"
              title="Controls, Graphics & Gameplay [O]"
              onClick={(e) => {
                e.currentTarget.blur();
                onOpenSettings();
              }}
              className="w-9 h-9 rounded bg-[#090e16]/90 hover:bg-slate-800 border border-slate-700/80 flex items-center justify-center text-slate-200 transition-colors cursor-pointer"
            >
              <Sliders className="w-4 h-4" />
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-label="Pause Simulation"
              title="Pause [P / Esc]"
              onClick={(e) => {
                e.currentTarget.blur();
                onPause();
              }}
              className="w-9 h-9 rounded bg-[#090e16]/90 hover:bg-slate-800 border border-slate-700/80 flex items-center justify-center text-slate-200 transition-colors cursor-pointer"
            >
              <Pause className="w-4 h-4" />
            </button>
          </div>

          <div className="bg-[#090e16]/85 border border-slate-700/70 rounded px-3 py-1.5 flex items-center gap-3 text-xs font-mono-tabular">
            <span className="text-slate-300">
              Units <strong className="text-emerald-400">{hud.reserveDrones}/3</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span className="text-slate-300">
              Targets <strong className="text-white">{hud.targetsDestroyed}/{hud.totalTargets}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span className="text-amber-400 font-semibold">Score {hud.score}</span>
            <span aria-hidden="true">·</span>
            <span className={wsConnected ? 'text-cyan-400' : 'text-slate-400'}>
              {wsConnected ? `Live (${remotePilotCount + 1})` : 'Solo'}
            </span>
          </div>

          {hud.stalling && (
            <div className="bg-rose-950/90 border border-rose-500 rounded px-3 py-1 text-xs font-display font-bold text-rose-200">
              STALL WARNING · PITCH DOWN
            </div>
          )}
          {killFeed.slice(0, 2).map((entry) => (
            <div
              key={entry.id}
              className="bg-[#090e16]/85 border border-slate-700/60 rounded px-2.5 py-1 text-[11px] text-slate-200 font-mono-tabular"
            >
              {entry.text}
            </div>
          ))}
        </div>
      </div>

      {/* BOTTOM CLUSTER: Primary Flight Instruments & 4-Slot Modular Ordnance */}
      <div className="relative z-20 flex flex-col xl:flex-row items-center justify-between gap-2 max-w-full">
        {/* Left: Primary Flight Instruments */}
        <div className="bg-[#090e16]/95 border border-slate-700/90 rounded px-3 py-1.5 flex items-center gap-3 pointer-events-auto font-mono-tabular shrink-0">
          <div className="whitespace-nowrap">
            <div className="text-[10px] uppercase tracking-wider text-slate-400">Airspeed</div>
            <div className="text-base font-bold text-white leading-tight">
              {speedVal} <span className="text-[11px] font-normal text-slate-400">{speedUnit}</span>
            </div>
            <div className="text-[10px] text-sky-400">M {hud.mach.toFixed(2)}</div>
          </div>

          <div className="h-8 w-px bg-slate-800" />

          <div className="whitespace-nowrap">
            <div className="text-[10px] uppercase tracking-wider text-slate-400">Altitude</div>
            <div className="text-base font-bold text-white leading-tight">
              {altAglVal} <span className="text-[11px] font-normal text-slate-400">{altUnit} AGL</span>
            </div>
            <div className="text-[10px] text-slate-400">{altMslVal}{altUnit} MSL</div>
          </div>

          <div className="h-8 w-px bg-slate-800" />

          <div className="whitespace-nowrap">
            <div className="text-[10px] uppercase tracking-wider text-slate-400">HDG / G</div>
            <div className="text-base font-bold text-amber-400 leading-tight">{hud.headingDeg}°</div>
            <div className="text-[10px] text-slate-300">
              {hud.gLoad.toFixed(1)}G · THR{' '}
              <span className={hud.wepActive ? 'text-rose-400 font-bold' : ''}>
                {hud.throttlePct}%{hud.wepActive ? ' WEP' : ''}
              </span>
            </div>
          </div>

          <div className="h-8 w-px bg-slate-800" />

          {/* Structural Hull Pips + Fuel */}
          <div className="whitespace-nowrap">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">
              Hull {hud.hp}/{hud.maxHp} · Fuel {hud.fuelPct}%
            </div>
            <div className="flex items-center gap-1">
              {Array.from({ length: hullPips }).map((_, idx) => (
                <span
                  key={idx}
                  className={`h-2.5 w-3.5 rounded-xs ${
                    idx < filledPips
                      ? hpRatio > 0.35
                        ? 'bg-emerald-400'
                        : 'bg-rose-500'
                      : 'bg-slate-800 border border-slate-700'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Right: 4-Slot Modular Ordnance & Countermeasure/Kamikaze/Fire Actions */}
        <div className="flex flex-wrap items-center justify-center xl:justify-end gap-1.5 pointer-events-auto">
          {loadout.slots.map((wId, idx) => {
            const w = WEAPONS[wId];
            const isSelected = hud.activeSlot === idx;
            const ammo = sandbox.infiniteAmmo ? '∞' : hud.slotAmmo[idx];
            const cd = hud.slotCooldowns[idx];
            return (
              <button
                key={`${wId}-${idx}`}
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.currentTarget.blur();
                  onSelectSlot(idx);
                }}
                className={`px-2 py-1.5 rounded border text-left transition-colors cursor-pointer min-w-[92px] max-w-[122px] whitespace-nowrap ${
                  isSelected
                    ? 'bg-[#171d26]/95 border-amber-400 text-white shadow-md'
                    : 'bg-[#090e16]/95 border-slate-700/80 text-slate-300 hover:border-slate-500'
                }`}
              >
                <div className="flex items-center justify-between gap-1.5 text-[10px] font-mono-tabular">
                  <span className={isSelected ? 'text-amber-400 font-bold' : 'text-slate-400'}>
                    [{idx + 1}] {w.natoCode}
                  </span>
                  <span className="font-bold text-white">{cd > 0 ? `${cd.toFixed(1)}s` : `x${ammo}`}</span>
                </div>
                <div className="text-[11px] font-medium truncate mt-0.5">{w.name.split(' ')[0]} {w.name.split(' ')[1] ?? ''}</div>
              </button>
            );
          })}

          {hud.kamikazeCapable && (
            <button
              type="button"
              tabIndex={-1}
              title="Arm Terminal Kamikaze Impact Dive [B]"
              onClick={(e) => {
                e.currentTarget.blur();
                onArmKamikaze();
              }}
              className={`px-2.5 py-2 rounded border text-xs font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                hud.kamikazeArmed
                  ? 'bg-rose-600 border-rose-400 text-white'
                  : 'bg-[#090e16]/95 hover:bg-rose-950/60 border-rose-500/60 text-rose-300'
              }`}
            >
              <Bomb className="w-3.5 h-3.5" />
              {hud.kamikazeArmed ? 'DIVE ARMED [B]' : 'Kamikaze [B]'}
            </button>
          )}

          <button
            type="button"
            tabIndex={-1}
            title="Deploy IR Flares & Chaff [F]"
            onClick={(e) => {
              e.currentTarget.blur();
              onDeployFlares();
            }}
            disabled={hud.flaresRemaining <= 0 || hud.flareCooldownSec > 0}
            className="px-2 py-2 rounded bg-[#090e16]/95 hover:bg-slate-800 disabled:opacity-50 border border-slate-700 text-amber-300 text-xs font-medium inline-flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Flame className="w-3.5 h-3.5" />
            Flares ({hud.flaresRemaining})
          </button>

          <button
            type="button"
            tabIndex={-1}
            title="Cycle & Lock Next Target [Tab]"
            onClick={(e) => {
              e.currentTarget.blur();
              onCycleTarget();
            }}
            className="px-2 py-2 rounded bg-[#090e16]/95 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-medium inline-flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Crosshair className="w-3.5 h-3.5 text-rose-400" />
            Lock
          </button>

          <button
            type="button"
            tabIndex={-1}
            title="Fire / Release Active Ordnance [Left Click / Space]"
            onClick={(e) => {
              e.currentTarget.blur();
              onFire();
            }}
            className="px-3 py-2 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-bold text-xs tracking-wide cursor-pointer whitespace-nowrap shrink-0"
          >
            Fire [LMB]
          </button>
        </div>
      </div>
    </div>
  );
};
