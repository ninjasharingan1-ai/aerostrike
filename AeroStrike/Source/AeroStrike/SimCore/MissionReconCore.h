#pragma once

#include "MouseAimCore.h"
#include <algorithm>
#include <cmath>
#include <string>
#include <vector>

namespace AeroStrike::SimCore {

enum class EMissionPhaseId {
    Deployment = 1,
    Recon = 2,
    AerialEncounter = 3,
    GroundActivity = 4,
    Resolution = 5
};

enum class EConvoyMissionState {
    Patrolling,
    Engaged,
    Disrupted,
    Neutralized
};

struct GroundContactObservationCandidate {
    std::string id;
    std::string displayName;
    Vec3 worldPos{};
    bool alive = true;
    bool lineOfSightClear = true;
};

struct EoirObservationQuery {
    bool eoirCameraActive = false;
    Vec3 cameraPos{};
    Vec3 cameraForwardDir{}; // Active observation-camera forward vector, NOT aircraft nose!
    double fovHalfAngleCos = 0.90; // ~25.8 deg optical sensor cone
    double maxRangeM = 3500.0;
};

struct EoirScanStepResult {
    bool scanning = false;
    std::string scanTargetId;
    double scanProgress = 0.0;
    std::string newlyMarkedTargetId;
    int scoreAwarded = 0;
};

struct CombinedMissionState {
    EMissionPhaseId phase = EMissionPhaseId::Deployment;
    std::vector<std::string> markedTargetIds;
    int requiredReconMarks = 2;
    std::string reconScanTargetId;
    double reconScanProgress = 0.0;
    int airKillsCount = 0;
    int groundKillsCount = 0;
    int score = 0;
    bool victory = false;
    bool failed = false;
    EConvoyMissionState convoyState = EConvoyMissionState::Patrolling;

    bool isTargetAlreadyMarked(const std::string& id) const {
        for (const auto& existing : markedTargetIds) {
            if (existing == id) return true;
        }
        return false;
    }
};

/**
 * Evaluates EO/IR reconnaissance strictly against the active observation camera direction & FOV.
 * Guarantees:
 * - No invisible off-screen target marking.
 * - No nearest-target fallback bypassing observation.
 * - No duplicate scoring for already-marked contacts.
 */
inline EoirScanStepResult evaluateEoirObservationStep(
    CombinedMissionState& state,
    const EoirObservationQuery& query,
    const std::vector<GroundContactObservationCandidate>& candidates,
    double dt,
    bool manualMarkRequested
) {
    EoirScanStepResult result;
    if (!query.eoirCameraActive || state.victory || state.failed) {
        state.reconScanTargetId.clear();
        state.reconScanProgress = 0.0;
        return result;
    }

    const double camLen = std::max(1e-6, std::sqrt(
        query.cameraForwardDir.x * query.cameraForwardDir.x +
        query.cameraForwardDir.y * query.cameraForwardDir.y +
        query.cameraForwardDir.z * query.cameraForwardDir.z));
    const Vec3 camFwd{
        query.cameraForwardDir.x / camLen,
        query.cameraForwardDir.y / camLen,
        query.cameraForwardDir.z / camLen
    };

    const GroundContactObservationCandidate* best = nullptr;
    double bestDot = query.fovHalfAngleCos;

    for (const auto& c : candidates) {
        if (!c.alive || !c.lineOfSightClear || state.isTargetAlreadyMarked(c.id)) {
            continue;
        }
        const double dx = c.worldPos.x - query.cameraPos.x;
        const double dy = c.worldPos.y - query.cameraPos.y;
        const double dz = c.worldPos.z - query.cameraPos.z;
        const double dist = std::sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < 10.0 || dist > query.maxRangeM) {
            continue;
        }
        const double dot = (dx * camFwd.x + dy * camFwd.y + dz * camFwd.z) / dist;
        if (dot >= bestDot) {
            bestDot = dot;
            best = &c;
        }
    }

    if (!best) {
        state.reconScanTargetId.clear();
        state.reconScanProgress = std::max(0.0, state.reconScanProgress - dt * 1.4);
        result.scanProgress = state.reconScanProgress;
        return result;
    }

    if (state.reconScanTargetId != best->id) {
        state.reconScanTargetId = best->id;
        state.reconScanProgress = 0.0;
    }

    state.reconScanProgress = std::min(1.0, state.reconScanProgress + dt * 0.95);
    result.scanning = true;
    result.scanTargetId = best->id;
    result.scanProgress = state.reconScanProgress;

    if (manualMarkRequested || state.reconScanProgress >= 1.0) {
        if (!state.isTargetAlreadyMarked(best->id)) {
            state.markedTargetIds.push_back(best->id);
            state.score += 50;
            result.newlyMarkedTargetId = best->id;
            result.scoreAwarded = 50;
            state.reconScanTargetId.clear();
            state.reconScanProgress = 0.0;
        }
    }

    return result;
}

struct MissionStepInputs {
    double droneZ = 800.0;
    bool eoirActive = false;
    bool intentionalAdvanceAction = false;
    int aliveGroundLandmarks = 6;
    bool convoyAlive = true;
    bool convoyTookDamage = false;
    bool playerDestroyed = false;
};

/**
 * Event-driven 5-phase mission progression.
 * Deployment does NOT auto-skip on an arbitrary elapsed timer without player ingress or EO/IR action.
 */
inline bool advanceCombinedMission(CombinedMissionState& state, const MissionStepInputs& in) {
    if (in.playerDestroyed) {
        if (state.phase != EMissionPhaseId::Resolution) {
            state.phase = EMissionPhaseId::Resolution;
            state.failed = true;
            return true;
        }
        return false;
    }

    if (!in.convoyAlive) {
        state.convoyState = EConvoyMissionState::Neutralized;
    } else if (state.phase == EMissionPhaseId::GroundActivity) {
        state.convoyState = in.convoyTookDamage ? EConvoyMissionState::Disrupted : EConvoyMissionState::Engaged;
    } else if (in.convoyTookDamage) {
        state.convoyState = EConvoyMissionState::Disrupted;
    }

    if (in.aliveGroundLandmarks <= 0) {
        if (state.phase != EMissionPhaseId::Resolution) {
            state.phase = EMissionPhaseId::Resolution;
            state.victory = true;
            return true;
        }
        return false;
    }

    const EMissionPhaseId before = state.phase;
    if (state.phase == EMissionPhaseId::Deployment) {
        if (in.droneZ < 450.0 || in.eoirActive || in.intentionalAdvanceAction || !state.markedTargetIds.empty()) {
            state.phase = EMissionPhaseId::Recon;
        }
    } else if (state.phase == EMissionPhaseId::Recon) {
        if (static_cast<int>(state.markedTargetIds.size()) >= state.requiredReconMarks || state.groundKillsCount >= 2) {
            state.phase = (state.airKillsCount >= 1) ? EMissionPhaseId::GroundActivity : EMissionPhaseId::AerialEncounter;
        }
    } else if (state.phase == EMissionPhaseId::AerialEncounter) {
        if (state.airKillsCount >= 1 || (!in.convoyAlive && in.aliveGroundLandmarks <= 2) || state.groundKillsCount >= 3) {
            state.phase = EMissionPhaseId::GroundActivity;
        }
    }

    return state.phase != before;
}

} // namespace AeroStrike::SimCore
