using UnrealBuildTool;

public class AeroStrikeEditorTarget : TargetRules
{
    public AeroStrikeEditorTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Editor;
        DefaultBuildSettings = BuildSettingsVersion.V5;
        IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_8;
        ExtraModuleNames.Add("AeroStrike");
    }
}
