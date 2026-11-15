import React, { useState } from 'react';
import { BookOpen, X } from 'lucide-react';
import { AIRFRAMES, WEAPONS } from '../sim/arsenalData';
import { WeaponId } from '../sim/types';

interface OrdnanceInfographicsModalProps {
  open: boolean;
  onClose: () => void;
}

export const OrdnanceInfographicsModal: React.FC<OrdnanceInfographicsModalProps> = ({
  open,
  onClose,
}) => {
  const [selectedWeapon, setSelectedWeapon] = useState<WeaponId>('mam_l');

  if (!open) return null;

  const w = WEAPONS[selectedWeapon];

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-5xl bg-[#0b1118] border border-slate-700 rounded-lg shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <BookOpen className="w-5 h-5 text-amber-400" />
            <div>
              <h2 className="font-display text-xl font-bold text-white">
                Military Ordnance Data &amp; Ballistic Infographs
              </h2>
              <p className="text-xs text-slate-400">
                Real-world drone payloads from Ukraine, Israel, Iran, Russia, Syria &amp; NATO combat theaters
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close Ordnance Infographics"
            onClick={onClose}
            className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(WEAPONS) as WeaponId[]).map((id) => {
              const item = WEAPONS[id];
              const active = id === selectedWeapon;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSelectedWeapon(id)}
                  className={`px-3 py-1.5 rounded border text-xs font-medium transition-colors cursor-pointer ${
                    active
                      ? 'bg-amber-500/20 border-amber-400 text-amber-200 font-semibold'
                      : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  {item.natoCode}
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-[#070b10] border border-slate-800 rounded p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-sm font-bold text-white">{w.name}</div>
                  <div className="text-xs text-amber-400 font-mono-tabular">
                    {w.origin} · {w.flightProfileLabel}
                  </div>
                </div>
                <span className="text-xs font-mono-tabular text-slate-400">{w.natoCode}</span>
              </div>

              <svg viewBox="0 0 640 240" className="w-full h-56 bg-[#05080c] rounded border border-slate-800/80">
                <line x1="40" y1="205" x2="610" y2="205" stroke="#334155" strokeWidth="1.5" />
                <line x1="40" y1="20" x2="40" y2="205" stroke="#334155" strokeWidth="1.5" />
                <line x1="40" y1="145" x2="610" y2="145" stroke="#1e293b" strokeDasharray="4 4" />
                <line x1="40" y1="85" x2="610" y2="85" stroke="#1e293b" strokeDasharray="4 4" />

                <text x="10" y="30" fill="#64748b" fontSize="10" fontFamily="monospace">ALT</text>
                <text x="575" y="224" fill="#64748b" fontSize="10" fontFamily="monospace">RANGE</text>

                {w.category === 'ballistic_missile' && (
                  <>
                    <path d="M 60 155 Q 150 28 330 26 Q 500 28 575 202" fill="none" stroke="#f59e0b" strokeWidth="3" />
                    <path d="M 60 155 L 145 78" fill="none" stroke="#ef4444" strokeWidth="4.5" strokeLinecap="round" />
                    <circle cx="60" cy="155" r="5" fill="#38bdf8" />
                    <circle cx="330" cy="26" r="5" fill="#f59e0b" />
                    <circle cx="575" cy="202" r="6" fill="#ef4444" />
                    <text x="68" y="172" fill="#94a3b8" fontSize="10" fontFamily="monospace">1. Air Release</text>
                    <text x="120" y="68" fill="#fca5a5" fontSize="10" fontFamily="monospace">2. Solid Rocket Boost</text>
                    <text x="275" y="18" fill="#fcd34d" fontSize="10" fontFamily="monospace">3. Exo-Apogee / g(h)</text>
                    <text x="615" y="135" textAnchor="end" fill="#fdba74" fontSize="10" fontFamily="monospace">
                      4. Coriolis Terminal Dive (Mach {w.machMax})
                    </text>
                  </>
                )}

                {w.category === 'glide_bomb' && (
                  <>
                    <path d="M 60 62 Q 105 95 160 105 L 520 155 Q 555 165 575 202" fill="none" stroke="#06b6d4" strokeWidth="3" />
                    <circle cx="60" cy="62" r="5" fill="#38bdf8" />
                    <circle cx="130" cy="100" r="5" fill="#22d3ee" />
                    <circle cx="575" cy="202" r="6" fill="#ef4444" />
                    <text x="68" y="54" fill="#94a3b8" fontSize="10" fontFamily="monospace">1. Pylon Drop</text>
                    <text x="135" y="88" fill="#67e8f9" fontSize="10" fontFamily="monospace">2. Fin/Wing Deploy</text>
                    <text x="275" y="118" fill="#22d3ee" fontSize="10" fontFamily="monospace">
                      3. Standoff L/D {w.glideLiftToDrag}:1 Glide ({w.maxRangeKm} km)
                    </text>
                    <text x="450" y="188" fill="#fca5a5" fontSize="10" fontFamily="monospace">4. Laser / EO Homing</text>
                  </>
                )}

                {w.category === 'drop_bomb' && (
                  <>
                    <path d="M 110 56 Q 280 75 430 202" fill="none" stroke="#10b981" strokeWidth="3" />
                    <circle cx="110" cy="56" r="5" fill="#34d399" />
                    <circle cx="430" cy="202" r="6" fill="#ef4444" />
                    <text x="122" y="48" fill="#6ee7b7" fontSize="10" fontFamily="monospace">
                      1. Multi-Rack Bay Release (x{w.ammoPerSlot})
                    </text>
                    <text x="270" y="105" fill="#a7f3d0" fontSize="10" fontFamily="monospace">
                      2. Gravity Ballistic Drop + Wind Trim
                    </text>
                    <text x="442" y="196" fill="#fca5a5" fontSize="10" fontFamily="monospace">
                      3. HEATArmor Penetration ({w.warheadKg} kg)
                    </text>
                  </>
                )}

                {(w.category === 'cruise_missile' || w.category === 'atgm' || w.category === 'aam') && (
                  <>
                    <path d="M 60 100 L 140 135 L 480 138 Q 545 140 575 200" fill="none" stroke="#38bdf8" strokeWidth="3" />
                    <circle cx="60" cy="100" r="5" fill="#f59e0b" />
                    <circle cx="575" cy="200" r="6" fill="#ef4444" />
                    <text x="70" y="92" fill="#94a3b8" fontSize="10" fontFamily="monospace">1. Motor Ignition</text>
                    <text x="235" y="126" fill="#7dd3fc" fontSize="10" fontFamily="monospace">
                      2. Prop-Nav Sustainer (N&apos;={w.guidanceGain})
                    </text>
                    <text x="460" y="182" fill="#fca5a5" fontSize="10" fontFamily="monospace">3. Terminal Hit</text>
                  </>
                )}

                {w.category === 'cannon' && (
                  <>
                    <path d="M 60 110 Q 320 120 575 202" fill="none" stroke="#facc15" strokeWidth="2.5" strokeDasharray="6 4" />
                    <circle cx="60" cy="110" r="5" fill="#facc15" />
                    <circle cx="575" cy="202" r="6" fill="#ef4444" />
                    <text x="72" y="100" fill="#fef08a" fontSize="10" fontFamily="monospace">
                      Muzzle Velocity {w.initialSpeedMs} m/s · Gravity Drop &amp; Crosswind Drift
                    </text>
                  </>
                )}
              </svg>

              <p className="text-xs text-slate-300 mt-3 leading-relaxed">{w.summary}</p>
            </div>

            <div className="bg-slate-900/75 border border-slate-800 rounded p-4 font-mono-tabular space-y-2.5 text-xs">
              <div className="text-sm font-sans font-bold text-white mb-2">Ordnance Telemetry</div>
              {[
                ['Origin', w.origin],
                ['Total Mass', `${w.massKg} kg`],
                ['Warhead Yield', `${w.warheadKg} kg`],
                ['Blast Radius', `${w.blastRadiusM} m`],
                ['Max Range', `${w.maxRangeKm} km`],
                ['Peak Speed', `Mach ${w.machMax.toFixed(1)}`],
                ['Glide Ratio (L/D)', `${w.glideLiftToDrag.toFixed(1)} : 1`],
                ['Nominal CEP', `${w.cepMeters.toFixed(1)} m`],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between border-b border-slate-800/80 pb-1.5">
                  <span className="text-slate-400">{k}</span>
                  <span className="text-white font-semibold">{v}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-white mb-3">
              Global Combat UAV Airframe Military Reference Matrix
            </h3>
            <div className="overflow-x-auto border border-slate-800 rounded">
              <table className="w-full text-left text-xs font-mono-tabular">
                <thead className="bg-slate-900 text-slate-300">
                  <tr>
                    <th className="py-2.5 px-3 font-sans">Airframe</th>
                    <th className="py-2.5 px-3 font-sans">Operator</th>
                    <th className="py-2.5 px-3">Dry Mass</th>
                    <th className="py-2.5 px-3">Span</th>
                    <th className="py-2.5 px-3">Kamikaze WH</th>
                    <th className="py-2.5 px-3">Max G</th>
                    <th className="py-2.5 px-3">RCS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {Object.values(AIRFRAMES).map((a) => (
                    <tr key={a.id} className="bg-[#080d13] text-slate-200">
                      <td className="py-2.5 px-3 font-sans font-semibold text-amber-400">{a.name}</td>
                      <td className="py-2.5 px-3 font-sans text-slate-300">{a.origin}</td>
                      <td className="py-2.5 px-3">{a.dryMassKg} kg</td>
                      <td className="py-2.5 px-3">{a.wingspanM} m</td>
                      <td className="py-2.5 px-3 text-rose-300">{a.kamikazeWarheadKg} kg</td>
                      <td className="py-2.5 px-3">+{a.maxG}G</td>
                      <td className="py-2.5 px-3">{a.rcsM2} m²</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
