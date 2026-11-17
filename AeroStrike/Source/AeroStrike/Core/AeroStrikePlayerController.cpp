#include "Core/AeroStrikePlayerController.h"
#include "EnhancedInputComponent.h"
#include "EnhancedInputSubsystems.h"
#include "Aircraft/AeroStrikeUavPawn.h"
#include "Flight/AeroStrikeFlightComponent.h"
#include "Weapons/WeaponLoadoutComponent.h"
#include "Components/InputComponent.h"
#include "InputCoreTypes.h"

void AAeroStrikePlayerController::BeginPlay()
{
    Super::BeginPlay();
    if (UEnhancedInputLocalPlayerSubsystem* Sub =
        ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(GetLocalPlayer()))
    {
        if (FlightMappingContext)
        {
            Sub->AddMappingContext(FlightMappingContext, 0);
        }
    }
    FInputModeGameOnly GameModeInput;
    SetInputMode(GameModeInput);
    bShowMouseCursor = false;
    bPointerCaptured = true;
    if (AAeroStrikeUavPawn* Uav = GetUavPawn())
    {
        if (auto* Flight = Uav->GetFlightComponent()) Flight->OnPointerLockChanged(true);
    }
}

void AAeroStrikePlayerController::SetupInputComponent()
{
    Super::SetupInputComponent();
    if (UEnhancedInputComponent* EIC = Cast<UEnhancedInputComponent>(InputComponent))
    {
        if (IA_AimLook) EIC->BindAction(IA_AimLook, ETriggerEvent::Triggered, this, &ThisClass::HandleAimLook);
        if (IA_FirePrimary)
        {
            EIC->BindAction(IA_FirePrimary, ETriggerEvent::Started, this, &ThisClass::HandleFirePressed);
            EIC->BindAction(IA_FirePrimary, ETriggerEvent::Completed, this, &ThisClass::HandleFireReleased);
            EIC->BindAction(IA_FirePrimary, ETriggerEvent::Canceled, this, &ThisClass::HandleFireReleased);
        }
        if (IA_CycleFireMode) EIC->BindAction(IA_CycleFireMode, ETriggerEvent::Started, this, &ThisClass::HandleCycleFireMode);
        if (IA_FreeLook)
        {
            EIC->BindAction(IA_FreeLook, ETriggerEvent::Started, this, &ThisClass::HandleFreeLookStarted);
            EIC->BindAction(IA_FreeLook, ETriggerEvent::Completed, this, &ThisClass::HandleFreeLookCompleted);
        }
        if (IA_CycleCamera) EIC->BindAction(IA_CycleCamera, ETriggerEvent::Started, this, &ThisClass::HandleCycleCamera);
        if (IA_TogglePointerLock) EIC->BindAction(IA_TogglePointerLock, ETriggerEvent::Started, this, &ThisClass::HandleTogglePointerLock);
        if (IA_SelectSlot1) EIC->BindActionValueLambda(IA_SelectSlot1, ETriggerEvent::Started, [this](const FInputActionValue&) { SelectWeaponSlot(0); });
        if (IA_SelectSlot2) EIC->BindActionValueLambda(IA_SelectSlot2, ETriggerEvent::Started, [this](const FInputActionValue&) { SelectWeaponSlot(1); });
        if (IA_SelectSlot3) EIC->BindActionValueLambda(IA_SelectSlot3, ETriggerEvent::Started, [this](const FInputActionValue&) { SelectWeaponSlot(2); });
        if (IA_SelectSlot4) EIC->BindActionValueLambda(IA_SelectSlot4, ETriggerEvent::Started, [this](const FInputActionValue&) { SelectWeaponSlot(3); });
    }

    // Bootstrap a playable UE scene without relying on missing IA_*/IMC_*.uasset content.
    // Once authored input assets are supplied, each corresponding fallback is disabled.
    if (!IA_AimLook)
    {
        InputComponent->BindAxisKey(EKeys::MouseX, this, &ThisClass::FallbackMouseX);
        InputComponent->BindAxisKey(EKeys::MouseY, this, &ThisClass::FallbackMouseY);
    }
    if (!IA_FirePrimary)
    {
        InputComponent->BindKey(EKeys::LeftMouseButton, IE_Pressed, this, &ThisClass::FallbackFirePressed);
        InputComponent->BindKey(EKeys::LeftMouseButton, IE_Released, this, &ThisClass::FallbackFireReleased);
        InputComponent->BindKey(EKeys::SpaceBar, IE_Pressed, this, &ThisClass::FallbackFirePressed);
        InputComponent->BindKey(EKeys::SpaceBar, IE_Released, this, &ThisClass::FallbackFireReleased);
    }
    if (!IA_CycleFireMode) InputComponent->BindKey(EKeys::R, IE_Pressed, this, &ThisClass::FallbackFireMode);
    if (!IA_FreeLook)
    {
        InputComponent->BindKey(EKeys::C, IE_Pressed, this, &ThisClass::FallbackFreeLookStarted);
        InputComponent->BindKey(EKeys::C, IE_Released, this, &ThisClass::FallbackFreeLookCompleted);
    }
    if (!IA_CycleCamera) InputComponent->BindKey(EKeys::U, IE_Pressed, this, &ThisClass::FallbackCycleCamera);
    if (!IA_TogglePointerLock) InputComponent->BindKey(EKeys::L, IE_Pressed, this, &ThisClass::FallbackTogglePointerLock);
    if (!IA_SelectSlot1) InputComponent->BindKey(EKeys::One, IE_Pressed, this, &ThisClass::FallbackSlotOne);
    if (!IA_SelectSlot2) InputComponent->BindKey(EKeys::Two, IE_Pressed, this, &ThisClass::FallbackSlotTwo);
    if (!IA_SelectSlot3) InputComponent->BindKey(EKeys::Three, IE_Pressed, this, &ThisClass::FallbackSlotThree);
    if (!IA_SelectSlot4) InputComponent->BindKey(EKeys::Four, IE_Pressed, this, &ThisClass::FallbackSlotFour);
}

void AAeroStrikePlayerController::OnWindowFocusLost()
{
    if (AAeroStrikeUavPawn* Uav = GetUavPawn())
    {
        if (auto* Flight = Uav->GetFlightComponent()) Flight->OnWindowFocusLost();
        if (auto* Wep = Uav->GetWeaponComponent()) Wep->RequestPrimaryFireReleased();
    }
}

AAeroStrikeUavPawn* AAeroStrikePlayerController::GetUavPawn() const
{
    return Cast<AAeroStrikeUavPawn>(GetPawn());
}

void AAeroStrikePlayerController::HandleAimLook(const FInputActionValue& Value)
{
    AAeroStrikeUavPawn* Uav = GetUavPawn();
    if (!Uav || !Uav->GetFlightComponent()) return;
    const FVector2D Delta = Value.Get<FVector2D>();
    double MouseX = 0.0, MouseY = 0.0;
    GetMousePosition(MouseX, MouseY);
    const bool bEoir = Uav->GetCameraMode() == EAeroStrikeCameraMode::EoirSensor;
    Uav->GetFlightComponent()->PushMousePointerDelta(MouseX, MouseY, Delta.X, -Delta.Y, Uav->IsFreeLookHeld(), bEoir);
}

void AAeroStrikePlayerController::HandleFirePressed(const FInputActionValue&)
{
    if (AAeroStrikeUavPawn* Uav = GetUavPawn())
    {
        if (auto* Wep = Uav->GetWeaponComponent()) Wep->RequestPrimaryFirePressed();
    }
}

void AAeroStrikePlayerController::HandleFireReleased(const FInputActionValue&)
{
    if (AAeroStrikeUavPawn* Uav = GetUavPawn())
    {
        if (auto* Wep = Uav->GetWeaponComponent()) Wep->RequestPrimaryFireReleased();
    }
}

void AAeroStrikePlayerController::HandleCycleFireMode(const FInputActionValue&)
{
    if (AAeroStrikeUavPawn* Uav = GetUavPawn())
    {
        if (auto* Wep = Uav->GetWeaponComponent()) Wep->CycleActiveFireMode();
    }
}

void AAeroStrikePlayerController::HandleFreeLookStarted(const FInputActionValue&)
{
    if (AAeroStrikeUavPawn* Uav = GetUavPawn()) Uav->SetFreeLookHeld(true);
}

void AAeroStrikePlayerController::HandleFreeLookCompleted(const FInputActionValue&)
{
    if (AAeroStrikeUavPawn* Uav = GetUavPawn()) Uav->SetFreeLookHeld(false);
}

void AAeroStrikePlayerController::HandleCycleCamera(const FInputActionValue&)
{
    if (AAeroStrikeUavPawn* Uav = GetUavPawn()) Uav->CycleCameraMode();
}

void AAeroStrikePlayerController::HandleTogglePointerLock(const FInputActionValue&)
{
    bPointerCaptured = !bPointerCaptured;
    bShowMouseCursor = !bPointerCaptured;
    if (AAeroStrikeUavPawn* Uav = GetUavPawn())
    {
        if (auto* Flight = Uav->GetFlightComponent()) Flight->OnPointerLockChanged(bPointerCaptured);
    }
}

void AAeroStrikePlayerController::SelectWeaponSlot(int32 SlotIdx)
{
    if (AAeroStrikeUavPawn* Uav = GetUavPawn())
    {
        if (auto* Wep = Uav->GetWeaponComponent()) Wep->SelectSlot(SlotIdx);
    }
}

void AAeroStrikePlayerController::FallbackMouseX(float AxisValue)
{
    if (FMath::IsNearlyZero(AxisValue)) return;
    AAeroStrikeUavPawn* Uav = GetUavPawn();
    if (!Uav || !Uav->GetFlightComponent()) return;
    double X = 0.0, Y = 0.0;
    GetMousePosition(X, Y);
    Uav->GetFlightComponent()->PushMousePointerDelta(
        X, Y, AxisValue, 0.0, Uav->IsFreeLookHeld(),
        Uav->GetCameraMode() == EAeroStrikeCameraMode::EoirSensor);
}

void AAeroStrikePlayerController::FallbackMouseY(float AxisValue)
{
    if (FMath::IsNearlyZero(AxisValue)) return;
    AAeroStrikeUavPawn* Uav = GetUavPawn();
    if (!Uav || !Uav->GetFlightComponent()) return;
    double X = 0.0, Y = 0.0;
    GetMousePosition(X, Y);
    Uav->GetFlightComponent()->PushMousePointerDelta(
        X, Y, 0.0, -AxisValue, Uav->IsFreeLookHeld(),
        Uav->GetCameraMode() == EAeroStrikeCameraMode::EoirSensor);
}

void AAeroStrikePlayerController::FallbackFirePressed() { HandleFirePressed(FInputActionValue()); }
void AAeroStrikePlayerController::FallbackFireReleased() { HandleFireReleased(FInputActionValue()); }
void AAeroStrikePlayerController::FallbackFireMode() { HandleCycleFireMode(FInputActionValue()); }
void AAeroStrikePlayerController::FallbackFreeLookStarted() { HandleFreeLookStarted(FInputActionValue()); }
void AAeroStrikePlayerController::FallbackFreeLookCompleted() { HandleFreeLookCompleted(FInputActionValue()); }
void AAeroStrikePlayerController::FallbackCycleCamera() { HandleCycleCamera(FInputActionValue()); }
void AAeroStrikePlayerController::FallbackTogglePointerLock() { HandleTogglePointerLock(FInputActionValue()); }
void AAeroStrikePlayerController::FallbackSlotOne() { SelectWeaponSlot(0); }
void AAeroStrikePlayerController::FallbackSlotTwo() { SelectWeaponSlot(1); }
void AAeroStrikePlayerController::FallbackSlotThree() { SelectWeaponSlot(2); }
void AAeroStrikePlayerController::FallbackSlotFour() { SelectWeaponSlot(3); }
