import { AtmosphericGravityState, SolarState } from './types';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const EARTH_RADIUS_M = 6371000;
const EARTH_OMEGA_RAD_S = 7.2921159e-5; // Sidereal rotation rate

/**
 * Computes astronomical solar elevation, azimuth, directional vector,
 * solar irradiance (W/m^2), and atmospheric thermal updrafts from
 * real Latitude, Longitude, UTC decimal hours, and Day of Year.
 */
export function computeSolarState(
  latDeg: number,
  lonDeg: number,
  utcHours: number,
  dayOfYear = 172,
  cloudCover = 0.1,
): SolarState {
  // Solar declination angle (Spencer / Cooper approximation)
  const declDeg = 23.44 * Math.sin(((360 / 365) * (dayOfYear - 81)) * DEG2RAD);
  const declRad = declDeg * DEG2RAD;
  const latRad = latDeg * DEG2RAD;

  // Local solar time from UTC + longitude offset (15 deg per hour)
  const localSolarTime = ((utcHours + lonDeg / 15) % 24 + 24) % 24;
  const hourAngleDeg = (localSolarTime - 12) * 15;
  const hourAngleRad = hourAngleDeg * DEG2RAD;

  const sinElev =
    Math.sin(latRad) * Math.sin(declRad) +
    Math.cos(latRad) * Math.cos(declRad) * Math.cos(hourAngleRad);
  const clampedSinElev = Math.max(-1, Math.min(1, sinElev));
  const elevRad = Math.asin(clampedSinElev);
  const elevationDeg = elevRad * RAD2DEG;

  const cosElev = Math.max(1e-4, Math.cos(elevRad));
  const cosAz =
    (Math.sin(declRad) - Math.sin(latRad) * clampedSinElev) /
    (Math.cos(latRad) * cosElev);
  const clampedCosAz = Math.max(-1, Math.min(1, cosAz));
  let azimuthDeg = Math.acos(clampedCosAz) * RAD2DEG;
  if (hourAngleDeg > 0) {
    azimuthDeg = 360 - azimuthDeg;
  }

  // Three.js world coordinates: +X = East, +Y = Up, -Z = North
  const azRad = azimuthDeg * DEG2RAD;
  const sunDirX = Math.cos(elevRad) * Math.sin(azRad);
  const sunDirY = Math.sin(elevRad);
  const sunDirZ = -Math.cos(elevRad) * Math.cos(azRad);

  // Direct Normal + Diffuse Irradiance (Kasten-Young Air Mass attenuation)
  let irradianceWm2 = 0;
  if (elevationDeg > 0) {
    const airMass = 1 / (Math.sin(elevRad) + 0.50572 * Math.pow(elevationDeg + 6.07995, -1.6364));
    const clearSky = 1361 * Math.pow(0.7, Math.pow(airMass, 0.678));
    irradianceWm2 = clearSky * (1 - 0.72 * Math.pow(cloudCover, 2));
  }

  // Solar heating drives convective thermal updrafts (m/s)
  const thermalUpdraftMs = Math.max(0, (irradianceWm2 / 1000) * 1.45 * (1 - cloudCover * 0.6));

  // Derive atmospheric sky/fog palette from solar elevation
  let skyColorHex = 0x0b1220;
  let fogColorHex = 0x0e1726;
  let sunColorHex = 0xfff3dc;

  if (elevationDeg > 18) {
    skyColorHex = 0x6ba6d8;
    fogColorHex = 0x9ec4e2;
    sunColorHex = 0xfff8ea;
  } else if (elevationDeg > 4) {
    skyColorHex = 0x4d79a8;
    fogColorHex = 0x8ea4be;
    sunColorHex = 0xffcf96;
  } else if (elevationDeg > -4) {
    skyColorHex = 0x2c3654;
    fogColorHex = 0x5c4c5c;
    sunColorHex = 0xff8f52;
  } else {
    skyColorHex = 0x09101c;
    fogColorHex = 0x0c1524;
    sunColorHex = 0x7b98c4;
  }

  return {
    elevationDeg,
    azimuthDeg,
    sunDirX,
    sunDirY,
    sunDirZ,
    irradianceWm2,
    thermalUpdraftMs,
    isDaylight: elevationDeg > -2,
    skyColorHex,
    fogColorHex,
    sunColorHex,
  };
}

/**
 * Computes real-world WGS84 Somigliana surface gravity (latitude-dependent),
 * inverse-square orbital altitude gravity decay, International Standard Atmosphere (ISA)
 * air density & speed of sound, and local Coriolis acceleration on moving bodies.
 */
export function computeAtmosphericGravity(
  latDeg: number,
  altitudeM: number,
  vxMs: number,
  vzMs: number,
  gravityMultiplier = 1.0,
  airDensityMultiplier = 1.0,
): AtmosphericGravityState {
  const latRad = latDeg * DEG2RAD;
  const sin2 = Math.sin(latRad) ** 2;

  // WGS84 Somigliana normal gravity formula (m/s^2 at sea level)
  const g0 = 9.7803253359 * ((1 + 0.00193185265241 * sin2) / Math.sqrt(1 - 0.00669437999014 * sin2));

  // Inverse-square altitude reduction (crucial for high-apogee ballistic & orbital tests)
  const hClamped = Math.max(-500, altitudeM);
  const altRatio = EARTH_RADIUS_M / (EARTH_RADIUS_M + hClamped);
  const localGravityMs2 = g0 * altRatio * altRatio * gravityMultiplier;

  // ISA Troposphere + Lower Stratosphere model
  let temperatureK = 288.15 - 0.0065 * Math.min(11000, Math.max(0, hClamped));
  let pressurePa: number;
  if (hClamped <= 11000) {
    pressurePa = 101325 * Math.pow(temperatureK / 288.15, 5.25588);
  } else {
    temperatureK = 216.65;
    pressurePa = 22632.1 * Math.exp(-0.000157688 * (Math.min(85000, hClamped) - 11000));
  }

  const rhoBase = pressurePa / (287.058 * temperatureK);
  const airDensityKgM3 = Math.max(0.001, rhoBase * airDensityMultiplier);
  const speedOfSoundMs = Math.sqrt(1.4 * 287.058 * temperatureK);

  // Horizontal Coriolis acceleration: f = 2 * Omega * sin(phi)
  // In +X = East, -Z = North: a_x = f * v_south = f * v_z, a_z = -f * v_east = -f * v_x
  const f = 2 * EARTH_OMEGA_RAD_S * Math.sin(latRad);
  const coriolisAccelX = f * vzMs;
  const coriolisAccelZ = -f * vxMs;

  return {
    localGravityMs2,
    airDensityKgM3,
    speedOfSoundMs,
    temperatureK,
    coriolisAccelX,
    coriolisAccelZ,
  };
}
