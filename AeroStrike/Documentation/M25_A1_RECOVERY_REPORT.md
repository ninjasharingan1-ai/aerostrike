# AeroStrike — M2.5-A.1 Unreal Build & Playability Recovery

## Recovery status

**Source recovery changes committed on the isolated `m25-a1-ue-playability-recovery` branch.**

**Unreal Engine compile/editor playability gate: UNVERIFIED / BLOCKED.** The editing environment has no UE 5.8 UnrealBuildTool, UnrealHeaderTool or Unreal Editor. Do not reclassify the foundation as playable UE5 until a genuine engine compile and Play-In-Editor (PIE) run passes.

The prior Three.js/Vite application on `main` is preserved unchanged.

## Changes applied

1. **UHT-facing AI properties:** `AeroStrikeAiController.h` now uses the `UENUM(BlueprintType)`-backed `EAeroStrikeFlightClass`, rather than an ordinary namespace-scoped C++ enum in `UPROPERTY`.
2. **Project configuration:** corrected `ProjectID` to a syntactically valid GUID; changed `EditorStartupMap` / `GameDefaultMap` from absent `/Game/Missions/Sector04_MojaveProvingBasin` to fallback `/Engine/Maps/Entry`. **This is a bootstrap map, not an authored Sector 04 level.**
3. **Training scene:** GameMode optionally spawns a primitive ground plane, directional light and sky light. GameMode's `bEnableTrainingBootstrap` defaults true and must be disabled for authored production maps.
4. **Aircraft visibility:** the UAV Pawn uses engine-native cube-based fuselage/wing/tail training proxies when no production Skeletal Mesh is assigned. This is explicitly a temporary visual diagnostic.
5. **Input fallback:** when the Enhanced Input assets have not been authored/assigned, PlayerController binds basic mouse axes, LMB/Space primary fire, L mouse capture toggle, C free look, U camera cycle, R fire mode, slots 1–4, and W/S/A/D/Q/E manual flight with Shift throttle. An enhanced-input authored mapping remains the production solution.
6. **Camera deltas:** FlightComponent now exposes independently consumed free-look and EO/IR angular deltas; Pawn applies those offsets separately from the stable world-space Mouse Aim target. Flyby and Orbit get temporary chase-camera presentation.
7. **Training weapon:** missing production Weapon Data Assets activate an explicitly fictional, cosmetic `aerostrike_training_gun` on slot 0. It generates authoritative firing-state events and log entries, but **not** projectiles, hit detection, damage, Niagara, or MetaSound.
8. **Network-mode correction:** fire-mode cycling has a server RPC, matching existing server-owned weapon state.
9. **Compatibility fallback:** absent a compatible weapon variant, an unarmed empty slot is returned instead of an incompatible variant. Added regression coverage.
10. **CI:** `.github/workflows/m25-a1-portable.yml` runs strict g++ C++20 SimCore tests plus the existing browser tests/typecheck/build.

## Strict acceptance separation

| Gate | Evidence required | Status |
| --- | --- | --- |
| Portable C++20 tests | GitHub Actions job runs executable with `-Wall -Wextra -Werror` | Check workflow run |
| Browser regression | 45 existing tests, TypeScript check and Vite build | Check workflow run |
| UnrealHeaderTool | UHT accepts every reflected C++ header | **Unverified** |
| UnrealBuildTool | `AeroStrikeEditor Win64 Development` compiles | **Unverified** |
| Input & Pawn | Real Play-In-Editor: mouse aim, LMB, C, W/S/A/D/Q/E, R, 1–4, U | **Unverified** |
| Real UE5 content | Authored Sector04 map, production aircraft and weapon assets imported | **Not implemented** |
| UE5 combat | Real projectile, hit, damage, VFX and sound systems | **Not implemented** |
| UE5 multiplayer | Live dedicated server/client replication and reconnection | **Not tested** |
| Win64 shipping | Cook/package, startup smoke test, GPU profile | **Not tested** |

## Recommended Windows workstation verification (UE5.8.x)

1. Fetch the recovery branch and open `AeroStrike/AeroStrike.uproject` with an installed UE 5.8 toolchain.
2. Generate Visual Studio project files. Compile **AeroStrikeEditor Win64 Development**. Record first genuine UHT/UBT error including source line; fix root cause and rerun.
3. Open the project in Unreal Editor. Use **Play** in the fallback Entry map. Inspect the temporary ground plane and training aircraft; verify aircraft is visible after first flight tick.
4. Confirm LMB generates `AeroStrike weapon event` log entries; R changes fire mode; mouse aim maintains invariant when stationary; C changes view without steering; WASD/QE override; U cycles camera.
5. Verify no accidental fire from editor/menu interactions and that input is cleared when losing focus or opening overlays.
6. Test standalone / packaged behavior, not only PIE. Confirm `/Engine/Maps/Entry` and `/Engine/BasicShapes/*` resolve under cook.
7. Capture screenshot/video, UHT/UBT logs, UE version, actual GPU, and input telemetry.
8. Replace fallback bindings with authored Enhanced Input Actions + Mapping Context; replace training ground/aircraft/weapon with production assets before declaring M2.5-A complete.

### Known limitations to close in a subsequent UE-enabled pass

- The input fallback is provisional; native authored Enhanced Input assets and IMC are absent. Cross-platform input/device behavior and focus recovery need real PIE validation.
- The training gun exercises fire events only and intentionally has no destructive combat implementation.
- There is no authentic Sector 04 `.umap`, production `.uasset` aircraft, sound or effects content.
- The EO/IR observation component and mission subsystem are not yet fully connected to actual target actors and phase progression in an authored map.
- Flyby and Orbit are currently approximate camera presentation states.
- The existing `UWeaponLoadoutComponent` replicates equipped variants/events but not a full authoritative current-ammo and fire-mode snapshot; live multiplayer testing remains necessary.
- The host cannot assert UE build success, packaged runtime performance or an equivalent AAA visual result.

**Decision:** keep M2.5-A.1 in **SOURCE-RECOVERY / PENDING UNREAL BUILD** until workstation evidence closes the remaining gates.
