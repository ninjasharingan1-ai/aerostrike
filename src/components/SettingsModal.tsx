import React, { useState } from 'react';
import { Gamepad2, Keyboard, Monitor, RotateCcw, Sliders, X } from 'lucide-react';
import {
  applyGraphicsPreset,
  DEFAULT_SETTINGS,
  GameSettings,
  GraphicsPreset,
} from '../sim/settings';

interface SettingsModalProps {
  open: boolean;
  settings: GameSettings;
  onChangeSettings: (next: GameSettings) => void;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  settings,
  onChangeSettings,
  onClose,
}) => {
  const [tab, setTab] = useState<'controls' | 'graphics' | 'gameplay'>('controls');

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-4xl bg-[#0b1118] border border-slate-700 rounded-lg shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <Sliders className="w-5 h-5 text-amber-400" />
            <div>
              <h2 className="font-display text-xl font-bold text-white">
                Controls, Graphics &amp; Gameplay Settings
              </h2>
              <p className="text-xs text-slate-400">
                Customize Mouse-Aim Instructor, rendering quality, and combat flight simulation rules
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 p-1 bg-slate-900 rounded border border-slate-800">
              <button
                type="button"
                onClick={() => setTab('controls')}
                className={`px-3 py-1.5 rounded text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                  tab === 'controls' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-300 hover:text-white'
                }`}
              >
                <Keyboard className="w-3.5 h-3.5" />
                Controls
              </button>
              <button
                type="button"
                onClick={() => setTab('graphics')}
                className={`px-3 py-1.5 rounded text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                  tab === 'graphics' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-300 hover:text-white'
                }`}
              >
                <Monitor className="w-3.5 h-3.5" />
                Graphics
              </button>
              <button
                type="button"
                onClick={() => setTab('gameplay')}
                className={`px-3 py-1.5 rounded text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                  tab === 'gameplay' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-300 hover:text-white'
                }`}
              >
                <Gamepad2 className="w-3.5 h-3.5" />
                Gameplay
              </button>
            </div>
            <button
              type="button"
              aria-label="Close Settings"
              onClick={onClose}
              className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {tab === 'controls' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-white">Flight Control Mode</h3>
                <div className="grid grid-cols-1 gap-2.5">
                  <button
                    type="button"
                    onClick={() =>
                      onChangeSettings({
                        ...settings,
                        controls: { ...settings.controls, scheme: 'mouse_aim' },
                      })
                    }
                    className={`p-3.5 rounded border text-left transition-colors cursor-pointer ${
                      settings.controls.scheme === 'mouse_aim'
                        ? 'bg-amber-500/15 border-amber-400 text-white'
                        : 'bg-slate-900/75 border-slate-800 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    <div className="text-xs font-bold text-amber-300">
                      Mouse Aim + Instructor (Recommended)
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Steer with mouse cursor reticle while the Instructor coordinates bank-and-pitch turns. Use W/S/A/D anytime for manual override.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      onChangeSettings({
                        ...settings,
                        controls: { ...settings.controls, scheme: 'direct_stick' },
                      })
                    }
                    className={`p-3.5 rounded border text-left transition-colors cursor-pointer ${
                      settings.controls.scheme === 'direct_stick'
                        ? 'bg-amber-500/15 border-amber-400 text-white'
                        : 'bg-slate-900/75 border-slate-800 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    <div className="text-xs font-bold text-sky-300">
                      Direct Keyboard Stick (Full Manual)
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Classic W/S pitch, A/D roll, and Q/E rudder without Mouse-Aim Instructor assistance.
                    </p>
                  </button>
                </div>

                <div className="bg-slate-900/75 border border-slate-800 rounded p-3.5 space-y-3">
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <label htmlFor="mouse-sens" className="text-slate-200 font-medium">
                        Mouse Aim Sensitivity
                      </label>
                      <span className="font-mono-tabular text-amber-400 font-bold">
                        {settings.controls.mouseSensitivity.toFixed(2)}x
                      </span>
                    </div>
                    <input
                      id="mouse-sens"
                      type="range"
                      min={0.4}
                      max={2.2}
                      step={0.05}
                      value={settings.controls.mouseSensitivity}
                      onChange={(e) =>
                        onChangeSettings({
                          ...settings,
                          controls: {
                            ...settings.controls,
                            mouseSensitivity: Number(e.target.value),
                          },
                        })
                      }
                      className="w-full accent-amber-400 cursor-pointer"
                    />
                  </div>

                  <label className="flex items-center justify-between text-xs text-slate-200 cursor-pointer">
                    <span>Invert Mouse &amp; Pitch Y-Axis</span>
                    <input
                      type="checkbox"
                      checked={settings.controls.invertY}
                      onChange={(e) =>
                        onChangeSettings({
                          ...settings,
                          controls: { ...settings.controls, invertY: e.target.checked },
                        })
                      }
                      className="w-4 h-4 accent-amber-400"
                    />
                  </label>

                  <label className="flex items-center justify-between text-xs text-slate-200 cursor-pointer">
                    <span>Instructor Wing Auto-Level</span>
                    <input
                      type="checkbox"
                      checked={settings.controls.instructorAutoLevel}
                      onChange={(e) =>
                        onChangeSettings({
                          ...settings,
                          controls: {
                            ...settings.controls,
                            instructorAutoLevel: e.target.checked,
                          },
                        })
                      }
                      className="w-4 h-4 accent-amber-400"
                    />
                  </label>
                </div>
              </div>

              {/* Keybind Reference */}
              <div className="bg-slate-900/75 border border-slate-800 rounded p-4">
                <h3 className="text-sm font-semibold text-white mb-3">PC Gamer Bindings</h3>
                <div className="space-y-2 text-xs font-mono-tabular">
                  {[
                    ['Mouse Move', 'Steer Aim Reticle (Mouse Aim)'],
                    ['Left Click / Space', 'Fire / Release Active Ordnance'],
                    ['Right Click / Z', 'Toggle Sniper Target Zoom'],
                    ['Scroll Wheel / Shift / Ctrl', 'Throttle & WEP (110%)'],
                    ['W / S / A / D / Q / E', 'Manual Pitch / Roll / Rudder Override'],
                    ['1 – 4', 'Select Hardpoint Ordnance Slot'],
                    ['Tab', 'Cycle & Lock Next Target'],
                    ['F', 'Deploy IR Flares & Chaff'],
                    ['Hold C', 'Free-Look Around Aircraft'],
                    ['U / K / H / O', 'Camera / Cyber EW / Hangar / Settings'],
                  ].map(([k, desc]) => (
                    <div
                      key={k}
                      className="flex items-center justify-between gap-2 py-1 border-b border-slate-800/70 last:border-0"
                    >
                      <span className="text-amber-300 font-semibold">{k}</span>
                      <span className="text-slate-300 text-right">{desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'graphics' && (
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-semibold text-white mb-2.5">Visual Quality Preset</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {(['low', 'balanced', 'high', 'ultra'] as GraphicsPreset[]).map((preset) => {
                    const active = settings.graphics.preset === preset;
                    return (
                      <button
                        key={preset}
                        type="button"
                        onClick={() =>
                          onChangeSettings({
                            ...settings,
                            graphics: applyGraphicsPreset(preset),
                          })
                        }
                        className={`px-3 py-2.5 rounded border text-xs font-semibold capitalize cursor-pointer ${
                          active
                            ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                            : 'bg-slate-900/75 border-slate-800 text-slate-300 hover:border-slate-600'
                        }`}
                      >
                        {preset}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-slate-900/75 border border-slate-800 rounded p-3.5">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <label htmlFor="gfx-res" className="text-slate-200 font-medium">
                      Render Resolution Scale
                    </label>
                    <span className="font-mono-tabular text-sky-400 font-bold">
                      {Math.round(settings.graphics.resolutionScale * 100)}%
                    </span>
                  </div>
                  <input
                    id="gfx-res"
                    type="range"
                    min={0.6}
                    max={1.5}
                    step={0.05}
                    value={settings.graphics.resolutionScale}
                    onChange={(e) =>
                      onChangeSettings({
                        ...settings,
                        graphics: {
                          ...settings.graphics,
                          resolutionScale: Number(e.target.value),
                        },
                      })
                    }
                    className="w-full accent-sky-400 cursor-pointer"
                  />
                </div>

                <div className="bg-slate-900/75 border border-slate-800 rounded p-3.5">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <label htmlFor="gfx-fov" className="text-slate-200 font-medium">
                      Cockpit / Chase Base FOV
                    </label>
                    <span className="font-mono-tabular text-sky-400 font-bold">
                      {settings.graphics.fovDeg}°
                    </span>
                  </div>
                  <input
                    id="gfx-fov"
                    type="range"
                    min={54}
                    max={84}
                    step={1}
                    value={settings.graphics.fovDeg}
                    onChange={(e) =>
                      onChangeSettings({
                        ...settings,
                        graphics: { ...settings.graphics, fovDeg: Number(e.target.value) },
                      })
                    }
                    className="w-full accent-sky-400 cursor-pointer"
                  />
                </div>

                <div className="bg-slate-900/75 border border-slate-800 rounded p-3.5">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <label htmlFor="gfx-exp" className="text-slate-200 font-medium">
                      ACES Filmic Exposure
                    </label>
                    <span className="font-mono-tabular text-sky-400 font-bold">
                      {settings.graphics.exposure.toFixed(2)}
                    </span>
                  </div>
                  <input
                    id="gfx-exp"
                    type="range"
                    min={0.85}
                    max={1.4}
                    step={0.05}
                    value={settings.graphics.exposure}
                    onChange={(e) =>
                      onChangeSettings({
                        ...settings,
                        graphics: { ...settings.graphics, exposure: Number(e.target.value) },
                      })
                    }
                    className="w-full accent-sky-400 cursor-pointer"
                  />
                </div>

                <div className="bg-slate-900/75 border border-slate-800 rounded p-3.5 flex flex-col justify-center gap-3">
                  <label className="flex items-center justify-between text-xs text-slate-200 cursor-pointer">
                    <span>Dynamic Sun Shadows</span>
                    <input
                      type="checkbox"
                      checked={settings.graphics.shadows}
                      onChange={(e) =>
                        onChangeSettings({
                          ...settings,
                          graphics: { ...settings.graphics, shadows: e.target.checked },
                        })
                      }
                      className="w-4 h-4 accent-sky-400"
                    />
                  </label>
                  <label className="flex items-center justify-between text-xs text-slate-200 cursor-pointer">
                    <span>High-Altitude Cloud Layer</span>
                    <input
                      type="checkbox"
                      checked={settings.graphics.clouds}
                      onChange={(e) =>
                        onChangeSettings({
                          ...settings,
                          graphics: { ...settings.graphics, clouds: e.target.checked },
                        })
                      }
                      className="w-4 h-4 accent-sky-400"
                    />
                  </label>
                </div>
              </div>
            </div>
          )}

          {tab === 'gameplay' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-white">Aerodynamic Flight Model</h3>
                <button
                  type="button"
                  onClick={() =>
                    onChangeSettings({
                      ...settings,
                      gameplay: { ...settings.gameplay, flightModel: 'arcade' },
                    })
                  }
                  className={`w-full p-3.5 rounded border text-left cursor-pointer ${
                    settings.gameplay.flightModel === 'arcade'
                      ? 'bg-emerald-500/15 border-emerald-400 text-white'
                      : 'bg-slate-900/75 border-slate-800 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  <div className="text-xs font-bold text-emerald-300">
                    Air Combat Arcade (War Thunder AB-Inspired)
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Boosted turn authority, 110% WEP afterburner throttle, forgiving stall cushion, and crisp dive-to-climb energy retention.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onChangeSettings({
                      ...settings,
                      gameplay: { ...settings.gameplay, flightModel: 'realistic' },
                    })
                  }
                  className={`w-full p-3.5 rounded border text-left cursor-pointer ${
                    settings.gameplay.flightModel === 'realistic'
                      ? 'bg-emerald-500/15 border-emerald-400 text-white'
                      : 'bg-slate-900/75 border-slate-800 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  <div className="text-xs font-bold text-amber-300">
                    Realistic 6-DOF Sim (RB/SB Envelope)
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    True wing loading drag, genuine AoA stall departure, and full atmospheric turbulence shear.
                  </p>
                </button>
              </div>

              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-white">Avionics &amp; HUD Preferences</h3>
                <div className="bg-slate-900/75 border border-slate-800 rounded p-4 space-y-3">
                  <div>
                    <div className="text-xs text-slate-300 mb-2 font-medium">Airspeed &amp; Altitude Units</div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { id: 'knots_m' as const, label: 'Knots / Meters' },
                        { id: 'kmh_ft' as const, label: 'km/h / Feet' },
                      ].map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() =>
                            onChangeSettings({
                              ...settings,
                              gameplay: { ...settings.gameplay, hudUnits: u.id },
                            })
                          }
                          className={`px-3 py-1.5 rounded border text-xs font-medium cursor-pointer ${
                            settings.gameplay.hudUnits === u.id
                              ? 'bg-sky-500/20 border-sky-400 text-sky-200'
                              : 'bg-slate-950 border-slate-700 text-slate-400'
                          }`}
                        >
                          {u.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="flex items-center justify-between text-xs text-slate-200 cursor-pointer pt-1">
                    <span>Aerial Target Lead Indicator Pip</span>
                    <input
                      type="checkbox"
                      checked={settings.gameplay.showLeadIndicator}
                      onChange={(e) =>
                        onChangeSettings({
                          ...settings,
                          gameplay: { ...settings.gameplay, showLeadIndicator: e.target.checked },
                        })
                      }
                      className="w-4 h-4 accent-sky-400"
                    />
                  </label>

                  <label className="flex items-center justify-between text-xs text-slate-200 cursor-pointer">
                    <span>RWR Lock &amp; Launch Audio Alerts</span>
                    <input
                      type="checkbox"
                      checked={settings.gameplay.radarWarningAudio}
                      onChange={(e) =>
                        onChangeSettings({
                          ...settings,
                          gameplay: { ...settings.gameplay, radarWarningAudio: e.target.checked },
                        })
                      }
                      className="w-4 h-4 accent-sky-400"
                    />
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-800 flex items-center justify-between gap-4 bg-[#080d13]">
          <button
            type="button"
            onClick={() => onChangeSettings(structuredClone(DEFAULT_SETTINGS))}
            className="px-3.5 py-2 rounded border border-slate-700 hover:border-slate-500 text-xs text-slate-300 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Defaults
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-bold text-xs cursor-pointer"
          >
            Save &amp; Apply
          </button>
        </div>
      </div>
    </div>
  );
};
