#pragma once

#include "MouseAimCore.h"
#include <algorithm>
#include <cmath>

namespace AeroStrike::SimCore {

enum class EFlightModelFamily {
    FixedWingPropeller,
    Multirotor,
    JetPowered,
    LoiteringAircraft
};

enum class EFlightPreset {
    Arcade,
    Realistic
};

struct AirframeFlightSpec {
    EFlightModelFamily family = EFlightModelFamily::FixedWingPropeller;
    double dryMassKg = 700.0;
    double maxFuelKg = 300.0;
    double wingAreaM2 = 14.5;
    double aspectRatio = 12.0;
    double cd0 = 0.024;
    double clMax = 1.48;
    double stallAngleDeg = 15.0;
    double maxPitchRateRad = 1.25;
    double maxRollRateRad = 2.05;
    double maxYawRateRad = 0.72;
    double maxThrustN = 16500.0;
    double optimalMach = 0.35;
    double maxMach = 0.58;
    double maxG = 5.5;
    double maxHp = 115.0;
};

struct DroneFlightState {
    double x = 0.0;
    double y = 450.0;
    double z = 800.0;
    double vx = 0.0;
    double vy = 0.0;
    double vz = -75.0;
    double pitch = 0.0;
    double yaw = 0.0;
    double roll = 0.0;
    double pitchRateRad = 0.0;
    double rollRateRad = 0.0;
    double yawRateRad = 0.0;
    double throttle = 0.72;
    double airspeedMs = 75.0;
    double groundSpeedMs = 75.0;
    double mach = 0.22;
    double aglMeters = 450.0;
    double aoaDeg = 0.0;
    double gLoad = 1.0;
    bool stalling = false;
    double hp = 115.0;
    double maxHp = 115.0;
    double fuelKg = 300.0;
    double maxFuelKg = 300.0;
};

struct FlightEnvironmentContext {
    EFlightPreset preset = EFlightPreset::Arcade;
    double windSpeedMs = 3.0;
    double windHeadingDeg = 270.0;
    double turbulenceIntensity = 0.05;
    double airDensityKgM3 = 1.15;
    double gravityMs2 = 9.80665;
    double speedOfSoundMs = 336.0;
    double groundElevationM = 0.0;
    double elapsedTimeSec = 0.0;
    double timeScale = 1.0;
    bool kamikazeArmed = false;
    // Non-negotiable invariant: fuel/battery depletion stays disabled during normal gameplay.
    bool disableFuelDepletion = true;
};

/**
 * Class-differentiated aerodynamic / rotorcraft flight physics model.
 * Computes physically coherent forces and damped angular accelerations per aircraft class.
 */
inline DroneFlightState stepDroneFlight(
    const DroneFlightState& prev,
    const AirframeFlightSpec& spec,
    const FlightControlInput& input,
    const FlightEnvironmentContext& env,
    double dt
) {
    DroneFlightState s = prev;
    const bool isArcade = env.preset == EFlightPreset::Arcade;
    const double simDt = std::clamp(dt, 0.001, 0.05) * std::max(0.05, env.timeScale);

    const double maxThrottle = isArcade ? 1.10 : 1.05;
    const double minThrottle = (spec.family == EFlightModelFamily::Multirotor) ? 0.15 : 0.05;
    s.throttle = std::clamp(s.throttle + input.throttleDelta * 0.78 * simDt, minThrottle, maxThrottle);

    // Non-negotiable Fuel Rule: keep fuel/battery full when disableFuelDepletion is true
    if (env.disableFuelDepletion) {
        s.fuelKg = s.maxFuelKg;
    }

    // Wind vector in world space (+X East, +Y Up, -Z North)
    const double windRad = env.windHeadingDeg * PI / 180.0;
    const double gust = env.turbulenceIntensity * 8.5 *
        std::sin(env.elapsedTimeSec * 2.1 + s.x * 0.01) *
        std::cos(env.elapsedTimeSec * 1.4 + s.z * 0.01);
    const double windVx = std::sin(windRad) * (env.windSpeedMs + gust);
    const double windVz = -std::cos(windRad) * (env.windSpeedMs + gust);
    const double windVy = env.turbulenceIntensity * 2.4 * std::sin(env.elapsedTimeSec * 3.1);

    const double vRelX = s.vx - windVx;
    const double vRelY = s.vy - windVy;
    const double vRelZ = s.vz - windVz;
    const double relSpeed = std::max(0.5, std::sqrt(vRelX * vRelX + vRelY * vRelY + vRelZ * vRelZ));

    // Rotational damping & class-specific authority
    const double turbScale = isArcade ? 0.50 : 1.0;
    const double turbPitch = env.turbulenceIntensity * 0.08 * turbScale * std::sin(env.elapsedTimeSec * 5.7);
    const double turbRoll = env.turbulenceIntensity * 0.12 * turbScale * std::cos(env.elapsedTimeSec * 4.9);

    if (spec.family == EFlightModelFamily::Multirotor) {
        // Multirotor UAV: instant electric torque, hover stability, tilt-for-thrust, damped yaw
        const double maxTiltRad = isArcade ? 0.58 : 0.72;
        const double targetRollRate = input.rollInput * spec.maxRollRateRad * (isArcade ? 1.15 : 1.0);
        const double targetPitchRate = input.pitchInput * spec.maxPitchRateRad * (isArcade ? 1.15 : 1.0);
        const double targetYawRate = input.yawInput * spec.maxYawRateRad * (isArcade ? 1.2 : 1.0);

        s.rollRateRad += (targetRollRate - s.rollRateRad) * std::min(1.0, 10.0 * simDt);
        s.pitchRateRad += (targetPitchRate - s.pitchRateRad) * std::min(1.0, 10.0 * simDt);
        s.yawRateRad += (targetYawRate - s.yawRateRad) * std::min(1.0, 9.0 * simDt);

        s.roll = std::clamp(s.roll + (s.rollRateRad + turbRoll * 0.6) * simDt, -maxTiltRad, maxTiltRad);
        s.pitch = std::clamp(s.pitch + (s.pitchRateRad + turbPitch * 0.6) * simDt, -maxTiltRad, maxTiltRad);
        s.yaw = wrapAngleRad(s.yaw + s.yawRateRad * simDt);

        if (std::abs(input.rollInput) < 0.02) s.roll *= std::exp(-3.2 * simDt);
        if (std::abs(input.pitchInput) < 0.02) s.pitch *= std::exp(-2.8 * simDt);

        const double totalMassKg = std::max(15.0, spec.dryMassKg);
        const double fwdX = -std::sin(s.yaw);
        const double fwdZ = -std::cos(s.yaw);
        const double rightX = std::cos(s.yaw);
        const double rightZ = -std::sin(s.yaw);

        // Hover baseline + throttle climb + tilt translation
        const double hoverLiftN = totalMassKg * env.gravityMs2;
        const double climbThrottle = (s.throttle - 0.55) * 1.9;
        const double rotorThrustN = std::max(0.0, hoverLiftN * (1.0 + climbThrottle) + spec.maxThrustN * 0.12 * s.throttle);
        const double horizontalDrive = totalMassKg * env.gravityMs2 * (isArcade ? 2.4 : 1.85);
        const double fwdAccel = (-std::sin(s.pitch) * 1.1 + s.throttle * 0.55) * (horizontalDrive / totalMassKg);
        const double latAccel = std::sin(s.roll) * (horizontalDrive / totalMassKg);

        const double fx = (fwdX * fwdAccel + rightX * latAccel) * totalMassKg - 0.5 * env.airDensityKgM3 * 1.45 * vRelX * relSpeed;
        const double fy = rotorThrustN * std::cos(s.roll) * std::cos(s.pitch) - hoverLiftN - 0.5 * env.airDensityKgM3 * 1.8 * vRelY * std::abs(vRelY);
        const double fz = (fwdZ * fwdAccel + rightZ * latAccel) * totalMassKg - 0.5 * env.airDensityKgM3 * 1.45 * vRelZ * relSpeed;

        s.vx += (fx / totalMassKg) * simDt;
        s.vy += (fy / totalMassKg) * simDt;
        s.vz += (fz / totalMassKg) * simDt;
        s.stalling = false;
        s.aoaDeg = (s.pitch * 180.0) / PI;
        s.gLoad = std::clamp(rotorThrustN / std::max(1.0, hoverLiftN), 0.2, spec.maxG);
    } else {
        // Fixed-Wing Propeller, Jet-Powered, and Loitering Aircraft families
        const double stallSpeedFloor = (spec.family == EFlightModelFamily::JetPowered) ? 58.0 :
                                       (spec.family == EFlightModelFamily::LoiteringAircraft) ? 34.0 : 38.0;
        const double authorityBase = isArcade ? 0.55 : 0.36;
        const double familyAgilityBias =
            (spec.family == EFlightModelFamily::JetPowered) ? 1.18 :
            (spec.family == EFlightModelFamily::LoiteringAircraft) ? (env.kamikazeArmed ? 1.28 : 0.88) : 1.0;

        const double authority = std::clamp(relSpeed / stallSpeedFloor, authorityBase, 1.0) *
                                 (isArcade ? 1.24 : 1.0) * familyAgilityBias;

        const double targetRollRate = input.rollInput * spec.maxRollRateRad * authority;
        const double targetPitchRate = input.pitchInput * spec.maxPitchRateRad * authority;
        const double targetYawRate = input.yawInput * spec.maxYawRateRad * authority;

        const double angResponse = (spec.family == EFlightModelFamily::JetPowered) ? 11.5 : 8.5;
        s.rollRateRad += (targetRollRate - s.rollRateRad) * std::min(1.0, angResponse * simDt);
        s.pitchRateRad += (targetPitchRate - s.pitchRateRad) * std::min(1.0, angResponse * simDt);
        s.yawRateRad += (targetYawRate - s.yawRateRad) * std::min(1.0, angResponse * simDt);

        s.roll += (s.rollRateRad + turbRoll) * simDt;
        if (std::abs(input.rollInput) < 0.02) {
            s.roll *= std::exp(-(isArcade ? 2.1 : 1.2) * simDt);
        }
        const double maxRoll = (spec.family == EFlightModelFamily::JetPowered) ? PI * 0.85 : PI * 0.70;
        s.roll = std::clamp(s.roll, -maxRoll, maxRoll);

        s.pitch += (s.pitchRateRad + turbPitch) * simDt;
        if (std::abs(input.pitchInput) < 0.012) {
            s.pitch *= std::exp(-(isArcade ? 0.14 : 0.09) * simDt);
        }
        s.pitch = std::clamp(s.pitch, -PI * 0.46, PI * 0.46);

        const double bankTurnRate = std::sin(s.roll) * (env.gravityMs2 / std::max(32.0, relSpeed)) * (isArcade ? 2.4 : 1.9);
        s.yaw = wrapAngleRad(s.yaw + (s.yawRateRad + bankTurnRate) * simDt);

        const double cosP = std::cos(s.pitch);
        const double fwdX = -std::sin(s.yaw) * cosP;
        const double fwdY = std::sin(s.pitch);
        const double fwdZ = -std::cos(s.yaw) * cosP;

        const double rightX = std::cos(s.yaw);
        const double rightZ = -std::sin(s.yaw);
        const double sinR = std::sin(s.roll);
        const double cosR = std::cos(s.roll);

        const double upBaseX = std::sin(s.yaw) * std::sin(s.pitch);
        const double upBaseY = std::cos(s.pitch);
        const double upBaseZ = std::cos(s.yaw) * std::sin(s.pitch);
        const double wingUpX = upBaseX * cosR - rightX * sinR;
        const double wingUpY = upBaseY * cosR;
        const double wingUpZ = upBaseZ * cosR - rightZ * sinR;

        const double dirX = vRelX / relSpeed;
        const double dirY = vRelY / relSpeed;
        const double dirZ = vRelZ / relSpeed;
        const double upDot = dirX * wingUpX + dirY * wingUpY + dirZ * wingUpZ;
        const double aoaRad = std::atan2(-upDot, std::max(0.1, dirX * fwdX + dirY * fwdY + dirZ * fwdZ));
        s.aoaDeg = (aoaRad * 180.0) / PI;

        const double stallRad = spec.stallAngleDeg * PI / 180.0;
        const double minStallSpeed = std::min(isArcade ? 38.0 : 46.0,
            16.0 + std::sqrt(spec.dryMassKg / std::max(1.0, spec.wingAreaM2)) * 2.8);
        s.stalling = (std::abs(aoaRad) > stallRad) && (relSpeed < minStallSpeed);

        const double clSlope = (2.0 * PI * spec.aspectRatio) / (spec.aspectRatio + 2.0);
        const double clBase = isArcade ? 0.34 : 0.28;
        double cl = clBase + clSlope * aoaRad;
        if (std::abs(aoaRad) > stallRad) {
            cl *= isArcade ? 0.72 : 0.55;
        }
        cl = std::clamp(cl, -spec.clMax * 0.65, spec.clMax * (isArcade ? 1.15 : 1.0));

        const double eOswald = (spec.family == EFlightModelFamily::JetPowered) ? 0.88 : 0.84;
        const double turnBleed = 1.0 + std::min(0.42, std::abs(aoaRad) * 0.65);
        const double cdInduced = ((cl * cl) / (PI * spec.aspectRatio * eOswald)) * turnBleed;
        const double mach = relSpeed / std::max(120.0, env.speedOfSoundMs);
        const double waveDrag = (mach > 0.88) ? std::pow(mach - 0.88, 2.0) * 0.12 : 0.0;
        const double cd = (spec.cd0 * (isArcade ? 0.82 : 1.0)) + cdInduced + waveDrag;

        const double qDyn = 0.5 * env.airDensityKgM3 * relSpeed * relSpeed;
        double liftN = qDyn * spec.wingAreaM2 * cl;
        const double dragN = qDyn * spec.wingAreaM2 * cd;

        // Ground effect cushion within 1 wingspan of surface
        const double wingSpanEst = std::sqrt(spec.wingAreaM2 * spec.aspectRatio);
        const double preAgl = std::max(0.0, s.y - env.groundElevationM);
        if (preAgl < wingSpanEst) {
            const double geFactor = 1.0 + 0.18 * (1.0 - preAgl / std::max(1.0, wingSpanEst));
            liftN *= geFactor;
        }

        const double totalMassKg = std::max(25.0, spec.dryMassKg + s.fuelKg * 0.15);
        const double kamikazeBoost = env.kamikazeArmed ? 1.45 : 1.0;
        const double machFactor = (mach > spec.maxMach) ? std::max(0.18, 1.0 - (mach - spec.maxMach) * 1.35) : 1.0;
        const double wepMult = (s.throttle > 1.0) ? (1.0 + (s.throttle - 1.0) * 2.8) : 1.0;
        const bool hasFuel = env.disableFuelDepletion ? true : (s.fuelKg > 0.5);
        const double thrustN = hasFuel
            ? spec.maxThrustN * kamikazeBoost * std::min(1.0, s.throttle) * wepMult * machFactor * (isArcade ? 1.12 : 1.0)
            : 0.0;

        const double fx = thrustN * fwdX + liftN * wingUpX - dragN * dirX;
        const double fy = thrustN * fwdY + liftN * wingUpY - dragN * dirY - totalMassKg * env.gravityMs2;
        const double fz = thrustN * fwdZ + liftN * wingUpZ - dragN * dirZ;

        s.vx += (fx / totalMassKg) * simDt;
        s.vy += (fy / totalMassKg) * simDt;
        s.vz += (fz / totalMassKg) * simDt;

        // Weathercock alignment damping
        const double speed = std::sqrt(s.vx * s.vx + s.vy * s.vy + s.vz * s.vz);
        const double alignRate = std::min(1.0, (isArcade ? 3.85 : 2.35) * simDt);
        s.vx += (fwdX * speed - s.vx) * alignRate;
        s.vy += (fwdY * speed - s.vy) * alignRate * 0.42;
        s.vz += (fwdZ * speed - s.vz) * alignRate;

        s.gLoad = std::clamp(liftN / (totalMassKg * 9.80665), -3.0, spec.maxG + 2.0);
    }

    s.x += s.vx * simDt;
    s.y += s.vy * simDt;
    s.z += s.vz * simDt;

    s.aglMeters = s.y - env.groundElevationM;
    if (env.kamikazeArmed) {
        if (s.aglMeters < 0.5) {
            s.y = env.groundElevationM + 0.5;
            s.aglMeters = 0.5;
        }
    } else if (s.aglMeters < 6.0) {
        if (s.vy < -22.0) {
            s.hp = std::max(0.0, s.hp - std::abs(s.vy) * 0.85);
        }
        s.y = env.groundElevationM + 6.0;
        s.vy = std::max(4.0, std::abs(s.vy) * 0.25);
        s.pitch = std::max(0.08, s.pitch);
        s.aglMeters = 6.0;
    }
    s.y = std::min(28000.0, s.y);

    const double postRelVx = s.vx - windVx;
    const double postRelVy = s.vy - windVy;
    const double postRelVz = s.vz - windVz;
    s.airspeedMs = std::sqrt(postRelVx * postRelVx + postRelVy * postRelVy + postRelVz * postRelVz);
    s.groundSpeedMs = std::sqrt(s.vx * s.vx + s.vy * s.vy + s.vz * s.vz);
    s.mach = s.airspeedMs / std::max(120.0, env.speedOfSoundMs);
    return s;
}

} // namespace AeroStrike::SimCore
