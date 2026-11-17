#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "SimCore/MissionReconCore.h"
#include "EoirObservationComponent.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE_ThreeParams(
    FOnEoirTargetMarked,
    FName, TargetId,
    int32, TotalMarked,
    int32, RequiredMarks
);

UCLASS(ClassGroup = (AeroStrike), meta = (BlueprintSpawnableComponent))
class AEROSTRIKE_API UEoirObservationComponent : public UActorComponent
{
    GENERATED_BODY()

public:
    UEoirObservationComponent();

    UPROPERTY(BlueprintAssignable, Category = "AeroStrike|Recon")
    FOnEoirTargetMarked OnTargetMarked;

    // Evaluates strictly along ActiveCameraForward vector inside SensorFovHalfAngleDeg with LineTrace occlusion
    AeroStrike::SimCore::EoirScanStepResult EvaluateObservationFrame(
        AeroStrike::SimCore::CombinedMissionState& MissionState,
        bool bEoirCameraActive,
        const FVector& CameraWorldLocUE,
        const FVector& CameraForwardUE,
        const TArray<AActor*>& CandidateActors,
        double DeltaSec,
        bool bManualMarkPressed
    );

protected:
    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "EOIR")
    double SensorFovHalfAngleDeg = 22.0;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "EOIR")
    double MaxOpticalRangeMeters = 3500.0;
};
