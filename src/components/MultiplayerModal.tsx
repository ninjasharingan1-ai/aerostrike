import React, { useEffect, useState } from 'react';
import { RefreshCw, Users, Wifi, WifiOff, X } from 'lucide-react';
import { THEATERS } from '../sim/geoTheaters';
import { RemotePilotState, TheaterId } from '../sim/types';

interface ArenaSummary {
  theaterId: TheaterId;
  name: string;
  region: string;
  pilotCount: number;
  pilots: { id: string; callsign: string; airframeId: string; kills: number; team: string }[];
}

interface MultiplayerModalProps {
  open: boolean;
  wsConnected: boolean;
  callsign: string;
  theaterId: TheaterId;
  remotePilots: RemotePilotState[];
  onChangeCallsign: (name: string) => void;
  onJoinArena: (theaterId: TheaterId) => void;
  onResetArenaTargets: () => void;
  onClose: () => void;
}

export const MultiplayerModal: React.FC<MultiplayerModalProps> = ({
  open,
  wsConnected,
  callsign,
  theaterId,
  remotePilots,
  onChangeCallsign,
  onJoinArena,
  onResetArenaTargets,
  onClose,
}) => {
  const [arenas, setArenas] = useState<ArenaSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchArenas = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/arenas');
      if (res.ok) {
        const data = (await res.json()) as { arenas: ArenaSummary[] };
        setArenas(data.arenas);
      }
    } catch {
      // Ignore network hiccup
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) fetchArenas();
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-3xl bg-[#0b1118] border border-slate-700 rounded-lg shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <Users className="w-5 h-5 text-cyan-400" />
            <div>
              <h2 className="font-display text-xl font-bold text-white">
                Multiplayer Combat Arenas
              </h2>
              <div className="text-xs font-mono-tabular flex items-center gap-2 mt-0.5">
                {wsConnected ? (
                  <span className="text-cyan-400 inline-flex items-center gap-1">
                    <Wifi className="w-3.5 h-3.5" /> WebSocket Connected
                  </span>
                ) : (
                  <span className="text-amber-400 inline-flex items-center gap-1">
                    <WifiOff className="w-3.5 h-3.5" /> Reconnecting to Arena Server
                  </span>
                )}
                <span aria-hidden="true">·</span>
                <span className="text-slate-400">Active Room: {THEATERS[theaterId].name}</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            aria-label="Close Multiplayer Arenas"
            onClick={onClose}
            className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5">
          {/* Pilot Callsign Input */}
          <div className="flex flex-wrap items-end gap-3 bg-slate-900/75 border border-slate-800 rounded p-4">
            <div className="flex-1 min-w-[200px]">
              <label htmlFor="mp-callsign" className="block text-xs font-medium text-slate-300 mb-1.5">
                Pilot Callsign
              </label>
              <input
                id="mp-callsign"
                type="text"
                maxLength={16}
                value={callsign}
                onChange={(e) => onChangeCallsign(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-white font-mono-tabular focus:border-cyan-400 outline-none"
              />
            </div>
            <button
              type="button"
              onClick={fetchArenas}
              className="px-3.5 py-2 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh Roster
            </button>
            <button
              type="button"
              onClick={onResetArenaTargets}
              className="px-3.5 py-2 rounded border border-slate-700 hover:border-amber-400 text-xs text-amber-300 cursor-pointer"
            >
              Respawn Theater Targets
            </button>
          </div>

          {/* Arena Rooms */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(Object.keys(THEATERS) as TheaterId[]).map((id) => {
              const t = THEATERS[id];
              const summary = arenas.find((a) => a.theaterId === id);
              const isCurrent = id === theaterId;
              return (
                <div
                  key={id}
                  className={`p-4 rounded border transition-colors ${
                    isCurrent
                      ? 'bg-cyan-500/10 border-cyan-400'
                      : 'bg-slate-900/70 border-slate-800'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-bold text-white">{t.name}</div>
                      <div className="text-xs text-slate-400">{t.region}</div>
                    </div>
                    <span className="text-xs font-mono-tabular text-cyan-400 font-semibold">
                      {summary?.pilotCount ?? (isCurrent ? remotePilots.length + 1 : 0)} Pilots
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-2 line-clamp-2">{t.description}</p>
                  <button
                    type="button"
                    onClick={() => onJoinArena(id)}
                    className={`mt-3 w-full py-2 rounded text-xs font-semibold cursor-pointer ${
                      isCurrent
                        ? 'bg-cyan-500 text-slate-950 font-bold'
                        : 'bg-slate-800 hover:bg-slate-700 text-white'
                    }`}
                  >
                    {isCurrent ? 'Connected in Arena' : 'Deploy to Arena'}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Connected Pilots Roster */}
          <div className="border-t border-slate-800 pt-4">
            <h3 className="text-sm font-semibold text-white mb-2.5">
              Connected Pilots in {THEATERS[theaterId].name}
            </h3>
            <div className="space-y-2 text-xs font-mono-tabular">
              <div className="bg-slate-900/90 border border-slate-800 rounded px-3.5 py-2 flex items-center justify-between">
                <span className="text-amber-400 font-bold">{callsign || 'VANGUARD-1'} (You)</span>
                <span className="text-slate-400">Local Host</span>
              </div>
              {remotePilots.length === 0 ? (
                <div className="text-slate-400 py-2">
                  No other remote pilots currently in this room — open a second tab or share the URL to dogfight live, while AI Aggressors patrol the ridge.
                </div>
              ) : (
                remotePilots.map((rp) => (
                  <div
                    key={rp.id}
                    className="bg-slate-900/70 border border-slate-800 rounded px-3.5 py-2 flex items-center justify-between"
                  >
                    <span className="text-cyan-300 font-semibold">{rp.callsign}</span>
                    <span className="text-slate-400">
                      {rp.airframeId.toUpperCase()} · Alt {Math.round(rp.y)}m · Kills {rp.kills}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
