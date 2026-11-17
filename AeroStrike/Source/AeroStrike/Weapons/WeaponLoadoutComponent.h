#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "Weapons/AeroStrikeWeaponDataAssets.h"
#include "SimCore/WeaponFamilyCore.h"
#include "WeaponLoadoutComponent.generated.h"

UENUM(BlueprintType)
enum class EWeaponEventKindBP : uint8
{
    RoundFired,
    SpinUpStarted,
    SpinDownStarted,
    FireModeChanged,
    SlotChanged,
    AmmoDepleted
};

DECLARE_DYNAMIC_MULTICAST_DELEGATE_FourParams(
    FOnAeroStrikeWeaponEvent,
    EWeaponEventKindBP, EventKind,
    int32, SlotIndex,
    FName, WeaponId,
    int32, RemainingAmmo
);

UCLASS(ClassGroup = (AeroStrike), meta = (BlueprintSpawnableComponent))
class AEROSTRIKE_API UWeaponLoadoutComponent : public UActorComponent
{
    GENERATED_BODY()

public:
    UWeaponLoadoutComponent();

    virtual void BeginPlay() override;
    virtual void TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction) override;
    virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override;

    UPROPERTY(BlueprintAssignable, Category = "AeroStrike|Weapons")
    FOnAeroStrikeWeaponEvent OnWeaponGameplayEvent;

    UFUNCTION(BlueprintCallable, Category = "AeroStrike|Weapons")
    void RequestPrimaryFirePressed();

    UFUNCTION(BlueprintCallable, Category = "AeroStrike|Weapons")
    void RequestPrimaryFireReleased();

    UFUNCTION(BlueprintCallable, Category = "AeroStrike|Weapons")
    void SelectSlot(int32 NewSlotIndex);

    UFUNCTION(BlueprintCallable, Category = "AeroStrike|Weapons")
    void CycleActiveFireMode();

    UFUNCTION(BlueprintCallable, Category = "AeroStrike|Weapons")
    void SetPausedOrDisrupted(bool bPaused, bool bDisrupted);

    UFUNCTION(BlueprintPure, Category = "AeroStrike|Weapons")
    int32 GetActiveSlotIndex() const { return StateMachine.activeSlot; }

    UFUNCTION(BlueprintPure, Category = "AeroStrike|Weapons")
    double GetRotaryBarrelAngleRad() const { return StateMachine.barrelAngleRad; }

protected:
    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Config")
    TArray<TObjectPtr<UHardpointDataAsset>> Hardpoints;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Replicated, Category = "Config")
    TArray<TObjectPtr<UWeaponVariantDataAsset>> EquippedVariants;

    UFUNCTION(Server, Reliable)
    void ServerRequestPrimaryFire(bool bPressed);

    UFUNCTION(Server, Reliable)
    void ServerSelectSlot(int32 NewSlotIndex);

    UFUNCTION(NetMulticast, Reliable)
    void MulticastWeaponEvent(EWeaponEventKindBP EventKind, int32 SlotIndex, FName WeaponId, int32 RemainingAmmo);

private:
    AeroStrike::SimCore::WeaponFireStateMachine StateMachine;
    AeroStrike::SimCore::WeaponVariantSpec BuildSimVariant(int32 SlotIdx) const;
    void DispatchSimEvents(const std::vector<AeroStrike::SimCore::WeaponGameplayEvent>& Events);
};
