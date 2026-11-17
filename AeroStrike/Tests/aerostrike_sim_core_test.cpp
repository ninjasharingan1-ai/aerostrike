#include "../Source/AeroStrike/SimCore/DroneFlightModel.h"
#include "../Source/AeroStrike/SimCore/MissionReconCore.h"
#include "../Source/AeroStrike/SimCore/MouseAimCore.h"
#include "../Source/AeroStrike/SimCore/WeaponFamilyCore.h"

#include <cassert>
#include <cmath>
#include <iostream>
#include <vector>

using namespace AeroStrike::SimCore;

static void testMouseAimInvariants() {
    MouseInputState mouse;
    MouseAimInputConfig cfg;
    cfg.aimSensitivity = 1.0;

    // 1. Anchor sample + steady move updates aim; stationary frames keep aim strictly invariant
    handleMousePointerMove(mouse, 500, 400, 0, 0, EPointerRoute::Aim); // anchor
    handleMousePointerMove(mouse, 580, 360, 0, 0, EPointerRoute::Aim); // +80px right, -40px up
    const auto consumed = consumeMouseFrameInput(mouse, cfg);
    assert(consumed.aimDeltaYawRad < 0.0);
    assert(consumed.aimDeltaPitchRad > 0.0);

    MouseAimStepInput stepIn;
    stepIn.aimDeltaYawRad = consumed.aimDeltaYawRad;
    stepIn.aimDeltaPitchRad = consumed.aimDeltaPitchRad;
    auto aimRes = stepWarThunderAimAngles(stepIn);
    const Vec3 savedDir = aimRes.targetDir;

    // Stationary frames: zero delta -> zero change in desired aim direction
    for (int i = 0; i < 120; ++i) {
        const auto zeroConsumed = consumeMouseFrameInput(mouse, cfg);
        assert(zeroConsumed.aimDeltaYawRad == 0.0 && zeroConsumed.aimDeltaPitchRad == 0.0);
        MouseAimStepInput holdIn;
        holdIn.aimYaw = aimRes.aimYaw;
        holdIn.aimPitch = aimRes.aimPitch;
        aimRes = stepWarThunderAimAngles(holdIn);
    }
    assert(computeDirectionAngularErrorRad(savedDir, aimRes.targetDir) < 1e-12);

    // 2. Free Look ('C') isolates desired aim direction completely
    handleMousePointerMove(mouse, 720, 440, 0, 0, EPointerRoute::FreeLook);
    const auto flConsumed = consumeMouseFrameInput(mouse, cfg);
    assert(flConsumed.aimDeltaYawRad == 0.0);
    assert(flConsumed.freeLookDeltaYawRad != 0.0);

    MouseAimStepInput flStep;
    flStep.aimYaw = aimRes.aimYaw;
    flStep.aimPitch = aimRes.aimPitch;
    flStep.aimDeltaYawRad = 0.4;
    flStep.freeLooking = true;
    const auto frozenRes = stepWarThunderAimAngles(flStep);
    assert(computeDirectionAngularErrorRad(savedDir, frozenRes.targetDir) < 1e-12);

    // 3. Spike rejection drops pathological cursor warps
    const bool spikeAccepted = handleMousePointerMove(mouse, 1400, 440, 0, 0, EPointerRoute::Aim);
    assert(!spikeAccepted);

    std::cout << "[PASS] MouseAimCore P0 invariants\n";
}

static void testFourFlightClassesAndFuelRule() {
    FlightEnvironmentContext env;
    env.disableFuelDepletion = true;

    const std::array<EFlightModelFamily, 4> families = {
        EFlightModelFamily::FixedWingPropeller,
        EFlightModelFamily::Multirotor,
        EFlightModelFamily::JetPowered,
        EFlightModelFamily::LoiteringAircraft
    };

    for (EFlightModelFamily fam : families) {
        AirframeFlightSpec spec;
        spec.family = fam;
        spec.dryMassKg = (fam == EFlightModelFamily::Multirotor) ? 48.0 :
                         (fam == EFlightModelFamily::JetPowered) ? 1134.0 : 700.0;
        spec.maxThrustN = (fam == EFlightModelFamily::JetPowered) ? 34000.0 : 16500.0;
        spec.maxFuelKg = 300.0;

        DroneFlightState st;
        st.fuelKg = 300.0;
        st.maxFuelKg = 300.0;
        st.vz = (fam == EFlightModelFamily::Multirotor) ? -12.0 : -75.0;

        for (int f = 0; f < 180; ++f) {
            const auto ctrl = computeInstructorControlInput(
                st.yaw, st.pitch, st.roll, aimAnglesToDirection(-0.35, 0.06), InstructorManualOverride{});
            st = stepDroneFlight(st, spec, ctrl, env, 1.0 / 60.0);
        }

        // Fuel depletion must remain disabled across every aircraft class
        assert(std::abs(st.fuelKg - st.maxFuelKg) < 1e-9);
        assert(std::isfinite(st.x) && std::isfinite(st.y) && std::isfinite(st.z));
        assert(st.airspeedMs > 1.0);
    }

    std::cout << "[PASS] DroneFlightModel 4 classes & fuel depletion disabled\n";
}

static void testCompatibilityAuditAndLoadoutNormalization() {
    AirframeCatalogEntry tb2{ "bayraktar_tb2", "Bayraktar TB2", EAirframeClass::TacticalUav, 150.0 };
    AirframeCatalogEntry mojave{ "mojave_ucav", "MQ-1C Mojave STOL", EAirframeClass::HeavyPodUav, 1630.0 };
    AirframeCatalogEntry lancet{ "zala_lancet", "ZALA Lancet-3", EAirframeClass::LightMultirotor, 35.0 };

    WeaponVariantSpec songar556;
    songar556.id = "songar_556";
    songar556.displayName = "SONGAR-556";
    songar556.domain = EWeaponDomain::ProjectileGuns;
    songar556.compatibleClasses = { EAirframeClass::LightMultirotor, EAirframeClass::HeavyMultirotor, EAirframeClass::TacticalUav, EAirframeClass::HeavyPodUav };
    songar556.historicallyDocumentedAirframeIds = { "baba_yaga", "punisher_ua", "bayraktar_tb2", "mohajer_6", "zala_lancet" };
    songar556.massKg = 18.0;
    songar556.ammoPerSlot = 120; // slot mass = 27.6 <= 35

    WeaponVariantSpec fireStorm;
    fireStorm.id = "fire_storm_250";
    fireStorm.displayName = "FIRE STORM 250";
    fireStorm.domain = EWeaponDomain::ProjectileGuns;
    fireStorm.compatibleClasses = { EAirframeClass::HeavyMultirotor, EAirframeClass::TacticalUav, EAirframeClass::HeavyPodUav, EAirframeClass::StealthJet };
    fireStorm.historicallyDocumentedAirframeIds = { "bayraktar_tb2", "hermes_900", "baba_yaga" };
    fireStorm.massKg = 26.0;
    fireStorm.ammoPerSlot = 110;

    WeaponVariantSpec dap6;
    dap6.id = "dap6_minigun_pod";
    dap6.displayName = "Dillon Aero DAP-6";
    dap6.domain = EWeaponDomain::ProjectileGuns;
    dap6.family = EWeaponFamily::FamilyC_RotaryAircraftGunPod;
    dap6.compatibleClasses = { EAirframeClass::HeavyPodUav, EAirframeClass::StealthJet };
    dap6.historicallyDocumentedAirframeIds = { "mojave_ucav", "mq9x", "akinci" };
    dap6.massKg = 118.0;
    dap6.ammoPerSlot = 240;

    WeaponVariantSpec mamL;
    mamL.id = "mam_l";
    mamL.displayName = "MAM-L";
    mamL.domain = EWeaponDomain::ReleaseOrdnance;
    mamL.family = EWeaponFamily::FamilyF_BombAndReleaseSystem;
    mamL.compatibleClasses = { EAirframeClass::TacticalUav, EAirframeClass::HeavyPodUav };
    mamL.historicallyDocumentedAirframeIds = { "bayraktar_tb2", "akinci" };
    mamL.massKg = 22.0;
    mamL.ammoPerSlot = 4;

    // TB2 cannot mount DAP-6 in Verified mode; Sandbox sets bSandboxOverrideUsed without claiming historical verification
    const auto tb2DapVerified = evaluateWeaponCompatibility(tb2, dap6, false);
    assert(!tb2DapVerified.bGameplayCompatible && !tb2DapVerified.bHistoricallyDocumented && !tb2DapVerified.bSandboxOverrideUsed);

    const auto tb2DapSandbox = evaluateWeaponCompatibility(tb2, dap6, true);
    assert(!tb2DapSandbox.bGameplayCompatible && !tb2DapSandbox.bHistoricallyDocumented && tb2DapSandbox.bSandboxOverrideUsed);

    // Mojave + FireStorm is class-compatible, NOT historically documented (explicit separation!)
    const auto mojaveFs = evaluateWeaponCompatibility(mojave, fireStorm, false);
    assert(mojaveFs.bGameplayCompatible && !mojaveFs.bHistoricallyDocumented);

    // Safe normalization on light_multirotor (Lancet) NEVER replaces invalid FireStorm with invalid FireStorm!
    const std::vector<WeaponVariantSpec> catalog{ mamL, fireStorm, songar556, dap6 };
    const auto normalized = normalizeLoadoutSlots(
        lancet, { "dap6_minigun_pod", "mam_l", "fire_storm_250", "fire_storm_250" }, catalog, false);
    for (const auto& s : normalized) {
        assert(s == "songar_556");
    }

    // The catalog may have no compatible fallback. Never silently mount an invalid variant.
    const std::vector<WeaponVariantSpec> onlyIncompatible{ fireStorm };
    const auto noCompatible = normalizeLoadoutSlots(
        lancet, { "fire_storm_250", "fire_storm_250", "fire_storm_250", "fire_storm_250" },
        onlyIncompatible, false);
    for (const auto& slot : noCompatible) {
        assert(slot.empty());
    }

    std::cout << "[PASS] WeaponFamilyCore compatibility separation & safe normalization\n";
}

static void testWeaponFireStateMachine() {
    WeaponVariantSpec rotary;
    rotary.id = "dap6_minigun_pod";
    rotary.domain = EWeaponDomain::ProjectileGuns;
    rotary.family = EWeaponFamily::FamilyC_RotaryAircraftGunPod;
    rotary.allowedFireModes = { EFireMode::Auto };
    rotary.defaultFireMode = EFireMode::Auto;
    rotary.cooldownSec = 0.06;
    rotary.ammoPerSlot = 20;
    rotary.rotaryBarrels = 6;
    rotary.spinUpDurationSec = 0.08;
    rotary.spinDownDurationSec = 0.16;

    WeaponVariantSpec burstGun;
    burstGun.id = "songar_556";
    burstGun.domain = EWeaponDomain::ProjectileGuns;
    burstGun.allowedFireModes = { EFireMode::Single, EFireMode::Burst, EFireMode::Auto };
    burstGun.defaultFireMode = EFireMode::Burst;
    burstGun.burstCount = 3;
    burstGun.burstIntervalSec = 0.05;
    burstGun.cooldownSec = 0.2;
    burstGun.ammoPerSlot = 30;

    WeaponFireStateMachine fsm;
    fsm.slots[0] = { "dap6_minigun_pod", 20, 0.0, EFireMode::Auto };
    fsm.slots[1] = { "songar_556", 30, 0.0, EFireMode::Burst };
    std::vector<WeaponGameplayEvent> events;

    // Hold LMB on rotary pod -> spin-up event, then sustained firing, then release -> spin-down event
    fsm.onTriggerPressed();
    for (int f = 0; f < 30; ++f) {
        fsm.step(1.0 / 60.0, rotary, events);
    }
    bool sawSpinUp = false;
    int firedCount = 0;
    for (const auto& e : events) {
        if (e.type == EWeaponEventType::SpinUpStarted) sawSpinUp = true;
        if (e.type == EWeaponEventType::RoundFired) firedCount++;
    }
    assert(sawSpinUp && firedCount >= 5);
    assert(fsm.barrelAngleRad > 1.0);

    // Switching slot mid-hold suppresses firing until trigger released & re-pressed
    events.clear();
    fsm.requestSlotSwitch(1, events);
    for (int f = 0; f < 25; ++f) {
        fsm.step(1.0 / 60.0, burstGun, events);
    }
    for (const auto& e : events) {
        assert(e.type != EWeaponEventType::RoundFired);
    }

    // Release and press again -> fires exact 3-round burst even while held
    fsm.onTriggerReleased();
    events.clear();
    fsm.onTriggerPressed();
    for (int f = 0; f < 30; ++f) {
        fsm.step(1.0 / 60.0, burstGun, events);
    }
    int burstShots = 0;
    for (const auto& e : events) {
        if (e.type == EWeaponEventType::RoundFired) burstShots++;
    }
    assert(burstShots == 3);

    std::cout << "[PASS] WeaponFireStateMachine SpinUp/Auto/SlotSwitch/Burst\n";
}

static void testEoirCameraReconAndMissionFlow() {
    CombinedMissionState mission;
    std::vector<GroundContactObservationCandidate> targets = {
        { "convoy_1", "Desert Convoy", { 0.0, 0.0, -1000.0 }, true, true },
        { "sam_1",    "North SAM",     { -900.0, 0.0, 1200.0 }, true, true }, // Behind/off-camera
        { "bunker_1", "Bunker Alpha",  { 0.0, 0.0, -1400.0 }, true, false } // LOS blocked
    };

    // Deployment does NOT auto-advance on elapsed time alone without ingress or EO/IR action
    assert(!advanceCombinedMission(mission, MissionStepInputs{ 800.0, false, false, 3, true, false, false }));
    assert(mission.phase == EMissionPhaseId::Deployment);

    // Player enters EO/IR mode -> transitions to Recon
    assert(advanceCombinedMission(mission, MissionStepInputs{ 800.0, true, false, 3, true, false, false }));
    assert(mission.phase == EMissionPhaseId::Recon);

    // Looking AWAY from all targets (East) -> off-screen targets must NOT scan or mark
    EoirObservationQuery lookEast{ true, { 0, 450, 0 }, { 1, 0, 0 }, 0.90, 3500.0 };
    const auto eastRes = evaluateEoirObservationStep(mission, lookEast, targets, 1.5, true);
    assert(!eastRes.scanning && eastRes.newlyMarkedTargetId.empty());
    assert(mission.markedTargetIds.empty());

    // Looking directly at convoy_1 in EO/IR -> scans & marks once; blocked LOS bunker_1 skipped
    EoirObservationQuery lookNorth{ true, { 0, 450, 0 }, { 0, -0.41, -0.91 }, 0.90, 3500.0 };
    const auto markRes = evaluateEoirObservationStep(mission, lookNorth, targets, 1.2, false);
    assert(markRes.newlyMarkedTargetId == "convoy_1" && markRes.scoreAwarded == 50);
    assert(mission.score == 50 && mission.markedTargetIds.size() == 1);

    // Re-evaluating same target cannot award duplicate marks or points
    const auto dupRes = evaluateEoirObservationStep(mission, lookNorth, targets, 1.2, true);
    assert(dupRes.newlyMarkedTargetId.empty() && mission.score == 50);

    std::cout << "[PASS] MissionReconCore camera-cone EO/IR & event-driven transitions\n";
}

int main() {
    testMouseAimInvariants();
    testFourFlightClassesAndFuelRule();
    testCompatibilityAuditAndLoadoutNormalization();
    testWeaponFireStateMachine();
    testEoirCameraReconAndMissionFlow();
    std::cout << "ALL 5 AEROSTRIKE C++20 SIMCORE TEST SUITES PASSED.\n";
    return 0;
}
