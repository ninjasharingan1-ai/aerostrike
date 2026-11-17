# AeroStrike M2.5-A — Toolchain Reality Check & UE 5.8.x Migration Boundary

## 1. Execution Environment Reality Check

Inspected in the container at `2026-11-17`:
- **Host OS**: `Linux localhost 4.19.0-gvisor #1 SMP x86_64 GNU/Linux` (sandboxed Linux container).
- **Available Compilers / Runtimes**: `node`, `npm`, `bun`, `tsx`, `g++`, `git`, `playwright-cli`.
- **Missing Unreal Engine 5.8.x Toolchain**:
  - `UnrealEditor` / `UE5Editor` — **Not installed**.
  - `UnrealBuildTool` / `dotnet` — **Not installed**.
  - `RunUAT.sh` / Windows PC SDK / DX12 / Vulkan GPU — **Not installed**.

**Honest Gate Status**:
- **M2.5-A Source Foundation & Portable C++20 SimCore**: Created, structured, data-seeded, and verified with `g++ -std=c++20` (`AeroStrike/Tests/aerostrike_sim_core_test.cpp`).
- **UE5 Editor Open / UBT Compile / Cook / Windows Package**: **Blocked pending Windows UE 5.8.x workstation execution**. No fabricated UE5 build or GPU benchmark claims are made.
- **Browser Reference Application (`src/`, `public/`, `vite.config.ts`)**: Preserved 100% playable and unchanged as regression reference.

---

## 2. Repository Inventory & Migration Boundaries

| System / Module (Browser Prototype) | Classification | UE 5.8.x Target Destination | Migration Disposition |
|---|---|---|---|
| `src/sim/mouseAimInput.ts` + P0 `stepWarThunderAimAngles` + `computeInstructorControlInput` | **Ported C++20 Core** | `Source/AeroStrike/SimCore/MouseAimCore.h` + `Core/AeroStrikePlayerController` + `Flight/AeroStrikeFlightComponent` | Preserves P0 invariants bit-for-bit on top of Unreal Enhanced Input. |
| `src/sim/flightPhysics.ts` | **Rebuilt into 4 Families** | `Source/AeroStrike/SimCore/DroneFlightModel.h` + `Flight/AeroStrikeFlightComponent` | Splits `FixedWingPropeller`, `Multirotor`, `JetPowered`, `LoiteringAircraft`; enforces `bDisableFuelDepletion = true`. |
| `src/sim/weaponCompatibility.ts` + `arsenalData.ts` | **Audited & Rebuilt** | `Source/AeroStrike/SimCore/WeaponFamilyCore.h` + `Weapons/AeroStrikeWeaponDataAssets.h` | Separates `GameplayCompatible`, `HistoricallyDocumented`, and `FictionalSandbox`; replaces conditional branches with Data Assets. |
| `src/sim/core/missionDirector.ts` + `groundConvoys.ts` | **Upgraded Event-Driven** | `Source/AeroStrike/SimCore/MissionReconCore.h` + `Missions/AeroStrikeMissionSubsystem` + `Reconnaissance/EoirObservationComponent` | Removes arbitrary timed Deployment skip; evaluates EO/IR strictly inside active observation camera FOV + LineTrace LOS. |
| `src/sim/core/simWorld.ts` | **Replaced by UE Gameplay Framework** | `AGameModeBase`, `AGameState`, `APawn`, `UWorldSubsystem`, Unreal Replication | Authoritative server state + replicated multicast events replace custom browser WebSocket snapshot loop. |
| `src/engine/droneModels.ts`, `terrainEngine.ts`, `FlightViewport.tsx` | **Rewritten Native UE5** | Skeletal/Static Meshes, UE Landscape + World Partition + SkyAtmosphere + VolumetricCloud + Niagara + Lumen | Procedural Three.js primitives replaced in M2.5-D/E on UE 5.8 Windows workstation. |
| `src/engine/audioSynth.ts` + 22 `.wav` stems | **Rewritten MetaSounds + Real Audio** | `Content/Audio/` MetaSounds + Audio Mixer + `canonical_asset_database.json` | 22 existing `.wav` files retained as legacy baseline until M2.5-E studio/field replacement. |
| `src/components/*.tsx` | **Rewritten CommonUI / UMG** | `Content/UI/` CommonUI HUD & Weapon Family Hangar | Decoupled from simulation; reads replicated authoritative state only. |
