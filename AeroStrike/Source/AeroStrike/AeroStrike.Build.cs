using UnrealBuildTool;

public class AeroStrike : ModuleRules
{
    public AeroStrike(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        CppStandard = CppStandardVersion.Cpp20;

        PublicDependencyModuleNames.AddRange(new string[]
        {
            "Core",
            "CoreUObject",
            "Engine",
            "InputCore",
            "EnhancedInput",
            "GameplayTags",
            "Niagara",
            "MetasoundEngine",
            "AudioMixer",
            "UMG",
            "CommonUI",
            "AIModule",
            "StateTreeModule",
            "GameplayStateTreeModule",
            "PhysicsCore",
            "NetCore"
        });

        PrivateDependencyModuleNames.AddRange(new string[]
        {
            "Slate",
            "SlateCore",
            "Json",
            "JsonUtilities"
        });
    }
}
