#include "Reconnaissance/EoirObservationComponent.h"
#include "Flight/AeroStrikeFlightComponent.h"
#include "Engine/World.h"
#include "GameFramework/Actor.h"

UEoirObservationComponent::UEoirObservationComponent()
{
    PrimaryComponentTick.bCanEverTick = false;
}

AeroStrike::SimCore::EoirScanStepResult UEoirObservationComponent::EvaluateObservationFrame(
    AeroStrike::SimCore::CombinedMissionState& MissionState,
    bool bEoirCameraActive,
    const FVector& CameraWorldLocUE,
    const FVector& CameraForwardUE,
    const TArray<AActor*>& CandidateActors,
    double DeltaSec,
    bool bManualMarkPressed
)
{
    std::vector<AeroStrike::SimCore::GroundContactObservationCandidate> Candidates;
    Candidates.reserve(CandidateActors.Num());

    UWorld* World = GetWorld();
    FCollisionQueryParams TraceParams(SCENE_QUERY_STAT(EoirLosTrace), false, GetOwner());

    for (AActor* Actor : CandidateActors)
    {
        if (!IsValid(Actor)) continue;
        const FVector TargetLoc = Actor->GetActorLocation();
        bool bLosClear = true;
        if (World)
        {
            FHitResult Hit;
            const bool bHit = World->LineTraceSingleByChannel(Hit, CameraWorldLocUE, TargetLoc, ECC_Visibility, TraceParams);
            bLosClear = !bHit || Hit.GetActor() == Actor;
        }

        AeroStrike::SimCore::GroundContactObservationCandidate C;
        C.id = TCHAR_TO_UTF8(*Actor->GetFName().ToString());
        C.displayName = C.id;
        // Convert UE cm (+X North, +Y East, +Z Up) -> Sim m (+X East, +Y Up, -Z North)
        C.worldPos = { TargetLoc.Y * 0.01, TargetLoc.Z * 0.01, -TargetLoc.X * 0.01 };
        C.alive = true;
        C.lineOfSightClear = bLosClear;
        Candidates.push_back(MoveTemp(C));
    }

    AeroStrike::SimCore::EoirObservationQuery Query;
    Query.eoirCameraActive = bEoirCameraActive;
    Query.cameraPos = { CameraWorldLocUE.Y * 0.01, CameraWorldLocUE.Z * 0.01, -CameraWorldLocUE.X * 0.01 };
    Query.cameraForwardDir = UAeroStrikeFlightComponent::UEDirToSimDir(CameraForwardUE);
    Query.fovHalfAngleCos = FMath::Cos(FMath::DegreesToRadians(SensorFovHalfAngleDeg));
    Query.maxRangeM = MaxOpticalRangeMeters;

    const auto Result = AeroStrike::SimCore::evaluateEoirObservationStep(
        MissionState, Query, Candidates, DeltaSec, bManualMarkPressed);

    if (!Result.newlyMarkedTargetId.empty())
    {
        OnTargetMarked.Broadcast(
            FName(UTF8_TO_TCHAR(Result.newlyMarkedTargetId.c_str())),
            static_cast<int32>(MissionState.markedTargetIds.size()),
            MissionState.requiredReconMarks);
    }
    return Result;
}
