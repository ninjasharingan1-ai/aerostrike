import { TheaterId, TheaterSpec } from './types';

export const THEATERS: Record<TheaterId, TheaterSpec> = {
  edwards: {
    id: 'edwards',
    name: 'Mojave Proving Basin — Sector 04',
    region: 'Western High-Desert Range',
    latDeg: 34.9054,
    lonDeg: -117.8839,
    worldRadiusM: 3200,
    baseElevationM: 700,
    waterLevelM: -999,
    defaultWeather: 'clear',
    description:
      'Composite high-desert dry lakebed and basalt ridges in Sector 04 used for UAV strike, EW denial, and close-air combat evaluation.',
    landmarks: [
      { id: 'edw-hq', name: 'Mesa Dry Lake Airfield', type: 'airbase', x: 0, z: -200, maxHp: 300, points: 250 },
      { id: 'edw-sam1', name: 'North Ridge SAM Site', type: 'sam', x: -720, z: -1350, maxHp: 110, points: 180, threatRadiusM: 850 },
      { id: 'edw-rad1', name: 'East Crest Radar Array', type: 'radar', x: 860, z: -1120, maxHp: 90, points: 150, threatRadiusM: 950 },
      { id: 'edw-bnk1', name: 'Sector Bunker Alpha', type: 'bunker', x: -1250, z: -2100, maxHp: 220, points: 320 },
      { id: 'edw-dep1', name: 'Forward Logistics Depot', type: 'depot', x: 1180, z: -1950, maxHp: 140, points: 200 },
      { id: 'edw-cnv1', name: 'Desert Armored Convoy', type: 'convoy', x: 180, z: -1650, maxHp: 95, points: 160 },
    ],
  },
  alps: {
    id: 'alps',
    name: 'Lauterbrunnen Alpine Corridor',
    region: 'Bernese Oberland, Switzerland',
    latDeg: 46.5775,
    lonDeg: 7.9052,
    worldRadiusM: 3200,
    baseElevationM: 820,
    waterLevelM: 40,
    defaultWeather: 'overcast_crosswind',
    description:
      'Steep glacial U-valleys and 1,600m limestone ridges testing terrain-following cruise flight and high-angle ballistic arcs.',
    landmarks: [
      { id: 'alp-ab', name: 'Valley Forward Strip', type: 'airbase', x: 0, z: 300, maxHp: 260, points: 240 },
      { id: 'alp-sam1', name: 'Eiger Ridge Air Defense', type: 'sam', x: -840, z: -1280, maxHp: 120, points: 200, threatRadiusM: 900 },
      { id: 'alp-rad1', name: 'High-Altitude Early Warning', type: 'radar', x: 940, z: -1460, maxHp: 100, points: 175, threatRadiusM: 1050 },
      { id: 'alp-bnk1', name: 'Mountain Command Vault', type: 'bunker', x: 50, z: -2250, maxHp: 260, points: 360 },
      { id: 'alp-dep1', name: 'Alpine Supply Railhead', type: 'depot', x: -580, z: -1780, maxHp: 130, points: 190 },
      { id: 'alp-cnv1', name: 'Pass Logistics Column', type: 'convoy', x: 420, z: -1020, maxHp: 90, points: 150 },
    ],
  },
  hormuz: {
    id: 'hormuz',
    name: 'Strait of Hormuz Maritime Zone',
    region: 'Persian Gulf',
    latDeg: 26.5667,
    lonDeg: 56.25,
    worldRadiusM: 3200,
    baseElevationM: 12,
    waterLevelM: 0,
    defaultWeather: 'desert_dust',
    description:
      'Strategic littoral strait with rocky island chokepoints, coastal radar batteries, and maritime strike corridors.',
    landmarks: [
      { id: 'hor-ab', name: 'Littoral UAV Carrier Deck', type: 'airbase', x: -120, z: 450, maxHp: 280, points: 250 },
      { id: 'hor-sam1', name: 'Qeshm Coastal SAM', type: 'sam', x: -950, z: -1450, maxHp: 115, points: 190, threatRadiusM: 900 },
      { id: 'hor-rad1', name: 'Strait Maritime Radar', type: 'radar', x: 1020, z: -1180, maxHp: 95, points: 165, threatRadiusM: 1000 },
      { id: 'hor-bnk1', name: 'Anti-Ship Silo Complex', type: 'bunker', x: 760, z: -2150, maxHp: 230, points: 340 },
      { id: 'hor-dep1', name: 'Refinery & Fuel Terminal', type: 'depot', x: -1120, z: -2050, maxHp: 160, points: 220 },
      { id: 'hor-cnv1', name: 'Patrol Escort Group', type: 'convoy', x: 60, z: -1580, maxHp: 105, points: 175 },
    ],
  },
  baltic: {
    id: 'baltic',
    name: 'Baltic Archipelago Sector',
    region: 'Gdansk Bay / Baltic Sea',
    latDeg: 54.5189,
    lonDeg: 18.5305,
    worldRadiusM: 3200,
    baseElevationM: 18,
    waterLevelM: 0,
    defaultWeather: 'thunderstorm',
    description:
      'Low-lying coastal archipelago under squall fronts, testing high-latitude Somigliana gravity & weather-penetrating AESA targeting.',
    landmarks: [
      { id: 'bal-ab', name: 'Coastal Air Station', type: 'airbase', x: 140, z: 420, maxHp: 260, points: 230 },
      { id: 'bal-sam1', name: 'Peninsula SAM Battery', type: 'sam', x: -780, z: -1150, maxHp: 115, points: 190, threatRadiusM: 880 },
      { id: 'bal-rad1', name: 'Over-the-Horizon Radar', type: 'radar', x: 890, z: -1520, maxHp: 100, points: 170, threatRadiusM: 1100 },
      { id: 'bal-bnk1', name: 'Naval Command Bunker', type: 'bunker', x: -320, z: -2180, maxHp: 240, points: 350 },
      { id: 'bal-dep1', name: 'Port Munitions Pier', type: 'depot', x: 1150, z: -1900, maxHp: 150, points: 210 },
      { id: 'bal-cnv1', name: 'Coastal Mobile Launcher', type: 'convoy', x: -240, z: -1420, maxHp: 95, points: 160 },
    ],
  },
};

/**
 * Deterministic multi-octave topographical heightfield (meters relative to local sea/datum)
 * Shared 1:1 between the 3D Three.js terrain mesh, collision groundHeightAt(x, z),
 * and the 2D Real-World Topographical Mission Map.
 */
export function groundHeightAt(theaterId: TheaterId, x: number, z: number): number {
  const nx = x * 0.0012;
  const nz = z * 0.0012;

  if (theaterId === 'edwards') {
    // Flat dry lakebed near center (0,0), rising into multi-directional Mojave ridges outside 650m
    const dist = Math.hypot(x, z);
    const lakeFlat = Math.max(0, Math.min(1, (dist - 650) / 700));
    const ridge1 = Math.sin(nx * 1.9 + 0.4) * Math.cos(nz * 1.7 - 0.3) * 125;
    const ridge2 = Math.sin(nx * 3.1 + nz * 4.7) * Math.cos(nx * 2.2 - nz * 1.8) * 65;
    const ridge3 = Math.cos(nx * 6.3 - nz * 2.1 + 1.1) * 28;
    const micro = Math.cos(nx * 9.5 + nz * 7.8) * 12;
    const rim = Math.max(0, (dist - 2200) / 1000) * 260;
    return Math.max(0, (ridge1 + ridge2 + ridge3 + micro + 95) * lakeFlat + rim);
  }

  if (theaterId === 'alps') {
    // Deep central glacial valley along X near 0, towering alpine peaks on flanks
    const valleyCross = Math.min(1.6, Math.pow(Math.abs(x) / 950, 1.45));
    const peaks =
      Math.abs(Math.sin(nx * 2.3 + 0.8) * Math.cos(nz * 2.1)) * 420 +
      Math.abs(Math.sin(nx * 5.2 - nz * 4.4)) * 130;
    const valleyFloor = 22 + Math.sin(nz * 3.0) * 12;
    return valleyFloor + peaks * valleyCross;
  }

  if (theaterId === 'hormuz') {
    // Sea channels at y <= 0 with jagged limestone islands and northern coastal ridge
    const channel = Math.sin(nx * 1.4 + nz * 0.9) * 95 + Math.cos(nx * 2.8 - nz * 2.3) * 65;
    const northCoast = z < -1400 ? (-1400 - z) * 0.16 : 0;
    const spawnPad = Math.hypot(x + 120, z - 450) < 350 ? 28 : -999;
    const raw = channel + northCoast - 18;
    return Math.max(spawnPad, raw);
  }

  // baltic: low coastal peninsulas, shallow bays, gentle glacial moraine hills
  const moraine =
    Math.sin(nx * 1.7 - 0.5) * Math.cos(nz * 1.5 + 0.6) * 58 +
    Math.sin(nx * 4.3 + nz * 3.8) * 22;
  const coastBias = z < -700 ? 35 : -12;
  const airbasePad = Math.hypot(x - 140, z - 420) < 320 ? 18 : -999;
  return Math.max(airbasePad, moraine + coastBias);
}

/**
 * Converts local simulation meters (x East, z South) to real WGS84 Latitude/Longitude
 */
export function worldToLatLon(theaterId: TheaterId, x: number, z: number): { lat: number; lon: number } {
  const theater = THEATERS[theaterId];
  const metersPerDegLat = 111320;
  const metersPerDegLon = 111320 * Math.cos((theater.latDeg * Math.PI) / 180);
  return {
    lat: theater.latDeg - z / metersPerDegLat,
    lon: theater.lonDeg + x / metersPerDegLon,
  };
}

export function getElevationProfile(
  theaterId: TheaterId,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  samples = 32,
): { distM: number; elevM: number }[] {
  const totalDist = Math.hypot(x1 - x0, z1 - z0);
  const out: { distM: number; elevM: number }[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const x = x0 + (x1 - x0) * t;
    const z = z0 + (z1 - z0) * t;
    out.push({
      distM: totalDist * t,
      elevM: groundHeightAt(theaterId, x, z),
    });
  }
  return out;
}
