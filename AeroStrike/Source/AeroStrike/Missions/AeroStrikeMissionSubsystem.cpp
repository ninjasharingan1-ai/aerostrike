#include "Missions/AeroStrikeMissionSubsystem.h"

void UAeroStrikeMissionSubsystem::EvaluateMissionTick(
    double DroneZMeters,
    bool bEoirActive,
    bool bIntentionalAdvance,
    int32 AliveGroundLandmarks,
    bool bConvoyAlive,
    bool bConvoyTookDamage,
    bool bPlayerDestroyed
)
{
    AeroStrike::SimCore::MissionStepInputs In;
    In.droneZ = DroneZMeters;
    In.eoirActive = bEoirActive;
    In.intentionalAdvanceAction = bIntentionalAdvance;
    In.aliveGroundLandmarks = AliveGroundLandmarks;
    In.convoyAlive = bConvoyAlive;
    In.convoyTookDamage = bConvoyTookDamage;
    In.playerDestroyed = bPlayerDestroyed;

    if (AeroStrike::SimCore::advanceCombinedMission(MissionState, In))
    {
        OnMissionPhaseChanged.Broadcast(GetCurrentPhase());
    }
}
