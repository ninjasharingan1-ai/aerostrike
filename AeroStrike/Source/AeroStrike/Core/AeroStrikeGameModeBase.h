#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "AeroStrikeGameModeBase.generated.h"

UCLASS()
class AEROSTRIKE_API AAeroStrikeGameModeBase : public AGameModeBase
{
    GENERATED_BODY()

public:
    AAeroStrikeGameModeBase();
    virtual void BeginPlay() override;

protected:
    // Disabled when the authored Sector04_Mojave world map is ready.
    UPROPERTY(EditDefaultsOnly, Category = "Bootstrap")
    bool bEnableTrainingBootstrap = true;
};
