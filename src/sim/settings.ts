export type GraphicsPreset = 'low' | 'balanced' | 'high' | 'ultra';
export type ControlScheme = 'mouse_aim' | 'direct_stick';
export type FlightModelMode = 'arcade' | 'realistic';
export type HudUnitsMode = 'knots_m' | 'kmh_ft';

export interface GraphicsSettings {
  preset: GraphicsPreset;
  shadows: boolean;
  clouds: boolean;
  resolutionScale: number; // 0.6 .. 1.5
  fovDeg: number; // 54 .. 84
  exposure: number; // 0.85 .. 1.4
}

export interface ControlSettings {
  scheme: ControlScheme;
  mouseSensitivity: number; // 0.4 .. 2.2
  invertY: boolean;
  instructorAutoLevel: boolean;
}

export interface GameplaySettings {
  flightModel: FlightModelMode;
  hudUnits: HudUnitsMode;
  showLeadIndicator: boolean;
  radarWarningAudio: boolean;
}

export interface GameSettings {
  graphics: GraphicsSettings;
  controls: ControlSettings;
  gameplay: GameplaySettings;
}

const STORAGE_KEY = 'aerostrike_settings_v1';

export const GRAPHICS_PRESETS: Record<GraphicsPreset, GraphicsSettings> = {
  low: {
    preset: 'low',
    shadows: false,
    clouds: false,
    resolutionScale: 0.75,
    fovDeg: 62,
    exposure: 1.05,
  },
  balanced: {
    preset: 'balanced',
    shadows: true,
    clouds: true,
    resolutionScale: 1.0,
    fovDeg: 64,
    exposure: 1.1,
  },
  high: {
    preset: 'high',
    shadows: true,
    clouds: true,
    resolutionScale: 1.0,
    fovDeg: 66,
    exposure: 1.15,
  },
  ultra: {
    preset: 'ultra',
    shadows: true,
    clouds: true,
    resolutionScale: 1.25,
    fovDeg: 68,
    exposure: 1.2,
  },
};

export const DEFAULT_SETTINGS: GameSettings = {
  graphics: { ...GRAPHICS_PRESETS.high },
  controls: {
    scheme: 'mouse_aim',
    mouseSensitivity: 1.0,
    invertY: false,
    instructorAutoLevel: true,
  },
  gameplay: {
    flightModel: 'arcade',
    hudUnits: 'knots_m',
    showLeadIndicator: true,
    radarWarningAudio: true,
  },
};

export function applyGraphicsPreset(preset: GraphicsPreset): GraphicsSettings {
  return { ...GRAPHICS_PRESETS[preset] };
}

export function loadSettings(): GameSettings {
  if (typeof window === 'undefined' || !window.localStorage) {
    return structuredClone(DEFAULT_SETTINGS);
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    return {
      graphics: { ...DEFAULT_SETTINGS.graphics, ...(parsed.graphics ?? {}) },
      controls: { ...DEFAULT_SETTINGS.controls, ...(parsed.controls ?? {}) },
      gameplay: { ...DEFAULT_SETTINGS.gameplay, ...(parsed.gameplay ?? {}) },
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(settings: GameSettings): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota errors
  }
}
