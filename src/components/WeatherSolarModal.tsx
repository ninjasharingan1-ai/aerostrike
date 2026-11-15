import React from 'react';
import { CloudSun, Compass, Sun, Wind, X } from 'lucide-react';
import { WEATHERS } from '../sim/arsenalData';
import { THEATERS } from '../sim/geoTheaters';
import { computeAtmosphericGravity, computeSolarState } from '../sim/solarGravity';
import { TheaterId, WeatherId } from '../sim/types';

interface WeatherSolarModalProps {
  open: boolean;
  theaterId: TheaterId;
  weatherId: WeatherId;
  utcHours: number;
  altitudeM: number;
  onSelectWeather: (id: WeatherId) => void;
  onChangeUtcHours: (hours: number) => void;
  onClose: () => void;
}

export const WeatherSolarModal: React.FC<WeatherSolarModalProps> = ({
  open,
  theaterId,
  weatherId,
  utcHours,
  altitudeM,
  onSelectWeather,
  onChangeUtcHours,
  onClose,
}) => {
  if (!open) return null;

  const theater = THEATERS[theaterId];
  const weather = WEATHERS[weatherId];
  const solar = computeSolarState(theater.latDeg, theater.lonDeg, utcHours, 172, weather.cloudCover);
  const atmos = computeAtmosphericGravity(theater.latDeg, altitudeM, 100, 0);

  const formatUtc = (h: number) => {
    const hrs = Math.floor(h);
    const mins = Math.round((h - hrs) * 60);
    return `${String(hrs).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')} UTC`;
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-2xl bg-[#0b1118] border border-slate-700 rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <CloudSun className="w-5 h-5 text-amber-400" />
            <h2 className="font-display text-xl font-bold text-white">
              Dynamic Weather &amp; Solar-Gravitational Model
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close Weather and Solar Deck"
            onClick={onClose}
            className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6">
          {/* Weather Presets */}
          <div>
            <h3 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
              <Wind className="w-4 h-4 text-sky-400" />
              Atmospheric Weather Presets
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {(Object.keys(WEATHERS) as WeatherId[]).map((id) => {
                const w = WEATHERS[id];
                const active = id === weatherId;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onSelectWeather(id)}
                    className={`p-3 rounded border text-left transition-colors cursor-pointer ${
                      active
                        ? 'bg-amber-500/15 border-amber-400 text-white'
                        : 'bg-slate-900/70 border-slate-800 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span>{w.name}</span>
                      <span className="font-mono-tabular text-sky-400">
                        {Math.round(w.windSpeedMs * 1.94)} kt
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1 leading-snug">{w.description}</p>
                    <div className="mt-2 text-[11px] font-mono-tabular text-slate-400">
                      Turb {Math.round(w.turbulenceIntensity * 100)}% · Vis {(w.visibilityM / 1000).toFixed(1)}km · IR Loss {Math.round(w.irAttenuation * 100)}%
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Solar Ephemeris & UTC Time Control */}
          <div className="border-t border-slate-800 pt-5">
            <div className="flex items-center justify-between mb-2">
              <label htmlFor="utc-solar-slider" className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Sun className="w-4 h-4 text-amber-400" />
                Astronomical Solar Ephemeris Time
              </label>
              <span className="font-mono-tabular text-sm font-bold text-amber-400">
                {formatUtc(utcHours)}
              </span>
            </div>
            <input
              id="utc-solar-slider"
              type="range"
              min={0}
              max={23.9}
              step={0.1}
              value={utcHours}
              onChange={(e) => onChangeUtcHours(Number(e.target.value))}
              className="w-full accent-amber-500 cursor-pointer"
            />

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 font-mono-tabular">
              <div className="bg-slate-900/80 border border-slate-800 rounded p-2.5">
                <div className="text-[11px] text-slate-400">Solar Elevation</div>
                <div className="text-base font-bold text-white">{solar.elevationDeg.toFixed(1)}°</div>
              </div>
              <div className="bg-slate-900/80 border border-slate-800 rounded p-2.5">
                <div className="text-[11px] text-slate-400">Solar Azimuth</div>
                <div className="text-base font-bold text-white">{solar.azimuthDeg.toFixed(1)}°</div>
              </div>
              <div className="bg-slate-900/80 border border-slate-800 rounded p-2.5">
                <div className="text-[11px] text-slate-400">Solar Flux</div>
                <div className="text-base font-bold text-amber-400">{Math.round(solar.irradianceWm2)} W/m²</div>
              </div>
              <div className="bg-slate-900/80 border border-slate-800 rounded p-2.5">
                <div className="text-[11px] text-slate-400">Thermal Updraft</div>
                <div className="text-base font-bold text-sky-400">+{solar.thermalUpdraftMs.toFixed(2)} m/s</div>
              </div>
            </div>
          </div>

          {/* WGS84 Somigliana Gravity & Coriolis Readout */}
          <div className="border-t border-slate-800 pt-5">
            <h3 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
              <Compass className="w-4 h-4 text-cyan-400" />
              WGS84 Gravitational &amp; Atmospheric State ({theater.latDeg.toFixed(2)}° Lat)
            </h3>
            <div className="grid grid-cols-3 gap-3 font-mono-tabular">
              <div className="bg-slate-900/80 border border-slate-800 rounded p-2.5">
                <div className="text-[11px] text-slate-400">Local Gravity g</div>
                <div className="text-base font-bold text-white">{atmos.localGravityMs2.toFixed(4)} m/s²</div>
              </div>
              <div className="bg-slate-900/80 border border-slate-800 rounded p-2.5">
                <div className="text-[11px] text-slate-400">ISA Air Density</div>
                <div className="text-base font-bold text-white">{atmos.airDensityKgM3.toFixed(3)} kg/m³</div>
              </div>
              <div className="bg-slate-900/80 border border-slate-800 rounded p-2.5">
                <div className="text-[11px] text-slate-400">Speed of Sound</div>
                <div className="text-base font-bold text-white">{Math.round(atmos.speedOfSoundMs)} m/s</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
