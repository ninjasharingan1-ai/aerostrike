#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Pawn.h"
#include "AeroStrikeUavPawn.generated.h"

class USkeletalMeshComponent;
class UStaticMeshComponent;
class USpringArmComponent;
class UCameraComponent;
class UAeroStrikeFlightComponent;
class UWeaponLoadoutComponent;
class UEoirObservationComponent;
class UAeroStrikeAirframeDataAsset;

UENUM(BlueprintType)
enum class EAeroStrikeCameraMode : uint8
{
    Chase,
    EoirSensor,
    Flyby,
    Orbit
};

UCLASS()
class AEROSTRIKE_API AAeroStrikeUavPawn : public APawn
{
    GENERATED_BODY()

public:
    AAeroStrikeUavPawn();

    virtual void BeginPlay() override;
    virtual void Tick(float DeltaSeconds) override;

    UFUNCTION(BlueprintCallable, Category = "AeroStrike|Camera")
    void CycleCameraMode();

    UFUNCTION(BlueprintCallable, Category = "AeroStrike|Camera")
    void SetFreeLookHeld(bool bHeld);

    UFUNCTION(BlueprintPure, Category = "AeroStrike|Camera")
    EAeroStrikeCameraMode GetCameraMode() const { return CameraMode; }

    UFUNCTION(BlueprintPure, Category = "AeroStrike|Camera")
    bool IsFreeLookHeld() const { return bFreeLookHeld; }

    FVector GetActiveCameraLocation() const;
    FVector GetActiveCameraForwardVector() const;

    UAeroStrikeFlightComponent* GetFlightComponent() const { return FlightComponent; }
    UWeaponLoadoutComponent* GetWeaponComponent() const { return WeaponComponent; }
    UEoirObservationComponent* GetEoirComponent() const { return EoirComponent; }

protected:
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
    TObjectPtr<USkeletalMeshComponent> AirframeMesh;

    // Visible training proxy until licensed production skeletal meshes are imported.
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Bootstrap")
    TObjectPtr<UStaticMeshComponent> FallbackFuselage;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Bootstrap")
    TObjectPtr<UStaticMeshComponent> FallbackWings;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Bootstrap")
    TObjectPtr<UStaticMeshComponent> FallbackTail;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
    TObjectPtr<USpringArmComponent> ChaseSpringArm;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
    TObjectPtr<UCameraComponent> ChaseCamera;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
    TObjectPtr<UCameraComponent> EoirTurretCamera;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
    TObjectPtr<UAeroStrikeFlightComponent> FlightComponent;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
    TObjectPtr<UWeaponLoadoutComponent> WeaponComponent;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
    TObjectPtr<UEoirObservationComponent> EoirComponent;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Data")
    TObjectPtr<UAeroStrikeAirframeDataAsset> DefaultAirframeAsset;

private:
    EAeroStrikeCameraMode CameraMode = EAeroStrikeCameraMode::Chase;
    bool bFreeLookHeld = false;
    FRotator FreeLookOffset = FRotator::ZeroRotator;
};
