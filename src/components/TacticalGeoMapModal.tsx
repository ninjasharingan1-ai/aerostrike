import React, { useEffect, useRef, useState } from 'react';
import { Crosshair, Globe, X } from 'lucide-react';
import { getElevationProfile, groundHeightAt, THEATERS, worldToLatLon } from '../sim/geoTheaters';
import { TheaterId } from '../sim/types';

interface TacticalGeoMapModalProps {
  open: boolean;
  theaterId: TheaterId;
  dronePos: { x: number; z: number };
  onSelectTheater: (id: TheaterId) => void;
  onSetWaypoint: (x: number, z: number) => void;
  onClose: () => void;
}

type MapLayer = 'satellite' | 'contours' | 'threat';

export const TacticalGeoMapModal: React.FC<TacticalGeoMapModalProps> = ({
  open,
  theaterId,
  dronePos,
  onSelectTheater,
  onSetWaypoint,
  onClose,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [layer, setLayer] = useState<MapLayer>('satellite');
  const [waypoint, setWaypoint] = useState<{ x: number; z: number }>({ x: 0, z: -1400 });
  const [hoverCoord, setHoverCoord] = useState<{ lat: number; lon: number; elevM: number } | null>(null);

  const theater = THEATERS[theaterId];

  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = 480;
    const r = theater.worldRadiusM;
    const img = ctx.createImageData(size, size);

    // Render real shaded-relief DEM satellite + hypsometric + contour data
    for (let py = 0; py < size; py++) {
      const z = ((py / size) * 2 - 1) * r;
      for (let px = 0; px < size; px++) {
        const x = ((px / size) * 2 - 1) * r;
        const elev = groundHeightAt(theaterId, x, z);

        // Hillshade slope normal approximation
        const dx = groundHeightAt(theaterId, x + 28, z) - elev;
        const dz = groundHeightAt(theaterId, x, z + 28) - elev;
        const shade = Math.max(0.45, Math.min(1.25, 0.92 - (dx + dz) * 0.012));

        let cr = 40;
        let cg = 55;
        let cb = 45;

        if (elev <= theater.waterLevelM) {
          cr = 14;
          cg = 52;
          cb = 78;
        } else if (layer === 'contours') {
          const band = Math.floor(elev / 25) % 2;
          const isLine = Math.abs(elev % 25) < 2.2;
          if (isLine) {
            cr = 245;
            cg = 158;
            cb = 11;
          } else {
            cr = 18 + band * 10;
            cg = 28 + band * 12;
            cb = 38 + band * 14;
          }
        } else {
          // Satellite hypsometric relief per theater biome
          if (theaterId === 'edwards') {
            if (elev < 10) {
              cr = 188;
              cg = 172;
              cb = 145;
            } else if (elev < 120) {
              cr = 146;
              cg = 118;
              cb = 88;
            } else {
              cr = 110;
              cg = 90;
              cb = 74;
            }
          } else if (theaterId === 'alps') {
            if (elev < 50) {
              cr = 62;
              cg = 104;
              cb = 68;
            } else if (elev < 200) {
              cr = 78;
              cg = 88;
              cb = 70;
            } else if (elev < 350) {
              cr = 108;
              cg = 114;
              cb = 122;
            } else {
              cr = 228;
              cg = 236;
              cb = 244;
            }
          } else {
            cr = elev < 30 ? 72 : 124;
            cg = elev < 30 ? 105 : 112;
            cb = elev < 30 ? 74 : 88;
          }
          cr = Math.min(255, cr * shade);
          cg = Math.min(255, cg * shade);
          cb = Math.min(255, cb * shade);
        }

        const idx = (py * size + px) * 4;
        img.data[idx] = cr;
        img.data[idx + 1] = cg;
        img.data[idx + 2] = cb;
        img.data[idx + 3] = 255;
      }
    }

    ctx.putImageData(img, 0, 0);

    // Lat/Lon Graticule Grid
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 6; i++) {
      const pos = (i / 6) * size;
      ctx.beginPath();
      ctx.moveTo(pos, 0);
      ctx.lineTo(pos, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, pos);
      ctx.lineTo(size, pos);
      ctx.stroke();
    }

    const toPx = (wx: number, wz: number) => ({
      px: ((wx / r + 1) / 2) * size,
      py: ((wz / r + 1) / 2) * size,
    });

    // SAM / Radar Threat Rings
    if (layer === 'threat' || layer === 'satellite') {
      for (const lm of theater.landmarks) {
        const pt = toPx(lm.x, lm.z);
        if (lm.threatRadiusM) {
          const radPx = (lm.threatRadiusM / (r * 2)) * size;
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.65)';
          ctx.fillStyle = 'rgba(239, 68, 68, 0.12)';
          ctx.beginPath();
          ctx.arc(pt.px, pt.py, radPx, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        ctx.fillStyle = lm.type === 'airbase' ? '#38bdf8' : '#ef4444';
        ctx.fillRect(pt.px - 4, pt.py - 4, 8, 8);
      }
    }

    // Route Line & Waypoint Marker
    const dp = toPx(dronePos.x, dronePos.z);
    const wp = toPx(waypoint.x, waypoint.z);
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 1.8;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(dp.px, dp.py);
    ctx.lineTo(wp.px, wp.py);
    ctx.stroke();
    ctx.setLineDash([]);

    // Player Drone Marker
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(dp.px, dp.py, 5.5, 0, Math.PI * 2);
    ctx.fill();

    // Strike Waypoint Crosshair
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(wp.px, wp.py, 8, 0, Math.PI * 2);
    ctx.stroke();
  }, [open, theaterId, layer, dronePos.x, dronePos.z, waypoint.x, waypoint.z, theater]);

  if (!open) return null;

  const profile = getElevationProfile(theaterId, dronePos.x, dronePos.z, waypoint.x, waypoint.z, 28);
  const maxElev = Math.max(100, ...profile.map((p) => p.elevM));

  const handleCanvasEvent = (e: React.MouseEvent<HTMLCanvasElement>, commit: boolean) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const nz = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    const wx = nx * theater.worldRadiusM;
    const wz = nz * theater.worldRadiusM;
    const coord = worldToLatLon(theaterId, wx, wz);
    const elevM = Math.round(groundHeightAt(theaterId, wx, wz) + theater.baseElevationM);
    setHoverCoord({ ...coord, elevM });
    if (commit) {
      setWaypoint({ x: wx, z: wz });
      onSetWaypoint(wx, wz);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-5xl bg-[#0b1118] border border-slate-700 rounded-lg shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <Globe className="w-5 h-5 text-sky-400" />
            <div>
              <h2 className="font-display text-xl font-bold text-white">
                Real-World Topographical &amp; Satellite Mission Map
              </h2>
              <p className="text-xs text-slate-400 font-mono-tabular">
                {theater.name} · {theater.latDeg.toFixed(4)}° N, {theater.lonDeg.toFixed(4)}° E
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded">
              {(
                [
                  ['satellite', 'Satellite Relief'],
                  ['contours', 'Topo Contours'],
                  ['threat', 'SAM Threats'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setLayer(id)}
                  className={`px-3 py-1 rounded text-xs font-medium cursor-pointer whitespace-nowrap ${
                    layer === id ? 'bg-sky-500 text-slate-950 font-bold' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              aria-label="Close Topographical Map"
              onClick={onClose}
              className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Interactive DEM Relief Map Canvas */}
          <div className="lg:col-span-2 flex flex-col items-center">
            <canvas
              ref={canvasRef}
              width={480}
              height={480}
              onMouseMove={(e) => handleCanvasEvent(e, false)}
              onClick={(e) => handleCanvasEvent(e, true)}
              className="w-full max-w-[480px] aspect-square rounded border border-slate-700 cursor-crosshair"
            />
            <div className="mt-2.5 flex flex-wrap items-center justify-between w-full max-w-[480px] text-xs font-mono-tabular text-slate-300">
              <span>Click anywhere to set CCRP Strike Waypoint</span>
              {hoverCoord && (
                <span className="text-sky-400">
                  {hoverCoord.lat.toFixed(4)}°, {hoverCoord.lon.toFixed(4)}° · {hoverCoord.elevM}m MSL
                </span>
              )}
            </div>
          </div>

          {/* Theater Selector & Elevation Profile */}
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-white mb-2">Theater Selection</h3>
              <div className="space-y-2">
                {(Object.keys(THEATERS) as TheaterId[]).map((id) => {
                  const t = THEATERS[id];
                  const active = id === theaterId;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onSelectTheater(id)}
                      className={`w-full p-2.5 rounded border text-left transition-colors cursor-pointer ${
                        active
                          ? 'bg-sky-500/15 border-sky-400 text-white'
                          : 'bg-slate-900/70 border-slate-800 text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      <div className="text-xs font-semibold">{t.name}</div>
                      <div className="text-[11px] text-slate-400 font-mono-tabular">
                        {t.region} · {t.latDeg.toFixed(2)}°N {t.lonDeg.toFixed(2)}°E
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Terrain Elevation Cross-Section along Drone -> Waypoint */}
            <div className="bg-slate-900/80 border border-slate-800 rounded p-3.5">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="font-semibold text-white flex items-center gap-1.5">
                  <Crosshair className="w-3.5 h-3.5 text-amber-400" />
                  DEM Elevation Profile
                </span>
                <span className="font-mono-tabular text-slate-400">
                  {Math.round(profile[profile.length - 1]?.distM ?? 0)} m
                </span>
              </div>
              <svg viewBox="0 0 260 90" className="w-full h-24 bg-[#060a0f] rounded border border-slate-800">
                <polygon
                  points={`0,90 ${profile
                    .map((pt, i) => {
                      const x = (i / Math.max(1, profile.length - 1)) * 260;
                      const y = 85 - (Math.max(0, pt.elevM) / maxElev) * 70;
                      return `${x.toFixed(1)},${y.toFixed(1)}`;
                    })
                    .join(' ')} 260,90`}
                  fill="rgba(56, 189, 248, 0.25)"
                  stroke="#38bdf8"
                  strokeWidth="1.5"
                />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
