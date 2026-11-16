import {
  AIRFRAMES,
  PROPULSION_MODULES,
  WEAPONS,
  WEATHERS,
} from '../arsenalData';
import type { AarEventType } from '../aarLogger';
import {
  AiCombatBot,
  AiTargetCandidate,
  createAiBotSquadron,
  stepAiCombatBot,
} from '../aiDogfight';
import {
  advanceFixedClock,
  createFixedClock,
  FIXED_TIMESTEP_SEC,
  FixedClockState,
  MAX_SUBSTEPS_PER_FRAME,
} from '../clock/fixedClock';
import { SeededRng } from '../clock/seededRng';
import { CYBER_PAYLOADS } from '../cyberWarfare';
import {
  aimAnglesToDirection,
  computeDirectionAngularErrorRad,
  computeInstructorControlInput,
  computeKamikazeImpactPayload,
  predictOrdnanceTrajectory,
  stepDroneFlight,
  stepOrdnance,
  stepWarThunderAimAngles,
  wrapAngleRad,
} from '../flightPhysics';
import { groundHeightAt, THEATERS } from '../geoTheaters';
import { INITIAL_PROGRESSION, computePilotSkillBonuses } from '../progression';
import { ControlScheme, FlightModelMode } from '../settings';
import { computeAtmosphericGravity, computeSolarState } from '../solarGravity';
import {
  ActiveOrdnanceState,
  CyberPayloadId,
  DroneFlightState,
  LoadoutConfig,
  PilotSkillBonuses,
  PredictedImpact,
  PropulsionSpec,
  RemotePilotState,
  SandboxConfig,
  TheaterId,
  TheaterLandmark,
  WeaponId,
  WeatherId,
} from '../types';

export interface SimStepInput {
  pitchOverride: number;
  rollOverride: number;
  yawOverride: number;
  throttleDelta: number;
  aimDeltaYawRad: number;
  aimDeltaPitchRad: number;
  aimSmoothing?: number;
  freeLooking: boolean;
  firingHeld: boolean;
  cameraOrbitMode: boolean;
  cameraEoirMode?: boolean;
}

export interface SimWorldConfig {
  theaterId: TheaterId;
  weatherId: WeatherId;
  utcHours: number;
  loadout: LoadoutConfig;
  sandbox: SandboxConfig;
  skillBonuses: PilotSkillBonuses;
  flightModel: FlightModelMode;
  controlScheme: ControlScheme;
  instructorAutoLevel: boolean;
  radarWarningAudio: boolean;
  disableFuelDepletion?: boolean;
}

export interface SimCyberTargetInfo {
  id: string;
  name: string;
  kind: 'base' | 'drone';
  subtype: string;
  distanceM: number;
  hpPct: number;
  compromisedSec: number;
  activePayload: CyberPayloadId | null;
}

export interface LockedTargetInfo {
  id: string | null;
  kind: 'base' | 'drone' | 'waypoint' | null;
  name: string | null;
  x: number;
  y: number;
  z: number;
  hpPct: number | null;
}

export type SimEvent =
  | { type: 'theater_reset'; theaterId: TheaterId }
  | { type: 'ordnance_spawned'; ord: ActiveOrdnanceState }
  | { type: 'ordnance_removed'; id: string }
  | {
      type: 'ordnance_fired_net';
      payload: {
        weaponId: WeaponId;
        x: number;
        y: number;
        z: number;
        vx: number;
        vy: number;
        vz: number;
        targetX: number;
        targetY: number;
        targetZ: number;
      };
    }
  | { type: 'landmark_visibility'; landmarkId: string; visible: boolean }
  | {
      type: 'target_destroyed';
      info: { targetId: string; name: string; points: number; cepMeters: number; weaponId: WeaponId };
    }
  | { type: 'air_kill'; info: { victimName: string; points: number; weaponId: WeaponId } }
  | {
      type: 'cyber_success';
      info: {
        targetId: string;
        targetName: string;
        targetKind: 'base' | 'drone';
        payloadId: CyberPayloadId;
        damageDealt: number;
        destroyed: boolean;
        isRemotePilot: boolean;
      };
    }
  | {
      type: 'aar';
      event: {
        type: AarEventType;
        title: string;
        detail: string;
        tSec: number;
        x: number;
        z: number;
        altMsl: number;
        fuelKg: number;
      };
    }
  | {
      type: 'particle_burst';
      x: number;
      y: number;
      z: number;
      count: number;
      speed: number;
      size: number;
      r: number;
      g: number;
      b: number;
      life: number;
    }
  | { type: 'shockwave'; x: number; y: number; z: number; scale: number }
  | {
      type: 'sound';
      kind:
        | 'cannon'
        | 'glide_release'
        | 'missile_launch'
        | 'lock_chirp'
        | 'hit_marker'
        | 'explosion'
        | 'aaa_burst'
        | 'flare_pop'
        | 'cyber_inject'
        | 'cyber_purge'
        | 'cyber_alert'
        | 'kamikaze_siren';
      intensity?: number;
      isKill?: boolean;
      isBallistic?: boolean;
      x?: number;
      y?: number;
      z?: number;
      vx?: number;
      vy?: number;
      vz?: number;
    }
  | {
      type: 'game_over';
      victory: boolean;
      summary: { score: number; targetsDestroyed: number; totalTargets: number; bestCep: number | null };
    };

export function createInitialDroneState(
  theaterId: TheaterId,
  airframeId: LoadoutConfig['airframeId'],
  skillBonuses: PilotSkillBonuses,
): DroneFlightState {
  const airframe = AIRFRAMES[airframeId];
  const maxHp = Math.round(airframe.maxHp * skillBonuses.maxHpMult);
  const spawnX = 0;
  const spawnZ = 950;
  const groundY = Math.max(THEATERS[theaterId].waterLevelM, groundHeightAt(theaterId, spawnX, spawnZ));
  const initialSpeedMs = 92;
  const initialAtmos = computeAtmosphericGravity(THEATERS[theaterId].latDeg, groundY + 420 + THEATERS[theaterId].baseElevationM, 0, -initialSpeedMs);
  return {
    x: spawnX,
    y: groundY + 420,
    z: spawnZ,
    vx: 0,
    vy: 0,
    vz: -initialSpeedMs,
    pitch: 0.02,
    yaw: 0,
    roll: 0,
    throttle: 0.72,
    airspeedMs: initialSpeedMs,
    groundSpeedMs: initialSpeedMs,
    mach: initialSpeedMs / initialAtmos.speedOfSoundMs,
    aglMeters: 420,
    aoaDeg: 1.5,
    gLoad: 1.0,
    stalling: false,
    hp: maxHp,
    maxHp,
    fuelKg: airframe.maxFuelKg,
    maxFuelKg: airframe.maxFuelKg,
    solarChargeRateW: 0,
  };
}

/**
 * Pure TypeScript, headless AeroStrike simulation kernel.
 * Owns fixed-timestep simulation stepping, physics dispatch, ordnance, AI squadron,
 * base defenses, cyber state timers, and authoritative telemetry derivation.
 */
export class SimWorld {
  public clock: FixedClockState;
  public readonly rng: SeededRng;

  public config: SimWorldConfig;
  public drone: DroneFlightState;
  public landmarks: TheaterLandmark[] = [];
  public aiBots: AiCombatBot[] = [];
  public readonly botFlareDecoyUntil = new Map<string, number>();
  public readonly activeOrdnance: ActiveOrdnanceState[] = [];

  public activeSlot = 0;
  public slotAmmo: [number, number, number, number] = [4, 4, 2, 80];
  public slotCooldowns: [number, number, number, number] = [0, 0, 0, 0];
  public lockedTargetId: string | null = null;
  public customWaypoint: { x: number; y: number; z: number } | null = null;

  public aimYaw = 0;
  public aimPitch = 0.02;
  public desiredAimDir: { x: number; y: number; z: number } = aimAnglesToDirection(0, 0.02);

  private pendingAimDeltaYawRad = 0;
  private pendingAimDeltaPitchRad = 0;
  private queuedAimDeltaYawRad = 0;
  private queuedAimDeltaPitchRad = 0;
  private substepAimDeltaYawRad = 0;
  private substepAimDeltaPitchRad = 0;
  private prevDroneYaw = 0;
  private prevDronePitch = 0.02;
  private prevDroneRoll = 0;
  private estYawRateRad = 0;
  private estPitchRateRad = 0;
  private estRollRateRad = 0;
  public manualOverrideActive = false;
  public manualHandoffBlend = 1;
  public lastInstructorCmd = { pitch: 0, roll: 0, yaw: 0 };

  public score = 0;
  public bestCep: number | null = null;
  public blueTickets = 1000;
  public redTickets = 1000;
  public botReinforceTimer = 14;
  public ticketBleedTimer = 4.0;
  public combatHitCallout: string | null = null;
  public combatHitUntil = 0;
  public wingVortexTimer = 0;

  public readonly cyberStatus = new Map<string, { until: number; payloadId: CyberPayloadId }>();
  public cyberCooldownSec = 0;
  public playerGnssSpoofUntil = 0;
  public playerDisruptedUntil = 0;
  public playerDisruptedKind: CyberPayloadId | null = null;
  public incomingThreat: { sourceName: string; remainingSec: number } | null = null;
  public hostileCyberCooldown = 14;

  public flaresRemaining = 12;
  public flareCooldownSec = 0;
  public playerFlaresActiveUntil = 0;
  public kamikazeArmed = false;
  public reserveDrones = 3;
  public aaaBurstCooldown = 1.6;
  public warSmokeCooldown = 0.25;

  public gameOverTriggered = false;
  public hitstopTimer = 0;
  public trauma = 0;

  private nextOrdnanceSeq = 1;
  private currentAirframeId: LoadoutConfig['airframeId'];
  private currentSlotsKey: string;
  private pendingEvents: SimEvent[] = [];

  constructor(config: SimWorldConfig, seed = 0x5a17c0de) {
    this.config = {
      ...config,
      loadout: { ...config.loadout, slots: [...config.loadout.slots] as LoadoutConfig['slots'] },
      sandbox: { ...config.sandbox },
      skillBonuses: { ...config.skillBonuses },
    };
    this.rng = new SeededRng(seed);
    this.clock = createFixedClock();
    this.currentAirframeId = config.loadout.airframeId;
    this.currentSlotsKey = config.loadout.slots.join(',');
    this.drone = createInitialDroneState(config.theaterId, config.loadout.airframeId, config.skillBonuses);
    this.resetSortie(config.theaterId);
    this.pendingEvents = [];
  }

  public static createDefaultConfig(overrides?: Partial<SimWorldConfig>): SimWorldConfig {
    const baseBonuses = computePilotSkillBonuses(INITIAL_PROGRESSION);
    return {
      theaterId: 'edwards',
      weatherId: 'clear',
      utcHours: 19.2,
      loadout: {
        airframeId: 'bayraktar_tb2',
        propulsionId: 'turboprop_900',
        sensorId: 'eoir_das4',
        slots: ['mam_l', 'pg7vl_drop', 'r73_archer', 'm61_vulcan'],
      },
      sandbox: {
        enabled: false,
        gravityMultiplier: 1,
        airDensityMultiplier: 1,
        thrustMultiplier: 1,
        wingAreaMultiplier: 1,
        massMultiplier: 1,
        guidanceGainMultiplier: 1,
        timeScale: 1,
        infiniteAmmo: false,
        unlockAllInSandbox: false,
      },
      skillBonuses: baseBonuses,
      flightModel: 'arcade',
      controlScheme: 'mouse_aim',
      instructorAutoLevel: true,
      radarWarningAudio: true,
      disableFuelDepletion: false,
      ...overrides,
    };
  }

  public get sortieTimeSec(): number {
    return this.clock.simTimeSec;
  }

  private emit(ev: SimEvent): void {
    this.pendingEvents.push(ev);
  }

  private drainEvents(): SimEvent[] {
    if (this.pendingEvents.length === 0) return [];
    const out = this.pendingEvents;
    this.pendingEvents = [];
    return out;
  }

  private emitAar(type: AarEventType, title: string, detail: string): void {
    const baseElev = THEATERS[this.config.theaterId]?.baseElevationM ?? 0;
    this.emit({
      type: 'aar',
      event: {
        type,
        title,
        detail,
        tSec: Number(this.clock.simTimeSec.toFixed(1)),
        x: Math.round(this.drone.x),
        z: Math.round(this.drone.z),
        altMsl: Math.round(this.drone.y + baseElev),
        fuelKg: Math.round(this.drone.fuelKg * 10) / 10,
      },
    });
  }

  private rebuildTheaterState(theaterId: TheaterId): void {
    this.config.theaterId = theaterId;
    const spec = THEATERS[theaterId];
    this.landmarks = spec.landmarks.map((lm) => ({ ...lm, hp: lm.maxHp }));
    this.botFlareDecoyUntil.clear();
    this.aiBots = createAiBotSquadron(theaterId);
    this.lockedTargetId = this.landmarks.find((l) => l.hp > 0)?.id ?? null;
    this.emit({ type: 'theater_reset', theaterId });
  }

  public resetSortie(nextTheaterId?: TheaterId): SimEvent[] {
    const targetTheater = nextTheaterId ?? this.config.theaterId;
    for (const ord of this.activeOrdnance) {
      this.emit({ type: 'ordnance_removed', id: ord.id });
    }
    this.activeOrdnance.length = 0;

    this.clock = createFixedClock();
    this.rebuildTheaterState(targetTheater);

    this.drone = createInitialDroneState(
      targetTheater,
      this.config.loadout.airframeId,
      this.config.skillBonuses,
    );
    const slots = this.config.loadout.slots;
    this.slotAmmo = [
      WEAPONS[slots[0]].ammoPerSlot,
      WEAPONS[slots[1]].ammoPerSlot,
      WEAPONS[slots[2]].ammoPerSlot,
      WEAPONS[slots[3]].ammoPerSlot,
    ];
    this.slotCooldowns = [0, 0, 0, 0];
    this.score = 0;
    this.bestCep = null;
    this.trauma = 0;
    this.hitstopTimer = 0;
    this.gameOverTriggered = false;
    this.blueTickets = 1000;
    this.redTickets = 1000;
    this.botReinforceTimer = 14;
    this.ticketBleedTimer = 4.0;
    this.combatHitCallout = null;
    this.combatHitUntil = 0;
    this.syncAimStateToDrone();
    this.wingVortexTimer = 0;
    this.lockedTargetId = this.landmarks[0]?.id ?? null;
    this.customWaypoint = null;
    this.cyberStatus.clear();
    this.cyberCooldownSec = 0;
    this.playerGnssSpoofUntil = 0;
    this.playerDisruptedUntil = 0;
    this.playerDisruptedKind = null;
    this.incomingThreat = null;
    this.hostileCyberCooldown = 14;
    this.flaresRemaining = 12 + this.config.skillBonuses.bonusFlares;
    this.flareCooldownSec = 0;
    this.playerFlaresActiveUntil = 0;
    this.kamikazeArmed = false;
    this.reserveDrones = 3;
    this.aaaBurstCooldown = 1.6;
    this.warSmokeCooldown = 0.25;
    this.nextOrdnanceSeq = 1;
    this.currentAirframeId = this.config.loadout.airframeId;
    this.currentSlotsKey = slots.join(',');

    return this.drainEvents();
  }

  public syncConfig(next: SimWorldConfig): { events: SimEvent[]; loadoutChanged: boolean } {
    const prevTheater = this.config.theaterId;
    this.config = {
      ...next,
      loadout: { ...next.loadout, slots: [...next.loadout.slots] as LoadoutConfig['slots'] },
      sandbox: { ...next.sandbox },
      skillBonuses: { ...next.skillBonuses },
    };

    if (next.theaterId !== prevTheater) {
      this.resetSortie(next.theaterId);
    }

    let loadoutChanged = false;
    const nextSlotsKey = next.loadout.slots.join(',');
    if (next.loadout.airframeId !== this.currentAirframeId || nextSlotsKey !== this.currentSlotsKey) {
      loadoutChanged = true;
      const airframeChanged = next.loadout.airframeId !== this.currentAirframeId;
      this.currentAirframeId = next.loadout.airframeId;
      this.currentSlotsKey = nextSlotsKey;
      if (airframeChanged) {
        const af = AIRFRAMES[this.currentAirframeId];
        this.drone.maxHp = Math.round(af.maxHp * next.skillBonuses.maxHpMult);
        this.drone.hp = Math.min(this.drone.maxHp, this.drone.hp);
        this.drone.maxFuelKg = af.maxFuelKg;
        this.drone.fuelKg = af.maxFuelKg;
      }
      this.slotAmmo = [
        WEAPONS[next.loadout.slots[0]].ammoPerSlot,
        WEAPONS[next.loadout.slots[1]].ammoPerSlot,
        WEAPONS[next.loadout.slots[2]].ammoPerSlot,
        WEAPONS[next.loadout.slots[3]].ammoPerSlot,
      ];
      this.slotCooldowns = [0, 0, 0, 0];
    }

    return { events: this.drainEvents(), loadoutChanged };
  }

  public clearPendingAimDeltas(): void {
    this.pendingAimDeltaYawRad = 0;
    this.pendingAimDeltaPitchRad = 0;
    this.queuedAimDeltaYawRad = 0;
    this.queuedAimDeltaPitchRad = 0;
    this.substepAimDeltaYawRad = 0;
    this.substepAimDeltaPitchRad = 0;
  }

  private syncAimStateToDrone(): void {
    this.aimYaw = this.drone.yaw;
    this.aimPitch = this.drone.pitch;
    this.desiredAimDir = aimAnglesToDirection(this.aimYaw, this.aimPitch);
    this.prevDroneYaw = this.drone.yaw;
    this.prevDronePitch = this.drone.pitch;
    this.prevDroneRoll = this.drone.roll;
    this.estYawRateRad = 0;
    this.estPitchRateRad = 0;
    this.estRollRateRad = 0;
    this.manualOverrideActive = false;
    this.manualHandoffBlend = 1;
    this.lastInstructorCmd = { pitch: 0, roll: 0, yaw: 0 };
    this.clearPendingAimDeltas();
  }

  public getDesiredAimDirection(): { x: number; y: number; z: number } {
    return { ...this.desiredAimDir };
  }

  public getAimTelemetry() {
    const noseDir = aimAnglesToDirection(this.drone.yaw, this.drone.pitch);
    const angularErrorRad = computeDirectionAngularErrorRad(this.desiredAimDir, noseDir);
    return {
      desiredAimYawRad: Number(this.aimYaw.toFixed(4)),
      desiredAimPitchRad: Number(this.aimPitch.toFixed(4)),
      desiredAimDir: {
        x: Number(this.desiredAimDir.x.toFixed(4)),
        y: Number(this.desiredAimDir.y.toFixed(4)),
        z: Number(this.desiredAimDir.z.toFixed(4)),
      },
      aircraftYawRad: Number(this.drone.yaw.toFixed(4)),
      aircraftPitchRad: Number(this.drone.pitch.toFixed(4)),
      aircraftRollRad: Number(this.drone.roll.toFixed(4)),
      angularErrorDeg: Number(((angularErrorRad * 180) / Math.PI).toFixed(2)),
      instructorCmd: {
        pitch: Number(this.lastInstructorCmd.pitch.toFixed(3)),
        roll: Number(this.lastInstructorCmd.roll.toFixed(3)),
        yaw: Number(this.lastInstructorCmd.yaw.toFixed(3)),
      },
      manualOverrideActive: this.manualOverrideActive,
      manualHandoffBlend: Number(this.manualHandoffBlend.toFixed(2)),
    };
  }

  public setActiveSlot(slot: number): void {
    this.activeSlot = Math.max(0, Math.min(3, Math.floor(slot)));
  }

  public adjustThrottleDirect(delta: number): void {
    const maxThr = this.config.flightModel === 'arcade' ? 1.1 : 1.05;
    this.drone.throttle = Math.max(0, Math.min(maxThr, this.drone.throttle + delta));
  }

  public setWaypointTarget(x: number, z: number): SimEvent[] {
    const theaterId = this.config.theaterId;
    const y = Math.max(THEATERS[theaterId].waterLevelM, groundHeightAt(theaterId, x, z));
    this.customWaypoint = { x, y: y + 4, z };
    this.emit({ type: 'sound', kind: 'lock_chirp' });
    return this.drainEvents();
  }

  public getLockedTargetPos(remotePilots: RemotePilotState[]): LockedTargetInfo {
    const theaterId = this.config.theaterId;
    if (this.customWaypoint) {
      return {
        id: 'waypoint',
        kind: 'waypoint',
        name: 'MAP WAYPOINT',
        x: this.customWaypoint.x,
        y: this.customWaypoint.y,
        z: this.customWaypoint.z,
        hpPct: null,
      };
    }
    if (this.lockedTargetId) {
      const lm = this.landmarks.find((l) => l.id === this.lockedTargetId && l.hp > 0);
      if (lm) {
        const y = Math.max(THEATERS[theaterId].waterLevelM, groundHeightAt(theaterId, lm.x, lm.z));
        return {
          id: lm.id,
          kind: 'base',
          name: lm.name,
          x: lm.x,
          y: y + 8,
          z: lm.z,
          hpPct: (lm.hp / lm.maxHp) * 100,
        };
      }
      const ai = this.aiBots.find((a) => a.id === this.lockedTargetId && a.hp > 0);
      if (ai) {
        return {
          id: ai.id,
          kind: 'drone',
          name: ai.callsign,
          x: ai.x,
          y: ai.y,
          z: ai.z,
          hpPct: (ai.hp / ai.maxHp) * 100,
        };
      }
      const rem = remotePilots.find((p) => p.id === this.lockedTargetId && p.hp > 0);
      if (rem) {
        return {
          id: rem.id,
          kind: 'drone',
          name: rem.callsign,
          x: rem.x,
          y: rem.y,
          z: rem.z,
          hpPct: (rem.hp / rem.maxHp) * 100,
        };
      }
    }
    const fallback = this.landmarks.find((l) => l.hp > 0);
    if (fallback) {
      this.lockedTargetId = fallback.id;
      const y = Math.max(THEATERS[theaterId].waterLevelM, groundHeightAt(theaterId, fallback.x, fallback.z));
      return {
        id: fallback.id,
        kind: 'base',
        name: fallback.name,
        x: fallback.x,
        y: y + 8,
        z: fallback.z,
        hpPct: (fallback.hp / fallback.maxHp) * 100,
      };
    }
    const fallbackBot = this.aiBots.find((a) => a.team === 'bravo' && a.hp > 0);
    if (fallbackBot) {
      this.lockedTargetId = fallbackBot.id;
      return {
        id: fallbackBot.id,
        kind: 'drone',
        name: fallbackBot.callsign,
        x: fallbackBot.x,
        y: fallbackBot.y,
        z: fallbackBot.z,
        hpPct: (fallbackBot.hp / fallbackBot.maxHp) * 100,
      };
    }
    return { id: null, kind: null, name: null, x: this.drone.x, y: 0, z: this.drone.z - 1200, hpPct: null };
  }

  public cycleTarget(remotePilots: RemotePilotState[]): SimEvent[] {
    this.customWaypoint = null;
    const candidates: string[] = [
      ...this.landmarks.filter((l) => l.hp > 0).map((l) => l.id),
      ...this.aiBots.filter((a) => a.team === 'bravo' && a.hp > 0).map((a) => a.id),
      ...remotePilots.filter((p) => p.hp > 0).map((p) => p.id),
    ];
    if (candidates.length === 0) return [];
    const idx = this.lockedTargetId ? candidates.indexOf(this.lockedTargetId) : -1;
    this.lockedTargetId = candidates[(idx + 1) % candidates.length];
    this.emit({ type: 'sound', kind: 'lock_chirp' });
    return this.drainEvents();
  }

  private spawnOrdnanceEntity(payload: {
    id: string;
    ownerId: string;
    weaponId: WeaponId;
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    targetId: string | null;
    targetX: number;
    targetY: number;
    targetZ: number;
  }): void {
    const spec = WEAPONS[payload.weaponId];
    const ord: ActiveOrdnanceState = {
      ...payload,
      ageSec: 0,
      maxLifetimeSec: spec.category === 'cannon' ? 2.6 : 38,
      wingDeployed: false,
      phase: spec.category === 'cannon' ? 'bullet' : spec.category === 'glide_bomb' ? 'glide' : 'boost',
    };
    this.activeOrdnance.push(ord);
    this.emit({ type: 'ordnance_spawned', ord });
  }

  public spawnRemoteOrdnance(payload: {
    ownerId: string;
    weaponId: WeaponId;
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    targetX: number;
    targetY: number;
    targetZ: number;
  }): SimEvent[] {
    const id = `rem-${this.nextOrdnanceSeq++}`;
    this.spawnOrdnanceEntity({
      id,
      ownerId: payload.ownerId,
      weaponId: payload.weaponId,
      x: payload.x,
      y: payload.y,
      z: payload.z,
      vx: payload.vx,
      vy: payload.vy,
      vz: payload.vz,
      targetId: null,
      targetX: payload.targetX,
      targetY: payload.targetY,
      targetZ: payload.targetZ,
    });
    return this.drainEvents();
  }

  public applyTargetHpSync(targetHp: Record<string, number>): SimEvent[] {
    for (const lm of this.landmarks) {
      if (lm.id in targetHp) {
        lm.hp = targetHp[lm.id];
        this.emit({ type: 'landmark_visibility', landmarkId: lm.id, visible: lm.hp > 0 });
      }
    }
    return this.drainEvents();
  }

  public deployFlares(isPlaying: boolean): { ok: boolean; events: SimEvent[] } {
    if (!isPlaying || this.gameOverTriggered) return { ok: false, events: [] };
    if (this.flaresRemaining <= 0 || this.flareCooldownSec > 0) return { ok: false, events: [] };
    this.flaresRemaining -= 1;
    this.flareCooldownSec = 1.6;
    this.playerFlaresActiveUntil = this.clock.simTimeSec + 4.5;

    const cosP = Math.cos(this.drone.pitch);
    const fwdX = -Math.sin(this.drone.yaw) * cosP;
    const fwdZ = -Math.cos(this.drone.yaw) * cosP;
    const rightX = Math.cos(this.drone.yaw);
    const rightZ = -Math.sin(this.drone.yaw);
    for (let i = 0; i < 4; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      this.emit({
        type: 'particle_burst',
        x: this.drone.x - fwdX * 3.5 + rightX * side * 2.1,
        y: this.drone.y - 0.8,
        z: this.drone.z - fwdZ * 3.5 + rightZ * side * 2.1,
        count: 3,
        speed: 24,
        size: 0.42,
        r: 1.0,
        g: 0.88,
        b: 0.42,
        life: 1.4,
      });
    }
    this.emit({
      type: 'sound',
      kind: 'flare_pop',
      x: this.drone.x,
      y: this.drone.y - 0.8,
      z: this.drone.z,
      vx: this.drone.vx,
      vy: this.drone.vy,
      vz: this.drone.vz,
    });
    this.emitAar('ordnance', 'Countermeasures Deployed', `IR Flares & Chaff salvo (${this.flaresRemaining} remaining)`);
    return { ok: true, events: this.drainEvents() };
  }

  public armKamikazeDive(isPlaying: boolean): { armed: boolean; events: SimEvent[] } {
    const af = AIRFRAMES[this.config.loadout.airframeId];
    if (!af.kamikazeCapable || !isPlaying || this.gameOverTriggered) {
      return { armed: false, events: [] };
    }
    this.kamikazeArmed = !this.kamikazeArmed;
    if (this.kamikazeArmed) {
      this.emit({ type: 'sound', kind: 'kamikaze_siren' });
      this.emitAar(
        'ordnance',
        'Kamikaze Dive Armed',
        `${af.name} terminal warhead (${af.kamikazeWarheadKg} kg) armed — steer nose into target!`,
      );
    }
    return { armed: this.kamikazeArmed, events: this.drainEvents() };
  }

  public fireActiveOrdnance(
    isPlaying: boolean,
    remotePilots: RemotePilotState[],
  ): { fired: boolean; events: SimEvent[] } {
    if (!isPlaying || this.gameOverTriggered) return { fired: false, events: [] };
    if (
      this.clock.simTimeSec < this.playerDisruptedUntil &&
      (this.playerDisruptedKind === 'c2_hijack' || this.playerDisruptedKind === 'firmware_brick')
    ) {
      return { fired: false, events: [] };
    }
    const weaponId = this.config.loadout.slots[this.activeSlot];
    const spec = WEAPONS[weaponId];
    if (this.slotCooldowns[this.activeSlot] > 0) return { fired: false, events: [] };
    if (!this.config.sandbox.infiniteAmmo && this.slotAmmo[this.activeSlot] <= 0) {
      return { fired: false, events: [] };
    }

    if (!this.config.sandbox.infiniteAmmo) {
      this.slotAmmo[this.activeSlot] -= 1;
    }
    this.slotCooldowns[this.activeSlot] = spec.cooldownSec * this.config.skillBonuses.weaponCooldownMult;

    const cosP = Math.cos(this.drone.pitch);
    const fwdX = -Math.sin(this.drone.yaw) * cosP;
    const fwdY = Math.sin(this.drone.pitch);
    const fwdZ = -Math.cos(this.drone.yaw) * cosP;

    const tgt = this.getLockedTargetPos(remotePilots);
    const vx = this.drone.vx + fwdX * spec.initialSpeedMs;
    const vy = this.drone.vy + fwdY * spec.initialSpeedMs;
    const vz = this.drone.vz + fwdZ * spec.initialSpeedMs;

    const id = `ord-${this.nextOrdnanceSeq++}`;
    this.spawnOrdnanceEntity({
      id,
      ownerId: 'player',
      weaponId,
      x: this.drone.x + fwdX * 3,
      y: this.drone.y - 1.5,
      z: this.drone.z + fwdZ * 3,
      vx,
      vy,
      vz,
      targetId: tgt.id,
      targetX: tgt.x,
      targetY: tgt.y,
      targetZ: tgt.z,
    });

    this.emit({
      type: 'ordnance_fired_net',
      payload: {
        weaponId,
        x: this.drone.x,
        y: this.drone.y - 1.5,
        z: this.drone.z,
        vx,
        vy,
        vz,
        targetX: tgt.x,
        targetY: tgt.y,
        targetZ: tgt.z,
      },
    });
    if (spec.category !== 'cannon') {
      this.emitAar('ordnance', `${spec.natoCode} Released`, `${spec.name} → ${tgt.name ?? 'Boresight'}`);
    }

    if (spec.category === 'cannon') {
      this.emit({
        type: 'sound',
        kind: 'cannon',
        x: this.drone.x + fwdX * 3.8,
        y: this.drone.y - 0.3,
        z: this.drone.z + fwdZ * 3.8,
        vx: this.drone.vx,
        vy: this.drone.vy,
        vz: this.drone.vz,
      });
      this.emit({
        type: 'particle_burst',
        x: this.drone.x + fwdX * 3.8,
        y: this.drone.y - 0.3,
        z: this.drone.z + fwdZ * 3.8,
        count: 3,
        speed: 14,
        size: 0.45,
        r: 1.0,
        g: 0.85,
        b: 0.3,
        life: 0.14,
      });
      this.trauma = Math.min(1, this.trauma + 0.08);
    } else if (spec.category === 'glide_bomb' || spec.category === 'drop_bomb') {
      this.emit({
        type: 'sound',
        kind: 'glide_release',
        x: this.drone.x,
        y: this.drone.y - 1.5,
        z: this.drone.z,
        vx: this.drone.vx,
        vy: this.drone.vy,
        vz: this.drone.vz,
      });
      this.trauma = Math.min(1, this.trauma + 0.14);
    } else {
      this.emit({
        type: 'sound',
        kind: 'missile_launch',
        isBallistic: spec.category === 'ballistic_missile',
        x: this.drone.x + fwdX * 2.5,
        y: this.drone.y - 1.5,
        z: this.drone.z + fwdZ * 2.5,
        vx: this.drone.vx,
        vy: this.drone.vy,
        vz: this.drone.vz,
      });
      this.emit({
        type: 'particle_burst',
        x: this.drone.x + fwdX * 1.2,
        y: this.drone.y - 1.5,
        z: this.drone.z + fwdZ * 1.2,
        count: 6,
        speed: 18,
        size: 1.4,
        r: 0.96,
        g: 0.72,
        b: 0.38,
        life: 0.45,
      });
      this.trauma = Math.min(1, this.trauma + (spec.category === 'ballistic_missile' ? 0.35 : 0.2));
    }

    return { fired: true, events: this.drainEvents() };
  }

  public getCyberTargets(remotePilots: RemotePilotState[]): SimCyberTargetInfo[] {
    const list: SimCyberTargetInfo[] = [];
    const theaterSpec = THEATERS[this.config.theaterId];
    for (const lm of this.landmarks) {
      if (lm.hp <= 0) continue;
      const ly = Math.max(theaterSpec.waterLevelM, groundHeightAt(this.config.theaterId, lm.x, lm.z)) + 8;
      const dist = Math.round(Math.hypot(lm.x - this.drone.x, ly - this.drone.y, lm.z - this.drone.z));
      const st = this.cyberStatus.get(lm.id);
      const rem = st ? Math.max(0, Math.ceil(st.until - this.clock.simTimeSec)) : 0;
      list.push({
        id: lm.id,
        name: lm.name,
        kind: 'base',
        subtype: lm.type,
        distanceM: dist,
        hpPct: Math.round((lm.hp / lm.maxHp) * 100),
        compromisedSec: rem,
        activePayload: rem > 0 && st ? st.payloadId : null,
      });
    }
    for (const ai of this.aiBots) {
      if (ai.team !== 'bravo' || ai.hp <= 0) continue;
      const dist = Math.round(Math.hypot(ai.x - this.drone.x, ai.y - this.drone.y, ai.z - this.drone.z));
      const st = this.cyberStatus.get(ai.id);
      const rem = st ? Math.max(0, Math.ceil(st.until - this.clock.simTimeSec)) : 0;
      list.push({
        id: ai.id,
        name: ai.callsign,
        kind: 'drone',
        subtype: 'Hostile UAV',
        distanceM: dist,
        hpPct: Math.round((ai.hp / ai.maxHp) * 100),
        compromisedSec: rem,
        activePayload: rem > 0 && st ? st.payloadId : null,
      });
    }
    for (const rp of remotePilots) {
      if (rp.hp <= 0) continue;
      const dist = Math.round(Math.hypot(rp.x - this.drone.x, rp.y - this.drone.y, rp.z - this.drone.z));
      const st = this.cyberStatus.get(rp.id);
      const rem = st ? Math.max(0, Math.ceil(st.until - this.clock.simTimeSec)) : 0;
      list.push({
        id: rp.id,
        name: rp.callsign,
        kind: 'drone',
        subtype: 'Arena UAV',
        distanceM: dist,
        hpPct: Math.round((rp.hp / rp.maxHp) * 100),
        compromisedSec: rem,
        activePayload: rem > 0 && st ? st.payloadId : null,
      });
    }
    return list.sort((a, b) => a.distanceM - b.distanceM);
  }

  public triggerCyberAttack(
    targetId: string,
    payloadId: CyberPayloadId,
    remotePilots: RemotePilotState[],
  ): {
    result: {
      ok: boolean;
      targetName: string;
      targetKind: 'base' | 'drone';
      destroyed: boolean;
      damageDealt: number;
      isRemotePilot: boolean;
      message: string;
    };
    events: SimEvent[];
  } {
    const spec = CYBER_PAYLOADS[payloadId];
    const sb = this.config.skillBonuses;
    const effectiveDuration = Math.round(spec.durationSec * sb.cyberDurationMult);
    this.cyberCooldownSec = Number((spec.cooldownSec * sb.cyberCooldownMult).toFixed(1));
    this.cyberStatus.set(targetId, { until: this.clock.simTimeSec + effectiveDuration, payloadId });
    if (payloadId === 'gnss_spoof') {
      this.playerGnssSpoofUntil = this.clock.simTimeSec + effectiveDuration;
    }
    this.emit({ type: 'sound', kind: 'cyber_inject' });
    const theaterSpec = THEATERS[this.config.theaterId];

    const lm = this.landmarks.find((l) => l.id === targetId && l.hp > 0);
    if (lm) {
      const ly = Math.max(theaterSpec.waterLevelM, groundHeightAt(this.config.theaterId, lm.x, lm.z)) + 12;
      this.emit({ type: 'particle_burst', x: lm.x, y: ly, z: lm.z, count: 18, speed: 42, size: 3.6, r: 0.08, g: 0.85, b: 0.96, life: 1.0 });
      let destroyed = false;
      if (spec.directDamage > 0) {
        lm.hp = Math.max(0, lm.hp - spec.directDamage);
        this.emit({ type: 'sound', kind: 'explosion', intensity: 1.15, x: lm.x, y: ly, z: lm.z, vx: 0, vy: 0, vz: 0 });
        this.emit({ type: 'particle_burst', x: lm.x, y: ly, z: lm.z, count: 22, speed: 58, size: 4.8, r: 1.0, g: 0.48, b: 0.12, life: 1.1 });
        if (lm.hp === 0) {
          destroyed = true;
          this.redTickets = Math.max(0, this.redTickets - 120);
          this.emit({ type: 'landmark_visibility', landmarkId: lm.id, visible: false });
          this.score += lm.points;
          this.emit({
            type: 'target_destroyed',
            info: {
              targetId: lm.id,
              name: lm.name,
              points: lm.points,
              cepMeters: 0,
              weaponId: 'agm158_jassm',
            },
          });
        }
      }
      this.emit({
        type: 'cyber_success',
        info: {
          targetId: lm.id,
          targetName: lm.name,
          targetKind: 'base',
          payloadId,
          damageDealt: spec.directDamage,
          destroyed,
          isRemotePilot: false,
        },
      });
      this.emitAar(
        'cyber',
        `Cyber Breach: ${lm.name}`,
        `${spec.name}${destroyed ? ' (Facility Destroyed)' : spec.directDamage > 0 ? ` (-${spec.directDamage} HP)` : ` (${effectiveDuration}s EW lockout)`}`,
      );
      return {
        result: {
          ok: true,
          targetName: lm.name,
          targetKind: 'base',
          destroyed,
          damageDealt: spec.directDamage,
          isRemotePilot: false,
          message: `${spec.name} injected into ${lm.name}${destroyed ? ' — FACILITY DESTROYED!' : spec.directDamage > 0 ? ` (-${spec.directDamage} HP)` : ` (${effectiveDuration}s EW lockout)`}`,
        },
        events: this.drainEvents(),
      };
    }

    const ai = this.aiBots.find((a) => a.id === targetId && a.hp > 0);
    if (ai) {
      this.emit({ type: 'particle_burst', x: ai.x, y: ai.y, z: ai.z, count: 16, speed: 40, size: 3.4, r: 0.08, g: 0.85, b: 0.96, life: 0.9 });
      let destroyed = false;
      if (spec.directDamage > 0) {
        ai.hp = Math.max(0, ai.hp - spec.directDamage);
        if (ai.hp === 0) {
          destroyed = true;
          this.redTickets = Math.max(0, this.redTickets - 65);
          this.emit({ type: 'sound', kind: 'explosion', intensity: 1.2, x: ai.x, y: ai.y, z: ai.z, vx: ai.vx, vy: ai.vy, vz: ai.vz });
          this.emit({ type: 'sound', kind: 'hit_marker', isKill: true });
          this.score += 250;
          this.emit({
            type: 'air_kill',
            info: { victimName: ai.callsign, points: 250, weaponId: 'aim9x_sidewinder' },
          });
        }
      }
      this.emit({
        type: 'cyber_success',
        info: {
          targetId: ai.id,
          targetName: ai.callsign,
          targetKind: 'drone',
          payloadId,
          damageDealt: spec.directDamage,
          destroyed,
          isRemotePilot: false,
        },
      });
      this.emitAar(
        'cyber',
        `Cyber Breach: ${ai.callsign}`,
        `${spec.name}${destroyed ? ' (UAV Crashed)' : ` (${spec.durationSec}s C2 disruption)`}`,
      );
      return {
        result: {
          ok: true,
          targetName: ai.callsign,
          targetKind: 'drone',
          destroyed,
          damageDealt: spec.directDamage,
          isRemotePilot: false,
          message: `${spec.name} breached ${ai.callsign}${destroyed ? ' — UAV CRASHED!' : ` (${spec.durationSec}s flight/C2 disruption)`}`,
        },
        events: this.drainEvents(),
      };
    }

    const rp = remotePilots.find((p) => p.id === targetId && p.hp > 0);
    if (rp) {
      this.emit({ type: 'particle_burst', x: rp.x, y: rp.y, z: rp.z, count: 16, speed: 40, size: 3.4, r: 0.08, g: 0.85, b: 0.96, life: 0.9 });
      this.emit({
        type: 'cyber_success',
        info: {
          targetId: rp.id,
          targetName: rp.callsign,
          targetKind: 'drone',
          payloadId,
          damageDealt: spec.directDamage,
          destroyed: false,
          isRemotePilot: true,
        },
      });
      this.emitAar('cyber', `Cyber Breach: ${rp.callsign}`, `Transmitted ${spec.name} to arena UAV`);
      return {
        result: {
          ok: true,
          targetName: rp.callsign,
          targetKind: 'drone',
          destroyed: false,
          damageDealt: spec.directDamage,
          isRemotePilot: true,
          message: `Transmitted ${spec.name} to arena UAV ${rp.callsign}.`,
        },
        events: this.drainEvents(),
      };
    }

    return {
      result: {
        ok: false,
        targetName: 'Unknown',
        targetKind: 'base',
        destroyed: false,
        damageDealt: 0,
        isRemotePilot: false,
        message: 'Target lost or already destroyed.',
      },
      events: this.drainEvents(),
    };
  }

  public purgeCyberIntrusion(): { hadThreat: boolean; events: SimEvent[] } {
    const hadThreat = Boolean(this.incomingThreat) || this.clock.simTimeSec < this.playerDisruptedUntil;
    this.incomingThreat = null;
    this.playerDisruptedUntil = 0;
    this.playerDisruptedKind = null;
    this.emit({ type: 'sound', kind: 'cyber_purge' });
    if (hadThreat) {
      this.emitAar('defense', 'C2 Key Rotation', 'Purged hostile cyber intrusion and restored flight link');
    }
    return { hadThreat, events: this.drainEvents() };
  }

  public receiveRemoteCyberAttack(payloadId: CyberPayloadId, attackerCallsign: string): SimEvent[] {
    const spec = CYBER_PAYLOADS[payloadId];
    this.playerDisruptedUntil = this.clock.simTimeSec + Math.min(8, spec.durationSec);
    this.playerDisruptedKind = payloadId;
    this.incomingThreat = { sourceName: `${attackerCallsign} (${spec.name})`, remainingSec: 4.0 };
    if (spec.directDamage > 0) {
      this.drone.hp = Math.max(1, this.drone.hp - Math.round(spec.directDamage * 0.25));
    }
    this.emit({ type: 'sound', kind: 'cyber_alert' });
    this.trauma = Math.min(1, this.trauma + 0.3);
    return this.drainEvents();
  }

  private detonateDroneAsKamikaze(
    impactX: number,
    impactY: number,
    impactZ: number,
    reasonLabel: string,
  ): void {
    const payload = computeKamikazeImpactPayload(
      this.config.loadout.airframeId,
      this.config.loadout.slots,
      this.slotAmmo,
      this.config.skillBonuses,
    );
    const theaterSpec = THEATERS[this.config.theaterId];

    this.emit({ type: 'shockwave', x: impactX, y: impactY, z: impactZ, scale: 2.2 });
    this.emit({ type: 'particle_burst', x: impactX, y: impactY + 4, z: impactZ, count: 48, speed: 105, size: 7.6, r: 1.0, g: 0.52, b: 0.1, life: 1.35 });
    this.emit({ type: 'particle_burst', x: impactX, y: impactY + 6, z: impactZ, count: 28, speed: 52, size: 8.2, r: 0.28, g: 0.28, b: 0.3, life: 1.8 });
    this.emit({ type: 'sound', kind: 'explosion', intensity: 2.2, x: impactX, y: impactY, z: impactZ, vx: 0, vy: 0, vz: 0 });
    this.trauma = 1.0;
    this.hitstopTimer = 0.075;

    for (const lm of this.landmarks) {
      if (lm.hp <= 0) continue;
      const dHoriz = Math.hypot(impactX - lm.x, impactZ - lm.z);
      if (dHoriz <= Math.max(payload.blastRadiusM, 52)) {
        const falloff = Math.max(0.45, 1 - (dHoriz / Math.max(payload.blastRadiusM, 55)) * 0.45);
        lm.hp = Math.max(0, lm.hp - payload.damage * falloff);
        if (lm.hp === 0) {
          this.emit({ type: 'landmark_visibility', landmarkId: lm.id, visible: false });
          this.redTickets = Math.max(0, this.redTickets - 120);
          const cep = Math.round(dHoriz * 10) / 10;
          this.bestCep = this.bestCep === null ? cep : Math.min(this.bestCep, cep);
          this.score += lm.points + 75;
          this.combatHitCallout = `TARGET DESTROYED +${lm.points + 75}`;
          this.combatHitUntil = this.clock.simTimeSec + 2.2;
          this.emit({ type: 'sound', kind: 'hit_marker', isKill: true });
          this.emit({
            type: 'target_destroyed',
            info: {
              targetId: lm.id,
              name: lm.name,
              points: lm.points + 75,
              cepMeters: cep,
              weaponId: this.config.loadout.slots[0],
            },
          });
          this.emitAar(
            'strike',
            `Kamikaze Direct Hit: ${lm.name}`,
            `${reasonLabel} (${payload.warheadKg} kg warhead+ordnance) · CEP ${cep}m (+${lm.points + 75} pts)`,
          );
        }
      }
    }

    for (const ai of this.aiBots) {
      if (ai.team !== 'bravo' || ai.hp <= 0) continue;
      const dAi = Math.hypot(impactX - ai.x, impactY - ai.y, impactZ - ai.z);
      if (dAi <= Math.max(46, payload.blastRadiusM * 0.8)) {
        ai.hp = Math.max(0, ai.hp - payload.damage);
        if (ai.hp === 0) {
          this.score += 300;
          this.redTickets = Math.max(0, this.redTickets - 65);
          this.combatHitCallout = `AIRCRAFT DESTROYED +300`;
          this.combatHitUntil = this.clock.simTimeSec + 2.2;
          this.emit({ type: 'sound', kind: 'hit_marker', isKill: true });
          this.emit({
            type: 'air_kill',
            info: { victimName: ai.callsign, points: 300, weaponId: this.config.loadout.slots[0] },
          });
          this.emitAar('air_kill', `Kamikaze Ram: ${ai.callsign}`, `Mid-air warhead detonation (+300 pts)`);
        }
      }
    }

    this.reserveDrones = Math.max(0, this.reserveDrones - 1);
    this.blueTickets = Math.max(0, this.blueTickets - 120);
    this.kamikazeArmed = false;

    const aliveLandmarks = this.landmarks.filter((l) => l.hp > 0).length;
    if (aliveLandmarks === 0 || this.redTickets <= 0) {
      return;
    }

    if (this.reserveDrones > 0) {
      this.drone = createInitialDroneState(
        theaterSpec.id,
        this.config.loadout.airframeId,
        this.config.skillBonuses,
      );
      this.syncAimStateToDrone();
      const slots = this.config.loadout.slots;
      this.slotAmmo = [
        WEAPONS[slots[0]].ammoPerSlot,
        WEAPONS[slots[1]].ammoPerSlot,
        WEAPONS[slots[2]].ammoPerSlot,
        WEAPONS[slots[3]].ammoPerSlot,
      ];
      this.slotCooldowns = [0, 0, 0, 0];
      this.emitAar('launch', `Squadron Unit Redeployed`, `${this.reserveDrones} drone units remaining in theater`);
    } else {
      this.drone.hp = 0;
    }
  }

  private stepFixed(dt: number, input: SimStepInput, remotePilots: RemotePilotState[]): void {
    const sortieTimeSec = this.clock.simTimeSec;
    const theaterId = this.config.theaterId;
    const theater = THEATERS[theaterId];
    const normalizedSandbox: SandboxConfig = { ...this.config.sandbox, timeScale: 1.0 };

    // Continuous cannon hold support
    if (input.firingHeld && WEAPONS[this.config.loadout.slots[this.activeSlot]].category === 'cannon') {
      this.fireActiveOrdnance(true, remotePilots);
    }

    // Cooldowns & Cyber Intrusion Timers
    this.cyberCooldownSec = Math.max(0, this.cyberCooldownSec - dt);
    this.flareCooldownSec = Math.max(0, this.flareCooldownSec - dt);
    for (let i = 0; i < 4; i++) {
      this.slotCooldowns[i] = Math.max(0, this.slotCooldowns[i] - dt);
    }

    if (this.incomingThreat) {
      this.incomingThreat.remainingSec -= dt;
      if (this.incomingThreat.remainingSec <= 0) {
        this.playerDisruptedUntil =
          sortieTimeSec + 7.5 * this.config.skillBonuses.hostileCyberDurationMult;
        this.playerDisruptedKind = 'c2_hijack';
        this.drone.hp = Math.max(1, this.drone.hp - 10);
        this.trauma = Math.min(1, this.trauma + 0.28);
        if (this.config.radarWarningAudio) this.emit({ type: 'sound', kind: 'cyber_alert' });
        this.emitAar(
          'damage',
          'Hostile C2 Breach',
          `${this.incomingThreat.sourceName} disrupted avionics (-10 HP)`,
        );
        this.incomingThreat = null;
      }
    } else {
      this.hostileCyberCooldown -= dt;
      if (this.hostileCyberCooldown <= 0 && sortieTimeSec > 10) {
        const activeEnemyRadar = this.landmarks.find(
          (l) =>
            l.hp > 0 &&
            (l.type === 'radar' || l.type === 'sam') &&
            !(this.cyberStatus.get(l.id) && sortieTimeSec < (this.cyberStatus.get(l.id)?.until ?? 0)) &&
            Math.hypot(l.x - this.drone.x, l.z - this.drone.z) < 2500,
        );
        const activeEnemyAi = this.aiBots.find(
          (a) =>
            a.team === 'bravo' &&
            a.hp > 0 &&
            !(this.cyberStatus.get(a.id) && sortieTimeSec < (this.cyberStatus.get(a.id)?.until ?? 0)) &&
            Math.hypot(a.x - this.drone.x, a.z - this.drone.z) < 2000,
        );
        const source = activeEnemyRadar?.name ?? activeEnemyAi?.callsign ?? null;
        if (source) {
          this.incomingThreat = { sourceName: source, remainingSec: 4.5 };
          if (this.config.radarWarningAudio) this.emit({ type: 'sound', kind: 'cyber_alert' });
          this.hostileCyberCooldown = 22 + this.rng.next() * 10;
        } else {
          this.hostileCyberCooldown = 6;
        }
      }
    }

    if (this.combatHitCallout && sortieTimeSec >= this.combatHitUntil) {
      this.combatHitCallout = null;
    }

    const isPlayerDisrupted = sortieTimeSec < this.playerDisruptedUntil;
    const cyberRollJitter =
      isPlayerDisrupted && this.playerDisruptedKind === 'c2_hijack'
        ? Math.sin(sortieTimeSec * 9.5) * 0.45
        : 0;

    const effRollOverride = Math.max(-1, Math.min(1, input.rollOverride + cyberRollJitter));
    const manualOverrideActive =
      Math.abs(input.pitchOverride) > 0.05 ||
      Math.abs(effRollOverride) > 0.05 ||
      Math.abs(input.yawOverride) > 0.05;

    if (manualOverrideActive) {
      this.manualOverrideActive = true;
      this.manualHandoffBlend = 0;
      this.queuedAimDeltaYawRad = 0;
      this.queuedAimDeltaPitchRad = 0;
    } else {
      if (this.manualOverrideActive) {
        this.manualOverrideActive = false;
        this.manualHandoffBlend = 0;
      } else {
        this.manualHandoffBlend = Math.min(1, this.manualHandoffBlend + dt / 0.35);
      }
    }

    const aimSmoothing = Math.max(0, Math.min(1, input.aimSmoothing ?? 0));
    let appliedStepYawDelta = this.substepAimDeltaYawRad;
    let appliedStepPitchDelta = this.substepAimDeltaPitchRad;

    if (aimSmoothing > 0.01 && this.config.controlScheme === 'mouse_aim' && !input.freeLooking && !manualOverrideActive) {
      this.queuedAimDeltaYawRad += this.substepAimDeltaYawRad;
      this.queuedAimDeltaPitchRad += this.substepAimDeltaPitchRad;
      const smoothHz = 36 - aimSmoothing * 26; // 36 Hz -> 10 Hz responsive exponential smoothing
      const alpha = 1 - Math.exp(-smoothHz * dt);
      appliedStepYawDelta = this.queuedAimDeltaYawRad * alpha;
      appliedStepPitchDelta = this.queuedAimDeltaPitchRad * alpha;
      this.queuedAimDeltaYawRad -= appliedStepYawDelta;
      this.queuedAimDeltaPitchRad -= appliedStepPitchDelta;
    } else if (this.queuedAimDeltaYawRad !== 0 || this.queuedAimDeltaPitchRad !== 0) {
      appliedStepYawDelta += this.queuedAimDeltaYawRad;
      appliedStepPitchDelta += this.queuedAimDeltaPitchRad;
      this.queuedAimDeltaYawRad = 0;
      this.queuedAimDeltaPitchRad = 0;
    }

    const aimStep = stepWarThunderAimAngles({
      aimYaw: this.aimYaw,
      aimPitch: this.aimPitch,
      aimDeltaYawRad: appliedStepYawDelta,
      aimDeltaPitchRad: appliedStepPitchDelta,
      manualOverrideActive,
      freeLooking: input.freeLooking,
      droneYaw: this.drone.yaw,
      dronePitch: this.drone.pitch,
      scheme: this.config.controlScheme,
    });
    this.aimYaw = aimStep.aimYaw;
    this.aimPitch = aimStep.aimPitch;
    this.desiredAimDir = aimStep.targetDir;

    let flightControlInput;
    if (this.config.controlScheme === 'mouse_aim' && !input.cameraOrbitMode) {
      const afSpec = AIRFRAMES[this.config.loadout.airframeId];
      const maxBankRad = afSpec.maxRollRateRad > 1.8 ? 1.08 : 0.94;
      flightControlInput = computeInstructorControlInput(
        this.drone,
        this.desiredAimDir,
        {
          pitchOverride: input.pitchOverride,
          rollOverride: effRollOverride,
          yawOverride: input.yawOverride,
          throttleDelta: input.throttleDelta,
        },
        {
          autoLevel: this.config.instructorAutoLevel,
          pitchRateRad: this.estPitchRateRad,
          rollRateRad: this.estRollRateRad,
          yawRateRad: this.estYawRateRad,
          handoffBlend: this.manualHandoffBlend,
          maxBankRad,
        },
      );
      if (Math.abs(cyberRollJitter) > 0.01) {
        flightControlInput.rollInput = Math.max(-1, Math.min(1, flightControlInput.rollInput + cyberRollJitter));
      }
    } else {
      flightControlInput = {
        pitchInput: input.pitchOverride,
        rollInput: effRollOverride,
        yawInput: input.yawOverride,
        throttleDelta: input.throttleDelta,
      };
    }

    this.lastInstructorCmd = {
      pitch: flightControlInput.pitchInput,
      roll: flightControlInput.rollInput,
      yaw: flightControlInput.yawInput,
    };

    let ordnanceMassKg = 0;
    for (let i = 0; i < 4; i++) {
      const w = WEAPONS[this.config.loadout.slots[i]];
      ordnanceMassKg +=
        w.category === 'cannon'
          ? (this.slotAmmo[i] > 0 ? w.massKg : 0) + this.slotAmmo[i] * 0.16
          : w.massKg * this.slotAmmo[i];
    }

    this.prevDroneYaw = this.drone.yaw;
    this.prevDronePitch = this.drone.pitch;
    this.prevDroneRoll = this.drone.roll;

    this.drone = stepDroneFlight(
      this.drone,
      flightControlInput,
      {
        theaterId,
        weatherId: this.config.weatherId,
        utcHours: this.config.utcHours,
        loadout: this.config.loadout,
        sandbox: normalizedSandbox,
        ordnanceMassKg,
        elapsedTimeSec: sortieTimeSec,
        flightModel: this.config.flightModel,
        skillBonuses: this.config.skillBonuses,
        kamikazeArmed: this.kamikazeArmed,
        disableFuelDepletion: Boolean(this.config.disableFuelDepletion),
      },
      dt,
    );

    const instYawRate = wrapAngleRad(this.drone.yaw - this.prevDroneYaw) / Math.max(1e-4, dt);
    const instPitchRate = (this.drone.pitch - this.prevDronePitch) / Math.max(1e-4, dt);
    const instRollRate = (this.drone.roll - this.prevDroneRoll) / Math.max(1e-4, dt);
    const rateAlpha = 1 - Math.exp(-22 * dt);
    this.estYawRateRad += (instYawRate - this.estYawRateRad) * rateAlpha;
    this.estPitchRateRad += (instPitchRate - this.estPitchRateRad) * rateAlpha;
    this.estRollRateRad += (instRollRate - this.estRollRateRad) * rateAlpha;

    // Wingtip G-vortex vapor trails during tight pulls
    this.wingVortexTimer -= dt;
    if (Math.abs(this.drone.gLoad) > 2.2 && this.drone.airspeedMs > 68 && this.wingVortexTimer <= 0) {
      this.wingVortexTimer = 0.06;
      const halfSpan = AIRFRAMES[this.config.loadout.airframeId].wingspanM * 0.42;
      const rightX = Math.cos(this.drone.yaw) * Math.cos(this.drone.roll);
      const rightY = Math.sin(this.drone.roll);
      const rightZ = -Math.sin(this.drone.yaw) * Math.cos(this.drone.roll);
      for (const side of [-1, 1]) {
        this.emit({
          type: 'particle_burst',
          x: this.drone.x + rightX * side * halfSpan,
          y: this.drone.y + rightY * side * halfSpan,
          z: this.drone.z + rightZ * side * halfSpan,
          count: 1,
          speed: 2.5,
          size: 0.55,
          r: 0.92,
          g: 0.96,
          b: 1.0,
          life: 0.42,
        });
      }
    }

    // Build full battlefield target list for AI squadron bots
    const aiCandidates: AiTargetCandidate[] = [];
    if (this.drone.hp > 0) {
      aiCandidates.push({
        id: 'player',
        team: 'alpha',
        x: this.drone.x,
        y: this.drone.y,
        z: this.drone.z,
        vx: this.drone.vx,
        vy: this.drone.vy,
        vz: this.drone.vz,
      });
    }
    for (const b of this.aiBots) {
      if (b.hp <= 0) continue;
      aiCandidates.push({
        id: b.id,
        team: b.team,
        x: b.x,
        y: b.y,
        z: b.z,
        vx: b.vx,
        vy: b.vy,
        vz: b.vz,
      });
    }
    for (const lm of this.landmarks) {
      if (lm.hp <= 0) continue;
      const ly = Math.max(theater.waterLevelM, groundHeightAt(theaterId, lm.x, lm.z)) + 12;
      aiCandidates.push({
        id: lm.id,
        team: 'bravo',
        x: lm.x,
        y: ly,
        z: lm.z,
        vx: 0,
        vy: 0,
        vz: 0,
        isGround: true,
      });
    }

    const aiRng = () => this.rng.next();
    for (let idx = 0; idx < this.aiBots.length; idx++) {
      const bot = this.aiBots[idx];
      if (bot.hp <= 0) {
        bot.respawnTimer += dt;
        continue;
      }

      const aiCyber = this.cyberStatus.get(bot.id);
      const compromisedKind = aiCyber && sortieTimeSec < aiCyber.until ? aiCyber.payloadId : null;
      const gnssSpoofed = compromisedKind === 'gnss_spoof';

      let incomingMissileDistM: number | null = null;
      for (const ord of this.activeOrdnance) {
        if (ord.targetId === bot.id) {
          const d = Math.hypot(ord.x - bot.x, ord.y - bot.y, ord.z - bot.z);
          if (incomingMissileDistM === null || d < incomingMissileDistM) {
            incomingMissileDistM = d;
          }
        }
      }

      const stepRes = stepAiCombatBot(bot, aiCandidates, {
        theaterId,
        sortieTimeSec,
        incomingMissileDistM,
        compromisedKind,
        gnssSpoofed,
        dt,
        rng: aiRng,
      });
      this.aiBots[idx] = stepRes.bot;
      const updatedBot = stepRes.bot;

      if (stepRes.wantsFlares) {
        this.botFlareDecoyUntil.set(updatedBot.id, sortieTimeSec + 3.2);
        const rX = Math.cos(updatedBot.yaw);
        const rZ = -Math.sin(updatedBot.yaw);
        for (const s of [-1, 1]) {
          this.emit({
            type: 'particle_burst',
            x: updatedBot.x + rX * s * 2,
            y: updatedBot.y - 1,
            z: updatedBot.z + rZ * s * 2,
            count: 3,
            speed: 22,
            size: 0.5,
            r: 1.0,
            g: 0.9,
            b: 0.45,
            life: 1.2,
          });
        }
        if (Math.hypot(this.drone.x - updatedBot.x, this.drone.z - updatedBot.z) < 1600) {
          this.emit({
            type: 'sound',
            kind: 'flare_pop',
            x: updatedBot.x,
            y: updatedBot.y,
            z: updatedBot.z,
            vx: updatedBot.vx,
            vy: updatedBot.vy,
            vz: updatedBot.vz,
          });
        }
      }

      if (stepRes.wantsCannon) {
        const adx = stepRes.aimPoint.x - updatedBot.x;
        const ady = stepRes.aimPoint.y - updatedBot.y;
        const adz = stepRes.aimPoint.z - updatedBot.z;
        const ad = Math.max(1, Math.hypot(adx, ady, adz));
        const spread = 0.018;
        this.spawnOrdnanceEntity({
          id: `bot-gun-${this.nextOrdnanceSeq++}`,
          ownerId: updatedBot.id,
          weaponId: 'm61_vulcan',
          x: updatedBot.x + (adx / ad) * 4,
          y: updatedBot.y,
          z: updatedBot.z + (adz / ad) * 4,
          vx: (adx / ad + (this.rng.next() - 0.5) * spread) * 510,
          vy: (ady / ad + (this.rng.next() - 0.5) * spread) * 510,
          vz: (adz / ad + (this.rng.next() - 0.5) * spread) * 510,
          targetId: null,
          targetX: stepRes.aimPoint.x,
          targetY: stepRes.aimPoint.y,
          targetZ: stepRes.aimPoint.z,
        });
        if (Math.hypot(this.drone.x - updatedBot.x, this.drone.z - updatedBot.z) < 1400) {
          this.emit({
            type: 'sound',
            kind: 'cannon',
            x: updatedBot.x,
            y: updatedBot.y,
            z: updatedBot.z,
            vx: updatedBot.vx,
            vy: updatedBot.vy,
            vz: updatedBot.vz,
          });
        }
      }

      if (stepRes.wantsMissile && stepRes.targetId) {
        const adx = stepRes.aimPoint.x - updatedBot.x;
        const ady = stepRes.aimPoint.y - updatedBot.y;
        const adz = stepRes.aimPoint.z - updatedBot.z;
        const ad = Math.max(1, Math.hypot(adx, ady, adz));
        this.spawnOrdnanceEntity({
          id: `bot-msl-${this.nextOrdnanceSeq++}`,
          ownerId: updatedBot.id,
          weaponId: updatedBot.role === 'striker' ? 'mam_l' : 'aim9x_sidewinder',
          x: updatedBot.x + (adx / ad) * 4,
          y: updatedBot.y - 1.5,
          z: updatedBot.z + (adz / ad) * 4,
          vx: updatedBot.vx + (adx / ad) * 145,
          vy: updatedBot.vy + (ady / ad) * 145,
          vz: updatedBot.vz + (adz / ad) * 145,
          targetId: stepRes.targetId,
          targetX: stepRes.aimPoint.x,
          targetY: stepRes.aimPoint.y,
          targetZ: stepRes.aimPoint.z,
        });
        if (Math.hypot(this.drone.x - updatedBot.x, this.drone.z - updatedBot.z) < 2200) {
          this.emit({
            type: 'sound',
            kind: 'missile_launch',
            x: updatedBot.x,
            y: updatedBot.y - 1.5,
            z: updatedBot.z,
            vx: updatedBot.vx,
            vy: updatedBot.vy,
            vz: updatedBot.vz,
          });
        }
      }
    }

    // Bot Squadron Reinforcement Waves & Frontline Battle Ticket Bleed
    this.botReinforceTimer -= dt;
    if (this.botReinforceTimer <= 0) {
      this.botReinforceTimer = 14;
      for (const team of ['alpha', 'bravo'] as const) {
        const tickets = team === 'alpha' ? this.blueTickets : this.redTickets;
        if (tickets <= 150) continue;
        const fallen = this.aiBots.find((b) => b.team === team && b.hp <= 0 && b.respawnTimer > 8);
        if (fallen) {
          const rx = (this.rng.next() - 0.5) * 1400;
          const rz = team === 'alpha' ? 1450 : -2050;
          const ry = Math.max(theater.waterLevelM, groundHeightAt(theaterId, rx, rz)) + 520;
          fallen.hp = fallen.maxHp;
          fallen.x = rx;
          fallen.y = ry;
          fallen.z = rz;
          fallen.yaw = team === 'alpha' ? 0 : Math.PI;
          fallen.pitch = 0;
          fallen.roll = 0;
          fallen.flaresRemaining = 6;
          fallen.respawnTimer = 0;
        }
      }
    }

    this.ticketBleedTimer -= dt;
    if (this.ticketBleedTimer <= 0) {
      this.ticketBleedTimer = 4.0;
      const destroyedLandmarks = this.landmarks.filter((l) => l.hp <= 0).length;
      if (destroyedLandmarks > 0) {
        this.redTickets = Math.max(0, this.redTickets - destroyedLandmarks * 4);
      }
      const aliveAlpha = this.aiBots.filter((b) => b.team === 'alpha' && b.hp > 0).length + 1;
      const aliveBravo = this.aiBots.filter((b) => b.team === 'bravo' && b.hp > 0).length;
      if (aliveBravo > aliveAlpha) {
        this.blueTickets = Math.max(0, this.blueTickets - 5);
      }
    }

    // SAM sites & Airbases defensive flak & interceptors
    this.aaaBurstCooldown -= dt;
    this.warSmokeCooldown -= dt;
    if (this.warSmokeCooldown <= 0) {
      this.warSmokeCooldown = 0.35;
      for (const lm of this.landmarks) {
        if (lm.hp > 0 && lm.hp < lm.maxHp * 0.72) {
          const ly = Math.max(theater.waterLevelM, groundHeightAt(theaterId, lm.x, lm.z)) + 14;
          this.emit({ type: 'particle_burst', x: lm.x, y: ly, z: lm.z, count: 1, speed: 14, size: 5.2, r: 0.24, g: 0.24, b: 0.26, life: 2.2 });
        }
      }
    }

    for (const lm of this.landmarks) {
      if (lm.hp <= 0 || (!lm.threatRadiusM && lm.type !== 'airbase')) continue;
      const lmCyber = this.cyberStatus.get(lm.id);
      if (lmCyber && sortieTimeSec < lmCyber.until) continue;
      const d = Math.hypot(this.drone.x - lm.x, this.drone.z - lm.z);
      const threatR = lm.threatRadiusM ?? 1150;

      if (d < threatR * 1.2 && this.aaaBurstCooldown <= 0) {
        this.aaaBurstCooldown = 1.45 + this.rng.next() * 1.1;
        const aaaY = Math.max(theater.waterLevelM, groundHeightAt(theaterId, lm.x, lm.z)) + 10;
        const leadX = this.drone.x + this.drone.vx * 0.65 + (this.rng.next() - 0.5) * 90;
        const leadY = this.drone.y + this.drone.vy * 0.65 + (this.rng.next() - 0.5) * 45;
        const leadZ = this.drone.z + this.drone.vz * 0.65 + (this.rng.next() - 0.5) * 90;
        const dL = Math.max(1, Math.hypot(leadX - lm.x, leadY - aaaY, leadZ - lm.z));
        this.spawnOrdnanceEntity({
          id: `aaa-${this.nextOrdnanceSeq++}`,
          ownerId: lm.id,
          weaponId: 'm61_vulcan',
          x: lm.x,
          y: aaaY,
          z: lm.z,
          vx: ((leadX - lm.x) / dL) * 460,
          vy: ((leadY - aaaY) / dL) * 460,
          vz: ((leadZ - lm.z) / dL) * 460,
          targetId: null,
          targetX: leadX,
          targetY: leadY,
          targetZ: leadZ,
        });
        this.emit({ type: 'particle_burst', x: lm.x, y: aaaY + 2.5, z: lm.z, count: 4, speed: 18, size: 1.8, r: 1.0, g: 0.78, b: 0.34, life: 0.32 });
        this.emit({ type: 'particle_burst', x: leadX, y: leadY, z: leadZ, count: 5, speed: 22, size: 3.6, r: 0.28, g: 0.25, b: 0.22, life: 0.85 });
        this.emit({ type: 'sound', kind: 'aaa_burst', x: leadX, y: leadY, z: leadZ, vx: 0, vy: 0, vz: 0 });
      }

      if (lm.type === 'sam' && d < threatR && this.rng.next() < dt * 0.14) {
        const samY = Math.max(theater.waterLevelM, groundHeightAt(theaterId, lm.x, lm.z)) + 15;
        const baseJammer = this.config.loadout.sensorId === 'ew_jammer' ? 0.55 : 1.0;
        const jammerFactor = Math.max(0.15, baseJammer - this.config.skillBonuses.ecmSuppressionBonus);
        if (this.rng.next() < jammerFactor) {
          this.spawnOrdnanceEntity({
            id: `sam-${this.nextOrdnanceSeq++}`,
            ownerId: lm.id,
            weaponId: 'aim9x_sidewinder',
            x: lm.x,
            y: samY,
            z: lm.z,
            vx: (this.drone.x - lm.x) * 0.12,
            vy: 95,
            vz: (this.drone.z - lm.z) * 0.12,
            targetId: 'player',
            targetX: this.drone.x,
            targetY: this.drone.y,
            targetZ: this.drone.z,
          });
        }
      }
    }

    // Step active ordnance & evaluate collisions
    for (let i = this.activeOrdnance.length - 1; i >= 0; i--) {
      const ord = this.activeOrdnance[i];
      const spec = WEAPONS[ord.weaponId];

      let liveTargetPos: { x: number; y: number; z: number } | null = null;
      if (ord.targetId === 'player') {
        const spoofed = sortieTimeSec < this.playerGnssSpoofUntil;
        const flareDecoyed = sortieTimeSec < this.playerFlaresActiveUntil;
        liveTargetPos =
          spoofed || flareDecoyed
            ? {
                x: this.drone.x + Math.sin(sortieTimeSec * 4.5) * 260,
                y: this.drone.y - (flareDecoyed ? 85 : -55),
                z: this.drone.z + Math.cos(sortieTimeSec * 4.5) * 260,
              }
            : { x: this.drone.x, y: this.drone.y, z: this.drone.z };
      } else if (ord.targetId) {
        const ai = this.aiBots.find((a) => a.id === ord.targetId && a.hp > 0);
        if (ai) {
          const decoyed = spec.category === 'aam' && sortieTimeSec < (this.botFlareDecoyUntil.get(ai.id) ?? 0);
          liveTargetPos = decoyed
            ? {
                x: ai.x + Math.cos(sortieTimeSec * 4) * 180,
                y: ai.y - 65,
                z: ai.z + Math.sin(sortieTimeSec * 4) * 180,
              }
            : { x: ai.x, y: ai.y, z: ai.z };
        }
      }

      const updated = stepOrdnance(
        ord,
        {
          theaterId,
          weatherId: this.config.weatherId,
          sandbox: normalizedSandbox,
          targetPos: liveTargetPos,
          skillBonuses: this.config.skillBonuses,
        },
        dt,
      );
      this.activeOrdnance[i] = updated;

      if (spec.category !== 'cannon' && this.rng.next() < 0.65) {
        this.emit({
          type: 'particle_burst',
          x: updated.x,
          y: updated.y,
          z: updated.z,
          count: 1,
          speed: 4,
          size: spec.category === 'ballistic_missile' ? 3.2 : 1.6,
          r: 0.85,
          g: 0.88,
          b: 0.92,
          life: 0.6,
        });
      }

      let exploded = false;
      const groundY = Math.max(theater.waterLevelM, groundHeightAt(theaterId, updated.x, updated.z));
      const ownerIsAlpha = updated.ownerId === 'player' || updated.ownerId.startsWith('ally-');
      const effBlastRadius =
        spec.blastRadiusM * (updated.ownerId === 'player' ? this.config.skillBonuses.blastRadiusMult : 1);
      const effDamage =
        spec.damage * (updated.ownerId === 'player' ? this.config.skillBonuses.damageMult : 1);

      if (!ownerIsAlpha) {
        const dPlayer = Math.hypot(updated.x - this.drone.x, updated.y - this.drone.y, updated.z - this.drone.z);
        const hitRadius = spec.category === 'cannon' ? 14 : 24;
        if (dPlayer < hitRadius) {
          const dmg = spec.category === 'cannon' ? 6 : 22;
          this.drone.hp = Math.max(0, this.drone.hp - dmg);
          this.trauma = Math.min(1, this.trauma + (spec.category === 'cannon' ? 0.25 : 0.6));
          if (spec.category !== 'cannon') this.hitstopTimer = 0.04;
          this.emit({
            type: 'sound',
            kind: 'explosion',
            intensity: spec.category === 'cannon' ? 0.55 : 1.1,
            x: updated.x,
            y: updated.y,
            z: updated.z,
            vx: this.drone.vx,
            vy: this.drone.vy,
            vz: this.drone.vz,
          });
          this.emit({
            type: 'particle_burst',
            x: updated.x,
            y: updated.y,
            z: updated.z,
            count: spec.category === 'cannon' ? 8 : 18,
            speed: 45,
            size: 3.2,
            r: 1,
            g: 0.45,
            b: 0.12,
            life: 0.7,
          });
          if (spec.category !== 'cannon') {
            this.emitAar(
              'damage',
              'Interceptor Impact',
              `Hostile missile hit hull (${Math.round(this.drone.hp)}/${this.drone.maxHp} HP)`,
            );
          }
          exploded = true;
        } else {
          for (const ally of this.aiBots) {
            if (ally.team !== 'alpha' || ally.hp <= 0) continue;
            const dAlly = Math.hypot(updated.x - ally.x, updated.y - ally.y, updated.z - ally.z);
            if (dAlly < 18) {
              ally.hp = Math.max(0, ally.hp - (spec.category === 'cannon' ? 9 : 45));
              ally.hitFlash = 0.2;
              this.emit({ type: 'particle_burst', x: updated.x, y: updated.y, z: updated.z, count: 10, speed: 35, size: 3.0, r: 1, g: 0.5, b: 0.15, life: 0.7 });
              if (ally.hp === 0) {
                this.blueTickets = Math.max(0, this.blueTickets - 65);
                this.emit({ type: 'shockwave', x: ally.x, y: ally.y, z: ally.z, scale: 1.1 });
              }
              exploded = true;
              break;
            }
          }
        }
      } else {
        for (const ai of this.aiBots) {
          if (ai.team !== 'bravo' || ai.hp <= 0) continue;
          const dAi = Math.hypot(updated.x - ai.x, updated.y - ai.y, updated.z - ai.z);
          const airProx = spec.category === 'cannon' ? 17 : Math.max(24, effBlastRadius * 0.65);
          if (dAi < airProx) {
            const dmg = spec.category === 'cannon' ? 18 : effDamage;
            ai.hp = Math.max(0, ai.hp - dmg);
            ai.hitFlash = 0.25;
            if (ai.hp === 0) {
              this.emit({ type: 'shockwave', x: updated.x, y: updated.y, z: updated.z, scale: 1.2 });
              this.emit({ type: 'particle_burst', x: updated.x, y: updated.y, z: updated.z, count: 24, speed: 65, size: 5.0, r: 1, g: 0.52, b: 0.1, life: 1.1 });
              this.emit({
                type: 'sound',
                kind: 'explosion',
                intensity: 1.25,
                x: updated.x,
                y: updated.y,
                z: updated.z,
                vx: ai.vx,
                vy: ai.vy,
                vz: ai.vz,
              });
              this.redTickets = Math.max(0, this.redTickets - 65);
              if (updated.ownerId === 'player') {
                this.score += 250;
                this.trauma = Math.min(1, this.trauma + 0.45);
                this.hitstopTimer = 0.045;
                this.emit({ type: 'sound', kind: 'hit_marker', isKill: true });
                this.combatHitCallout = 'AIRCRAFT DESTROYED +250';
                this.combatHitUntil = sortieTimeSec + 2.1;
                this.emit({
                  type: 'air_kill',
                  info: { victimName: ai.callsign, points: 250, weaponId: updated.weaponId },
                });
                this.emitAar(
                  'air_kill',
                  `Air Kill: ${ai.callsign}`,
                  `${spec.natoCode} shot down hostile UAV (+250 pts)`,
                );
              }
            } else {
              this.emit({ type: 'particle_burst', x: updated.x, y: updated.y, z: updated.z, count: 8, speed: 32, size: 2.2, r: 1, g: 0.65, b: 0.18, life: 0.45 });
              if (updated.ownerId === 'player') {
                this.score += 15;
                this.emit({ type: 'sound', kind: 'hit_marker', isKill: false });
                this.combatHitCallout = spec.category === 'cannon' ? 'HIT! +15' : 'CRITICAL HIT!';
                this.combatHitUntil = sortieTimeSec + 1.1;
              }
            }
            exploded = true;
            break;
          }
        }
      }

      if (!exploded && updated.y <= groundY + 4) {
        exploded = true;
        const isHeavy =
          spec.category === 'ballistic_missile' ||
          spec.category === 'cruise_missile' ||
          spec.category === 'glide_bomb' ||
          spec.category === 'drop_bomb';
        if (isHeavy) {
          this.emit({
            type: 'shockwave',
            x: updated.x,
            y: groundY + 2,
            z: updated.z,
            scale: spec.category === 'ballistic_missile' ? 2.1 : 1.25,
          });
        }
        this.emit({
          type: 'particle_burst',
          x: updated.x,
          y: groundY + 4,
          z: updated.z,
          count: isHeavy ? 30 : 10,
          speed: isHeavy ? 78 : 28,
          size: isHeavy ? 6.8 : 2.5,
          r: 1,
          g: 0.48,
          b: 0.12,
          life: isHeavy ? 1.25 : 0.55,
        });
        this.emit({
          type: 'sound',
          kind: 'explosion',
          intensity: isHeavy ? 1.55 : 0.65,
          x: updated.x,
          y: groundY + 4,
          z: updated.z,
          vx: 0,
          vy: 0,
          vz: 0,
        });
        if (isHeavy && updated.ownerId === 'player') {
          this.trauma = Math.min(1, this.trauma + 0.44);
          this.hitstopTimer = 0.04;
        }

        if (ownerIsAlpha) {
          for (const lm of this.landmarks) {
            if (lm.hp <= 0) continue;
            const dHoriz = Math.hypot(updated.x - lm.x, updated.z - lm.z);
            if (dHoriz <= effBlastRadius) {
              const falloff = 1 - (dHoriz / effBlastRadius) * 0.4;
              const mult = updated.ownerId === 'player' ? 1 : 0.35;
              lm.hp = Math.max(0, lm.hp - effDamage * falloff * mult);
              if (lm.hp === 0) {
                this.emit({ type: 'landmark_visibility', landmarkId: lm.id, visible: false });
                this.redTickets = Math.max(0, this.redTickets - 120);
                const cep = Math.round(dHoriz * 10) / 10;
                if (updated.ownerId === 'player') {
                  this.bestCep = this.bestCep === null ? cep : Math.min(this.bestCep, cep);
                  this.score += lm.points;
                  this.emit({ type: 'sound', kind: 'hit_marker', isKill: true });
                  this.combatHitCallout = `TARGET DESTROYED +${lm.points}`;
                  this.combatHitUntil = sortieTimeSec + 2.1;
                  this.emit({
                    type: 'target_destroyed',
                    info: {
                      targetId: lm.id,
                      name: lm.name,
                      points: lm.points,
                      cepMeters: cep,
                      weaponId: updated.weaponId,
                    },
                  });
                  this.emitAar(
                    'strike',
                    `Destroyed ${lm.name}`,
                    `${spec.natoCode} direct hit · CEP ${cep}m (+${lm.points} pts)`,
                  );
                }
              } else if (updated.ownerId === 'player') {
                this.emit({ type: 'sound', kind: 'hit_marker', isKill: false });
                this.combatHitCallout = 'GROUND HIT! +20';
                this.combatHitUntil = sortieTimeSec + 1.0;
                this.score += 20;
              }
            }
          }
        }
      }

      if (exploded || updated.ageSec >= updated.maxLifetimeSec) {
        this.emit({ type: 'ordnance_removed', id: updated.id });
        this.activeOrdnance.splice(i, 1);
      }
    }

    // Kamikaze / Terminal Ram Check
    const afSpec = AIRFRAMES[this.config.loadout.airframeId];
    if (afSpec.kamikazeCapable && !this.gameOverTriggered) {
      let kamikazeTriggered = false;

      for (const ai of this.aiBots) {
        if (ai.team !== 'bravo' || ai.hp <= 0) continue;
        const dAi = Math.hypot(this.drone.x - ai.x, this.drone.y - ai.y, this.drone.z - ai.z);
        if (dAi < (this.kamikazeArmed ? 34 : 18)) {
          this.detonateDroneAsKamikaze(ai.x, ai.y, ai.z, `${afSpec.name} Mid-Air Kamikaze`);
          kamikazeTriggered = true;
          break;
        }
      }

      if (!kamikazeTriggered) {
        for (const lm of this.landmarks) {
          if (lm.hp <= 0) continue;
          const ly = Math.max(theater.waterLevelM, groundHeightAt(theaterId, lm.x, lm.z));
          const dHoriz = Math.hypot(this.drone.x - lm.x, this.drone.z - lm.z);
          const diveHitRadius = this.kamikazeArmed ? 52 : 28;
          if (dHoriz < diveHitRadius && this.drone.y <= ly + (this.kamikazeArmed ? 46 : 24)) {
            this.detonateDroneAsKamikaze(lm.x, ly + 4, lm.z, `${afSpec.name} Kamikaze Impact`);
            kamikazeTriggered = true;
            break;
          }
        }
      }

      if (!kamikazeTriggered && this.kamikazeArmed && this.drone.aglMeters <= 2.2) {
        const gY = Math.max(theater.waterLevelM, groundHeightAt(theaterId, this.drone.x, this.drone.z));
        this.detonateDroneAsKamikaze(this.drone.x, gY + 2, this.drone.z, `${afSpec.name} Surface Impact`);
      }
    }

    // Handle hull loss with squadron reserves before defeat
    if (!this.gameOverTriggered && this.drone.hp <= 0 && this.reserveDrones > 1) {
      this.emit({ type: 'shockwave', x: this.drone.x, y: this.drone.y, z: this.drone.z, scale: 1.4 });
      this.emit({ type: 'particle_burst', x: this.drone.x, y: this.drone.y, z: this.drone.z, count: 28, speed: 65, size: 5.5, r: 1, g: 0.45, b: 0.1, life: 1.1 });
      this.emit({
        type: 'sound',
        kind: 'explosion',
        intensity: 1.4,
        x: this.drone.x,
        y: this.drone.y,
        z: this.drone.z,
        vx: 0,
        vy: 0,
        vz: 0,
      });
      this.reserveDrones -= 1;
      this.blueTickets = Math.max(0, this.blueTickets - 120);
      this.kamikazeArmed = false;
      this.drone = createInitialDroneState(
        theater.id,
        this.config.loadout.airframeId,
        this.config.skillBonuses,
      );
      this.syncAimStateToDrone();
      this.emitAar('damage', 'Airframe Shot Down', `Redeploying reserve drone (${this.reserveDrones}/3 remaining)`);
    }

    // Victory / Defeat Check
    const aliveLandmarks = this.landmarks.filter((l) => l.hp > 0).length;
    if (
      !this.gameOverTriggered &&
      (this.drone.hp <= 0 || aliveLandmarks === 0 || this.redTickets <= 0 || this.blueTickets <= 0)
    ) {
      this.gameOverTriggered = true;
      const victory = aliveLandmarks === 0 || this.redTickets <= 0;
      this.emitAar(
        'end',
        victory ? 'Objectives Neutralized' : 'Squadron Depleted',
        `Score ${this.score} · ${this.landmarks.length - aliveLandmarks}/${this.landmarks.length} targets · Tickets ${this.blueTickets}/${this.redTickets}`,
      );
      this.emit({
        type: 'game_over',
        victory,
        summary: {
          score: this.score,
          targetsDestroyed: this.landmarks.length - aliveLandmarks,
          totalTargets: this.landmarks.length,
          bestCep: this.bestCep,
        },
      });
    }
  }

  /**
   * Advances simulation using frame-rate-independent fixed-timestep accumulation.
   */
  public stepFrame(
    rawFrameDtSec: number,
    isPlaying: boolean,
    input: SimStepInput,
    remotePilots: RemotePilotState[] = [],
  ): { events: SimEvent[]; substepsExecuted: number; unscaledFrameDt: number } {
    const safeRawDt = Number.isFinite(rawFrameDtSec) ? Math.max(0, Math.min(0.25, rawFrameDtSec)) : 0;

    if (this.hitstopTimer > 0) {
      this.hitstopTimer = Math.max(0, this.hitstopTimer - safeRawDt);
    }

    const simPaused = !isPlaying || this.hitstopTimer > 0;
    const canAcceptAimDeltas =
      !simPaused &&
      this.config.controlScheme === 'mouse_aim' &&
      !input.freeLooking &&
      !input.cameraOrbitMode &&
      !input.cameraEoirMode;

    if (!isPlaying) {
      this.clearPendingAimDeltas();
    } else if (canAcceptAimDeltas) {
      if (Number.isFinite(input.aimDeltaYawRad)) {
        this.pendingAimDeltaYawRad += input.aimDeltaYawRad;
      }
      if (Number.isFinite(input.aimDeltaPitchRad)) {
        this.pendingAimDeltaPitchRad += input.aimDeltaPitchRad;
      }
    }

    if (!simPaused) {
      const clampedScale = Number.isFinite(this.config.sandbox.timeScale)
        ? Math.max(0.05, Math.min(4.0, this.config.sandbox.timeScale))
        : 1.0;
      const projectedAccum = Math.min(
        MAX_SUBSTEPS_PER_FRAME * FIXED_TIMESTEP_SEC,
        this.clock.accumulatorSec + safeRawDt * clampedScale,
      );
      const plannedSubsteps = Math.min(
        MAX_SUBSTEPS_PER_FRAME,
        Math.floor((projectedAccum + 1e-11) / FIXED_TIMESTEP_SEC),
      );
      if (plannedSubsteps > 0) {
        this.substepAimDeltaYawRad = this.pendingAimDeltaYawRad / plannedSubsteps;
        this.substepAimDeltaPitchRad = this.pendingAimDeltaPitchRad / plannedSubsteps;
        this.pendingAimDeltaYawRad = 0;
        this.pendingAimDeltaPitchRad = 0;
      } else {
        this.substepAimDeltaYawRad = 0;
        this.substepAimDeltaPitchRad = 0;
      }
    } else {
      this.substepAimDeltaYawRad = 0;
      this.substepAimDeltaPitchRad = 0;
    }

    advanceFixedClock(
      this.clock,
      safeRawDt,
      this.config.sandbox.timeScale,
      simPaused,
      (fixedDt) => {
        this.stepFixed(fixedDt, input, remotePilots);
      },
    );

    return {
      events: this.drainEvents(),
      substepsExecuted: this.clock.lastSubsteps,
      unscaledFrameDt: safeRawDt,
    };
  }

  public predictActiveWeapon(remotePilots: RemotePilotState[]): {
    target: LockedTargetInfo;
    prediction: PredictedImpact;
    weaponId: WeaponId;
  } {
    const target = this.getLockedTargetPos(remotePilots);
    const weaponId = this.config.loadout.slots[this.activeSlot];
    const prediction = predictOrdnanceTrajectory(
      this.drone,
      weaponId,
      { x: target.x, y: target.y, z: target.z },
      {
        theaterId: this.config.theaterId,
        weatherId: this.config.weatherId,
        sandbox: this.config.sandbox,
        skillBonuses: this.config.skillBonuses,
      },
    );
    return { target, prediction, weaponId };
  }

  public getPropulsionLabel(): PropulsionSpec['type'] {
    return PROPULSION_MODULES[this.config.loadout.propulsionId].type;
  }

  public getEnvironmentSnapshot() {
    const theater = THEATERS[this.config.theaterId];
    const weather = WEATHERS[this.config.weatherId];
    const solar = computeSolarState(theater.latDeg, theater.lonDeg, this.config.utcHours, 172, weather.cloudCover);
    const atmos = computeAtmosphericGravity(
      theater.latDeg,
      this.drone.y + theater.baseElevationM,
      this.drone.vx,
      this.drone.vz,
      this.config.sandbox.enabled ? this.config.sandbox.gravityMultiplier : 1.0,
      this.config.sandbox.enabled ? this.config.sandbox.airDensityMultiplier : 1.0,
    );
    return { theater, weather, solar, atmos };
  }

  public isRadarLocked(): boolean {
    const sortieTimeSec = this.clock.simTimeSec;
    return this.landmarks.some(
      (l) =>
        l.hp > 0 &&
        l.type === 'sam' &&
        l.threatRadiusM &&
        !(this.cyberStatus.get(l.id) && sortieTimeSec < (this.cyberStatus.get(l.id)?.until ?? 0)) &&
        Math.hypot(this.drone.x - l.x, this.drone.z - l.z) < l.threatRadiusM,
    );
  }
}

export { FIXED_TIMESTEP_SEC };
