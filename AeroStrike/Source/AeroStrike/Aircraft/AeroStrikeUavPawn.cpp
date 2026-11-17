#include "Aircraft/AeroStrikeUavPawn.h"
#include "Components/SkeletalMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "UObject/ConstructorHelpers.h"
#include "GameFramework/SpringArmComponent.h"
#include "Camera/CameraComponent.h"
#include "Flight/AeroStrikeFlightComponent.h"
#include "Weapons/WeaponLoadoutComponent.h"
#include "Reconnaissance/EoirObservationComponent.h"

AAeroStrikeUavPawn::AAeroStrikeUavPawn()
{
    PrimaryActorTick.bCanEverTick = true;
    bReplicates = true;

    AirframeMesh = CreateDefaultSubobject<USkeletalMeshComponent>(TEXT("AirframeMesh"));
    SetRootComponent(AirframeMesh);

    static ConstructorHelpers::FObjectFinder<UStaticMesh> CubeAsset(TEXT("/Engine/BasicShapes/Cube.Cube"));
    FallbackFuselage = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("FallbackFuselage"));
    FallbackFuselage->SetupAttachment(AirframeMesh);
    FallbackFuselage->SetRelativeLocation(FVector(0.0f, 0.0f, 0.0f));
    FallbackFuselage->SetRelativeScale3D(FVector(6.0f, 0.48f, 0.38f));
    FallbackWings = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("FallbackWings"));
    FallbackWings->SetupAttachment(AirframeMesh);
    FallbackWings->SetRelativeLocation(FVector(10.0f, 0.0f, 10.0f));
    FallbackWings->SetRelativeScale3D(FVector(1.1f, 11.0f, 0.13f));
    FallbackTail = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("FallbackTail"));
    FallbackTail->SetupAttachment(AirframeMesh);
    FallbackTail->SetRelativeLocation(FVector(-245.0f, 0.0f, 24.0f));
    FallbackTail->SetRelativeScale3D(FVector(0.85f, 3.4f, 0.12f));
    if (CubeAsset.Succeeded())
    {
        FallbackFuselage->SetStaticMesh(CubeAsset.Object);
        FallbackWings->SetStaticMesh(CubeAsset.Object);
        FallbackTail->SetStaticMesh(CubeAsset.Object);
    }
    FallbackFuselage->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    FallbackWings->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    FallbackTail->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    ChaseSpringArm = CreateDefaultSubobject<USpringArmComponent>(TEXT("ChaseSpringArm"));
    ChaseSpringArm->SetupAttachment(AirframeMesh);
    ChaseSpringArm->TargetArmLength = 1550.0f; // ~15.5m behind TB2
    ChaseSpringArm->SocketOffset = FVector(0.0f, 0.0f, 340.0f);
    ChaseSpringArm->bEnableCameraLag = true;
    ChaseSpringArm->CameraLagSpeed = 9.0f;
    ChaseSpringArm->bEnableCameraRotationLag = true;
    ChaseSpringArm->CameraRotationLagSpeed = 10.0f;

    ChaseCamera = CreateDefaultSubobject<UCameraComponent>(TEXT("ChaseCamera"));
    ChaseCamera->SetupAttachment(ChaseSpringArm);
    ChaseCamera->FieldOfView = 62.0f;

    EoirTurretCamera = CreateDefaultSubobject<UCameraComponent>(TEXT("EoirTurretCamera"));
    EoirTurretCamera->SetupAttachment(AirframeMesh, FName(TEXT("Socket_EOIR_Gimbal")));
    EoirTurretCamera->SetRelativeLocation(FVector(210.0f, 0.0f, -65.0f));
    EoirTurretCamera->FieldOfView = 42.0f;
    EoirTurretCamera->bAutoActivate = false;

    FlightComponent = CreateDefaultSubobject<UAeroStrikeFlightComponent>(TEXT("FlightComponent"));
    WeaponComponent = CreateDefaultSubobject<UWeaponLoadoutComponent>(TEXT("WeaponComponent"));
    EoirComponent = CreateDefaultSubobject<UEoirObservationComponent>(TEXT("EoirComponent"));
}

void AAeroStrikeUavPawn::BeginPlay()
{
    Super::BeginPlay();
    if (DefaultAirframeAsset && FlightComponent)
    {
        FlightComponent->InitializeFromAirframe(DefaultAirframeAsset);
    }
    const bool bNeedsProxy = !AirframeMesh || !AirframeMesh->GetSkeletalMeshAsset();
    FallbackFuselage->SetVisibility(bNeedsProxy);
    FallbackWings->SetVisibility(bNeedsProxy);
    FallbackTail->SetVisibility(bNeedsProxy);
}

void AAeroStrikeUavPawn::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    if (!bFreeLookHeld)
    {
        FreeLookOffset = FMath::RInterpTo(FreeLookOffset, FRotator::ZeroRotator, DeltaSeconds, 6.0f);
    }
    if (!FlightComponent || !ChaseSpringArm) return;

    // Read deltas from the independent input route without ever mutating world-space Mouse Aim.
    const FVector2D LookDelta = FlightComponent->ConsumeFreeLookDeltaRadians();
    if (bFreeLookHeld)
    {
        FreeLookOffset.Yaw += FMath::RadiansToDegrees(LookDelta.X);
        FreeLookOffset.Pitch = FMath::Clamp(
            FreeLookOffset.Pitch + FMath::RadiansToDegrees(LookDelta.Y), -80.0f, 80.0f);
    }

    const FRotator AimRot = FlightComponent->GetDesiredAimWorldDirectionUE().Rotation();
    if (CameraMode == EAeroStrikeCameraMode::Chase)
    {
        ChaseSpringArm->SetWorldRotation(bFreeLookHeld ? (AimRot + FreeLookOffset) : AimRot);
    }
    else if (CameraMode == EAeroStrikeCameraMode::Flyby)
    {
        ChaseSpringArm->SetWorldRotation(AimRot + FRotator(-5.0f, 95.0f, 0.0f));
    }
    else if (CameraMode == EAeroStrikeCameraMode::Orbit)
    {
        const float OrbitDeg = static_cast<float>(GetWorld()->GetTimeSeconds()) * 14.0f;
        ChaseSpringArm->SetWorldRotation(FRotator(-16.0f, OrbitDeg, 0.0f));
    }

    if (EoirTurretCamera)
    {
        const FVector2D EoirDelta = FlightComponent->ConsumeEoirDeltaRadians();
        if (!EoirDelta.IsNearlyZero())
        {
            FRotator Offset = EoirTurretCamera->GetRelativeRotation();
            Offset.Yaw += FMath::RadiansToDegrees(EoirDelta.X);
            Offset.Pitch = FMath::Clamp(
                Offset.Pitch + FMath::RadiansToDegrees(EoirDelta.Y), -80.0f, 35.0f);
            EoirTurretCamera->SetRelativeRotation(Offset);
        }
    }
}

void AAeroStrikeUavPawn::CycleCameraMode()
{
    switch (CameraMode)
    {
        case EAeroStrikeCameraMode::Chase: CameraMode = EAeroStrikeCameraMode::EoirSensor; break;
        case EAeroStrikeCameraMode::EoirSensor: CameraMode = EAeroStrikeCameraMode::Flyby; break;
        case EAeroStrikeCameraMode::Flyby: CameraMode = EAeroStrikeCameraMode::Orbit; break;
        case EAeroStrikeCameraMode::Orbit:
        default:
            CameraMode = EAeroStrikeCameraMode::Chase;
            break;
    }

    const bool bUseEoir = (CameraMode == EAeroStrikeCameraMode::EoirSensor);
    if (ChaseCamera) ChaseCamera->SetActive(!bUseEoir);
    if (EoirTurretCamera) EoirTurretCamera->SetActive(bUseEoir);
}

void AAeroStrikeUavPawn::SetFreeLookHeld(bool bHeld)
{
    bFreeLookHeld = bHeld;
}

FVector AAeroStrikeUavPawn::GetActiveCameraLocation() const
{
    if (CameraMode == EAeroStrikeCameraMode::EoirSensor && EoirTurretCamera)
    {
        return EoirTurretCamera->GetComponentLocation();
    }
    return ChaseCamera ? ChaseCamera->GetComponentLocation() : GetActorLocation();
}

FVector AAeroStrikeUavPawn::GetActiveCameraForwardVector() const
{
    if (CameraMode == EAeroStrikeCameraMode::EoirSensor && EoirTurretCamera)
    {
        return EoirTurretCamera->GetForwardVector();
    }
    return ChaseCamera ? ChaseCamera->GetForwardVector() : GetActorForwardVector();
}
