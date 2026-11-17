#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "SimCore/MissionReconCore.h"
#include "AeroStrikeMissionSubsystem.generated.h"

UENUM(BlueprintType)
enum class EAeroStrikeMissionPhase : uint8
{
    Deployment = 1,
    Recon = 2,
    AerialEncounter = 3,
    GroundActivity = 4,
    Resolution = 5
};

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnMissionPhaseChanged, EAeroStrikeMissionPhase, NewPhase);

UCLASS()
class AEROSTRIKE_API UAeroStrikeMissionSubsystem : public UWorldSubsystem
{
    GENERATED_BODY()

public:
    UPROPERTY(BlueprintAssignable, Category = "AeroStrike|Mission")
    FOnMissionPhaseChanged OnMissionPhaseChanged;

    UFUNCTION(BlueprintCallable, Category = "AeroStrike|Mission")
    void EvaluateMissionTick(
        double DroneZMeters,
        bool bEoirActive,
        bool bIntentionalAdvance,
        int32 AliveGroundLandmarks,
        bool bConvoyAlive,
        bool bConvoyTookDamage,
        bool bPlayerDestroyed
    );

    UFUNCTION(BlueprintPure, Category = "AeroStrike|Mission")
    EAeroStrikeMissionPhase GetCurrentPhase() const
    {
        return static_cast<EAeroStrikeMissionPhase>(MissionState.phase);
    }

    AeroStrike::SimCore::CombinedMissionState& GetMutableState() { return MissionState; }

private:
    AeroStrike::SimCore::CombinedMissionState MissionState;
};
