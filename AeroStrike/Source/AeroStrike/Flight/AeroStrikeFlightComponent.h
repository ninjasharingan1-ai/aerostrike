#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "Aircraft/AeroStrikeAirframeDataAsset.h"
#include "SimCore/DroneFlightModel.h"
#include "SimCore/MouseAimCore.h"
#include "AeroStrikeFlightComponent.generated.h"

UCLASS(ClassGroup = (AeroStrike), meta = (BlueprintSpawnableComponent))
class AEROSTRIKE_API UAeroStrikeFlightComponent : public UActorComponent
{
    GENERATED_BODY()

public:
    UAeroStrikeFlightComponent();

    virtual void BeginPlay() override;
    virtual void TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction) override;

    void InitializeFromAirframe(const UAeroStrikeAirframeDataAsset* InAirframe);

    // P0 Approved Mouse Aim Input Routes
    void PushMousePointerDelta(double ClientX, double ClientY, double DeltaX, double DeltaY, bool bFreeLooking, bool bEoirMode);
    void OnPointerLockChanged(bool bLocked);
    void OnWindowFocusLost();
    void SetManualOverrideInput(double Pitch, double Roll, double Yaw, double ThrottleDelta);
    void SetFlightPreset(bool bRealistic);
    void SetKamikazeArmed(bool bArmed);

    UFUNCTION(BlueprintPure, Category = "AeroStrike|Flight")
    FVector GetDesiredAimWorldDirectionUE() const;

    UFUNCTION(BlueprintPure, Category = "AeroStrike|Flight")
    double GetAirspeedKnots() const;

    UFUNCTION(BlueprintPure, Category = "AeroStrike|Flight")
    double GetAltitudeAglMeters() const;

    UFUNCTION(BlueprintPure, Category = "AeroStrike|Flight")
    double GetFuelPercent() const { return 100.0; } // Non-negotiable: fuel depletion disabled

    // Coordinate conversion helpers: Sim (+X East, +Y Up, -Z North, meters) <-> UE (+X North, +Y East, +Z Up, cm)
    static FVector SimPosMetersToUECm(const AeroStrike::SimCore::Vec3& SimPos);
    static FVector SimDirToUEDir(const AeroStrike::SimCore::Vec3& SimDir);
    static AeroStrike::SimCore::Vec3 UEDirToSimDir(const FVector& UEDir);

protected:
    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Config")
    TObjectPtr<UAeroStrikeAirframeDataAsset> AirframeAsset;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Config")
    double AimSensitivity = 1.0;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Config")
    double FreeLookSensitivity = 1.0;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Config")
    bool bInvertY = false;

private:
    AeroStrike::SimCore::AirframeFlightSpec FlightSpec;
    AeroStrike::SimCore::DroneFlightState SimState;
    AeroStrike::SimCore::FlightEnvironmentContext EnvCtx;
    AeroStrike::SimCore::MouseInputState MouseState;
    AeroStrike::SimCore::InstructorManualOverride ManualInput;
    double DesiredAimYawRad = 0.0;
    double DesiredAimPitchRad = 0.02;
    double AccumulatorSec = 0.0;
    double HandoffBlend = 1.0;
    bool bManualWasActive = false;
    bool bFreeLookHeld = false;
    bool bEoirActive = false;
};
