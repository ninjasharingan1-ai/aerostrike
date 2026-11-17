#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "GameplayTagContainer.h"
#include "SimCore/DroneFlightModel.h"
#include "AeroStrikeAirframeDataAsset.generated.h"

UENUM(BlueprintType)
enum class EAeroStrikeFlightClass : uint8
{
    FixedWingPropeller UMETA(DisplayName = "Fixed-Wing Propeller UAV"),
    Multirotor         UMETA(DisplayName = "Multirotor UAV"),
    JetPowered         UMETA(DisplayName = "Jet-Powered UAV"),
    LoiteringAircraft  UMETA(DisplayName = "Loitering Aircraft")
};

UENUM(BlueprintType)
enum class EAeroStrikeAirframeSlotClass : uint8
{
    LightMultirotor  UMETA(DisplayName = "Light Multirotor"),
    HeavyMultirotor  UMETA(DisplayName = "Heavy Multirotor"),
    TacticalUav      UMETA(DisplayName = "Tactical UAV"),
    HeavyPodUav      UMETA(DisplayName = "Heavy Pod UCAV"),
    StealthJet       UMETA(DisplayName = "Stealth Jet UCAV")
};

UCLASS(BlueprintType)
class AEROSTRIKE_API UAeroStrikeAirframeDataAsset : public UPrimaryDataAsset
{
    GENERATED_BODY()

public:
    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Identity")
    FName AirframeId;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Identity")
    FText DisplayName;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Identity")
    FText RoleDescription;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Classification")
    EAeroStrikeFlightClass FlightModelClass = EAeroStrikeFlightClass::FixedWingPropeller;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Classification")
    EAeroStrikeAirframeSlotClass AirframeSlotClass = EAeroStrikeAirframeSlotClass::TacticalUav;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Classification")
    FGameplayTagContainer AirframeTags;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Presentation")
    TSoftObjectPtr<USkeletalMesh> AirframeSkeletalMesh;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Presentation")
    TArray<TSoftObjectPtr<UMaterialInterface>> ExteriorMaterials;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "FlightModel", meta = (ClampMin = "10.0"))
    double DryMassKg = 700.0;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "FlightModel", meta = (ClampMin = "1.0"))
    double WingAreaM2 = 14.5;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "FlightModel", meta = (ClampMin = "1.0"))
    double AspectRatio = 12.0;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "FlightModel")
    double Cd0 = 0.024;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "FlightModel")
    double ClMax = 1.48;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "FlightModel")
    double StallAngleDeg = 15.0;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "FlightModel")
    double MaxPitchRateRadSec = 1.25;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "FlightModel")
    double MaxRollRateRadSec = 2.05;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "FlightModel")
    double MaxYawRateRadSec = 0.72;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "FlightModel")
    double MaxThrustN = 16500.0;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "FlightModel")
    double MaxG = 5.5;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Hardpoints")
    double MaxPylonPayloadKg = 150.0;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Hardpoints")
    int32 HardpointCount = 4;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Survivability")
    double MaxHp = 115.0;

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Provenance")
    FString SourceReferenceNotes;

    AeroStrike::SimCore::AirframeFlightSpec ToFlightSpec() const
    {
        AeroStrike::SimCore::AirframeFlightSpec Out;
        switch (FlightModelClass)
        {
            case EAeroStrikeFlightClass::Multirotor:
                Out.family = AeroStrike::SimCore::EFlightModelFamily::Multirotor;
                break;
            case EAeroStrikeFlightClass::JetPowered:
                Out.family = AeroStrike::SimCore::EFlightModelFamily::JetPowered;
                break;
            case EAeroStrikeFlightClass::LoiteringAircraft:
                Out.family = AeroStrike::SimCore::EFlightModelFamily::LoiteringAircraft;
                break;
            case EAeroStrikeFlightClass::FixedWingPropeller:
            default:
                Out.family = AeroStrike::SimCore::EFlightModelFamily::FixedWingPropeller;
                break;
        }
        Out.dryMassKg = DryMassKg;
        Out.wingAreaM2 = WingAreaM2;
        Out.aspectRatio = AspectRatio;
        Out.cd0 = Cd0;
        Out.clMax = ClMax;
        Out.stallAngleDeg = StallAngleDeg;
        Out.maxPitchRateRad = MaxPitchRateRadSec;
        Out.maxRollRateRad = MaxRollRateRadSec;
        Out.maxYawRateRad = MaxYawRateRadSec;
        Out.maxThrustN = MaxThrustN;
        Out.maxG = MaxG;
        Out.maxHp = MaxHp;
        return Out;
    }
};
