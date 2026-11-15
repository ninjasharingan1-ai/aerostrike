import React from 'react';
import { Flame, Radar, ShieldAlert, Zap } from 'lucide-react';
import { HudSnapshot } from '../sim/types';

interface ThreatWarningOverlayProps {
  hud: HudSnapshot;
  onPurgeCyber: () => void;
  onDeployFlares: () => void;
}

/**
 * Full-viewport screen-edge Radar Warning Receiver (RWR), Missile Approach Warning (MAW),
 * and Cyber Intrusion overlay using hud.incomingCyberThreat, hud.playerCyberDisruptedSec,
 * hud.missilesIncoming, and hud.radarLocked.
 */
export const ThreatWarningOverlay: React.FC<ThreatWarningOverlayProps> = ({
  hud,
  onPurgeCyber,
  onDeployFlares,
}) => {
  const missileThreat = hud.missilesIncoming > 0;
  const cyberThreat = Boolean(hud.incomingCyberThreat) || hud.playerCyberDisruptedSec > 0;
  const radarThreat = hud.radarLocked;

  if (!missileThreat && !cyberThreat && !radarThreat) return null;

  const isCritical = missileThreat || hud.playerCyberDisruptedSec > 0;

  const borderGlow = missileThreat
    ? 'inset 0 0 95px rgba(239, 68, 68, 0.55)'
    : cyberThreat
      ? 'inset 0 0 85px rgba(6, 182, 212, 0.45)'
      : 'inset 0 0 70px rgba(245, 158, 11, 0.35)';

  return (
    <div
      data-testid="threat-warning-overlay"
      className="fixed inset-0 z-15 pointer-events-none flex flex-col items-center justify-start pt-16 sm:pt-20 px-4"
      style={{ boxShadow: borderGlow }}
    >
      {/* Perimeter Corner Warning Brackets */}
      <div
        className={`fixed inset-3 border-2 rounded-sm pointer-events-none transition-opacity duration-150 ${
          missileThreat
            ? 'border-rose-500/80'
            : cyberThreat
              ? 'border-cyan-400/75'
              : 'border-amber-400/70'
        }`}
      />

      {/* Top-Center Compact RWR & Countermeasure Strip */}
      <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2.5">
        {missileThreat && (
          <div className="bg-[#1b080b]/95 border border-rose-500 rounded px-3.5 py-2 flex items-center gap-3 shadow-lg">
            <Radar className="w-4 h-4 text-rose-400 shrink-0" />
            <div className="font-mono-tabular">
              <div className="text-xs font-display font-bold tracking-wider text-rose-200">
                MISSILE LAUNCH · MAW ALERT ({hud.missilesIncoming})
              </div>
              <div className="text-[11px] text-rose-300/90">
                Break hard &amp; deploy IR flares immediately
              </div>
            </div>
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onDeployFlares();
              }}
              disabled={hud.flaresRemaining <= 0 || hud.flareCooldownSec > 0}
              className={`px-2.5 py-1 rounded text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                hud.flaresRemaining > 0 && hud.flareCooldownSec <= 0
                  ? 'bg-rose-500 hover:bg-rose-400 text-slate-950'
                  : 'bg-slate-800 text-slate-400 cursor-not-allowed'
              }`}
            >
              <Flame className="w-3.5 h-3.5" />
              Flares [F] ({hud.flaresRemaining})
            </button>
          </div>
        )}

        {radarThreat && !missileThreat && (
          <div className="bg-[#1b1407]/92 border border-amber-400 rounded px-3.5 py-1.5 flex items-center gap-2.5 shadow-lg">
            <Radar className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="font-mono-tabular text-xs font-bold text-amber-200 tracking-wide">
              SAM RADAR LOCK · IN THREAT ENVELOPE
            </span>
          </div>
        )}

        {cyberThreat && (
          <div className="bg-[#071921]/95 border border-cyan-400 rounded px-3.5 py-2 flex items-center gap-3 shadow-lg">
            {hud.playerCyberDisruptedSec > 0 ? (
              <Zap className="w-4 h-4 text-cyan-300 shrink-0" />
            ) : (
              <ShieldAlert className="w-4 h-4 text-cyan-300 shrink-0" />
            )}
            <div className="font-mono-tabular">
              <div className="text-xs font-display font-bold tracking-wider text-cyan-100">
                {hud.incomingCyberThreat
                  ? `HOSTILE CYBER LOCK: ${hud.incomingCyberThreat}`
                  : `AVIONICS C2 DISRUPTED (${hud.playerCyberDisruptedSec}s)`}
              </div>
              <div className="text-[11px] text-cyan-300/90">
                {isCritical ? 'Rotate datalink keys to clear EW intrusion' : 'EW packet signature detected'}
              </div>
            </div>
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onPurgeCyber();
              }}
              className="px-2.5 py-1 rounded bg-cyan-400 hover:bg-cyan-300 text-slate-950 text-[11px] font-bold cursor-pointer whitespace-nowrap"
            >
              Purge [X]
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
