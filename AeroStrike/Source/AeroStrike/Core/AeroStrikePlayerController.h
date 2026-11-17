#pragma once

#include "CoreMinimal.h"
#include "GameFramework/PlayerController.h"
#include "InputActionValue.h"
#include "AeroStrikePlayerController.generated.h"

class UInputMappingContext;
class UInputAction;
class AAeroStrikeUavPawn;

UCLASS()
class AEROSTRIKE_API AAeroStrikePlayerController : public APlayerController
{
    GENERATED_BODY()

public:
    virtual void BeginPlay() override;
    virtual void SetupInputComponent() override;
    virtual void OnWindowFocusLost();

protected:
    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Input")
    TObjectPtr<UInputMappingContext> FlightMappingContext;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Input")
    TObjectPtr<UInputAction> IA_AimLook;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Input")
    TObjectPtr<UInputAction> IA_FirePrimary;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Input")
    TObjectPtr<UInputAction> IA_CycleFireMode;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Input")
    TObjectPtr<UInputAction> IA_SelectSlot1;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Input")
    TObjectPtr<UInputAction> IA_SelectSlot2;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Input")
    TObjectPtr<UInputAction> IA_SelectSlot3;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Input")
    TObjectPtr<UInputAction> IA_SelectSlot4;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Input")
    TObjectPtr<UInputAction> IA_FreeLook;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Input")
    TObjectPtr<UInputAction> IA_CycleCamera;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Input")
    TObjectPtr<UInputAction> IA_TogglePointerLock;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Input")
    TObjectPtr<UInputAction> IA_ReconMark;

private:
    bool bPointerCaptured = false;
    AAeroStrikeUavPawn* GetUavPawn() const;

    void HandleAimLook(const FInputActionValue& Value);
    void HandleFirePressed(const FInputActionValue& Value);
    void HandleFireReleased(const FInputActionValue& Value);
    void HandleCycleFireMode(const FInputActionValue& Value);
    void HandleFreeLookStarted(const FInputActionValue& Value);
    void HandleFreeLookCompleted(const FInputActionValue& Value);
    void HandleCycleCamera(const FInputActionValue& Value);
    void HandleTogglePointerLock(const FInputActionValue& Value);
    void SelectWeaponSlot(int32 SlotIdx);
};
