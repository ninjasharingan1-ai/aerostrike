#include "Weapons/WeaponLoadoutComponent.h"
#include "Net/UnrealNetwork.h"

UWeaponLoadoutComponent::UWeaponLoadoutComponent()
{
    PrimaryComponentTick.bCanEverTick = true;
    SetIsReplicatedByDefault(true);
}

void UWeaponLoadoutComponent::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
    Super::GetLifetimeReplicatedProps(OutLifetimeProps);
    DOREPLIFETIME(UWeaponLoadoutComponent, EquippedVariants);
}

void UWeaponLoadoutComponent::BeginPlay()
{
    Super::BeginPlay();
    for (int32 i = 0; i < 4; ++i)
    {
        if (EquippedVariants.IsValidIndex(i) && EquippedVariants[i])
        {
            const UWeaponVariantDataAsset* V = EquippedVariants[i];
            StateMachine.slots[i].weaponId = TCHAR_TO_UTF8(*V->WeaponId.ToString());
            StateMachine.slots[i].ammoRemaining = V->AmmoPerSlot;
            StateMachine.slots[i].cooldownRemainingSec = 0.0;
            StateMachine.slots[i].fireMode = static_cast<AeroStrike::SimCore::EFireMode>(V->DefaultFireMode);
        }
    }
}

void UWeaponLoadoutComponent::TickComponent(
    float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction)
{
    Super::TickComponent(DeltaTime, TickType, ThisTickFunction);

    if (GetOwner() && !GetOwner()->HasAuthority())
    {
        return; // Server owns authoritative firing state machine; clients receive MulticastWeaponEvent
    }

    std::vector<AeroStrike::SimCore::WeaponGameplayEvent> Events;
    const auto Spec = BuildSimVariant(StateMachine.activeSlot);
    StateMachine.step(static_cast<double>(DeltaTime), Spec, Events);
    DispatchSimEvents(Events);
}

void UWeaponLoadoutComponent::RequestPrimaryFirePressed()
{
    if (GetOwner() && !GetOwner()->HasAuthority())
    {
        ServerRequestPrimaryFire(true);
        return;
    }
    StateMachine.onTriggerPressed();
}

void UWeaponLoadoutComponent::RequestPrimaryFireReleased()
{
    if (GetOwner() && !GetOwner()->HasAuthority())
    {
        ServerRequestPrimaryFire(false);
        return;
    }
    StateMachine.onTriggerReleased();
}

void UWeaponLoadoutComponent::SelectSlot(int32 NewSlotIndex)
{
    if (GetOwner() && !GetOwner()->HasAuthority())
    {
        ServerSelectSlot(NewSlotIndex);
        return;
    }
    std::vector<AeroStrike::SimCore::WeaponGameplayEvent> Events;
    StateMachine.requestSlotSwitch(NewSlotIndex, Events);
    DispatchSimEvents(Events);
}

void UWeaponLoadoutComponent::CycleActiveFireMode()
{
    const auto Spec = BuildSimVariant(StateMachine.activeSlot);
    auto& Slot = StateMachine.slots[StateMachine.activeSlot];
    Slot.fireMode = AeroStrike::SimCore::cycleAllowedFireMode(Spec, Slot.fireMode);
    MulticastWeaponEvent(
        EWeaponEventKindBP::FireModeChanged,
        StateMachine.activeSlot,
        FName(UTF8_TO_TCHAR(Slot.weaponId.c_str())),
        Slot.ammoRemaining);
}

void UWeaponLoadoutComponent::SetPausedOrDisrupted(bool bPaused, bool bDisrupted)
{
    std::vector<AeroStrike::SimCore::WeaponGameplayEvent> Events;
    StateMachine.setPausedOrDisrupted(bPaused, bDisrupted, Events);
    DispatchSimEvents(Events);
}

void UWeaponLoadoutComponent::ServerRequestPrimaryFire_Implementation(bool bPressed)
{
    if (bPressed) StateMachine.onTriggerPressed();
    else StateMachine.onTriggerReleased();
}

void UWeaponLoadoutComponent::ServerSelectSlot_Implementation(int32 NewSlotIndex)
{
    SelectSlot(NewSlotIndex);
}

void UWeaponLoadoutComponent::MulticastWeaponEvent_Implementation(
    EWeaponEventKindBP EventKind, int32 SlotIndex, FName WeaponId, int32 RemainingAmmo)
{
    OnWeaponGameplayEvent.Broadcast(EventKind, SlotIndex, WeaponId, RemainingAmmo);
}

AeroStrike::SimCore::WeaponVariantSpec UWeaponLoadoutComponent::BuildSimVariant(int32 SlotIdx) const
{
    AeroStrike::SimCore::WeaponVariantSpec Out;
    if (!EquippedVariants.IsValidIndex(SlotIdx) || !EquippedVariants[SlotIdx])
    {
        return Out;
    }
    const UWeaponVariantDataAsset* V = EquippedVariants[SlotIdx];
    Out.id = TCHAR_TO_UTF8(*V->WeaponId.ToString());
    Out.displayName = TCHAR_TO_UTF8(*V->DisplayName.ToString());
    Out.cooldownSec = V->CooldownSec;
    Out.burstCount = V->BurstCount;
    Out.burstIntervalSec = V->BurstIntervalSec;
    Out.massKg = V->MassKg;
    Out.ammoPerSlot = V->AmmoPerSlot;
    Out.rotaryBarrels = V->RotaryBarrels;
    Out.defaultFireMode = static_cast<AeroStrike::SimCore::EFireMode>(V->DefaultFireMode);
    if (V->FamilyAsset)
    {
        Out.domain = static_cast<AeroStrike::SimCore::EWeaponDomain>(V->FamilyAsset->Domain);
        Out.family = static_cast<AeroStrike::SimCore::EWeaponFamily>(V->FamilyAsset->Family);
        if (V->FamilyAsset->bUsesRotarySpinUp)
        {
            Out.spinUpDurationSec = 0.08;
            Out.spinDownDurationSec = 0.25;
        }
    }
    for (const auto Mode : V->AllowedFireModes)
    {
        Out.allowedFireModes.push_back(static_cast<AeroStrike::SimCore::EFireMode>(Mode));
    }
    return Out;
}

void UWeaponLoadoutComponent::DispatchSimEvents(const std::vector<AeroStrike::SimCore::WeaponGameplayEvent>& Events)
{
    for (const auto& E : Events)
    {
        EWeaponEventKindBP Kind = EWeaponEventKindBP::RoundFired;
        switch (E.type)
        {
            case AeroStrike::SimCore::EWeaponEventType::SpinUpStarted: Kind = EWeaponEventKindBP::SpinUpStarted; break;
            case AeroStrike::SimCore::EWeaponEventType::SpinDownStarted: Kind = EWeaponEventKindBP::SpinDownStarted; break;
            case AeroStrike::SimCore::EWeaponEventType::FireModeChanged: Kind = EWeaponEventKindBP::FireModeChanged; break;
            case AeroStrike::SimCore::EWeaponEventType::SlotChanged: Kind = EWeaponEventKindBP::SlotChanged; break;
            case AeroStrike::SimCore::EWeaponEventType::AmmoDepleted: Kind = EWeaponEventKindBP::AmmoDepleted; break;
            case AeroStrike::SimCore::EWeaponEventType::RoundFired:
            default:
                Kind = EWeaponEventKindBP::RoundFired;
                break;
        }
        MulticastWeaponEvent(Kind, E.slotIndex, FName(UTF8_TO_TCHAR(E.weaponId.c_str())), E.remainingAmmo);
    }
}
