# Weapon Compatibility & Source Provenance Audit (M2.5-A)

## 1. Confirmed Defects Found in `src/sim/weaponCompatibility.ts`

1. **`verifiedAirframeIds` Ignored During Evaluation**
   - `src/sim/arsenalData.ts` defines `verifiedAirframeIds` on UAV gun variants (e.g., `dap6_minigun_pod`, `songar_556`, `fire_storm_250`), while other weapons define only `compatibleAirframeClasses`.
   - `checkWeaponCompatibility()` in `src/sim/weaponCompatibility.ts` checked ONLY `compatibleAirframeClasses` and `maxPylonPayloadKg`, then returned `verified: true` without verifying `weapon.verifiedAirframeIds`.
   - **Impact**: Class-compatible configurations (such as mounting `FIRE STORM 250` on `MQ-1C Mojave STOL` or `AGM-114R Hellfire` on `XQ-58A`) were marked as `verified: true` even when no historical verification existed.

2. **`normalizeLoadoutConfig` Fallback Could Return Another Invalid Weapon**
   - In `src/sim/weaponCompatibility.ts:162`, if slot `3` held an incompatible weapon, fallback returned `'fire_storm_250'`.
   - On `zala_lancet` (`light_multirotor`), `fire_storm_250` is **itself incompatible** (`compatibleAirframeClasses` excludes `light_multirotor`), silently leaving an invalid weapon in slot 3.

## 2. UE 5.8 C++ Resolution (`SimCore/WeaponFamilyCore.h`)

- `CompatibilityEvaluation` splits compatibility into three independent flags:
  1. `bGameplayCompatible`: Pylon class and payload mass allow equipping under fictional balance rules.
  2. `bHistoricallyDocumented`: True **if and only if** `airframe.id` is explicitly listed in `HistoricallyDocumentedAirframeIds` — never inferred from class or weight.
  3. `bSandboxOverrideUsed`: True only when `!bGameplayCompatible && bSandboxEnabled`.
- `normalizeLoadoutSlots()` evaluates candidate fallbacks through `evaluateWeaponCompatibility()` for the target airframe before selection, guaranteeing zero invalid fallback substitutions.

## 3. Audio & Visual Provenance Unification

- Reconciled all 22 `.wav` runtime audio stems (`public/assets/audio/*.wav`), Poly Haven CC0 1.0 textures/HDRI/props, Stage A `ORIGINAL_CREATED` Bayraktar TB2 LOD0–LOD2 meshes, and unbundled `MISSING_SOURCE` Freesound entries into one canonical database:
  `AeroStrike/SourceAssetManifests/canonical_asset_database.json`.
