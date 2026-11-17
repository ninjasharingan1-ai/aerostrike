#include "Aircraft/AeroStrikeUavPawn.h"
#include "Components/SkeletalMeshComponent.h"
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
}

void AAeroStrikeUavPawn::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    if (!bFreeLookHeld)
    {
        FreeLookOffset = FMath::RInterpTo(FreeLookOffset, FRotator::ZeroRotator, DeltaSeconds, 6.0f);
    }
    if (ChaseSpringArm && CameraMode == EAeroStrikeCameraMode::Chase && FlightComponent)
    {
        // Chase camera follows DesiredAim direction gently when not free-looking; never steers the aircraft
        const FRotator AimRot = FlightComponent->GetDesiredAimWorldDirectionUE().Rotation();
        ChaseSpringArm->SetWorldRotation(bFreeLookHeld ? (AimRot + FreeLookOffset) : AimRot);
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
