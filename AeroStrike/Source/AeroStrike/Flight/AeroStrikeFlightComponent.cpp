#include "Flight/AeroStrikeFlightComponent.h"
#include "GameFramework/Actor.h"
#include "Engine/World.h"

UAeroStrikeFlightComponent::UAeroStrikeFlightComponent()
{
    PrimaryComponentTick.bCanEverTick = true;
}

void UAeroStrikeFlightComponent::BeginPlay()
{
    Super::BeginPlay();
    EnvCtx.disableFuelDepletion = true; // Enforced non-negotiable invariant
    if (AirframeAsset)
    {
        InitializeFromAirframe(AirframeAsset);
    }
}

void UAeroStrikeFlightComponent::InitializeFromAirframe(const UAeroStrikeAirframeDataAsset* InAirframe)
{
    if (!InAirframe) return;
    FlightSpec = InAirframe->ToFlightSpec();
    SimState.maxHp = FlightSpec.maxHp;
    SimState.hp = FlightSpec.maxHp;
    SimState.maxFuelKg = FlightSpec.maxFuelKg;
    SimState.fuelKg = FlightSpec.maxFuelKg;
}

void UAeroStrikeFlightComponent::PushMousePointerDelta(
    double ClientX, double ClientY, double DeltaX, double DeltaY, bool bFreeLooking, bool bEoirMode)
{
    bFreeLookHeld = bFreeLooking;
    bEoirActive = bEoirMode;
    const auto Route = bFreeLooking
        ? AeroStrike::SimCore::EPointerRoute::FreeLook
        : (bEoirMode ? AeroStrike::SimCore::EPointerRoute::Eoir : AeroStrike::SimCore::EPointerRoute::Aim);
    AeroStrike::SimCore::handleMousePointerMove(MouseState, ClientX, ClientY, DeltaX, DeltaY, Route);
}

void UAeroStrikeFlightComponent::OnPointerLockChanged(bool bLocked)
{
    AeroStrike::SimCore::handleMousePointerLockChange(MouseState, bLocked);
}

void UAeroStrikeFlightComponent::OnWindowFocusLost()
{
    AeroStrike::SimCore::handleMouseFocusLoss(MouseState);
}

void UAeroStrikeFlightComponent::SetManualOverrideInput(double Pitch, double Roll, double Yaw, double ThrottleDelta)
{
    ManualInput.pitchOverride = Pitch;
    ManualInput.rollOverride = Roll;
    ManualInput.yawOverride = Yaw;
    ManualInput.throttleDelta = ThrottleDelta;
}

void UAeroStrikeFlightComponent::SetFlightPreset(bool bRealistic)
{
    EnvCtx.preset = bRealistic ? AeroStrike::SimCore::EFlightPreset::Realistic : AeroStrike::SimCore::EFlightPreset::Arcade;
}

void UAeroStrikeFlightComponent::SetKamikazeArmed(bool bArmed)
{
    EnvCtx.kamikazeArmed = bArmed;
}

void UAeroStrikeFlightComponent::TickComponent(
    float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction)
{
    Super::TickComponent(DeltaTime, TickType, ThisTickFunction);

    const bool bManualActive =
        FMath::Abs(ManualInput.pitchOverride) > 0.05 ||
        FMath::Abs(ManualInput.rollOverride) > 0.05 ||
        FMath::Abs(ManualInput.yawOverride) > 0.05;

    if (bManualWasActive && !bManualActive)
    {
        HandoffBlend = 0.0;
    }
    bManualWasActive = bManualActive;
    HandoffBlend = FMath::Min(1.0, HandoffBlend + static_cast<double>(DeltaTime) * 4.5);

    AeroStrike::SimCore::MouseAimInputConfig MouseCfg;
    MouseCfg.aimSensitivity = AimSensitivity;
    MouseCfg.freeLookSensitivity = FreeLookSensitivity;
    MouseCfg.invertY = bInvertY;
    const auto Consumed = AeroStrike::SimCore::consumeMouseFrameInput(MouseState, MouseCfg);

    AeroStrike::SimCore::MouseAimStepInput AimStep;
    AimStep.aimYaw = DesiredAimYawRad;
    AimStep.aimPitch = DesiredAimPitchRad;
    AimStep.aimDeltaYawRad = Consumed.aimDeltaYawRad;
    AimStep.aimDeltaPitchRad = Consumed.aimDeltaPitchRad;
    AimStep.manualOverrideActive = bManualActive;
    AimStep.freeLooking = bFreeLookHeld;
    AimStep.droneYaw = SimState.yaw;
    AimStep.dronePitch = SimState.pitch;
    AimStep.scheme = AeroStrike::SimCore::EControlScheme::MouseAim;

    const auto AimOut = AeroStrike::SimCore::stepWarThunderAimAngles(AimStep);
    DesiredAimYawRad = AimOut.aimYaw;
    DesiredAimPitchRad = AimOut.aimPitch;

    // Fixed 60Hz deterministic simulation accumulator
    constexpr double FixedDt = 1.0 / 60.0;
    AccumulatorSec = FMath::Min(0.25, AccumulatorSec + static_cast<double>(DeltaTime));
    while (AccumulatorSec >= FixedDt)
    {
        EnvCtx.elapsedTimeSec += FixedDt;
        EnvCtx.disableFuelDepletion = true;

        AeroStrike::SimCore::InstructorOptions InstOpts;
        InstOpts.pitchRateRad = SimState.pitchRateRad;
        InstOpts.rollRateRad = SimState.rollRateRad;
        InstOpts.yawRateRad = SimState.yawRateRad;
        InstOpts.handoffBlend = HandoffBlend;

        const auto Ctrl = AeroStrike::SimCore::computeInstructorControlInput(
            SimState.yaw, SimState.pitch, SimState.roll, AimOut.targetDir, ManualInput, InstOpts);

        SimState = AeroStrike::SimCore::stepDroneFlight(SimState, FlightSpec, Ctrl, EnvCtx, FixedDt);
        AccumulatorSec -= FixedDt;
    }

    if (AActor* Owner = GetOwner())
    {
        const FVector NewLoc = SimPosMetersToUECm({ SimState.x, SimState.y, SimState.z });
        const FVector FwdDir = SimDirToUEDir(AeroStrike::SimCore::aimAnglesToDirection(SimState.yaw, SimState.pitch));
        FRotator NewRot = FwdDir.Rotation();
        NewRot.Roll = -FMath::RadiansToDegrees(SimState.roll);
        Owner->SetActorLocationAndRotation(NewLoc, NewRot, false);
    }
}

FVector UAeroStrikeFlightComponent::GetDesiredAimWorldDirectionUE() const
{
    return SimDirToUEDir(AeroStrike::SimCore::aimAnglesToDirection(DesiredAimYawRad, DesiredAimPitchRad));
}

double UAeroStrikeFlightComponent::GetAirspeedKnots() const
{
    return SimState.airspeedMs * 1.94384;
}

double UAeroStrikeFlightComponent::GetAltitudeAglMeters() const
{
    return SimState.aglMeters;
}

FVector UAeroStrikeFlightComponent::SimPosMetersToUECm(const AeroStrike::SimCore::Vec3& SimPos)
{
    // Sim: +X East, +Y Up, -Z North (m) -> UE: +X North, +Y East, +Z Up (cm)
    return FVector(-SimPos.z * 100.0, SimPos.x * 100.0, SimPos.y * 100.0);
}

FVector UAeroStrikeFlightComponent::SimDirToUEDir(const AeroStrike::SimCore::Vec3& SimDir)
{
    return FVector(-SimDir.z, SimDir.x, SimDir.y).GetSafeNormal();
}

AeroStrike::SimCore::Vec3 UAeroStrikeFlightComponent::UEDirToSimDir(const FVector& UEDir)
{
    const FVector N = UEDir.GetSafeNormal();
    return AeroStrike::SimCore::Vec3{ N.Y, N.Z, -N.X };
}
