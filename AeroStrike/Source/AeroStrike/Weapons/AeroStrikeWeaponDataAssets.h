#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "GameplayTagContainer.h"
#include "Aircraft/AeroStrikeAirframeDataAsset.h"
#include "SimCore/WeaponFamilyCore.h"
#include "AeroStrikeWeaponDataAssets.generated.h"

class UNiagaraSystem;
class USoundBase;

UENUM(BlueprintType)
enum class EWeaponDomainBP : uint8
{
    ProjectileGuns,
    GuidedOrdnance,
    ReleaseOrdnance,
    DefensiveUtility
};

UENUM(BlueprintType)
enum class EWeaponFamilyBP : uint8
{
    FamilyA_LightweightUavGun,
    FamilyB_MediumUavMachineGun,
    FamilyC_RotaryAircraftGunPod,
    FamilyD_TacticalRwsTurret,
    FamilyE_GuidedGameOrdnance,
    FamilyF_BombAndReleaseSystem,
    FamilyG_DefensiveAndUtility
};

UENUM(BlueprintType)
enum class EWeaponFireModeBP : uint8
{
    Single,
    Burst,
    Auto
};

UCLASS(BlueprintType)
class AEROSTRIKE_API UWeaponPresentationDataAsset : public UDataAsset
{
    GENERATED_BODY()

public:
    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Mesh")
    TSoftObjectPtr<USkeletalMesh> WeaponMesh;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Mesh")
    TArray<TSoftObjectPtr<UMaterialInterface>> MaterialOverrides;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Animation")
    TSoftObjectPtr<UAnimMontage> FireRecoilMontage;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "VFX")
    TSoftObjectPtr<UNiagaraSystem> MuzzleFlashNiagara;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "VFX")
    TSoftObjectPtr<UNiagaraSystem> ProjectileTracerNiagara;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Audio")
    TSoftObjectPtr<USoundBase> TriggerTransientSound;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Audio")
    TSoftObjectPtr<USoundBase> MechanicalBodySound;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Audio")
    TSoftObjectPtr<USoundBase> SustainedLoopSound;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Audio")
    TSoftObjectPtr<USoundBase> EndingTailSound;
};

UCLASS(BlueprintType)
class AEROSTRIKE_API UWeaponFamilyDataAsset : public UPrimaryDataAsset
{
    GENERATED_BODY()

public:
    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Family")
    FName FamilyId;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Family")
    EWeaponDomainBP Domain = EWeaponDomainBP::ProjectileGuns;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Family")
    EWeaponFamilyBP Family = EWeaponFamilyBP::FamilyA_LightweightUavGun;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Family")
    FGameplayTagContainer FamilyTags;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Behavior")
    TArray<EWeaponFireModeBP> SupportedFireModes;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Behavior")
    bool bUsesRotarySpinUp = false;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Presentation")
    FGameplayTag AudioFamilyTag;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Presentation")
    FGameplayTag VfxFamilyTag;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Replication")
    bool bReplicateFireState = true;
};

UCLASS(BlueprintType)
class AEROSTRIKE_API UHardpointDataAsset : public UDataAsset
{
    GENERATED_BODY()

public:
    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Hardpoint")
    FName SlotId;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Hardpoint")
    int32 SlotIndex = 0;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Hardpoint")
    FName AttachSocketName;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Hardpoint")
    FTransform VisualAttachOffset;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Hardpoint")
    double CapacityKg = 150.0;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Hardpoint")
    TArray<EWeaponFamilyBP> AllowedFamilies;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Hardpoint")
    bool bMirrorSymmetricWithOppositeWing = false;
};

UCLASS(BlueprintType)
class AEROSTRIKE_API UWeaponVariantDataAsset : public UPrimaryDataAsset
{
    GENERATED_BODY()

public:
    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Variant")
    FName WeaponId;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Variant")
    FText DisplayName;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Variant")
    TObjectPtr<UWeaponFamilyDataAsset> FamilyAsset;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Presentation")
    TObjectPtr<UWeaponPresentationDataAsset> PresentationAsset;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Compatibility")
    TArray<EAeroStrikeAirframeSlotClass> CompatibleAirframeClasses;

    // Strictly separate historical/public documentation references from gameplay class compatibility!
    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "HistoricalReference")
    TArray<FName> HistoricallyDocumentedAirframeIds;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "HistoricalReference")
    FString SourceDocumentation;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "HistoricalReference")
    FString LicenseAttribution;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "FictionalGameStats")
    TArray<EWeaponFireModeBP> AllowedFireModes;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "FictionalGameStats")
    EWeaponFireModeBP DefaultFireMode = EWeaponFireModeBP::Single;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "FictionalGameStats")
    int32 BurstCount = 3;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "FictionalGameStats")
    double BurstIntervalSec = 0.085;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "FictionalGameStats")
    double CooldownSec = 0.11;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "FictionalGameStats")
    double MassKg = 18.0;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "FictionalGameStats")
    int32 AmmoPerSlot = 120;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "FictionalGameStats")
    int32 RotaryBarrels = 0;
};
