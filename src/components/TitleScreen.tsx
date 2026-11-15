import React, { useEffect } from 'react';
import { Crosshair, Globe, Layers, Play, Sliders, Users, Wrench } from 'lucide-react';
import { AIRFRAMES, WEATHERS } from '../sim/arsenalData';
import { THEATERS } from '../sim/geoTheaters';
import { AirframeId, TheaterId, WeatherId } from '../sim/types';

interface TitleScreenProps {
  theaterId: TheaterId;
  weatherId: WeatherId;
  airframeId: AirframeId;
  pilotRank: number;
  pilotsOnline: number;
  onStartMission: () => void;
  onOpenHangar: () => void;
  onOpenGeoMap: () => void;
  onOpenMultiplayer: () => void;
  onOpenSettings: () => void;
  onSelectTheater: (id: TheaterId) => void;
}

export const TitleScreen: React.FC<TitleScreenProps> = ({
  theaterId,
  weatherId,
  airframeId,
  pilotRank,
  pilotsOnline,
  onStartMission,
  onOpenHangar,
  onOpenGeoMap,
  onOpenMultiplayer,
  onOpenSettings,
  onSelectTheater,
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        onStartMission();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onStartMission]);

  const theater = THEATERS[theaterId];
  const weather = WEATHERS[weatherId];
  const airframe = AIRFRAMES[airframeId];

  return (
    <div className="fixed inset-0 z-20 pointer-events-none flex flex-col justify-between p-6 md:p-10">
      {/* Scrim for guaranteed legibility over live 3D terrain & bright sky */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            'linear-gradient(95deg, rgba(6,10,15,0.88) 0%, rgba(6,10,15,0.52) 44%, rgba(6,10,15,0.08) 100%)',
        }}
      />

      {/* Top metadata line */}
      <div className="relative z-10 flex items-center justify-between text-xs text-slate-200 font-mono-tabular hud-text-shadow">
        <div className="flex items-center gap-3">
          <span>{theater.latDeg.toFixed(4)}° N, {theater.lonDeg.toFixed(4)}° E</span>
          <span aria-hidden="true">·</span>
          <span>{weather.name}</span>
          <span aria-hidden="true">·</span>
          <span>Rank {pilotRank}</span>
        </div>
        <div className="hidden sm:flex items-center gap-3 text-slate-100 bg-[#080c10]/70 px-3 py-1 rounded">
          <span>
            {pilotsOnline} {pilotsOnline === 1 ? 'Pilot' : 'Pilots'} Connected
          </span>
        </div>
      </div>

      {/* Asymmetric left-third title & mission controls */}
      <div className="relative z-10 max-w-2xl my-auto pointer-events-auto">
        <div className="flex items-center gap-4 mb-4">
          <svg
            viewBox="0 0 64 64"
            className="w-12 h-12 shrink-0 text-amber-500"
            fill="none"
            aria-hidden="true"
          >
            <polygon
              points="32,4 58,44 38,38 32,58 26,38 6,44"
              fill="currentColor"
              fillOpacity="0.16"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinejoin="round"
            />
            <line x1="32" y1="12" x2="32" y2="50" stroke="#f8fafc" strokeWidth="1.5" />
            <circle cx="32" cy="30" r="3" fill="#f59e0b" />
          </svg>
          <div>
            <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-white hud-text-shadow">
              AEROSTRIKE
            </h1>
            <p className="text-xs sm:text-sm text-amber-400 font-mono-tabular tracking-wider">
              MODERN DRONE WARFARE &amp; BALLISTICS SIMULATOR
            </p>
          </div>
        </div>

        <p className="text-sm sm:text-base text-slate-200 leading-relaxed max-w-md mb-6 hud-text-shadow">
          Pilot authentic Ukrainian, Israeli, Iranian, Russian &amp; Syrian combat UAVs with modular pylon ordnance,
          loitering kamikaze terminal strikes, AAA flak defenses, EW cyber warfare, and live multiplayer arenas.
        </p>

        {/* Theater quick selector */}
        <div className="mb-6">
          <label
            htmlFor="title-theater-select"
            className="block text-xs text-slate-300 font-medium mb-2"
          >
            Operational Theater
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(Object.keys(THEATERS) as TheaterId[]).map((id) => {
              const active = id === theaterId;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onSelectTheater(id)}
                  className={`px-3 py-2 text-left rounded border text-xs transition-colors whitespace-nowrap truncate cursor-pointer ${
                    active
                      ? 'bg-amber-500/20 border-amber-400 text-amber-200 font-semibold'
                      : 'bg-[#0b1118]/85 border-slate-700/80 text-slate-300 hover:border-slate-500 hover:text-white'
                  }`}
                >
                  {THEATERS[id].name.split('/')[0].split(' ')[0]}
                </button>
              );
            })}
          </div>
          <div className="mt-2 text-xs text-slate-300 flex flex-wrap items-center gap-2">
            <span>{airframe.name} ({airframe.origin})</span>
            <span aria-hidden="true">·</span>
            <span>{theater.landmarks.length} Tactical Targets</span>
            <span aria-hidden="true">·</span>
            <span>3 Squadron Units</span>
          </div>
        </div>

        {/* Primary CTA + Secondary Actions */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            data-start="true"
            onClick={onStartMission}
            className="inline-flex items-center gap-2.5 px-6 py-3 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-bold text-sm tracking-wide transition-colors shadow-lg cursor-pointer whitespace-nowrap shrink-0"
          >
            <Play className="w-4 h-4 fill-current" />
            Launch Mission
          </button>

          <button
            type="button"
            onClick={onOpenHangar}
            className="inline-flex items-center gap-2 px-4 py-3 rounded bg-[#0e151f]/90 hover:bg-slate-800 border border-slate-700 text-slate-100 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Wrench className="w-4 h-4 text-amber-400" />
            Hangar &amp; Ammo
          </button>

          <button
            type="button"
            onClick={onOpenGeoMap}
            className="inline-flex items-center gap-2 px-4 py-3 rounded bg-[#0e151f]/90 hover:bg-slate-800 border border-slate-700 text-slate-100 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Globe className="w-4 h-4 text-sky-400" />
            Topo Map
          </button>

          <button
            type="button"
            onClick={onOpenMultiplayer}
            className="inline-flex items-center gap-2 px-4 py-3 rounded bg-[#0e151f]/90 hover:bg-slate-800 border border-slate-700 text-slate-100 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Users className="w-4 h-4 text-cyan-400" />
            Arena
          </button>

          <button
            type="button"
            onClick={onOpenSettings}
            className="inline-flex items-center gap-2 px-4 py-3 rounded bg-[#0e151f]/90 hover:bg-slate-800 border border-slate-700 text-slate-100 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Sliders className="w-4 h-4 text-emerald-400" />
            Settings [O]
          </button>
        </div>
      </div>

      {/* Single flat control hint line */}
      <div className="relative z-10 flex items-center justify-between text-xs text-slate-100 font-mono-tabular hud-text-shadow bg-[#080c10]/55 px-3 py-1.5 rounded">
        <div className="flex flex-wrap items-center gap-3">
          <span>Mouse Aim Steer</span>
          <span aria-hidden="true">·</span>
          <span>Hold C Free-Look</span>
          <span aria-hidden="true">·</span>
          <span>LMB/Space Fire</span>
          <span aria-hidden="true">·</span>
          <span>B Kamikaze Dive</span>
          <span aria-hidden="true">·</span>
          <span>RMB/Z Zoom</span>
          <span aria-hidden="true">·</span>
          <span>Scroll/Shift WEP</span>
          <span aria-hidden="true">·</span>
          <span>F Flares</span>
          <span aria-hidden="true">·</span>
          <span>Tab Lock</span>
        </div>
        <div className="hidden md:flex items-center gap-2 text-amber-300 shrink-0">
          <Layers className="w-3.5 h-3.5" />
          <Crosshair className="w-3.5 h-3.5" />
          <span>Enter or Space to Launch</span>
        </div>
      </div>
    </div>
  );
};
