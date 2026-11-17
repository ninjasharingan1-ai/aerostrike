#include "Core/AeroStrikeGameModeBase.h"
#include "Core/AeroStrikePlayerController.h"
#include "Aircraft/AeroStrikeUavPawn.h"
#include "Engine/World.h"
#include "Engine/StaticMeshActor.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/DirectionalLight.h"
#include "Engine/SkyLight.h"

AAeroStrikeGameModeBase::AAeroStrikeGameModeBase()
{
    DefaultPawnClass = AAeroStrikeUavPawn::StaticClass();
    PlayerControllerClass = AAeroStrikePlayerController::StaticClass();
}

void AAeroStrikeGameModeBase::BeginPlay()
{
    Super::BeginPlay();
    if (!bEnableTrainingBootstrap || !GetWorld()) return;

    // An intentionally minimal training level. It is not a production Sector 04 replacement.
    UStaticMesh* GroundMesh = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Plane.Plane"));
    if (GroundMesh)
    {
        AStaticMeshActor* Ground = GetWorld()->SpawnActor<AStaticMeshActor>(
            FVector(-80000.0f, 0.0f, 0.0f), FRotator::ZeroRotator);
        if (Ground)
        {
            Ground->GetStaticMeshComponent()->SetStaticMesh(GroundMesh);
            Ground->SetActorScale3D(FVector(6000.0f, 6000.0f, 1.0f));
            Ground->GetStaticMeshComponent()->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
        }
    }

    GetWorld()->SpawnActor<ADirectionalLight>(
        FVector(0.0f, 0.0f, 100000.0f), FRotator(-42.0f, -18.0f, 0.0f));
    GetWorld()->SpawnActor<ASkyLight>(FVector::ZeroVector, FRotator::ZeroRotator);

    UE_LOG(LogTemp, Display, TEXT("AeroStrike M2.5-A.1: temporary training scene spawned. LMB fire, L mouse capture, C free look, U cameras."));
}
