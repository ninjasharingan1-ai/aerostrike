#pragma once

#include <algorithm>
#include <array>
#include <cstdint>
#include <string>
#include <vector>

namespace AeroStrike::SimCore {

enum class EAirframeClass {
    LightMultirotor,
    HeavyMultirotor,
    TacticalUav,
    HeavyPodUav,
    StealthJet
};

enum class EWeaponDomain {
    ProjectileGuns,
    GuidedOrdnance,
    ReleaseOrdnance,
    DefensiveUtility
};

enum class EWeaponFamily {
    FamilyA_LightweightUavGun,
    FamilyB_MediumUavMachineGun,
    FamilyC_RotaryAircraftGunPod,
    FamilyD_TacticalRwsTurret,
    FamilyE_GuidedGameOrdnance,
    FamilyF_BombAndReleaseSystem,
    FamilyG_DefensiveAndUtility
};

enum class EFireMode : uint8_t {
    Single = 0,
    Burst = 1,
    Auto = 2
};

enum class EGunAudioProfile {
    GunLight556,
    GunMedium762,
    GunEnclosedMg,
    GunRotaryMinigun,
    GunRws250,
    Cannon20mm,
    OrdnanceLaunch,
    GlideRelease
};

struct AirframeCatalogEntry {
    std::string id;
    std::string displayName;
    EAirframeClass airframeClass = EAirframeClass::TacticalUav;
    double maxPylonPayloadKg = 150.0;
};

struct WeaponVariantSpec {
    std::string id;
    std::string displayName;
    EWeaponDomain domain = EWeaponDomain::ProjectileGuns;
    EWeaponFamily family = EWeaponFamily::FamilyA_LightweightUavGun;
    EGunAudioProfile audioProfile = EGunAudioProfile::GunLight556;
    std::vector<EAirframeClass> compatibleClasses;
    // Historical documentation list: strictly separate from general class/mass compatibility!
    std::vector<std::string> historicallyDocumentedAirframeIds;
    std::vector<EFireMode> allowedFireModes{ EFireMode::Single };
    EFireMode defaultFireMode = EFireMode::Single;
    int burstCount = 3;
    double burstIntervalSec = 0.085;
    double cooldownSec = 0.11;
    double massKg = 18.0;
    int ammoPerSlot = 120;
    int rotaryBarrels = 0;
    double spinUpDurationSec = 0.0;
    double spinDownDurationSec = 0.0;
};

struct CompatibilityEvaluation {
    bool bGameplayCompatible = false;
    bool bHistoricallyDocumented = false;
    bool bSandboxOverrideUsed = false;
    std::string reason;
};

/**
 * Separates GameplayCompatible, HistoricallyDocumented, and FictionalSandbox explicitly.
 * Never infers historical documentation from airframe class or weight limit alone.
 */
inline CompatibilityEvaluation evaluateWeaponCompatibility(
    const AirframeCatalogEntry& airframe,
    const WeaponVariantSpec& weapon,
    bool bSandboxEnabled
) {
    CompatibilityEvaluation res;

    bool classAllowed = weapon.compatibleClasses.empty();
    for (EAirframeClass c : weapon.compatibleClasses) {
        if (c == airframe.airframeClass) {
            classAllowed = true;
            break;
        }
    }

    const double slotMassKg = (weapon.domain == EWeaponDomain::ProjectileGuns)
        ? (weapon.massKg + static_cast<double>(weapon.ammoPerSlot) * 0.08)
        : weapon.massKg;
    const bool massAllowed = slotMassKg <= airframe.maxPylonPayloadKg;

    res.bGameplayCompatible = classAllowed && massAllowed;

    for (const std::string& docId : weapon.historicallyDocumentedAirframeIds) {
        if (docId == airframe.id) {
            res.bHistoricallyDocumented = true;
            break;
        }
    }

    if (res.bGameplayCompatible) {
        if (!res.bHistoricallyDocumented) {
            res.reason = "Gameplay-compatible loadout (no verified real-world airframe documentation claimed).";
        }
        return res;
    }

    res.reason = !classAllowed
        ? weapon.displayName + " is restricted from " + airframe.displayName + " in Verified mode."
        : weapon.displayName + " exceeds pylon payload limit for " + airframe.displayName + ".";

    if (bSandboxEnabled) {
        res.bSandboxOverrideUsed = true;
    }
    return res;
}

inline EFireMode resolveAllowedFireMode(const WeaponVariantSpec& weapon, EFireMode requested) {
    if (weapon.allowedFireModes.empty()) {
        return EFireMode::Single;
    }
    for (EFireMode m : weapon.allowedFireModes) {
        if (m == requested) return m;
    }
    return weapon.defaultFireMode;
}

inline EFireMode cycleAllowedFireMode(const WeaponVariantSpec& weapon, EFireMode current) {
    if (weapon.allowedFireModes.size() <= 1) {
        return weapon.allowedFireModes.empty() ? EFireMode::Single : weapon.allowedFireModes.front();
    }
    for (size_t i = 0; i < weapon.allowedFireModes.size(); ++i) {
        if (weapon.allowedFireModes[i] == current) {
            return weapon.allowedFireModes[(i + 1) % weapon.allowedFireModes.size()];
        }
    }
    return weapon.allowedFireModes.front();
}

/**
 * Guarantees default/normalized fallback slots are strictly compatible for the active airframe
 * (never silently substituting an invalid weapon with another invalid weapon).
 */
inline std::array<std::string, 4> normalizeLoadoutSlots(
    const AirframeCatalogEntry& airframe,
    const std::array<std::string, 4>& requestedSlots,
    const std::vector<WeaponVariantSpec>& catalog,
    bool bSandboxEnabled
) {
    auto findWeapon = [&](const std::string& id) -> const WeaponVariantSpec* {
        for (const auto& w : catalog) {
            if (w.id == id) return &w;
        }
        return nullptr;
    };

    auto pickSafeFallback = [&](size_t slotIdx) -> std::string {
        const bool preferGun = (slotIdx == 3);
        for (const auto& w : catalog) {
            const bool isGun = (w.domain == EWeaponDomain::ProjectileGuns);
            if (preferGun && !isGun) continue;
            auto eval = evaluateWeaponCompatibility(airframe, w, bSandboxEnabled);
            if (eval.bGameplayCompatible || eval.bSandboxOverrideUsed) {
                return w.id;
            }
        }
        // Secondary pass across any domain if no gun matches
        for (const auto& w : catalog) {
            auto eval = evaluateWeaponCompatibility(airframe, w, bSandboxEnabled);
            if (eval.bGameplayCompatible || eval.bSandboxOverrideUsed) {
                return w.id;
            }
        }
        return {}; // Explicitly unarmed if no compatible variant exists; never fabricate a valid loadout.
    };

    std::array<std::string, 4> out;
    for (size_t i = 0; i < 4; ++i) {
        const WeaponVariantSpec* spec = findWeapon(requestedSlots[i]);
        if (spec != nullptr) {
            const auto eval = evaluateWeaponCompatibility(airframe, *spec, bSandboxEnabled);
            if (eval.bGameplayCompatible || eval.bSandboxOverrideUsed) {
                out[i] = spec->id;
                continue;
            }
        }
        out[i] = pickSafeFallback(i);
    }
    return out;
}

enum class EFireMachineState {
    Idle,
    TriggerRequested,
    SpinUp,
    FiringCycle,
    RecoveryCooldown,
    SpinDown,
    WeaponSwitching,
    Suppressed,
    Depleted
};

enum class EWeaponEventType {
    RoundFired,
    SpinUpStarted,
    SpinDownStarted,
    FireModeChanged,
    SlotChanged,
    AmmoDepleted
};

struct WeaponGameplayEvent {
    EWeaponEventType type = EWeaponEventType::RoundFired;
    int slotIndex = 0;
    std::string weaponId;
    EFireMode fireMode = EFireMode::Single;
    EGunAudioProfile audioProfile = EGunAudioProfile::GunLight556;
    int remainingAmmo = 0;
};

struct EquippedSlotRuntime {
    std::string weaponId;
    int ammoRemaining = 0;
    double cooldownRemainingSec = 0.0;
    EFireMode fireMode = EFireMode::Single;
};

/**
 * Authoritative runtime fire-state machine shared across gameplay, audio, VFX, animation & net sync.
 * Audio/VFX consume emitted WeaponGameplayEvents and never invent their own firing schedules.
 */
class WeaponFireStateMachine {
public:
    std::array<EquippedSlotRuntime, 4> slots{};
    int activeSlot = 0;
    EFireMachineState state = EFireMachineState::Idle;
    bool bTriggerHeld = false;
    bool bFreshPressPending = false;
    bool bSuppressUntilRelease = false;
    int burstRemaining = 0;
    double burstTimerSec = 0.0;
    double spinTimerSec = 0.0;
    double barrelAngleRad = 0.0;
    double barrelSpinRateRadSec = 0.0;
    double switchTimerSec = 0.0;
    bool bPaused = false;
    bool bDisrupted = false;

    void setPausedOrDisrupted(bool paused, bool disrupted, std::vector<WeaponGameplayEvent>& outEvents) {
        bPaused = paused;
        bDisrupted = disrupted;
        if (paused || disrupted) {
            onFocusLostOrCancelled(outEvents);
        } else if (state == EFireMachineState::Suppressed) {
            state = EFireMachineState::Idle;
        }
    }

    void onFocusLostOrCancelled(std::vector<WeaponGameplayEvent>& outEvents) {
        bTriggerHeld = false;
        bFreshPressPending = false;
        burstRemaining = 0;
        if (state == EFireMachineState::SpinUp || state == EFireMachineState::FiringCycle) {
            state = EFireMachineState::SpinDown;
            spinTimerSec = 0.12;
            outEvents.push_back(WeaponGameplayEvent{
                EWeaponEventType::SpinDownStarted, activeSlot, slots[activeSlot].weaponId,
                slots[activeSlot].fireMode, EGunAudioProfile::GunRotaryMinigun, slots[activeSlot].ammoRemaining
            });
        } else if (bPaused || bDisrupted) {
            state = EFireMachineState::Suppressed;
        } else {
            state = EFireMachineState::Idle;
        }
    }

    void requestSlotSwitch(int newSlot, std::vector<WeaponGameplayEvent>& outEvents) {
        if (newSlot < 0 || newSlot >= 4 || newSlot == activeSlot) return;
        if (bTriggerHeld) {
            // Prevent weapon-switch auto-fire exploit until user releases and re-presses LMB
            bSuppressUntilRelease = true;
            bFreshPressPending = false;
        }
        burstRemaining = 0;
        activeSlot = newSlot;
        state = EFireMachineState::WeaponSwitching;
        switchTimerSec = 0.08;
        outEvents.push_back(WeaponGameplayEvent{
            EWeaponEventType::SlotChanged, activeSlot, slots[activeSlot].weaponId,
            slots[activeSlot].fireMode, EGunAudioProfile::GunLight556, slots[activeSlot].ammoRemaining
        });
    }

    void onTriggerPressed() {
        bTriggerHeld = true;
        if (!bSuppressUntilRelease) {
            bFreshPressPending = true;
        }
    }

    void onTriggerReleased() {
        bTriggerHeld = false;
        bFreshPressPending = false;
        bSuppressUntilRelease = false;
    }

    void step(double dt, const WeaponVariantSpec& activeSpec, std::vector<WeaponGameplayEvent>& outEvents) {
        for (auto& s : slots) {
            if (s.cooldownRemainingSec > 0.0) {
                s.cooldownRemainingSec = std::max(0.0, s.cooldownRemainingSec - dt);
            }
        }

        if (bPaused || bDisrupted) {
            state = EFireMachineState::Suppressed;
            barrelSpinRateRadSec *= std::exp(-8.0 * dt);
            barrelAngleRad += barrelSpinRateRadSec * dt;
            return;
        }

        auto& cur = slots[activeSlot];
        if (state == EFireMachineState::WeaponSwitching) {
            switchTimerSec -= dt;
            if (switchTimerSec <= 0.0) {
                state = (cur.ammoRemaining <= 0) ? EFireMachineState::Depleted : EFireMachineState::Idle;
            }
            return;
        }

        if (cur.ammoRemaining <= 0) {
            state = EFireMachineState::Depleted;
            bFreshPressPending = false;
            burstRemaining = 0;
            barrelSpinRateRadSec *= std::exp(-7.0 * dt);
            barrelAngleRad += barrelSpinRateRadSec * dt;
            return;
        }

        const bool isAuto = (activeSpec.domain == EWeaponDomain::ProjectileGuns && cur.fireMode == EFireMode::Auto);
        const bool isBurst = (activeSpec.domain == EWeaponDomain::ProjectileGuns && cur.fireMode == EFireMode::Burst);
        const bool wantsFire = !bSuppressUntilRelease && (
            (isAuto && bTriggerHeld) ||
            (isBurst && (bFreshPressPending || burstRemaining > 0)) ||
            (!isAuto && !isBurst && bFreshPressPending)
        );

        if (!wantsFire && (state == EFireMachineState::FiringCycle || state == EFireMachineState::SpinUp)) {
            if (activeSpec.spinDownDurationSec > 0.0) {
                state = EFireMachineState::SpinDown;
                spinTimerSec = activeSpec.spinDownDurationSec;
                outEvents.push_back(WeaponGameplayEvent{
                    EWeaponEventType::SpinDownStarted, activeSlot, cur.weaponId,
                    cur.fireMode, activeSpec.audioProfile, cur.ammoRemaining
                });
            } else {
                state = (cur.cooldownRemainingSec > 0.0) ? EFireMachineState::RecoveryCooldown : EFireMachineState::Idle;
            }
        }

        if (state == EFireMachineState::SpinDown) {
            spinTimerSec -= dt;
            barrelSpinRateRadSec *= std::exp(-9.0 * dt);
            barrelAngleRad += barrelSpinRateRadSec * dt;
            if (!wantsFire && spinTimerSec <= 0.0) {
                state = (cur.cooldownRemainingSec > 0.0) ? EFireMachineState::RecoveryCooldown : EFireMachineState::Idle;
            }
        }

        if (wantsFire) {
            if (state == EFireMachineState::Idle || state == EFireMachineState::RecoveryCooldown || state == EFireMachineState::SpinDown) {
                state = EFireMachineState::TriggerRequested;
                if (activeSpec.spinUpDurationSec > 0.0) {
                    state = EFireMachineState::SpinUp;
                    spinTimerSec = activeSpec.spinUpDurationSec;
                    outEvents.push_back(WeaponGameplayEvent{
                        EWeaponEventType::SpinUpStarted, activeSlot, cur.weaponId,
                        cur.fireMode, activeSpec.audioProfile, cur.ammoRemaining
                    });
                } else {
                    state = EFireMachineState::FiringCycle;
                }
            }

            if (state == EFireMachineState::SpinUp) {
                spinTimerSec -= dt;
                barrelSpinRateRadSec = std::min(48.0, barrelSpinRateRadSec + 320.0 * dt);
                barrelAngleRad += barrelSpinRateRadSec * dt;
                if (spinTimerSec <= 0.0) {
                    state = EFireMachineState::FiringCycle;
                }
            }

            if (state == EFireMachineState::FiringCycle) {
                if (activeSpec.rotaryBarrels > 0) {
                    barrelSpinRateRadSec = 48.0;
                    barrelAngleRad += barrelSpinRateRadSec * dt;
                }

                if (isBurst) {
                    if (bFreshPressPending && burstRemaining == 0 && cur.cooldownRemainingSec <= 0.0) {
                        bFreshPressPending = false;
                        burstRemaining = std::max(1, std::min(activeSpec.burstCount, cur.ammoRemaining));
                        burstTimerSec = 0.0;
                    }
                    if (burstRemaining > 0) {
                        burstTimerSec -= dt;
                        if (burstTimerSec <= 0.0 && cur.ammoRemaining > 0) {
                            emitSingleRound(cur, activeSpec, outEvents);
                            burstRemaining -= 1;
                            burstTimerSec = activeSpec.burstIntervalSec;
                            if (burstRemaining == 0) {
                                cur.cooldownRemainingSec = activeSpec.cooldownSec;
                                state = EFireMachineState::RecoveryCooldown;
                            }
                        }
                    }
                } else if (isAuto) {
                    bFreshPressPending = false;
                    if (cur.cooldownRemainingSec <= 0.0 && cur.ammoRemaining > 0) {
                        emitSingleRound(cur, activeSpec, outEvents);
                        cur.cooldownRemainingSec = activeSpec.cooldownSec;
                    }
                } else {
                    // Single-shot ordnance or single-fire rifle: strictly 1 round per fresh press
                    if (bFreshPressPending && cur.cooldownRemainingSec <= 0.0 && cur.ammoRemaining > 0) {
                        bFreshPressPending = false;
                        emitSingleRound(cur, activeSpec, outEvents);
                        cur.cooldownRemainingSec = activeSpec.cooldownSec;
                        state = EFireMachineState::RecoveryCooldown;
                    } else {
                        bFreshPressPending = false;
                    }
                }
            }
        } else {
            if (state == EFireMachineState::RecoveryCooldown && cur.cooldownRemainingSec <= 0.0) {
                state = EFireMachineState::Idle;
            }
            barrelSpinRateRadSec *= std::exp(-8.0 * dt);
            barrelAngleRad += barrelSpinRateRadSec * dt;
        }
    }

private:
    void emitSingleRound(
        EquippedSlotRuntime& cur,
        const WeaponVariantSpec& spec,
        std::vector<WeaponGameplayEvent>& outEvents
    ) {
        cur.ammoRemaining = std::max(0, cur.ammoRemaining - 1);
        outEvents.push_back(WeaponGameplayEvent{
            EWeaponEventType::RoundFired,
            activeSlot,
            cur.weaponId,
            cur.fireMode,
            spec.audioProfile,
            cur.ammoRemaining
        });
        if (cur.ammoRemaining == 0) {
            outEvents.push_back(WeaponGameplayEvent{
                EWeaponEventType::AmmoDepleted,
                activeSlot,
                cur.weaponId,
                cur.fireMode,
                spec.audioProfile,
                0
            });
            state = EFireMachineState::Depleted;
        }
    }
};

} // namespace AeroStrike::SimCore
