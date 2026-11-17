#pragma once

#include <algorithm>
#include <cmath>

namespace AeroStrike::SimCore {

constexpr double PI = 3.14159265358979323846;
constexpr double MAX_AIM_PITCH_RAD = 1.28; // +-73.3 deg safe envelope below gimbal lock
constexpr double BASE_AIM_RAD_PER_PX = 0.0024;
constexpr double BASE_FREELOOK_RAD_PER_PX = 0.0038;
constexpr double MAX_POINTER_DELTA_PX = 380.0;

struct Vec3 {
    double x = 0.0;
    double y = 0.0;
    double z = 0.0;
};

enum class EControlScheme {
    MouseAim,
    DirectStick
};

enum class EPointerRoute {
    Aim,
    FreeLook,
    Eoir,
    None
};

struct FlightControlInput {
    double pitchInput = 0.0;    // -1 (nose down) .. +1 (nose up)
    double rollInput = 0.0;     // -1 (left) .. +1 (right)
    double yawInput = 0.0;      // -1 (left) .. +1 (right)
    double throttleDelta = 0.0; // -1 .. +1
};

struct MouseAimInputConfig {
    double aimSensitivity = 1.0;
    double freeLookSensitivity = 1.0;
    bool invertY = false;
    double aimSmoothing = 0.0;
};

struct MouseInputState {
    bool pointerLocked = false;
    bool pointerInside = false;
    bool hasLastAnchor = false;
    double lastClientX = 0.0;
    double lastClientY = 0.0;
    int skipNextSamples = 0;
    double accumAimPxX = 0.0;
    double accumAimPxY = 0.0;
    double accumFreeLookPxX = 0.0;
    double accumFreeLookPxY = 0.0;
    double accumEoirPxX = 0.0;
    double accumEoirPxY = 0.0;
    double lastRawDeltaX = 0.0;
    double lastRawDeltaY = 0.0;
};

struct ConsumedMouseInput {
    double aimDeltaYawRad = 0.0;
    double aimDeltaPitchRad = 0.0;
    double freeLookDeltaYawRad = 0.0;
    double freeLookDeltaPitchRad = 0.0;
    double eoirDeltaYawRad = 0.0;
    double eoirDeltaPitchRad = 0.0;
    double rawDeltaX = 0.0;
    double rawDeltaY = 0.0;
    double appliedAimSensitivity = 1.0;
    double appliedFreeLookSensitivity = 1.0;
};

inline double wrapAngleRad(double angle) {
    while (angle > PI) angle -= PI * 2.0;
    while (angle < -PI) angle += PI * 2.0;
    return angle;
}

inline double clampAimPitchRad(double pitch) {
    return std::clamp(pitch, -MAX_AIM_PITCH_RAD, MAX_AIM_PITCH_RAD);
}

// Sim coordinates: +X East, +Y Up, -Z North (mapped cleanly to UE +X/+Y/+Z in FlightComponent)
inline Vec3 aimAnglesToDirection(double yaw, double pitch) {
    const double p = clampAimPitchRad(pitch);
    const double cosP = std::cos(p);
    return Vec3{
        -std::sin(yaw) * cosP,
        std::sin(p),
        -std::cos(yaw) * cosP
    };
}

inline void directionToAimAngles(const Vec3& dir, double& outYaw, double& outPitch) {
    const double len = std::max(1e-6, std::sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z));
    const double nx = dir.x / len;
    const double ny = std::clamp(dir.y / len, -0.958, 0.958);
    const double nz = dir.z / len;
    outYaw = wrapAngleRad(std::atan2(-nx, -nz));
    outPitch = clampAimPitchRad(std::asin(ny));
}

inline double computeDirectionAngularErrorRad(const Vec3& a, const Vec3& b) {
    const double lenA = std::max(1e-6, std::sqrt(a.x * a.x + a.y * a.y + a.z * a.z));
    const double lenB = std::max(1e-6, std::sqrt(b.x * b.x + b.y * b.y + b.z * b.z));
    const double dot = std::clamp((a.x * b.x + a.y * b.y + a.z * b.z) / (lenA * lenB), -1.0, 1.0);
    return std::acos(dot);
}

/**
 * Single sensitivity mapping stage: converts pixel deltas to angular radians ONCE.
 */
inline void convertMouseDeltaPxToRadians(
    double deltaPxX,
    double deltaPxY,
    double sensitivity,
    double radPerPx,
    bool invertY,
    double& outDeltaYawRad,
    double& outDeltaPitchRad
) {
    const double safeSens = std::isfinite(sensitivity) ? std::clamp(sensitivity, 0.1, 4.0) : 1.0;
    outDeltaYawRad = -deltaPxX * radPerPx * safeSens;
    const double ySign = invertY ? 1.0 : -1.0;
    outDeltaPitchRad = deltaPxY * radPerPx * safeSens * ySign;
}

inline void clearMousePendingDeltas(MouseInputState& state, bool resetAnchor = false) {
    state.accumAimPxX = 0.0;
    state.accumAimPxY = 0.0;
    state.accumFreeLookPxX = 0.0;
    state.accumFreeLookPxY = 0.0;
    state.accumEoirPxX = 0.0;
    state.accumEoirPxY = 0.0;
    state.lastRawDeltaX = 0.0;
    state.lastRawDeltaY = 0.0;
    if (resetAnchor) {
        state.hasLastAnchor = false;
    }
}

inline void handleMouseFocusLoss(MouseInputState& state) {
    state.pointerInside = false;
    state.pointerLocked = false;
    state.skipNextSamples = 1;
    clearMousePendingDeltas(state, true);
}

inline void handleMousePointerLockChange(MouseInputState& state, bool isLocked) {
    state.pointerLocked = isLocked;
    state.skipNextSamples = 1;
    clearMousePendingDeltas(state, true);
}

inline bool handleMousePointerMove(
    MouseInputState& state,
    double clientX,
    double clientY,
    double rawDeltaX,
    double rawDeltaY,
    EPointerRoute route
) {
    if (!std::isfinite(clientX) || !std::isfinite(clientY)) {
        return false;
    }

    double dx = 0.0;
    double dy = 0.0;

    if (state.pointerLocked) {
        dx = std::isfinite(rawDeltaX) ? rawDeltaX : 0.0;
        dy = std::isfinite(rawDeltaY) ? rawDeltaY : 0.0;
        if (state.skipNextSamples > 0) {
            state.skipNextSamples -= 1;
            state.lastClientX = clientX;
            state.lastClientY = clientY;
            state.hasLastAnchor = true;
            return false;
        }
    } else {
        state.pointerInside = true;
        if (!state.hasLastAnchor || state.skipNextSamples > 0) {
            state.lastClientX = clientX;
            state.lastClientY = clientY;
            state.hasLastAnchor = true;
            if (state.skipNextSamples > 0) state.skipNextSamples -= 1;
            return false;
        }
        dx = clientX - state.lastClientX;
        dy = clientY - state.lastClientY;
        state.lastClientX = clientX;
        state.lastClientY = clientY;
    }

    // Reject OS cursor-warp spikes
    if (std::abs(dx) > MAX_POINTER_DELTA_PX || std::abs(dy) > MAX_POINTER_DELTA_PX) {
        return false;
    }
    if (dx == 0.0 && dy == 0.0) {
        return true;
    }

    state.lastRawDeltaX = dx;
    state.lastRawDeltaY = dy;
    switch (route) {
        case EPointerRoute::Aim:
            state.accumAimPxX += dx;
            state.accumAimPxY += dy;
            break;
        case EPointerRoute::FreeLook:
            state.accumFreeLookPxX += dx;
            state.accumFreeLookPxY += dy;
            break;
        case EPointerRoute::Eoir:
            state.accumEoirPxX += dx;
            state.accumEoirPxY += dy;
            break;
        case EPointerRoute::None:
            break;
    }
    return true;
}

inline ConsumedMouseInput consumeMouseFrameInput(MouseInputState& state, const MouseAimInputConfig& cfg) {
    ConsumedMouseInput out;
    convertMouseDeltaPxToRadians(
        state.accumAimPxX, state.accumAimPxY, cfg.aimSensitivity, BASE_AIM_RAD_PER_PX, cfg.invertY,
        out.aimDeltaYawRad, out.aimDeltaPitchRad);
    convertMouseDeltaPxToRadians(
        state.accumFreeLookPxX, state.accumFreeLookPxY, cfg.freeLookSensitivity, BASE_FREELOOK_RAD_PER_PX, cfg.invertY,
        out.freeLookDeltaYawRad, out.freeLookDeltaPitchRad);
    convertMouseDeltaPxToRadians(
        state.accumEoirPxX, state.accumEoirPxY, cfg.freeLookSensitivity, BASE_FREELOOK_RAD_PER_PX * 0.65, cfg.invertY,
        out.eoirDeltaYawRad, out.eoirDeltaPitchRad);

    out.rawDeltaX = state.lastRawDeltaX;
    out.rawDeltaY = state.lastRawDeltaY;
    out.appliedAimSensitivity = cfg.aimSensitivity;
    out.appliedFreeLookSensitivity = cfg.freeLookSensitivity;

    state.accumAimPxX = 0.0;
    state.accumAimPxY = 0.0;
    state.accumFreeLookPxX = 0.0;
    state.accumFreeLookPxY = 0.0;
    state.accumEoirPxX = 0.0;
    state.accumEoirPxY = 0.0;
    state.lastRawDeltaX = 0.0;
    state.lastRawDeltaY = 0.0;
    return out;
}

struct MouseAimStepInput {
    double aimYaw = 0.0;
    double aimPitch = 0.0;
    double aimDeltaYawRad = 0.0;
    double aimDeltaPitchRad = 0.0;
    bool manualOverrideActive = false;
    bool freeLooking = false;
    double droneYaw = 0.0;
    double dronePitch = 0.0;
    EControlScheme scheme = EControlScheme::MouseAim;
};

struct MouseAimResult {
    double aimYaw = 0.0;
    double aimPitch = 0.0;
    Vec3 targetDir{};
};

/**
 * Approved P0 Persistent World-Space Mouse Aim Updater:
 * - Only physical mouse angular deltas modify desired aim.
 * - Zero mouse movement keeps desired world-space aim direction strictly invariant.
 * - Free-Look ('C') freezes desired world-space aim direction.
 * - Manual overrides align aim to aircraft nose so release never snaps back.
 */
inline MouseAimResult stepWarThunderAimAngles(const MouseAimStepInput& p) {
    double nextYaw = wrapAngleRad(p.aimYaw);
    double nextPitch = clampAimPitchRad(p.aimPitch);

    if (p.scheme != EControlScheme::MouseAim || p.manualOverrideActive) {
        nextYaw = wrapAngleRad(p.droneYaw);
        nextPitch = clampAimPitchRad(p.dronePitch);
    } else if (!p.freeLooking) {
        const double dy = std::isfinite(p.aimDeltaYawRad) ? p.aimDeltaYawRad : 0.0;
        const double dp = std::isfinite(p.aimDeltaPitchRad) ? p.aimDeltaPitchRad : 0.0;
        if (dy != 0.0 || dp != 0.0) {
            nextYaw = wrapAngleRad(nextYaw + dy);
            nextPitch = clampAimPitchRad(nextPitch + dp);
        }
    }

    return MouseAimResult{
        nextYaw,
        nextPitch,
        aimAnglesToDirection(nextYaw, nextPitch)
    };
}

struct InstructorManualOverride {
    double pitchOverride = 0.0;
    double rollOverride = 0.0;
    double yawOverride = 0.0;
    double throttleDelta = 0.0;
};

struct InstructorOptions {
    bool autoLevel = true;
    double pitchRateRad = 0.0;
    double rollRateRad = 0.0;
    double yawRateRad = 0.0;
    double handoffBlend = 1.0;
    double maxBankRad = 0.96; // ~55 deg UAV bank envelope
};

inline FlightControlInput computeInstructorControlInput(
    double droneYaw,
    double dronePitch,
    double droneRoll,
    const Vec3& aimDir,
    const InstructorManualOverride& manual,
    const InstructorOptions& opts = InstructorOptions{}
) {
    const bool hasManualPitch = std::abs(manual.pitchOverride) > 0.05;
    const bool hasManualRoll = std::abs(manual.rollOverride) > 0.05;
    const bool hasManualYaw = std::abs(manual.yawOverride) > 0.05;

    if (hasManualPitch || hasManualRoll || hasManualYaw) {
        return FlightControlInput{
            hasManualPitch ? manual.pitchOverride : 0.0,
            hasManualRoll ? manual.rollOverride : 0.0,
            hasManualYaw ? manual.yawOverride : 0.0,
            manual.throttleDelta
        };
    }

    double desiredYaw = 0.0;
    double desiredPitch = 0.0;
    directionToAimAngles(aimDir, desiredYaw, desiredPitch);

    const double dYaw = wrapAngleRad(desiredYaw - droneYaw);
    const double dPitch = desiredPitch - dronePitch;
    const double handoff = std::clamp(opts.handoffBlend, 0.0, 1.0);

    // Taper bank-to-turn smoothly toward 0 as dYaw shrinks so precision corrections never roll erratically
    const double bankEnvelope = std::min(1.0, std::abs(dYaw) / 0.16);
    double desiredRoll = 0.0;
    if (std::abs(dYaw) > 0.015) {
        desiredRoll = std::clamp(dYaw * 2.15, -opts.maxBankRad, opts.maxBankRad) * bankEnvelope;
    } else if (!opts.autoLevel) {
        desiredRoll = droneRoll;
    }

    const double dRoll = desiredRoll - droneRoll;
    const double instructorRoll = std::clamp(dRoll * 2.55 - opts.rollRateRad * 0.34, -1.0, 1.0) * handoff;
    const double instructorYaw = std::clamp(dYaw * 2.15 - opts.yawRateRad * 0.30, -1.0, 1.0) * handoff;
    const double bankLiftComp = std::min(0.28, std::abs(dYaw) * 0.45) * std::abs(std::sin(droneRoll));
    const double instructorPitch = std::clamp(dPitch * 2.95 - opts.pitchRateRad * 0.32 + bankLiftComp, -1.0, 1.0) * handoff;

    return FlightControlInput{
        instructorPitch,
        instructorRoll,
        instructorYaw,
        manual.throttleDelta
    };
}

} // namespace AeroStrike::SimCore
