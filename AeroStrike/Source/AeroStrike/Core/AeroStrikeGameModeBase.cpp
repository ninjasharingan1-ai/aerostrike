#include "Core/AeroStrikeGameModeBase.h"
#include "Core/AeroStrikePlayerController.h"
#include "Aircraft/AeroStrikeUavPawn.h"

AAeroStrikeGameModeBase::AAeroStrikeGameModeBase()
{
    DefaultPawnClass = AAeroStrikeUavPawn::StaticClass();
    PlayerControllerClass = AAeroStrikePlayerController::StaticClass();
}
