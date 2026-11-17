#pragma once

#include "CoreMinimal.h"
#include "AIController.h"
#include "SimCore/DroneFlightModel.h"
#include "AeroStrikeAiController.generated.h"

UENUM(BlueprintType)
enum class EAeroStrikeAiRole : uint8
{
    Wingman,
    Interceptor,
    Dogfighter,
    Striker,
    LoiteringAttacker
};

UCLASS()
class AEROSTRIKE_API AAeroStrikeAiController : public AAIController
{
    GENERATED_BODY()

public:
    UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "AeroStrike|AI")
    EAeroStrikeAiRole AiRole = EAeroStrikeAiRole::Dogfighter;

    UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "AeroStrike|AI")
    AeroStrike::SimCore::EFlightModelFamily FlightClass = AeroStrike::SimCore::EFlightModelFamily::FixedWingPropeller;

    UPROPERTY(EditDefaultsOnly, BlueprintReadWrite, Category = "AeroStrike|AI")
    int32 TeamId = 1; // 0 = Alpha (Allied), 1 = Bravo (Hostile)
};
