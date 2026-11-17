# AeroStrike M2.5-B through M2.5-G — Windows UE 5.8.x Execution Checklist

Run on a Windows 11 PC with **Unreal Engine 5.8.x**, **Visual Studio 2022**, **Windows 10/11 SDK**, and a DX12 SM6 GPU:

1. **M2.5-A Verification on Workstation**:
   - Right-click `AeroStrike/AeroStrike.uproject` -> *Generate Visual Studio project files*.
   - Build `AeroStrikeEditor Win64 Development` cleanly in Visual Studio / UBT.
   - Open `AeroStrike.uproject` in UE 5.8 Editor; import `Content/DataAssets/JSON/*.json` into DataTables / DataAssets.
2. **M2.5-B (Flight & Controls Parity)**:
   - Wire Enhanced Input asset (`IMC_AeroStrikeFlight`, `IA_*`) to `BP_AeroStrikePlayerController`.
   - Run UE Automation Tests wrapping `SimCore::MouseAimCore` & `DroneFlightModel` across 30/60/120+ FPS; verify stationary mouse invariance and all 4 flight classes.
3. **M2.5-C (Weapon Family Logic)**:
   - Author `DA_Family_*` (`Family A–G`) and `DA_Weapon_*` Data Assets + `UHardpointDataAsset` sockets on `SK_TB2` and `SK_Mojave`.
   - Verify Hangar preview sockets and live gameplay sockets match 1:1.
4. **M2.5-D (Hero Aircraft & Mojave Sector 04 Art)**:
   - Replace parametric Stage A TB2/Mojave/Multirotor/4 Gun families/Armored Convoy placeholders with production PBR skeletal/static assets.
   - Build Landscape + World Partition + HLOD + SkyAtmosphere + VolumetricCloud for `Sector04_MojaveProvingBasin`.
5. **M2.5-E (Niagara VFX & MetaSounds Audio)**:
   - Author MetaSounds patches (`TriggerTransient`, `MechanicalBody`, `SustainedLoop`, `EndingTail`, `DistantPerspective`) with real field-recorded CC0/licensed sources.
   - Author Niagara muzzle, tracer, ground dust, and authored multi-stage vehicle destruction systems driven strictly by `OnWeaponGameplayEvent`.
6. **M2.5-F (Combined Experience Mission & StateTree AI)**:
   - Build `ST_UavDogfighter`, `ST_UavInterceptor`, `ST_LoiteringStriker`, and `DA_ConvoyColumn` responding to Phases 1–5.
7. **M2.5-G (Unreal Insights Profiling & Packaged Win64 Build)**:
   - Profile 1080p @ 60 FPS target (<= 16.7ms frame budget) on documented midrange GPU/CPU using Unreal Insights.
   - Cook & package Windows PC (`RunUAT.sh/bat BuildCookRun -platform=Win64`) and complete full QA gates.
