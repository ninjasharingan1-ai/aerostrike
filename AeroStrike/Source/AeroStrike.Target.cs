using UnrealBuildTool;

public class AeroStrikeTarget : TargetRules
{
    public AeroStrikeTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Game;
        DefaultBuildSettings = BuildSettingsVersion.V5;
        IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_8;
        ExtraModuleNames.Add("AeroStrike");
    }
}
