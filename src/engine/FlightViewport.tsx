import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Sky } from 'three/addons/objects/Sky.js';
import {
  AIRFRAMES,
  PROPULSION_MODULES,
  SENSOR_MODULES,
  WEAPONS,
  WEATHERS,
} from '../sim/arsenalData';
import { AarEventType } from '../sim/aarLogger';
import {
  AiCombatBot,
  AiTargetCandidate,
  createAiBotSquadron,
  stepAiCombatBot,
} from '../sim/aiDogfight';
import { CYBER_PAYLOADS } from '../sim/cyberWarfare';
import {
  computeInstructorControlInput,
  computeKamikazeImpactPayload,
  computeLeadPoint,
  predictOrdnanceTrajectory,
  stepDroneFlight,
  stepOrdnance,
  stepWarThunderAimAngles,
} from '../sim/flightPhysics';
import { groundHeightAt, THEATERS } from '../sim/geoTheaters';
import { GameSettings } from '../sim/settings';
import { computeAtmosphericGravity, computeSolarState } from '../sim/solarGravity';
import {
  ActiveOrdnanceState,
  AirContactHud,
  AirframeId,
  CameraMode,
  CyberPayloadId,
  DroneFlightState,
  GamePhase,
  HudSnapshot,
  LoadoutConfig,
  PilotSkillBonuses,
  RemotePilotState,
  SandboxConfig,
  TheaterId,
  TheaterLandmark,
  WeaponId,
  WeatherId,
} from '../sim/types';
import { CyberTargetOption } from '../components/CyberWarfareModal';
import { TacticalAudioSynth } from './audioSynth';
import { buildDroneMesh, buildOrdnanceMesh, buildTargetStructure, DroneMeshHandle } from './droneModels';
import { buildTheaterTerrain } from './terrainEngine';

export interface SimCommandBridge {
  resetSortie: (theaterId?: TheaterId) => void;
  setActiveSlot: (slot: number) => void;
  fireActiveOrdnance: () => void;
  cycleTarget: () => void;
  deployFlares: () => boolean;
  armKamikazeDive: () => boolean;
  setWaypointTarget: (x: number, z: number) => void;
  getCyberTargets: () => CyberTargetOption[];
  triggerCyberAttack: (
    targetId: string,
    payloadId: CyberPayloadId,
  ) => { ok: boolean; targetName: string; targetKind: 'base' | 'drone'; destroyed: boolean; damageDealt: number; isRemotePilot: boolean; message: string };
  purgeCyberIntrusion: () => boolean;
  receiveRemoteCyberAttack: (payloadId: CyberPayloadId, attackerCallsign: string) => void;
  spawnRemoteOrdnance: (payload: {
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
  }) => void;
  applyTargetHpSync: (targetHp: Record<string, number>) => void;
}

interface FlightViewportProps {
  phase: GamePhase;
  theaterId: TheaterId;
  weatherId: WeatherId;
  utcHours: number;
  loadout: LoadoutConfig;
  sandbox: SandboxConfig;
  settings: GameSettings;
  skillBonuses: PilotSkillBonuses;
  cameraMode: CameraMode;
  muted: boolean;
  remotePilots: RemotePilotState[];
  bridgeRef: React.MutableRefObject<SimCommandBridge | null>;
  onHudUpdate: (snapshot: HudSnapshot) => void;
  onTargetDestroyed: (info: { targetId: string; name: string; points: number; cepMeters: number; weaponId: WeaponId }) => void;
  onAirKill: (info: { victimName: string; points: number; weaponId: WeaponId }) => void;
  onCyberSuccess: (info: {
    targetId: string;
    targetName: string;
    targetKind: 'base' | 'drone';
    payloadId: CyberPayloadId;
    damageDealt: number;
    destroyed: boolean;
    isRemotePilot: boolean;
  }) => void;
  onAarEvent: (ev: {
    type: AarEventType;
    title: string;
    detail: string;
    tSec: number;
    x: number;
    z: number;
    altMsl: number;
    fuelKg: number;
  }) => void;
  onPlayerStateBroadcast: (drone: DroneFlightState, sortieTimeSec: number) => void;
  onOrdnanceFired: (ord: {
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
  }) => void;
  onGameOver: (victory: boolean, summary: { score: number; targetsDestroyed: number; totalTargets: number; bestCep: number | null }) => void;
}

// Pre-allocated scratch math objects (zero GC in render loop)
const _vec3A = new THREE.Vector3();
const _vec3B = new THREE.Vector3();
const _vec3C = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _mat4 = new THREE.Matrix4();
const _scaleVec = new THREE.Vector3();
const _color = new THREE.Color();

interface PooledParticle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  size: number;
  r: number;
  g: number;
  b: number;
}

export const FlightViewport: React.FC<FlightViewportProps> = (props) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const [webglUnavailable, setWebglUnavailable] = React.useState(false);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // Software WebGL probe
    const isSoftwareGl = (() => {
      try {
        const probe = document.createElement('canvas');
        const gl = probe.getContext('webgl2') || probe.getContext('webgl');
        if (!gl) return true;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
        const gpu = String(gl.getParameter(param) ?? '');
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
      });
    } catch {
      setWebglUnavailable(true);
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const handleContextLost = (e: Event) => {
      e.preventDefault();
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      62,
      (container.clientWidth || window.innerWidth) / (container.clientHeight || window.innerHeight),
      0.5,
      14000,
    );

    // Studio & Outdoor PBR reflections
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // Atmospheric Sky Dome
    const sky = new Sky();
    sky.scale.setScalar(25000);
    scene.add(sky);
    const skyUniforms = sky.material.uniforms;
    skyUniforms['turbidity'].value = 4.2;
    skyUniforms['rayleigh'].value = 1.8;
    skyUniforms['mieCoefficient'].value = 0.005;
    skyUniforms['mieDirectionalG'].value = 0.82;

    // Warm/cool 3-point outdoor lighting
    const hemiLight = new THREE.HemisphereLight(0x9bc4e8, 0x3f3328, 0.72);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xfff5e0, 1.9);
    sunLight.castShadow = !isSoftwareGl;
    sunLight.shadow.mapSize.width = 1024;
    sunLight.shadow.mapSize.height = 1024;
    sunLight.shadow.camera.near = 50;
    sunLight.shadow.camera.far = 3500;
    const dShadow = 900;
    sunLight.shadow.camera.left = -dShadow;
    sunLight.shadow.camera.right = dShadow;
    sunLight.shadow.camera.top = dShadow;
    sunLight.shadow.camera.bottom = -dShadow;
    sunLight.shadow.bias = -0.0005;
    sunLight.shadow.normalBias = 0.02;
    scene.add(sunLight);
    scene.add(sunLight.target);

    scene.fog = new THREE.FogExp2(0x9ec4e2, 0.00018);

    // Dynamic Theater Group (Terrain + Landmarks)
    const theaterGroup = new THREE.Group();
    scene.add(theaterGroup);

    // Player Drone Mesh (includes live equipped pylon weapons)
    let currentAirframeId: AirframeId = propsRef.current.loadout.airframeId;
    let playerMeshHandle: DroneMeshHandle = buildDroneMesh(
      currentAirframeId,
      0xf59e0b,
      propsRef.current.loadout.slots,
    );
    scene.add(playerMeshHandle.group);

    // 3D Predicted Trajectory Arc & Impact Ring
    const maxArcPts = 64;
    const arcPositions = new Float32Array(maxArcPts * 3);
    const arcGeo = new THREE.BufferGeometry();
    arcGeo.setAttribute('position', new THREE.BufferAttribute(arcPositions, 3));
    const arcMat = new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.75 });
    const arcLine = new THREE.Line(arcGeo, arcMat);
    arcLine.frustumCulled = false;
    scene.add(arcLine);

    const impactRing = new THREE.Mesh(
      new THREE.RingGeometry(18, 26, 28),
      new THREE.MeshBasicMaterial({ color: 0xf59e0b, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }),
    );
    impactRing.rotation.x = -Math.PI / 2;
    scene.add(impactRing);

    // Target Lock Reticle Ring on 3D terrain/air target
    const targetMarker = new THREE.Mesh(
      new THREE.RingGeometry(28, 36, 4),
      new THREE.MeshBasicMaterial({ color: 0xef4444, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
    );
    targetMarker.rotation.x = -Math.PI / 2;
    scene.add(targetMarker);

    // Pooled 3D EW Cyber Disruption Wireframe Spheres (zero GC)
    const EW_POOL_SIZE = 6;
    const ewSpheres = Array.from({ length: EW_POOL_SIZE }, () => {
      const m = new THREE.Mesh(
        new THREE.IcosahedronGeometry(38, 1),
        new THREE.MeshBasicMaterial({ color: 0x06b6d4, wireframe: true, transparent: true, opacity: 0.52 }),
      );
      m.visible = false;
      scene.add(m);
      return m;
    });

    // Pooled 3D Explosion Shockwave Rings, Flash Spheres & Dynamic Explosion Lights
    const SHOCKWAVE_POOL_SIZE = 8;
    const shockwaves = Array.from({ length: SHOCKWAVE_POOL_SIZE }, () => {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(1.4, 2.2, 24),
        new THREE.MeshBasicMaterial({ color: 0xfdba74, side: THREE.DoubleSide, transparent: true, opacity: 0 }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      scene.add(ring);

      const core = new THREE.Mesh(
        new THREE.SphereGeometry(1.8, 12, 10),
        new THREE.MeshBasicMaterial({ color: 0xfff7ed, transparent: true, opacity: 0 }),
      );
      core.visible = false;
      scene.add(core);
      return { ring, core, active: false, age: 0, life: 0.65, maxScale: 35 };
    });
    let shockwaveCursor = 0;

    const flashLights = [0, 1].map(() => {
      const l = new THREE.PointLight(0xff7b24, 0, 420, 2);
      scene.add(l);
      return l;
    });
    let flashLightCursor = 0;

    function spawnShockwave(x: number, y: number, z: number, scale = 1.0) {
      const sw = shockwaves[shockwaveCursor];
      shockwaveCursor = (shockwaveCursor + 1) % SHOCKWAVE_POOL_SIZE;
      sw.active = true;
      sw.age = 0;
      sw.life = 0.48 + Math.min(0.45, scale * 0.18);
      sw.maxScale = 22 * scale;
      sw.ring.position.set(x, y + 1.5, z);
      sw.ring.scale.setScalar(1);
      sw.ring.visible = true;
      sw.core.position.set(x, y + 2, z);
      sw.core.scale.setScalar(1);
      sw.core.visible = true;

      const fl = flashLights[flashLightCursor];
      flashLightCursor = (flashLightCursor + 1) % flashLights.length;
      fl.position.set(x, y + 12, z);
      fl.intensity = 18000 * scale;
    }

    // Pooled Particle Ring Buffer (Zero-GC)
    const PARTICLE_COUNT = 260;
    const particleGeo = new THREE.SphereGeometry(0.85, 6, 5);
    const particleMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const particleMesh = new THREE.InstancedMesh(particleGeo, particleMat, PARTICLE_COUNT);
    particleMesh.frustumCulled = false;
    scene.add(particleMesh);

    const particles: PooledParticle[] = Array.from({ length: PARTICLE_COUNT }, () => ({
      active: false,
      x: 0,
      y: -9999,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      age: 0,
      life: 1,
      size: 1,
      r: 1,
      g: 0.5,
      b: 0.1,
    }));
    let particleCursor = 0;

    function spawnParticleBurst(
      x: number,
      y: number,
      z: number,
      count: number,
      speed: number,
      size: number,
      r: number,
      g: number,
      b: number,
      life = 0.8,
    ) {
      for (let i = 0; i < count; i++) {
        const p = particles[particleCursor];
        particleCursor = (particleCursor + 1) % PARTICLE_COUNT;
        p.active = true;
        p.x = x;
        p.y = y;
        p.z = z;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.random() * Math.PI - Math.PI / 2;
        const v = speed * (0.35 + Math.random() * 0.85);
        p.vx = Math.cos(theta) * Math.cos(phi) * v;
        p.vy = Math.abs(Math.sin(phi)) * v + speed * 0.25;
        p.vz = Math.sin(theta) * Math.cos(phi) * v;
        p.age = 0;
        p.life = life * (0.7 + Math.random() * 0.6);
        p.size = size * (0.7 + Math.random() * 0.6);
        p.r = r;
        p.g = g;
        p.b = b;
      }
    }

    // Instanced Weather Precipitation (Rain / Dust Streaks)
    const PRECIP_COUNT = 260;
    const precipGeo = new THREE.BoxGeometry(0.14, 4.5, 0.14);
    const precipMat = new THREE.MeshBasicMaterial({ color: 0xcbd5e1, transparent: true, opacity: 0.45 });
    const precipMesh = new THREE.InstancedMesh(precipGeo, precipMat, PRECIP_COUNT);
    precipMesh.frustumCulled = false;
    scene.add(precipMesh);
    const precipOffsets = Array.from({ length: PRECIP_COUNT }, () => ({
      x: (Math.random() - 0.5) * 260,
      y: Math.random() * 140 - 30,
      z: (Math.random() - 0.5) * 260,
    }));

    // Audio Synthesizer
    const audio = new TacticalAudioSynth();

    // Simulation State
    let activeTheaterId: TheaterId = propsRef.current.theaterId;
    let landmarks: TheaterLandmark[] = [];
    const landmarkMeshes = new Map<string, THREE.Group>();
    let aiBots: AiCombatBot[] = [];
    const aiMeshes = new Map<string, DroneMeshHandle>();
    const botFlareDecoyUntil = new Map<string, number>();
    const remoteMeshes = new Map<string, DroneMeshHandle>();
    const activeOrdnance: ActiveOrdnanceState[] = [];
    const ordnanceMeshes = new Map<string, THREE.Group>();

    let drone: DroneFlightState;
    let activeSlot = 0;
    let currentSlotsKey = propsRef.current.loadout.slots.join(',');
    let slotAmmo: [number, number, number, number] = [
      WEAPONS[propsRef.current.loadout.slots[0]].ammoPerSlot,
      WEAPONS[propsRef.current.loadout.slots[1]].ammoPerSlot,
      WEAPONS[propsRef.current.loadout.slots[2]].ammoPerSlot,
      WEAPONS[propsRef.current.loadout.slots[3]].ammoPerSlot,
    ];
    let slotCooldowns: [number, number, number, number] = [0, 0, 0, 0];
    let lockedTargetId: string | null = null;
    let customWaypoint: { x: number; y: number; z: number } | null = null;
    let score = 0;
    let bestCep: number | null = null;
    let sortieTimeSec = 0;
    let trauma = 0;
    let hitstopTimer = 0;
    let hudEmitAccum = 0;
    let broadcastAccum = 0;
    let gameOverTriggered = false;
    let orbitYawOffset = 0;

    // War Thunder Battle Tickets, Aiming & Hit-Confirm State
    let blueTickets = 1000;
    let redTickets = 1000;
    let botReinforceTimer = 14;
    let ticketBleedTimer = 4.0;
    let combatHitCallout: string | null = null;
    let combatHitUntil = 0;
    let aimYaw = 0;
    let aimPitch = 0.02;
    let freeLookYawOffset = 0;
    let freeLookPitchOffset = 0;
    let lastPointerX: number | null = null;
    let lastPointerY: number | null = null;
    let wingVortexTimer = 0;

    // Cyber Warfare, Countermeasures & Mouse-Aim State
    const cyberStatus = new Map<string, { until: number; payloadId: CyberPayloadId }>();
    let cyberCooldownSec = 0;
    let playerGnssSpoofUntil = 0;
    let playerDisruptedUntil = 0;
    let playerDisruptedKind: CyberPayloadId | null = null;
    let incomingThreat: { sourceName: string; remainingSec: number } | null = null;
    let hostileCyberCooldown = 14;

    let flaresRemaining = 12 + propsRef.current.skillBonuses.bonusFlares;
    let flareCooldownSec = 0;
    let playerFlaresActiveUntil = 0;
    let cloudGroupRef: THREE.Group | null = null;
    let lastResScale = propsRef.current.settings.graphics.resolutionScale;
    let kamikazeArmed = false;
    let reserveDrones = 3;
    let aaaBurstCooldown = 1.6;
    let warSmokeCooldown = 0.25;

    let mouseNdcX = 0;
    let mouseNdcY = 0;
    let zoomHeld = false;
    let zoomToggled = false;

    function createInitialDrone(theaterId: TheaterId): DroneFlightState {
      const airframe = AIRFRAMES[propsRef.current.loadout.airframeId];
      const maxHp = Math.round(airframe.maxHp * propsRef.current.skillBonuses.maxHpMult);
      const spawnX = 0;
      const spawnZ = 950;
      const groundY = Math.max(THEATERS[theaterId].waterLevelM, groundHeightAt(theaterId, spawnX, spawnZ));
      return {
        x: spawnX,
        y: groundY + 420,
        z: spawnZ,
        vx: 0,
        vy: 0,
        vz: -92,
        pitch: 0.02,
        yaw: 0,
        roll: 0,
        throttle: 0.72,
        airspeedMs: 92,
        mach: 0.27,
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

    function rebuildTheater(theaterId: TheaterId) {
      activeTheaterId = theaterId;
      while (theaterGroup.children.length > 0) {
        const child = theaterGroup.children[0];
        theaterGroup.remove(child);
      }
      landmarkMeshes.clear();

      const maxAniso = renderer.capabilities.getMaxAnisotropy();
      const { terrainMesh, waterMesh, cloudGroup, propGroup } = buildTheaterTerrain(theaterId, maxAniso);
      theaterGroup.add(terrainMesh);
      theaterGroup.add(propGroup);
      if (waterMesh) theaterGroup.add(waterMesh);
      cloudGroupRef = cloudGroup;
      cloudGroup.visible = propsRef.current.settings.graphics.clouds;
      theaterGroup.add(cloudGroup);

      const spec = THEATERS[theaterId];
      landmarks = spec.landmarks.map((lm) => ({ ...lm, hp: lm.maxHp }));
      for (const lm of landmarks) {
        const mesh = buildTargetStructure(lm);
        const y = Math.max(spec.waterLevelM, groundHeightAt(theaterId, lm.x, lm.z));
        mesh.position.set(lm.x, y, lm.z);
        theaterGroup.add(mesh);
        landmarkMeshes.set(lm.id, mesh);
      }

      // Rebuild War Thunder multi-policy AI squadron (Allied Alpha Wingmen + Hostile Bravo Bots)
      for (const m of aiMeshes.values()) scene.remove(m.group);
      aiMeshes.clear();
      botFlareDecoyUntil.clear();
      aiBots = createAiBotSquadron(theaterId);

      for (const bot of aiBots) {
        const handle = buildDroneMesh(bot.airframeId, bot.team === 'alpha' ? 0x38bdf8 : 0xef4444);
        handle.group.position.set(bot.x, bot.y, bot.z);
        scene.add(handle.group);
        aiMeshes.set(bot.id, handle);
      }

      lockedTargetId = landmarks.find((l) => l.hp > 0)?.id ?? null;
    }

    function resetSortie(nextTheaterId?: TheaterId) {
      const targetTheater = nextTheaterId ?? propsRef.current.theaterId;
      rebuildTheater(targetTheater);

      for (const m of ordnanceMeshes.values()) scene.remove(m);
      ordnanceMeshes.clear();
      activeOrdnance.length = 0;

      drone = createInitialDrone(targetTheater);
      const slots = propsRef.current.loadout.slots;
      slotAmmo = [
        WEAPONS[slots[0]].ammoPerSlot,
        WEAPONS[slots[1]].ammoPerSlot,
        WEAPONS[slots[2]].ammoPerSlot,
        WEAPONS[slots[3]].ammoPerSlot,
      ];
      slotCooldowns = [0, 0, 0, 0];
      score = 0;
      bestCep = null;
      sortieTimeSec = 0;
      trauma = 0;
      hitstopTimer = 0;
      gameOverTriggered = false;
      blueTickets = 1000;
      redTickets = 1000;
      botReinforceTimer = 14;
      ticketBleedTimer = 4.0;
      combatHitCallout = null;
      combatHitUntil = 0;
      aimYaw = 0;
      aimPitch = 0.02;
      freeLookYawOffset = 0;
      freeLookPitchOffset = 0;
      lastPointerX = null;
      lastPointerY = null;
      wingVortexTimer = 0;
      lockedTargetId = landmarks[0]?.id ?? null;
      cyberStatus.clear();
      cyberCooldownSec = 0;
      playerGnssSpoofUntil = 0;
      playerDisruptedUntil = 0;
      playerDisruptedKind = null;
      incomingThreat = null;
      hostileCyberCooldown = 14;
      flaresRemaining = 12 + propsRef.current.skillBonuses.bonusFlares;
      flareCooldownSec = 0;
      playerFlaresActiveUntil = 0;
      kamikazeArmed = false;
      reserveDrones = 3;
      aaaBurstCooldown = 1.6;
      mouseNdcX = 0;
      mouseNdcY = 0;
      zoomHeld = false;
      zoomToggled = false;
    }

    function emitAar(type: AarEventType, title: string, detail: string) {
      const baseElev = THEATERS[activeTheaterId]?.baseElevationM ?? 0;
      propsRef.current.onAarEvent({
        type,
        title,
        detail,
        tSec: Number(sortieTimeSec.toFixed(1)),
        x: Math.round(drone.x),
        z: Math.round(drone.z),
        altMsl: Math.round(drone.y + baseElev),
        fuelKg: Math.round(drone.fuelKg * 10) / 10,
      });
    }

    rebuildTheater(activeTheaterId);
    drone = createInitialDrone(activeTheaterId);

    function deployFlares(): boolean {
      if (propsRef.current.phase !== 'playing' || gameOverTriggered) return false;
      if (flaresRemaining <= 0 || flareCooldownSec > 0) return false;
      flaresRemaining -= 1;
      flareCooldownSec = 1.6;
      playerFlaresActiveUntil = sortieTimeSec + 4.5;

      const cosP = Math.cos(drone.pitch);
      const fwdX = -Math.sin(drone.yaw) * cosP;
      const fwdZ = -Math.cos(drone.yaw) * cosP;
      const rightX = Math.cos(drone.yaw);
      const rightZ = -Math.sin(drone.yaw);
      for (let i = 0; i < 4; i++) {
        const side = i % 2 === 0 ? 1 : -1;
        spawnParticleBurst(
          drone.x - fwdX * 3.5 + rightX * side * 2.1,
          drone.y - 0.8,
          drone.z - fwdZ * 3.5 + rightZ * side * 2.1,
          3,
          24,
          0.42,
          1.0,
          0.88,
          0.42,
          1.4,
        );
      }
      audio.playGlideRelease();
      emitAar('ordnance', 'Countermeasures Deployed', `IR Flares & Chaff salvo (${flaresRemaining} remaining)`);
      hudEmitAccum = 0.1;
      return true;
    }

    function armKamikazeDive(): boolean {
      const af = AIRFRAMES[propsRef.current.loadout.airframeId];
      if (!af.kamikazeCapable || propsRef.current.phase !== 'playing' || gameOverTriggered) return false;
      kamikazeArmed = !kamikazeArmed;
      if (kamikazeArmed) {
        audio.playKamikazeLockSiren();
        emitAar('ordnance', 'Kamikaze Dive Armed', `${af.name} terminal warhead (${af.kamikazeWarheadKg} kg) armed — steer nose into target!`);
      }
      hudEmitAccum = 0.1;
      return kamikazeArmed;
    }

    function detonateDroneAsKamikaze(impactX: number, impactY: number, impactZ: number, reasonLabel: string) {
      const p = propsRef.current;
      const payload = computeKamikazeImpactPayload(p.loadout.airframeId, p.loadout.slots, slotAmmo, p.skillBonuses);
      const theaterSpec = THEATERS[activeTheaterId];

      // Massive fireball + shockwave + acoustic concussion
      spawnShockwave(impactX, impactY, impactZ, 2.2);
      spawnParticleBurst(impactX, impactY + 4, impactZ, 48, 105, 7.6, 1.0, 0.52, 0.1, 1.35);
      spawnParticleBurst(impactX, impactY + 6, impactZ, 28, 52, 8.2, 0.28, 0.28, 0.3, 1.8);
      audio.playExplosion(2.2);
      trauma = 1.0;
      hitstopTimer = 0.075;

      // Blast all landmarks in blast radius
      for (const lm of landmarks) {
        if (lm.hp <= 0) continue;
        const dHoriz = Math.hypot(impactX - lm.x, impactZ - lm.z);
        if (dHoriz <= Math.max(payload.blastRadiusM, 52)) {
          const falloff = Math.max(0.45, 1 - (dHoriz / Math.max(payload.blastRadiusM, 55)) * 0.45);
          lm.hp = Math.max(0, lm.hp - payload.damage * falloff);
          if (lm.hp === 0) {
            const lmMesh = landmarkMeshes.get(lm.id);
            if (lmMesh) lmMesh.visible = false;
            redTickets = Math.max(0, redTickets - 120);
            const cep = Math.round(dHoriz * 10) / 10;
            bestCep = bestCep === null ? cep : Math.min(bestCep, cep);
            score += lm.points + 75;
            combatHitCallout = `TARGET DESTROYED +${lm.points + 75}`;
            combatHitUntil = sortieTimeSec + 2.2;
            audio.playHitMarker(true);
            p.onTargetDestroyed({
              targetId: lm.id,
              name: lm.name,
              points: lm.points + 75,
              cepMeters: cep,
              weaponId: p.loadout.slots[0],
            });
            emitAar(
              'strike',
              `Kamikaze Direct Hit: ${lm.name}`,
              `${reasonLabel} (${payload.warheadKg} kg warhead+ordnance) · CEP ${cep}m (+${lm.points + 75} pts)`,
            );
          }
        }
      }

      // Blast any enemy AI drone in airburst proximity
      for (const ai of aiBots) {
        if (ai.team !== 'bravo' || ai.hp <= 0) continue;
        const dAi = Math.hypot(impactX - ai.x, impactY - ai.y, impactZ - ai.z);
        if (dAi <= Math.max(46, payload.blastRadiusM * 0.8)) {
          ai.hp = Math.max(0, ai.hp - payload.damage);
          if (ai.hp === 0) {
            score += 300;
            redTickets = Math.max(0, redTickets - 65);
            combatHitCallout = `AIRCRAFT DESTROYED +300`;
            combatHitUntil = sortieTimeSec + 2.2;
            audio.playHitMarker(true);
            p.onAirKill({ victimName: ai.callsign, points: 300, weaponId: p.loadout.slots[0] });
            emitAar('air_kill', `Kamikaze Ram: ${ai.callsign}`, `Mid-air warhead detonation (+300 pts)`);
          }
        }
      }

      reserveDrones = Math.max(0, reserveDrones - 1);
      blueTickets = Math.max(0, blueTickets - 120);
      kamikazeArmed = false;

      const aliveLandmarks = landmarks.filter((l) => l.hp > 0).length;
      if (aliveLandmarks === 0 || redTickets <= 0) {
        return; // Victory handled right after in tick
      }

      if (reserveDrones > 0) {
        // Redeploy fresh squadron unit so player can clear the entire theater
        drone = createInitialDrone(theaterSpec.id);
        aimYaw = drone.yaw;
        aimPitch = drone.pitch;
        slotAmmo = [
          WEAPONS[p.loadout.slots[0]].ammoPerSlot,
          WEAPONS[p.loadout.slots[1]].ammoPerSlot,
          WEAPONS[p.loadout.slots[2]].ammoPerSlot,
          WEAPONS[p.loadout.slots[3]].ammoPerSlot,
        ];
        slotCooldowns = [0, 0, 0, 0];
        emitAar('launch', `Squadron Unit Redeployed`, `${reserveDrones} drone units remaining in theater`);
      } else {
        drone.hp = 0;
      }
    }

    // Input Tracking (cleared on blur/visibilitychange)
    const keys = new Set<string>();
    let mouseFireHeld = false;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
        return;
      }
      const code = e.code;
      keys.add(code);

      if (propsRef.current.phase !== 'playing') return;

      if (code === 'Digit1') {
        activeSlot = 0;
        hudEmitAccum = 0.1;
      } else if (code === 'Digit2') {
        activeSlot = 1;
        hudEmitAccum = 0.1;
      } else if (code === 'Digit3') {
        activeSlot = 2;
        hudEmitAccum = 0.1;
      } else if (code === 'Digit4') {
        activeSlot = 3;
        hudEmitAccum = 0.1;
      } else if (code === 'Tab') {
        e.preventDefault();
        cycleTarget();
      } else if (code === 'Space') {
        e.preventDefault();
        fireActiveOrdnance();
      } else if (code === 'KeyF') {
        e.preventDefault();
        deployFlares();
      } else if (code === 'KeyB') {
        e.preventDefault();
        armKamikazeDive();
      } else if (code === 'KeyZ') {
        e.preventDefault();
        zoomToggled = !zoomToggled;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keys.delete(e.code);
    };

    const clearInputs = () => {
      keys.clear();
      mouseFireHeld = false;
      zoomHeld = false;
      lastPointerX = null;
      lastPointerY = null;
    };

    const handleCanvasPointerDown = (e: PointerEvent) => {
      if (propsRef.current.phase !== 'playing') return;
      if (e.button === 0) {
        mouseFireHeld = true;
        fireActiveOrdnance();
      } else if (e.button === 2) {
        zoomHeld = true;
      }
    };

    const handleCanvasPointerUp = (e: PointerEvent) => {
      if (e.button === 2) {
        zoomHeld = false;
      } else if (e.button === 0) {
        mouseFireHeld = false;
      } else {
        mouseFireHeld = false;
        zoomHeld = false;
      }
    };

    const handleCanvasPointerMove = (e: PointerEvent) => {
      if (propsRef.current.phase !== 'playing') return;
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const sens = propsRef.current.settings.controls.mouseSensitivity;

      if (keys.has('KeyC')) {
        // War Thunder Hold-C Free-Look around the aircraft without altering flight aim
        const dx = e.movementX !== 0 ? e.movementX : lastPointerX !== null ? e.clientX - lastPointerX : 0;
        const dy = e.movementY !== 0 ? e.movementY : lastPointerY !== null ? e.clientY - lastPointerY : 0;
        freeLookYawOffset = Math.max(-Math.PI, Math.min(Math.PI, freeLookYawOffset - dx * 0.0055 * sens));
        freeLookPitchOffset = Math.max(-0.75, Math.min(0.95, freeLookPitchOffset + dy * 0.0045 * sens));
      } else {
        const rawX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const rawY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
        mouseNdcX = Math.max(-1, Math.min(1, rawX * sens));
        mouseNdcY = Math.max(-1, Math.min(1, rawY * sens));
      }
      lastPointerX = e.clientX;
      lastPointerY = e.clientY;
    };

    const handleCanvasWheel = (e: WheelEvent) => {
      if (propsRef.current.phase !== 'playing') return;
      e.preventDefault();
      const maxThr = propsRef.current.settings.gameplay.flightModel === 'arcade' ? 1.1 : 1.0;
      const step = e.deltaY < 0 ? 0.08 : -0.08;
      drone.throttle = Math.max(0, Math.min(maxThr, drone.throttle + step));
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', clearInputs);
    document.addEventListener('visibilitychange', clearInputs);
    renderer.domElement.addEventListener('pointerdown', handleCanvasPointerDown);
    renderer.domElement.addEventListener('pointermove', handleCanvasPointerMove);
    renderer.domElement.addEventListener('wheel', handleCanvasWheel, { passive: false });
    renderer.domElement.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('pointerup', handleCanvasPointerUp);

    function getLockedTargetPos(): {
      id: string | null;
      kind: 'base' | 'drone' | 'waypoint' | null;
      name: string | null;
      x: number;
      y: number;
      z: number;
      hpPct: number | null;
    } {
      if (customWaypoint) {
        return {
          id: 'waypoint',
          kind: 'waypoint',
          name: 'MAP WAYPOINT',
          x: customWaypoint.x,
          y: customWaypoint.y,
          z: customWaypoint.z,
          hpPct: null,
        };
      }
      if (lockedTargetId) {
        const lm = landmarks.find((l) => l.id === lockedTargetId && l.hp > 0);
        if (lm) {
          const y = Math.max(THEATERS[activeTheaterId].waterLevelM, groundHeightAt(activeTheaterId, lm.x, lm.z));
          return { id: lm.id, kind: 'base', name: lm.name, x: lm.x, y: y + 8, z: lm.z, hpPct: (lm.hp / lm.maxHp) * 100 };
        }
        const ai = aiBots.find((a) => a.id === lockedTargetId && a.hp > 0);
        if (ai) {
          return { id: ai.id, kind: 'drone', name: ai.callsign, x: ai.x, y: ai.y, z: ai.z, hpPct: (ai.hp / ai.maxHp) * 100 };
        }
        const rem = propsRef.current.remotePilots.find((p) => p.id === lockedTargetId && p.hp > 0);
        if (rem) {
          return { id: rem.id, kind: 'drone', name: rem.callsign, x: rem.x, y: rem.y, z: rem.z, hpPct: (rem.hp / rem.maxHp) * 100 };
        }
      }
      const fallback = landmarks.find((l) => l.hp > 0);
      if (fallback) {
        lockedTargetId = fallback.id;
        const y = Math.max(THEATERS[activeTheaterId].waterLevelM, groundHeightAt(activeTheaterId, fallback.x, fallback.z));
        return { id: fallback.id, kind: 'base', name: fallback.name, x: fallback.x, y: y + 8, z: fallback.z, hpPct: (fallback.hp / fallback.maxHp) * 100 };
      }
      const fallbackBot = aiBots.find((a) => a.team === 'bravo' && a.hp > 0);
      if (fallbackBot) {
        lockedTargetId = fallbackBot.id;
        return { id: fallbackBot.id, kind: 'drone', name: fallbackBot.callsign, x: fallbackBot.x, y: fallbackBot.y, z: fallbackBot.z, hpPct: (fallbackBot.hp / fallbackBot.maxHp) * 100 };
      }
      return { id: null, kind: null, name: null, x: drone.x, y: 0, z: drone.z - 1200, hpPct: null };
    }

    function cycleTarget() {
      customWaypoint = null;
      const candidates: string[] = [
        ...landmarks.filter((l) => l.hp > 0).map((l) => l.id),
        ...aiBots.filter((a) => a.team === 'bravo' && a.hp > 0).map((a) => a.id),
        ...propsRef.current.remotePilots.filter((p) => p.hp > 0).map((p) => p.id),
      ];
      if (candidates.length === 0) return;
      const idx = lockedTargetId ? candidates.indexOf(lockedTargetId) : -1;
      lockedTargetId = candidates[(idx + 1) % candidates.length];
      audio.playLockChirp();
      hudEmitAccum = 0.1;
    }

    function spawnOrdnanceEntity(payload: {
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
    }) {
      const spec = WEAPONS[payload.weaponId];
      const ord: ActiveOrdnanceState = {
        ...payload,
        ageSec: 0,
        maxLifetimeSec: spec.category === 'cannon' ? 2.6 : 38,
        wingDeployed: false,
        phase: spec.category === 'cannon' ? 'bullet' : spec.category === 'glide_bomb' ? 'glide' : 'boost',
      };
      activeOrdnance.push(ord);
      const mesh = buildOrdnanceMesh(spec.category);
      mesh.position.set(ord.x, ord.y, ord.z);
      scene.add(mesh);
      ordnanceMeshes.set(ord.id, mesh);
    }

    function fireActiveOrdnance() {
      if (propsRef.current.phase !== 'playing' || gameOverTriggered) return;
      if (
        sortieTimeSec < playerDisruptedUntil &&
        (playerDisruptedKind === 'c2_hijack' || playerDisruptedKind === 'firmware_brick')
      ) {
        return;
      }
      const weaponId = propsRef.current.loadout.slots[activeSlot];
      const spec = WEAPONS[weaponId];
      if (slotCooldowns[activeSlot] > 0) return;
      if (!propsRef.current.sandbox.infiniteAmmo && slotAmmo[activeSlot] <= 0) return;

      if (!propsRef.current.sandbox.infiniteAmmo) {
        slotAmmo[activeSlot] -= 1;
      }
      slotCooldowns[activeSlot] = spec.cooldownSec * propsRef.current.skillBonuses.weaponCooldownMult;

      const cosP = Math.cos(drone.pitch);
      const fwdX = -Math.sin(drone.yaw) * cosP;
      const fwdY = Math.sin(drone.pitch);
      const fwdZ = -Math.cos(drone.yaw) * cosP;

      const tgt = getLockedTargetPos();
      const vx = drone.vx + fwdX * spec.initialSpeedMs;
      const vy = drone.vy + fwdY * spec.initialSpeedMs;
      const vz = drone.vz + fwdZ * spec.initialSpeedMs;

      const id = `ord-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      spawnOrdnanceEntity({
        id,
        ownerId: 'player',
        weaponId,
        x: drone.x + fwdX * 3,
        y: drone.y - 1.5,
        z: drone.z + fwdZ * 3,
        vx,
        vy,
        vz,
        targetId: tgt.id,
        targetX: tgt.x,
        targetY: tgt.y,
        targetZ: tgt.z,
      });

      propsRef.current.onOrdnanceFired({
        weaponId,
        x: drone.x,
        y: drone.y - 1.5,
        z: drone.z,
        vx,
        vy,
        vz,
        targetX: tgt.x,
        targetY: tgt.y,
        targetZ: tgt.z,
      });
      if (spec.category !== 'cannon') {
        emitAar('ordnance', `${spec.natoCode} Released`, `${spec.name} → ${tgt.name ?? 'Boresight'}`);
      }

      if (spec.category === 'cannon') {
        audio.playCannonShot();
        spawnParticleBurst(
          drone.x + fwdX * 3.8,
          drone.y - 0.3,
          drone.z + fwdZ * 3.8,
          2,
          12,
          0.32,
          1.0,
          0.85,
          0.3,
          0.08,
        );
        trauma = Math.min(1, trauma + 0.08);
      } else if (spec.category === 'glide_bomb' || spec.category === 'drop_bomb') {
        audio.playGlideRelease();
        trauma = Math.min(1, trauma + 0.14);
      } else {
        audio.playMissileLaunch(spec.category === 'ballistic_missile');
        trauma = Math.min(1, trauma + (spec.category === 'ballistic_missile' ? 0.35 : 0.2));
      }
      hudEmitAccum = 0.1;
    }

    // Bind command bridge for UI & WebSocket callbacks
    propsRef.current.bridgeRef.current = {
      resetSortie,
      setActiveSlot: (s) => {
        activeSlot = Math.max(0, Math.min(3, s));
      },
      fireActiveOrdnance,
      cycleTarget,
      deployFlares,
      armKamikazeDive,
      setWaypointTarget: (x, z) => {
        const y = Math.max(THEATERS[activeTheaterId].waterLevelM, groundHeightAt(activeTheaterId, x, z));
        customWaypoint = { x, y: y + 4, z };
        audio.playLockChirp();
      },
      getCyberTargets: () => {
        const list: CyberTargetOption[] = [];
        const theaterSpec = THEATERS[activeTheaterId];
        for (const lm of landmarks) {
          if (lm.hp <= 0) continue;
          const ly = Math.max(theaterSpec.waterLevelM, groundHeightAt(activeTheaterId, lm.x, lm.z)) + 8;
          const dist = Math.round(Math.hypot(lm.x - drone.x, ly - drone.y, lm.z - drone.z));
          const st = cyberStatus.get(lm.id);
          const rem = st ? Math.max(0, Math.ceil(st.until - sortieTimeSec)) : 0;
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
        for (const ai of aiBots) {
          if (ai.team !== 'bravo' || ai.hp <= 0) continue;
          const dist = Math.round(Math.hypot(ai.x - drone.x, ai.y - drone.y, ai.z - drone.z));
          const st = cyberStatus.get(ai.id);
          const rem = st ? Math.max(0, Math.ceil(st.until - sortieTimeSec)) : 0;
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
        for (const rp of propsRef.current.remotePilots) {
          if (rp.hp <= 0) continue;
          const dist = Math.round(Math.hypot(rp.x - drone.x, rp.y - drone.y, rp.z - drone.z));
          const st = cyberStatus.get(rp.id);
          const rem = st ? Math.max(0, Math.ceil(st.until - sortieTimeSec)) : 0;
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
      },
      triggerCyberAttack: (targetId, payloadId) => {
        const spec = CYBER_PAYLOADS[payloadId];
        const sb = propsRef.current.skillBonuses;
        const effectiveDuration = Math.round(spec.durationSec * sb.cyberDurationMult);
        cyberCooldownSec = Number((spec.cooldownSec * sb.cyberCooldownMult).toFixed(1));
        cyberStatus.set(targetId, { until: sortieTimeSec + effectiveDuration, payloadId });
        if (payloadId === 'gnss_spoof') {
          playerGnssSpoofUntil = sortieTimeSec + effectiveDuration;
        }
        audio.playCyberInject();
        const theaterSpec = THEATERS[activeTheaterId];

        const lm = landmarks.find((l) => l.id === targetId && l.hp > 0);
        if (lm) {
          const ly = Math.max(theaterSpec.waterLevelM, groundHeightAt(activeTheaterId, lm.x, lm.z)) + 12;
          spawnParticleBurst(lm.x, ly, lm.z, 18, 42, 3.6, 0.08, 0.85, 0.96, 1.0);
          let destroyed = false;
          if (spec.directDamage > 0) {
            lm.hp = Math.max(0, lm.hp - spec.directDamage);
            audio.playExplosion(1.15);
            spawnParticleBurst(lm.x, ly, lm.z, 22, 58, 4.8, 1.0, 0.48, 0.12, 1.1);
            if (lm.hp === 0) {
              destroyed = true;
              redTickets = Math.max(0, redTickets - 120);
              const lmMesh = landmarkMeshes.get(lm.id);
              if (lmMesh) lmMesh.visible = false;
              score += lm.points;
              propsRef.current.onTargetDestroyed({
                targetId: lm.id,
                name: lm.name,
                points: lm.points,
                cepMeters: 0,
                weaponId: 'agm158_jassm',
              });
            }
          }
          propsRef.current.onCyberSuccess({
            targetId: lm.id,
            targetName: lm.name,
            targetKind: 'base',
            payloadId,
            damageDealt: spec.directDamage,
            destroyed,
            isRemotePilot: false,
          });
          emitAar('cyber', `Cyber Breach: ${lm.name}`, `${spec.name}${destroyed ? ' (Facility Destroyed)' : spec.directDamage > 0 ? ` (-${spec.directDamage} HP)` : ` (${effectiveDuration}s EW lockout)`}`);
          return {
            ok: true,
            targetName: lm.name,
            targetKind: 'base',
            destroyed,
            damageDealt: spec.directDamage,
            isRemotePilot: false,
            message: `${spec.name} injected into ${lm.name}${destroyed ? ' — FACILITY DESTROYED!' : spec.directDamage > 0 ? ` (-${spec.directDamage} HP)` : ` (${effectiveDuration}s EW lockout)`}`,
          };
        }

        const ai = aiBots.find((a) => a.id === targetId && a.hp > 0);
        if (ai) {
          spawnParticleBurst(ai.x, ai.y, ai.z, 16, 40, 3.4, 0.08, 0.85, 0.96, 0.9);
          let destroyed = false;
          if (spec.directDamage > 0) {
            ai.hp = Math.max(0, ai.hp - spec.directDamage);
            if (ai.hp === 0) {
              destroyed = true;
              redTickets = Math.max(0, redTickets - 65);
              audio.playExplosion(1.2);
              audio.playHitMarker(true);
              score += 250;
              propsRef.current.onAirKill({ victimName: ai.callsign, points: 250, weaponId: 'aim9x_sidewinder' });
            }
          }
          propsRef.current.onCyberSuccess({
            targetId: ai.id,
            targetName: ai.callsign,
            targetKind: 'drone',
            payloadId,
            damageDealt: spec.directDamage,
            destroyed,
            isRemotePilot: false,
          });
          emitAar('cyber', `Cyber Breach: ${ai.callsign}`, `${spec.name}${destroyed ? ' (UAV Crashed)' : ` (${spec.durationSec}s C2 disruption)`}`);
          return {
            ok: true,
            targetName: ai.callsign,
            targetKind: 'drone',
            destroyed,
            damageDealt: spec.directDamage,
            isRemotePilot: false,
            message: `${spec.name} breached ${ai.callsign}${destroyed ? ' — UAV CRASHED!' : ` (${spec.durationSec}s flight/C2 disruption)`}`,
          };
        }

        const rp = propsRef.current.remotePilots.find((p) => p.id === targetId && p.hp > 0);
        if (rp) {
          spawnParticleBurst(rp.x, rp.y, rp.z, 16, 40, 3.4, 0.08, 0.85, 0.96, 0.9);
          propsRef.current.onCyberSuccess({
            targetId: rp.id,
            targetName: rp.callsign,
            targetKind: 'drone',
            payloadId,
            damageDealt: spec.directDamage,
            destroyed: false,
            isRemotePilot: true,
          });
          emitAar('cyber', `Cyber Breach: ${rp.callsign}`, `Transmitted ${spec.name} to arena UAV`);
          return {
            ok: true,
            targetName: rp.callsign,
            targetKind: 'drone',
            destroyed: false,
            damageDealt: spec.directDamage,
            isRemotePilot: true,
            message: `Transmitted ${spec.name} to arena UAV ${rp.callsign}.`,
          };
        }

        return {
          ok: false,
          targetName: 'Unknown',
          targetKind: 'base',
          destroyed: false,
          damageDealt: 0,
          isRemotePilot: false,
          message: 'Target lost or already destroyed.',
        };
      },
      purgeCyberIntrusion: () => {
        const hadThreat = Boolean(incomingThreat) || sortieTimeSec < playerDisruptedUntil;
        incomingThreat = null;
        playerDisruptedUntil = 0;
        playerDisruptedKind = null;
        audio.playCyberPurge();
        if (hadThreat) {
          emitAar('defense', 'C2 Key Rotation', 'Purged hostile cyber intrusion and restored flight link');
        }
        return hadThreat;
      },
      receiveRemoteCyberAttack: (payloadId, attackerCallsign) => {
        const spec = CYBER_PAYLOADS[payloadId];
        playerDisruptedUntil = sortieTimeSec + Math.min(8, spec.durationSec);
        playerDisruptedKind = payloadId;
        incomingThreat = { sourceName: `${attackerCallsign} (${spec.name})`, remainingSec: 4.0 };
        if (spec.directDamage > 0) {
          drone.hp = Math.max(1, drone.hp - Math.round(spec.directDamage * 0.25));
        }
        audio.playCyberAlert();
        trauma = Math.min(1, trauma + 0.3);
      },
      spawnRemoteOrdnance: (p) => {
        const id = `rem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        spawnOrdnanceEntity({
          id,
          ownerId: p.ownerId,
          weaponId: p.weaponId,
          x: p.x,
          y: p.y,
          z: p.z,
          vx: p.vx,
          vy: p.vy,
          vz: p.vz,
          targetId: null,
          targetX: p.targetX,
          targetY: p.targetY,
          targetZ: p.targetZ,
        });
      },
      applyTargetHpSync: (targetHp) => {
        for (const lm of landmarks) {
          if (lm.id in targetHp) {
            lm.hp = targetHp[lm.id];
            const mesh = landmarkMeshes.get(lm.id);
            if (mesh) mesh.visible = lm.hp > 0;
          }
        }
      },
    };

    const handleResize = () => {
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Initialize camera behind drone cleanly
    camera.position.set(drone.x, drone.y + 12, drone.z + 32);
    camera.lookAt(drone.x, drone.y, drone.z - 60);

    let lastTimeMs = performance.now();
    let frameId = 0;
    let disposed = false;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl.fenceSync) {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function tick() {
      if (disposed) return;
      const nowMs = performance.now();
      const rawDt = (nowMs - lastTimeMs) / 1000;
      lastTimeMs = nowMs;
      const dt = Math.min(0.05, Math.max(0.001, rawDt));
      const p = propsRef.current;

      // Sync theater if user changed theater in UI
      if (p.theaterId !== activeTheaterId) {
        resetSortie(p.theaterId);
      }

      // Sync player airframe & hardpoint weapons 3D model if changed in Hangar
      const nextSlotsKey = p.loadout.slots.join(',');
      if (p.loadout.airframeId !== currentAirframeId || nextSlotsKey !== currentSlotsKey) {
        const airframeChanged = p.loadout.airframeId !== currentAirframeId;
        currentAirframeId = p.loadout.airframeId;
        currentSlotsKey = nextSlotsKey;
        scene.remove(playerMeshHandle.group);
        playerMeshHandle = buildDroneMesh(currentAirframeId, 0xf59e0b, p.loadout.slots);
        scene.add(playerMeshHandle.group);
        if (airframeChanged) {
          const af = AIRFRAMES[currentAirframeId];
          drone.maxHp = Math.round(af.maxHp * p.skillBonuses.maxHpMult);
          drone.hp = Math.min(drone.maxHp, drone.hp);
          drone.maxFuelKg = af.maxFuelKg;
          drone.fuelKg = af.maxFuelKg;
        }
        slotAmmo = [
          WEAPONS[p.loadout.slots[0]].ammoPerSlot,
          WEAPONS[p.loadout.slots[1]].ammoPerSlot,
          WEAPONS[p.loadout.slots[2]].ammoPerSlot,
          WEAPONS[p.loadout.slots[3]].ammoPerSlot,
        ];
        slotCooldowns = [0, 0, 0, 0];
      }

      // Sync Mute & Active Audio state
      audio.setMuted(p.muted);
      audio.setActive(p.phase === 'playing');

      // Apply Live Graphics Settings
      const gfx = p.settings.graphics;
      renderer.toneMappingExposure = gfx.exposure;
      renderer.shadowMap.enabled = !isSoftwareGl && gfx.shadows;
      sunLight.castShadow = !isSoftwareGl && gfx.shadows;
      if (cloudGroupRef) {
        cloudGroupRef.visible = gfx.clouds;
      }
      if (Math.abs(gfx.resolutionScale - lastResScale) > 0.01) {
        lastResScale = gfx.resolutionScale;
        renderer.setPixelRatio(
          isSoftwareGl ? 1 : Math.min(2, (window.devicePixelRatio || 1) * gfx.resolutionScale),
        );
        renderer.setSize(
          mountRef.current?.clientWidth || window.innerWidth,
          mountRef.current?.clientHeight || window.innerHeight,
        );
      }

      // Rotate radar dishes on active ground radar installations
      for (const lm of landmarks) {
        if (lm.hp > 0 && lm.type === 'radar') {
          const scanner = landmarkMeshes.get(lm.id)?.getObjectByName('radarScanner');
          if (scanner) scanner.rotation.y += dt * 1.8;
        }
      }

      // Update Sky, Sun Light, Fog from Solar Ephemeris & Weather
      const theater = THEATERS[activeTheaterId];
      const weather = WEATHERS[p.weatherId];
      const solar = computeSolarState(theater.latDeg, theater.lonDeg, p.utcHours, 172, weather.cloudCover);

      skyUniforms['sunPosition'].value.set(solar.sunDirX, solar.sunDirY, solar.sunDirZ);
      skyUniforms['turbidity'].value = 2.5 + weather.cloudCover * 10;

      sunLight.position.set(
        drone.x + solar.sunDirX * 1200,
        Math.max(120, drone.y + solar.sunDirY * 1200),
        drone.z + solar.sunDirZ * 1200,
      );
      sunLight.target.position.set(drone.x, 0, drone.z);
      sunLight.color.setHex(solar.sunColorHex);
      sunLight.intensity = solar.isDaylight ? 1.85 * (1 - weather.cloudCover * 0.45) : 0.45;
      hemiLight.intensity = solar.isDaylight ? 0.72 : 0.35;

      const fog = scene.fog as THREE.FogExp2;
      const fogHex = p.weatherId === 'desert_dust' ? 0xb89668 : solar.fogColorHex;
      fog.color.setHex(fogHex);
      fog.density = weather.fogDensity;

      // Update weather precipitation particles around camera
      const showPrecip = weather.precipitation !== 'none';
      precipMesh.visible = showPrecip;
      if (showPrecip) {
        precipMat.color.setHex(weather.precipitation === 'dust' ? 0xd4a373 : 0xcbd5e1);
        const windRad = (weather.windHeadingDeg * Math.PI) / 180;
        const wVx = Math.sin(windRad) * weather.windSpeedMs;
        const wVz = -Math.cos(windRad) * weather.windSpeedMs;
        const fallSpeed = weather.precipitation === 'rain' ? -85 : -12;
        for (let i = 0; i < PRECIP_COUNT; i++) {
          const po = precipOffsets[i];
          po.x += wVx * dt;
          po.y += fallSpeed * dt;
          po.z += wVz * dt;
          if (po.y < -40) po.y += 140;
          if (po.x > 130) po.x -= 260;
          if (po.x < -130) po.x += 260;
          if (po.z > 130) po.z -= 260;
          if (po.z < -130) po.z += 260;
          _vec3A.set(drone.x + po.x, drone.y + po.y, drone.z + po.z);
          _scaleVec.set(1, weather.precipitation === 'rain' ? 1.6 : 0.45, 1);
          _quat.identity();
          _mat4.compose(_vec3A, _quat, _scaleVec);
          precipMesh.setMatrixAt(i, _mat4);
        }
        precipMesh.instanceMatrix.needsUpdate = true;
      }

      if (hitstopTimer > 0) {
        hitstopTimer = Math.max(0, hitstopTimer - dt);
      }

      const simActive = p.phase === 'playing' && hitstopTimer <= 0;

      if (simActive) {
        sortieTimeSec += dt * p.sandbox.timeScale;

        // Continuous cannon hold support
        if ((keys.has('Space') || mouseFireHeld) && WEAPONS[p.loadout.slots[activeSlot]].category === 'cannon') {
          fireActiveOrdnance();
        }

        // Cooldowns & Cyber Intrusion Timers
        cyberCooldownSec = Math.max(0, cyberCooldownSec - dt);
        flareCooldownSec = Math.max(0, flareCooldownSec - dt);
        for (let i = 0; i < 4; i++) {
          slotCooldowns[i] = Math.max(0, slotCooldowns[i] - dt);
        }

        if (incomingThreat) {
          incomingThreat.remainingSec -= dt;
          if (incomingThreat.remainingSec <= 0) {
            playerDisruptedUntil =
              sortieTimeSec + 7.5 * p.skillBonuses.hostileCyberDurationMult;
            playerDisruptedKind = 'c2_hijack';
            drone.hp = Math.max(1, drone.hp - 10);
            trauma = Math.min(1, trauma + 0.28);
            if (p.settings.gameplay.radarWarningAudio) audio.playCyberAlert();
            emitAar('damage', 'Hostile C2 Breach', `${incomingThreat.sourceName} disrupted avionics (-10 HP)`);
            incomingThreat = null;
          }
        } else {
          hostileCyberCooldown -= dt;
          if (hostileCyberCooldown <= 0 && sortieTimeSec > 10) {
            const activeEnemyRadar = landmarks.find(
              (l) =>
                l.hp > 0 &&
                (l.type === 'radar' || l.type === 'sam') &&
                !(cyberStatus.get(l.id) && sortieTimeSec < (cyberStatus.get(l.id)?.until ?? 0)) &&
                Math.hypot(l.x - drone.x, l.z - drone.z) < 2500,
            );
            const activeEnemyAi = aiBots.find(
              (a) =>
                a.team === 'bravo' &&
                a.hp > 0 &&
                !(cyberStatus.get(a.id) && sortieTimeSec < (cyberStatus.get(a.id)?.until ?? 0)) &&
                Math.hypot(a.x - drone.x, a.z - drone.z) < 2000,
            );
            const source = activeEnemyRadar?.name ?? activeEnemyAi?.callsign ?? null;
            if (source) {
              incomingThreat = { sourceName: source, remainingSec: 4.5 };
              if (p.settings.gameplay.radarWarningAudio) audio.playCyberAlert();
              hostileCyberCooldown = 22 + Math.random() * 10;
            } else {
              hostileCyberCooldown = 6;
            }
          }
        }

        if (combatHitCallout && sortieTimeSec >= combatHitUntil) {
          combatHitCallout = null;
        }

        const isPlayerDisrupted = sortieTimeSec < playerDisruptedUntil;
        const cyberRollJitter =
          isPlayerDisrupted && playerDisruptedKind === 'c2_hijack'
            ? Math.sin(sortieTimeSec * 9.5) * 0.45
            : 0;

        // Gather manual control overrides
        const invertSign = p.settings.controls.invertY ? -1 : 1;
        const pitchOverride =
          ((keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) -
            (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0)) *
          invertSign;
        const rollOverride =
          (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) -
          (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) +
          cyberRollJitter;
        const yawOverride = (keys.has('KeyQ') ? 1 : 0) - (keys.has('KeyE') ? 1 : 0);
        const throttleDelta =
          (keys.has('ShiftLeft') || keys.has('ShiftRight') || keys.has('Equal') ? 1 : 0) -
          (keys.has('ControlLeft') || keys.has('Minus') ? 1 : 0);

        const freeLooking = keys.has('KeyC') && p.cameraMode !== 'orbit';
        const sens = p.settings.controls.mouseSensitivity;
        const effNdcX = Math.max(-0.98, Math.min(0.98, mouseNdcX * sens));
        const effNdcY = Math.max(-0.94, Math.min(0.94, (p.settings.controls.invertY ? -mouseNdcY : mouseNdcY) * sens));

        const aimStep = stepWarThunderAimAngles(
          aimYaw,
          aimPitch,
          effNdcX,
          effNdcY,
          { pitchOverride, rollOverride, yawOverride },
          freeLooking,
          drone.yaw,
          drone.pitch,
          p.settings.controls.scheme,
          dt,
        );
        aimYaw = aimStep.aimYaw;
        aimPitch = aimStep.aimPitch;

        let flightControlInput;
        if (p.settings.controls.scheme === 'mouse_aim' && p.cameraMode !== 'orbit') {
          flightControlInput = computeInstructorControlInput(
            drone,
            aimStep.targetDir,
            { pitchOverride, rollOverride, yawOverride, throttleDelta },
            { autoLevel: p.settings.controls.instructorAutoLevel },
          );
          if (Math.abs(cyberRollJitter) > 0.01) {
            flightControlInput.rollInput = Math.max(-1, Math.min(1, flightControlInput.rollInput + cyberRollJitter));
          }
        } else {
          flightControlInput = {
            pitchInput: pitchOverride,
            rollInput: rollOverride,
            yawInput: yawOverride,
            throttleDelta,
          };
        }

        let ordnanceMassKg = 0;
        for (let i = 0; i < 4; i++) {
          const w = WEAPONS[p.loadout.slots[i]];
          ordnanceMassKg +=
            w.category === 'cannon'
              ? (slotAmmo[i] > 0 ? w.massKg : 0) + slotAmmo[i] * 0.16
              : w.massKg * slotAmmo[i];
        }

        drone = stepDroneFlight(
          drone,
          flightControlInput,
          {
            theaterId: activeTheaterId,
            weatherId: p.weatherId,
            utcHours: p.utcHours,
            loadout: p.loadout,
            sandbox: p.sandbox,
            ordnanceMassKg,
            elapsedTimeSec: sortieTimeSec,
            flightModel: p.settings.gameplay.flightModel,
            skillBonuses: p.skillBonuses,
            kamikazeArmed,
          },
          dt,
        );

        // Wingtip G-vortex vapor trails during tight dogfight pulls
        wingVortexTimer -= dt;
        if (Math.abs(drone.gLoad) > 2.2 && drone.airspeedMs > 68 && wingVortexTimer <= 0) {
          wingVortexTimer = 0.06;
          const halfSpan = AIRFRAMES[p.loadout.airframeId].wingspanM * 0.42;
          const rightX = Math.cos(drone.yaw) * Math.cos(drone.roll);
          const rightY = Math.sin(drone.roll);
          const rightZ = Math.sin(drone.yaw) * Math.cos(drone.roll);
          for (const side of [-1, 1]) {
            spawnParticleBurst(
              drone.x + rightX * side * halfSpan,
              drone.y + rightY * side * halfSpan,
              drone.z + rightZ * side * halfSpan,
              1,
              2.5,
              0.55,
              0.92,
              0.96,
              1.0,
              0.42,
            );
          }
        }

        audio.updateEngine(drone.throttle, drone.mach, PROPULSION_MODULES[p.loadout.propulsionId].type);

        // Build full battlefield target list for Allied Alpha & Hostile Bravo AI policies
        const aiCandidates: AiTargetCandidate[] = [];
        if (drone.hp > 0) {
          aiCandidates.push({
            id: 'player',
            team: 'alpha',
            x: drone.x,
            y: drone.y,
            z: drone.z,
            vx: drone.vx,
            vy: drone.vy,
            vz: drone.vz,
          });
        }
        for (const b of aiBots) {
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
        for (const lm of landmarks) {
          if (lm.hp <= 0) continue;
          const ly = Math.max(theater.waterLevelM, groundHeightAt(activeTheaterId, lm.x, lm.z)) + 12;
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

        // Step Multi-Policy AI Squadron Bots (BnZ Interceptor, Dogfighter, Striker, Wingmen)
        for (let idx = 0; idx < aiBots.length; idx++) {
          const bot = aiBots[idx];
          const meshHandle = aiMeshes.get(bot.id);
          if (!meshHandle) continue;
          if (bot.hp <= 0) {
            meshHandle.group.visible = false;
            bot.respawnTimer += dt;
            continue;
          }
          meshHandle.group.visible = true;

          const aiCyber = cyberStatus.get(bot.id);
          const compromisedKind = aiCyber && sortieTimeSec < aiCyber.until ? aiCyber.payloadId : null;
          const gnssSpoofed = compromisedKind === 'gnss_spoof';

          let incomingMissileDistM: number | null = null;
          for (const ord of activeOrdnance) {
            if (ord.targetId === bot.id) {
              const d = Math.hypot(ord.x - bot.x, ord.y - bot.y, ord.z - bot.z);
              if (incomingMissileDistM === null || d < incomingMissileDistM) {
                incomingMissileDistM = d;
              }
            }
          }

          const stepRes = stepAiCombatBot(bot, aiCandidates, {
            theaterId: activeTheaterId,
            sortieTimeSec,
            incomingMissileDistM,
            compromisedKind,
            gnssSpoofed,
            dt,
          });
          aiBots[idx] = stepRes.bot;
          const updatedBot = stepRes.bot;

          if (stepRes.wantsFlares) {
            botFlareDecoyUntil.set(updatedBot.id, sortieTimeSec + 3.2);
            const rX = Math.cos(updatedBot.yaw);
            const rZ = -Math.sin(updatedBot.yaw);
            for (const s of [-1, 1]) {
              spawnParticleBurst(
                updatedBot.x + rX * s * 2,
                updatedBot.y - 1,
                updatedBot.z + rZ * s * 2,
                3,
                22,
                0.5,
                1.0,
                0.9,
                0.45,
                1.2,
              );
            }
            if (Math.hypot(drone.x - updatedBot.x, drone.z - updatedBot.z) < 1600) {
              audio.playFlarePop();
            }
          }

          if (stepRes.wantsCannon) {
            const adx = stepRes.aimPoint.x - updatedBot.x;
            const ady = stepRes.aimPoint.y - updatedBot.y;
            const adz = stepRes.aimPoint.z - updatedBot.z;
            const ad = Math.max(1, Math.hypot(adx, ady, adz));
            const spread = 0.018;
            spawnOrdnanceEntity({
              id: `bot-gun-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 5)}`,
              ownerId: updatedBot.id,
              weaponId: 'm61_vulcan',
              x: updatedBot.x + (adx / ad) * 4,
              y: updatedBot.y,
              z: updatedBot.z + (adz / ad) * 4,
              vx: ((adx / ad) + (Math.random() - 0.5) * spread) * 510,
              vy: ((ady / ad) + (Math.random() - 0.5) * spread) * 510,
              vz: ((adz / ad) + (Math.random() - 0.5) * spread) * 510,
              targetId: null,
              targetX: stepRes.aimPoint.x,
              targetY: stepRes.aimPoint.y,
              targetZ: stepRes.aimPoint.z,
            });
          }

          if (stepRes.wantsMissile && stepRes.targetId) {
            const adx = stepRes.aimPoint.x - updatedBot.x;
            const ady = stepRes.aimPoint.y - updatedBot.y;
            const adz = stepRes.aimPoint.z - updatedBot.z;
            const ad = Math.max(1, Math.hypot(adx, ady, adz));
            spawnOrdnanceEntity({
              id: `bot-msl-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 5)}`,
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
          }

          meshHandle.group.position.set(updatedBot.x, updatedBot.y, updatedBot.z);
          _euler.set(updatedBot.pitch, updatedBot.yaw, updatedBot.roll, 'YXZ');
          meshHandle.group.quaternion.setFromEuler(_euler);
          const hitScale = updatedBot.hitFlash > 0 ? 1.07 : 1.0;
          meshHandle.group.scale.setScalar(hitScale);
          for (const prop of meshHandle.propellers) prop.rotation.z += dt * 35;
        }

        // Bot Squadron Reinforcement Waves & Frontline Battle Ticket Bleed
        botReinforceTimer -= dt;
        if (botReinforceTimer <= 0) {
          botReinforceTimer = 14;
          for (const team of ['alpha', 'bravo'] as const) {
            const tickets = team === 'alpha' ? blueTickets : redTickets;
            if (tickets <= 150) continue;
            const fallen = aiBots.find((b) => b.team === team && b.hp <= 0 && b.respawnTimer > 8);
            if (fallen) {
              const rx = (Math.random() - 0.5) * 1400;
              const rz = team === 'alpha' ? 1450 : -2050;
              const ry = Math.max(theater.waterLevelM, groundHeightAt(activeTheaterId, rx, rz)) + 520;
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

        ticketBleedTimer -= dt;
        if (ticketBleedTimer <= 0) {
          ticketBleedTimer = 4.0;
          const destroyedLandmarks = landmarks.filter((l) => l.hp <= 0).length;
          if (destroyedLandmarks > 0) {
            redTickets = Math.max(0, redTickets - destroyedLandmarks * 4);
          }
          const aliveAlpha = aiBots.filter((b) => b.team === 'alpha' && b.hp > 0).length + 1;
          const aliveBravo = aiBots.filter((b) => b.team === 'bravo' && b.hp > 0).length;
          if (aliveBravo > aliveAlpha) {
            blueTickets = Math.max(0, blueTickets - 5);
          }
        }

        // SAM sites & Airbases fire defensive interceptors + AAA flak tracer streams
        aaaBurstCooldown -= dt;
        warSmokeCooldown -= dt;
        if (warSmokeCooldown <= 0) {
          warSmokeCooldown = 0.35;
          for (const lm of landmarks) {
            if (lm.hp > 0 && lm.hp < lm.maxHp * 0.72) {
              const ly = Math.max(theater.waterLevelM, groundHeightAt(activeTheaterId, lm.x, lm.z)) + 14;
              spawnParticleBurst(lm.x, ly, lm.z, 1, 14, 5.2, 0.24, 0.24, 0.26, 2.2);
            }
          }
        }

        for (const lm of landmarks) {
          if (lm.hp <= 0 || (!lm.threatRadiusM && lm.type !== 'airbase')) continue;
          const lmCyber = cyberStatus.get(lm.id);
          if (lmCyber && sortieTimeSec < lmCyber.until) continue;
          const d = Math.hypot(drone.x - lm.x, drone.z - lm.z);
          const threatR = lm.threatRadiusM ?? 1150;

          if (d < threatR * 1.2 && aaaBurstCooldown <= 0) {
            aaaBurstCooldown = 1.45 + Math.random() * 1.1;
            const aaaY = Math.max(theater.waterLevelM, groundHeightAt(activeTheaterId, lm.x, lm.z)) + 10;
            const leadX = drone.x + drone.vx * 0.65 + (Math.random() - 0.5) * 90;
            const leadY = drone.y + drone.vy * 0.65 + (Math.random() - 0.5) * 45;
            const leadZ = drone.z + drone.vz * 0.65 + (Math.random() - 0.5) * 90;
            const dL = Math.max(1, Math.hypot(leadX - lm.x, leadY - aaaY, leadZ - lm.z));
            spawnOrdnanceEntity({
              id: `aaa-${Date.now()}-${lm.id}`,
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
            // Distant flak puff near player
            spawnParticleBurst(leadX, leadY, leadZ, 5, 22, 3.6, 0.28, 0.25, 0.22, 0.85);
            audio.playAntiAirBurst();
          }

          if (lm.type === 'sam' && d < threatR && Math.random() < dt * 0.14) {
            const samY = Math.max(theater.waterLevelM, groundHeightAt(activeTheaterId, lm.x, lm.z)) + 15;
            const baseJammer = p.loadout.sensorId === 'ew_jammer' ? 0.55 : 1.0;
            const jammerFactor = Math.max(0.15, baseJammer - p.skillBonuses.ecmSuppressionBonus);
            if (Math.random() < jammerFactor) {
              spawnOrdnanceEntity({
                id: `sam-${Date.now()}-${lm.id}`,
                ownerId: lm.id,
                weaponId: 'aim9x_sidewinder',
                x: lm.x,
                y: samY,
                z: lm.z,
                vx: (drone.x - lm.x) * 0.12,
                vy: 95,
                vz: (drone.z - lm.z) * 0.12,
                targetId: 'player',
                targetX: drone.x,
                targetY: drone.y,
                targetZ: drone.z,
              });
            }
          }
        }

        // Step active ordnance & evaluate collisions
        for (let i = activeOrdnance.length - 1; i >= 0; i--) {
          const ord = activeOrdnance[i];
          const spec = WEAPONS[ord.weaponId];

          let liveTargetPos: { x: number; y: number; z: number } | null = null;
          if (ord.targetId === 'player') {
            const spoofed = sortieTimeSec < playerGnssSpoofUntil;
            const flareDecoyed = sortieTimeSec < playerFlaresActiveUntil;
            liveTargetPos =
              spoofed || flareDecoyed
                ? {
                    x: drone.x + Math.sin(sortieTimeSec * 4.5) * 260,
                    y: drone.y - (flareDecoyed ? 85 : -55),
                    z: drone.z + Math.cos(sortieTimeSec * 4.5) * 260,
                  }
                : { x: drone.x, y: drone.y, z: drone.z };
          } else if (ord.targetId) {
            const ai = aiBots.find((a) => a.id === ord.targetId && a.hp > 0);
            if (ai) {
              const decoyed = spec.category === 'aam' && sortieTimeSec < (botFlareDecoyUntil.get(ai.id) ?? 0);
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
              theaterId: activeTheaterId,
              weatherId: p.weatherId,
              sandbox: p.sandbox,
              targetPos: liveTargetPos,
              skillBonuses: p.skillBonuses,
            },
            dt,
          );
          activeOrdnance[i] = updated;

          const mesh = ordnanceMeshes.get(updated.id);
          if (mesh) {
            mesh.position.set(updated.x, updated.y, updated.z);
            _vec3A.set(updated.x + updated.vx, updated.y + updated.vy, updated.z + updated.vz);
            mesh.lookAt(_vec3A);
            const wings = mesh.getObjectByName('deployWings');
            if (wings) {
              wings.scale.x = updated.wingDeployed ? 1 : 0.15;
            }
          }

          // Smoke contrail for missiles
          if (spec.category !== 'cannon' && Math.random() < 0.65) {
            spawnParticleBurst(updated.x, updated.y, updated.z, 1, 4, spec.category === 'ballistic_missile' ? 3.2 : 1.6, 0.85, 0.88, 0.92, 0.6);
          }

          let exploded = false;
          const groundY = Math.max(theater.waterLevelM, groundHeightAt(activeTheaterId, updated.x, updated.z));
          const ownerIsAlpha = updated.ownerId === 'player' || updated.ownerId.startsWith('ally-');
          const effBlastRadius =
            spec.blastRadiusM * (updated.ownerId === 'player' ? p.skillBonuses.blastRadiusMult : 1);
          const effDamage =
            spec.damage * (updated.ownerId === 'player' ? p.skillBonuses.damageMult : 1);

          // Hostile ordnance hits on Player & Allied Wingmen
          if (!ownerIsAlpha) {
            const dPlayer = Math.hypot(updated.x - drone.x, updated.y - drone.y, updated.z - drone.z);
            const hitRadius = spec.category === 'cannon' ? 14 : 24;
            if (dPlayer < hitRadius) {
              const dmg = spec.category === 'cannon' ? 6 : 22;
              drone.hp = Math.max(0, drone.hp - dmg);
              trauma = Math.min(1, trauma + (spec.category === 'cannon' ? 0.25 : 0.6));
              if (spec.category !== 'cannon') hitstopTimer = 0.04;
              audio.playExplosion(spec.category === 'cannon' ? 0.55 : 1.1);
              spawnParticleBurst(updated.x, updated.y, updated.z, spec.category === 'cannon' ? 8 : 18, 45, 3.2, 1, 0.45, 0.12, 0.7);
              if (spec.category !== 'cannon') {
                emitAar('damage', 'Interceptor Impact', `Hostile missile hit hull (${Math.round(drone.hp)}/${drone.maxHp} HP)`);
              }
              exploded = true;
            } else {
              for (const ally of aiBots) {
                if (ally.team !== 'alpha' || ally.hp <= 0) continue;
                const dAlly = Math.hypot(updated.x - ally.x, updated.y - ally.y, updated.z - ally.z);
                if (dAlly < 18) {
                  ally.hp = Math.max(0, ally.hp - (spec.category === 'cannon' ? 9 : 45));
                  ally.hitFlash = 0.2;
                  spawnParticleBurst(updated.x, updated.y, updated.z, 10, 35, 3.0, 1, 0.5, 0.15, 0.7);
                  if (ally.hp === 0) {
                    blueTickets = Math.max(0, blueTickets - 65);
                    spawnShockwave(ally.x, ally.y, ally.z, 1.1);
                  }
                  exploded = true;
                  break;
                }
              }
            }
          } else {
            // Allied & Player ordnance vs Hostile Bravo Bots
            for (const ai of aiBots) {
              if (ai.team !== 'bravo' || ai.hp <= 0) continue;
              const dAi = Math.hypot(updated.x - ai.x, updated.y - ai.y, updated.z - ai.z);
              const airProx = spec.category === 'cannon' ? 17 : Math.max(24, effBlastRadius * 0.65);
              if (dAi < airProx) {
                const dmg = spec.category === 'cannon' ? 18 : effDamage;
                ai.hp = Math.max(0, ai.hp - dmg);
                ai.hitFlash = 0.25;
                if (ai.hp === 0) {
                  spawnShockwave(updated.x, updated.y, updated.z, 1.2);
                  spawnParticleBurst(updated.x, updated.y, updated.z, 24, 65, 5.0, 1, 0.52, 0.1, 1.1);
                  audio.playExplosion(1.25);
                  redTickets = Math.max(0, redTickets - 65);
                  if (updated.ownerId === 'player') {
                    score += 250;
                    trauma = Math.min(1, trauma + 0.45);
                    hitstopTimer = 0.045;
                    audio.playHitMarker(true);
                    combatHitCallout = 'AIRCRAFT DESTROYED +250';
                    combatHitUntil = sortieTimeSec + 2.1;
                    p.onAirKill({ victimName: ai.callsign, points: 250, weaponId: updated.weaponId });
                    emitAar('air_kill', `Air Kill: ${ai.callsign}`, `${spec.natoCode} shot down hostile UAV (+250 pts)`);
                  }
                } else {
                  spawnParticleBurst(updated.x, updated.y, updated.z, 8, 32, 2.2, 1, 0.65, 0.18, 0.45);
                  if (updated.ownerId === 'player') {
                    score += 15;
                    audio.playHitMarker(false);
                    combatHitCallout = spec.category === 'cannon' ? 'HIT! +15' : 'CRITICAL HIT!';
                    combatHitUntil = sortieTimeSec + 1.1;
                  }
                }
                exploded = true;
                break;
              }
            }
          }

          // Check terrain / ground landmark impact
          if (!exploded && updated.y <= groundY + 4) {
            exploded = true;
            const isHeavy = spec.category === 'ballistic_missile' || spec.category === 'cruise_missile' || spec.category === 'glide_bomb' || spec.category === 'drop_bomb';
            if (isHeavy) {
              spawnShockwave(updated.x, groundY + 2, updated.z, spec.category === 'ballistic_missile' ? 2.1 : 1.25);
            }
            spawnParticleBurst(
              updated.x,
              groundY + 4,
              updated.z,
              isHeavy ? 30 : 10,
              isHeavy ? 78 : 28,
              isHeavy ? 6.8 : 2.5,
              1,
              0.48,
              0.12,
              isHeavy ? 1.25 : 0.55,
            );
            audio.playExplosion(isHeavy ? 1.55 : 0.65);
            if (isHeavy && updated.ownerId === 'player') {
              trauma = Math.min(1, trauma + 0.44);
              hitstopTimer = 0.04;
            }

            if (ownerIsAlpha) {
              for (const lm of landmarks) {
                if (lm.hp <= 0) continue;
                const dHoriz = Math.hypot(updated.x - lm.x, updated.z - lm.z);
                if (dHoriz <= effBlastRadius) {
                  const falloff = 1 - (dHoriz / effBlastRadius) * 0.4;
                  const mult = updated.ownerId === 'player' ? 1 : 0.35;
                  lm.hp = Math.max(0, lm.hp - effDamage * falloff * mult);
                  if (lm.hp === 0) {
                    const lmMesh = landmarkMeshes.get(lm.id);
                    if (lmMesh) lmMesh.visible = false;
                    redTickets = Math.max(0, redTickets - 120);
                    const cep = Math.round(dHoriz * 10) / 10;
                    if (updated.ownerId === 'player') {
                      bestCep = bestCep === null ? cep : Math.min(bestCep, cep);
                      score += lm.points;
                      audio.playHitMarker(true);
                      combatHitCallout = `TARGET DESTROYED +${lm.points}`;
                      combatHitUntil = sortieTimeSec + 2.1;
                      p.onTargetDestroyed({
                        targetId: lm.id,
                        name: lm.name,
                        points: lm.points,
                        cepMeters: cep,
                        weaponId: updated.weaponId,
                      });
                      emitAar('strike', `Destroyed ${lm.name}`, `${spec.natoCode} direct hit · CEP ${cep}m (+${lm.points} pts)`);
                    }
                  } else if (updated.ownerId === 'player') {
                    audio.playHitMarker(false);
                    combatHitCallout = 'GROUND HIT! +20';
                    combatHitUntil = sortieTimeSec + 1.0;
                    score += 20;
                  }
                }
              }
            }
          }

          if (exploded || updated.ageSec >= updated.maxLifetimeSec) {
            if (mesh) {
              scene.remove(mesh);
              ordnanceMeshes.delete(updated.id);
            }
            activeOrdnance.splice(i, 1);
          }
        }

        // Kamikaze / Terminal Ram Check (Almost every drone can dive-detonate directly into ground/air targets)
        const afSpec = AIRFRAMES[p.loadout.airframeId];
        if (afSpec.kamikazeCapable && !gameOverTriggered) {
          let kamikazeTriggered = false;

          // 1. Mid-air ram into hostile AI drone
          for (const ai of aiBots) {
            if (ai.team !== 'bravo' || ai.hp <= 0) continue;
            const dAi = Math.hypot(drone.x - ai.x, drone.y - ai.y, drone.z - ai.z);
            if (dAi < (kamikazeArmed ? 34 : 18)) {
              detonateDroneAsKamikaze(ai.x, ai.y, ai.z, `${afSpec.name} Mid-Air Kamikaze`);
              kamikazeTriggered = true;
              break;
            }
          }

          // 2. Terminal dive into ground base / SAM / radar / bunker / depot / convoy
          if (!kamikazeTriggered) {
            for (const lm of landmarks) {
              if (lm.hp <= 0) continue;
              const ly = Math.max(theater.waterLevelM, groundHeightAt(activeTheaterId, lm.x, lm.z));
              const dHoriz = Math.hypot(drone.x - lm.x, drone.z - lm.z);
              const diveHitRadius = kamikazeArmed ? 52 : 28;
              if (dHoriz < diveHitRadius && drone.y <= ly + (kamikazeArmed ? 46 : 24)) {
                detonateDroneAsKamikaze(lm.x, ly + 4, lm.z, `${afSpec.name} Kamikaze Impact`);
                kamikazeTriggered = true;
                break;
              }
            }
          }

          // 3. Armed dive hits ground anywhere -> airframe warhead detonates at point of impact
          if (!kamikazeTriggered && kamikazeArmed && drone.aglMeters <= 2.2) {
            const gY = Math.max(theater.waterLevelM, groundHeightAt(activeTheaterId, drone.x, drone.z));
            detonateDroneAsKamikaze(drone.x, gY + 2, drone.z, `${afSpec.name} Surface Impact`);
          }
        }

        // Handle hull loss with squadron reserves before defeat
        if (!gameOverTriggered && drone.hp <= 0 && reserveDrones > 1) {
          spawnShockwave(drone.x, drone.y, drone.z, 1.4);
          spawnParticleBurst(drone.x, drone.y, drone.z, 28, 65, 5.5, 1, 0.45, 0.1, 1.1);
          audio.playExplosion(1.4);
          reserveDrones -= 1;
          blueTickets = Math.max(0, blueTickets - 120);
          kamikazeArmed = false;
          drone = createInitialDrone(theater.id);
          aimYaw = drone.yaw;
          aimPitch = drone.pitch;
          emitAar('damage', 'Airframe Shot Down', `Redeploying reserve drone (${reserveDrones}/3 remaining)`);
        }

        // Victory / Defeat Check (Battle Tickets or Full Objective Clearance)
        const aliveLandmarks = landmarks.filter((l) => l.hp > 0).length;
        if (!gameOverTriggered && (drone.hp <= 0 || aliveLandmarks === 0 || redTickets <= 0 || blueTickets <= 0)) {
          gameOverTriggered = true;
          const victory = aliveLandmarks === 0 || redTickets <= 0;
          emitAar(
            'end',
            victory ? 'Objectives Neutralized' : 'Squadron Depleted',
            `Score ${score} · ${landmarks.length - aliveLandmarks}/${landmarks.length} targets · Tickets ${blueTickets}/${redTickets}`,
          );
          p.onGameOver(victory, {
            score,
            targetsDestroyed: landmarks.length - aliveLandmarks,
            totalTargets: landmarks.length,
            bestCep,
          });
        }
      }

      // Sync Player Drone Mesh Transform
      playerMeshHandle.group.position.set(drone.x, drone.y, drone.z);
      _euler.set(drone.pitch, drone.yaw, drone.roll, 'YXZ');
      playerMeshHandle.group.quaternion.setFromEuler(_euler);
      for (const prop of playerMeshHandle.propellers) {
        prop.rotation.z += dt * (18 + drone.throttle * 38);
      }
      for (const glow of playerMeshHandle.exhaustGlows) {
        glow.scale.setScalar(0.7 + drone.throttle * 0.6);
      }

      // Sync Remote Multiplayer Drones
      const activeRemoteIds = new Set<string>();
      for (const rp of p.remotePilots) {
        activeRemoteIds.add(rp.id);
        let handle = remoteMeshes.get(rp.id);
        if (!handle) {
          handle = buildDroneMesh(rp.airframeId, rp.team === 'alpha' ? 0x06b6d4 : 0xec4899);
          scene.add(handle.group);
          remoteMeshes.set(rp.id, handle);
        }
        handle.group.position.set(rp.x, rp.y, rp.z);
        _euler.set(rp.pitch, rp.yaw, rp.roll, 'YXZ');
        handle.group.quaternion.setFromEuler(_euler);
        for (const prop of handle.propellers) prop.rotation.z += dt * 32;
      }
      for (const [id, handle] of remoteMeshes.entries()) {
        if (!activeRemoteIds.has(id)) {
          scene.remove(handle.group);
          remoteMeshes.delete(id);
        }
      }

      // Step Shockwave Rings, Fireballs & Flash PointLights
      for (let i = 0; i < SHOCKWAVE_POOL_SIZE; i++) {
        const sw = shockwaves[i];
        if (!sw.active) continue;
        sw.age += dt;
        if (sw.age >= sw.life) {
          sw.active = false;
          sw.ring.visible = false;
          sw.core.visible = false;
          continue;
        }
        const t = sw.age / sw.life;
        const sc = 1 + t * sw.maxScale;
        sw.ring.scale.setScalar(sc);
        (sw.ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, (1 - t) * 0.85);
        sw.core.scale.setScalar(1 + t * sw.maxScale * 0.42);
        (sw.core.material as THREE.MeshBasicMaterial).opacity = Math.max(0, (1 - t * 1.45) * 0.9);
      }
      for (const fl of flashLights) {
        if (fl.intensity > 1) fl.intensity *= Math.exp(-9.5 * dt);
        else fl.intensity = 0;
      }

      // Update Pooled Explosion/Smoke Particles
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const pt = particles[i];
        if (!pt.active) {
          _vec3A.set(0, -9999, 0);
          _scaleVec.setScalar(0.001);
          _quat.identity();
          _mat4.compose(_vec3A, _quat, _scaleVec);
          particleMesh.setMatrixAt(i, _mat4);
          continue;
        }
        pt.age += dt;
        if (pt.age >= pt.life) {
          pt.active = false;
          continue;
        }
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
        pt.z += pt.vz * dt;
        pt.vy -= 12 * dt;
        const lifeRatio = 1 - pt.age / pt.life;
        _vec3A.set(pt.x, pt.y, pt.z);
        _scaleVec.setScalar(pt.size * (0.4 + lifeRatio * 0.9));
        _quat.identity();
        _mat4.compose(_vec3A, _quat, _scaleVec);
        particleMesh.setMatrixAt(i, _mat4);
        _color.setRGB(pt.r * lifeRatio, pt.g * lifeRatio, pt.b * lifeRatio);
        particleMesh.setColorAt(i, _color);
      }
      particleMesh.instanceMatrix.needsUpdate = true;
      if (particleMesh.instanceColor) particleMesh.instanceColor.needsUpdate = true;

      // Update Pooled 3D EW Cyber Disruption Wireframe Spheres
      let ewCursor = 0;
      for (const [tid, st] of cyberStatus.entries()) {
        if (sortieTimeSec >= st.until || ewCursor >= EW_POOL_SIZE) continue;
        const lm = landmarks.find((l) => l.id === tid && l.hp > 0);
        const ai = aiBots.find((a) => a.id === tid && a.hp > 0);
        const rp = p.remotePilots.find((r) => r.id === tid && r.hp > 0);
        const sphere = ewSpheres[ewCursor];
        if (lm) {
          const ly = Math.max(theater.waterLevelM, groundHeightAt(activeTheaterId, lm.x, lm.z)) + 16;
          sphere.position.set(lm.x, ly, lm.z);
          sphere.scale.setScalar(1.35 + Math.sin(sortieTimeSec * 4) * 0.08);
          sphere.rotation.y += dt * 1.8;
          sphere.visible = true;
          ewCursor++;
        } else if (ai) {
          sphere.position.set(ai.x, ai.y, ai.z);
          sphere.scale.setScalar(0.55 + Math.sin(sortieTimeSec * 5) * 0.06);
          sphere.rotation.y += dt * 2.4;
          sphere.visible = true;
          ewCursor++;
        } else if (rp) {
          sphere.position.set(rp.x, rp.y, rp.z);
          sphere.scale.setScalar(0.55 + Math.sin(sortieTimeSec * 5) * 0.06);
          sphere.rotation.y += dt * 2.4;
          sphere.visible = true;
          ewCursor++;
        }
      }
      for (let i = ewCursor; i < EW_POOL_SIZE; i++) {
        ewSpheres[i].visible = false;
      }

      // Update Predicted Ballistic / Glide Bomb 3D Trajectory Arc
      const tgt = getLockedTargetPos();
      targetMarker.visible = p.phase === 'playing' && tgt.id !== null;
      targetMarker.position.set(tgt.x, tgt.y + 3, tgt.z);
      targetMarker.rotation.z += dt * 1.4;

      const selectedWeaponId = p.loadout.slots[activeSlot];
      const prediction = predictOrdnanceTrajectory(
        drone,
        selectedWeaponId,
        { x: tgt.x, y: tgt.y, z: tgt.z },
        {
          theaterId: activeTheaterId,
          weatherId: p.weatherId,
          sandbox: p.sandbox,
          skillBonuses: p.skillBonuses,
        },
      );

      if (p.phase === 'playing' && prediction.points.length > 1) {
        arcLine.visible = true;
        impactRing.visible = true;
        const posAttr = arcGeo.attributes.position as THREE.BufferAttribute;
        const count = Math.min(maxArcPts, prediction.points.length);
        for (let i = 0; i < maxArcPts; i++) {
          const pt = prediction.points[Math.min(i, count - 1)];
          posAttr.setXYZ(i, pt.x, pt.y, pt.z);
        }
        posAttr.needsUpdate = true;
        arcGeo.setDrawRange(0, count);
        arcMat.color.setHex(
          WEAPONS[selectedWeaponId].category === 'ballistic_missile'
            ? 0xf59e0b
            : WEAPONS[selectedWeaponId].category === 'glide_bomb'
              ? 0x06b6d4
              : 0x38bdf8,
        );
        impactRing.position.set(prediction.impactX, prediction.impactY + 4, prediction.impactZ);
      } else {
        arcLine.visible = false;
        impactRing.visible = false;
      }

      // Camera Choreography (including War Thunder Hold-C Free-Look & Bank Tilt)
      const freeLooking = p.phase === 'playing' && keys.has('KeyC') && p.cameraMode === 'chase';
      if (!freeLooking) {
        const recov = 1 - Math.exp(-16 * dt);
        freeLookYawOffset *= 1 - recov;
        freeLookPitchOffset *= 1 - recov;
      }

      if (p.phase === 'title') {
        camera.up.set(0, 1, 0);
        const t = performance.now() * 0.00028;
        const camX = drone.x + Math.cos(t) * 34;
        const camY = drone.y + 11 + Math.sin(t * 1.6) * 4;
        const camZ = drone.z + Math.sin(t) * 34;
        camera.position.set(camX, camY, camZ);
        camera.lookAt(drone.x, drone.y + 1, drone.z - 12);
      } else if (p.cameraMode === 'eoir') {
        camera.up.set(0, 1, 0);
        const cosP = Math.cos(drone.pitch);
        const fwdX = -Math.sin(drone.yaw) * cosP;
        const fwdY = Math.sin(drone.pitch);
        const fwdZ = -Math.cos(drone.yaw) * cosP;
        camera.position.set(drone.x + fwdX * 2.5, drone.y - 1.1, drone.z + fwdZ * 2.5);
        _vec3B.set(tgt.x, tgt.y, tgt.z);
        _vec3C.set(drone.x + fwdX * 400, drone.y + fwdY * 400, drone.z + fwdZ * 400);
        _vec3B.lerp(_vec3C, 0.35);
        camera.lookAt(_vec3B);
      } else if (p.cameraMode === 'orbit') {
        camera.up.set(0, 1, 0);
        orbitYawOffset += dt * 0.35;
        const ox = drone.x + Math.sin(drone.yaw + orbitYawOffset) * 26;
        const oz = drone.z + Math.cos(drone.yaw + orbitYawOffset) * 26;
        camera.position.set(ox, drone.y + 8, oz);
        camera.lookAt(drone.x, drone.y, drone.z);
      } else {
        // War Thunder spring chase camera: wing-lag follow + subtle horizon bank + C Free-Look
        const dampK = 1 - Math.exp(-8.2 * dt);
        const distBack = 23 + drone.mach * 10;
        const viewYaw = aimYaw + freeLookYawOffset;
        const viewPitch = Math.max(-0.85, Math.min(0.95, aimPitch * 0.48 + freeLookPitchOffset));

        const desiredX = drone.x + Math.sin(viewYaw) * distBack * Math.cos(viewPitch * 0.5);
        const desiredY = drone.y + 7.2 + Math.sin(viewPitch) * distBack * 0.72;
        const desiredZ = drone.z + Math.cos(viewYaw) * distBack * Math.cos(viewPitch * 0.5);
        _vec3A.set(desiredX, desiredY, desiredZ);
        camera.position.lerp(_vec3A, freeLooking ? 0.45 : dampK);

        const lookFwdDist = freeLooking ? 12 : 48;
        const lookAheadX = drone.x - Math.sin(viewYaw) * lookFwdDist;
        const lookAheadY = drone.y + 1.5 - Math.sin(viewPitch) * (freeLooking ? 8 : 20);
        const lookAheadZ = drone.z - Math.cos(viewYaw) * lookFwdDist;

        const camBank = freeLooking ? 0 : -drone.roll * 0.14;
        camera.up.set(Math.sin(camBank), Math.cos(camBank), 0);
        camera.lookAt(lookAheadX, lookAheadY, lookAheadZ);

        // Dynamic FOV widening with speed + Sniper Target Zoom (RMB / Z)
        const isZoomed = zoomHeld || zoomToggled;
        const baseFov = p.settings.graphics.fovDeg;
        const targetFov = isZoomed ? 30 : baseFov + Math.min(18, drone.mach * 12);
        if (Math.abs(camera.fov - targetFov) > 0.1) {
          camera.fov += (targetFov - camera.fov) * dampK;
          camera.updateProjectionMatrix();
        }
      }

      if (trauma > 0) {
        const shake = trauma * trauma * 1.4;
        camera.position.x += (Math.random() - 0.5) * shake;
        camera.position.y += (Math.random() - 0.5) * shake;
        trauma = Math.max(0, trauma - dt * 1.8);
      }

      // Throttled HUD updates (<= 10 Hz) & WebSocket position broadcast (15 Hz)
      hudEmitAccum += dt;
      if (hudEmitAccum >= 0.1) {
        hudEmitAccum = 0;
        const atmos = computeAtmosphericGravity(
          theater.latDeg,
          drone.y + theater.baseElevationM,
          drone.vx,
          drone.vz,
          p.sandbox.enabled ? p.sandbox.gravityMultiplier : 1.0,
          p.sandbox.enabled ? p.sandbox.airDensityMultiplier : 1.0,
        );
        const headingDeg = (((-drone.yaw * 180) / Math.PI) % 360 + 360) % 360;
        const targetDist = Math.hypot(tgt.x - drone.x, tgt.y - drone.y, tgt.z - drone.z);
        const cepM = Math.hypot(prediction.impactX - tgt.x, prediction.impactZ - tgt.z);
        const aliveCount = landmarks.filter((l) => l.hp > 0).length;

        const radarLocked = landmarks.some(
          (l) =>
            l.hp > 0 &&
            l.type === 'sam' &&
            l.threatRadiusM &&
            !(cyberStatus.get(l.id) && sortieTimeSec < (cyberStatus.get(l.id)?.until ?? 0)) &&
            Math.hypot(drone.x - l.x, drone.z - l.z) < l.threatRadiusM,
        );

        camera.getWorldDirection(_vec3B);
        const projectPct = (wx: number, wy: number, wz: number): { x: number; y: number } | null => {
          _vec3C.set(wx - camera.position.x, wy - camera.position.y, wz - camera.position.z);
          if (_vec3C.dot(_vec3B) <= 1) return null;
          _vec3A.set(wx, wy, wz).project(camera);
          if (_vec3A.z < -1 || _vec3A.z > 1) return null;
          return {
            x: Math.max(3, Math.min(97, (_vec3A.x * 0.5 + 0.5) * 100)),
            y: Math.max(4, Math.min(96, (-_vec3A.y * 0.5 + 0.5) * 100)),
          };
        };

        const projectInViewPct = (wx: number, wy: number, wz: number): { x: number; y: number } | null => {
          _vec3C.set(wx - camera.position.x, wy - camera.position.y, wz - camera.position.z);
          if (_vec3C.dot(_vec3B) <= 1) return null;
          _vec3A.set(wx, wy, wz).project(camera);
          if (_vec3A.z < -1 || _vec3A.z > 1) return null;
          if (Math.abs(_vec3A.x) > 0.9 || _vec3A.y > 0.72 || _vec3A.y < -0.74) return null;
          return {
            x: (_vec3A.x * 0.5 + 0.5) * 100,
            y: (-_vec3A.y * 0.5 + 0.5) * 100,
          };
        };

        const cosP = Math.cos(drone.pitch);
        const noseScreen = projectPct(
          drone.x - Math.sin(drone.yaw) * cosP * 320,
          drone.y + Math.sin(drone.pitch) * 320,
          drone.z - Math.cos(drone.yaw) * cosP * 320,
        ) ?? { x: 50, y: 50 };

        // Project 3D War Thunder aim circle from spherical aimYaw / aimPitch
        const cosAimP = Math.cos(aimPitch);
        const projectedAim = projectPct(
          drone.x - Math.sin(aimYaw) * cosAimP * 320,
          drone.y + Math.sin(aimPitch) * 320,
          drone.z - Math.cos(aimYaw) * cosAimP * 320,
        );
        const effMouseY = p.settings.controls.invertY ? -mouseNdcY : mouseNdcY;
        const mouseAimX = projectedAim ? projectedAim.x : Math.max(5, Math.min(95, (mouseNdcX * 0.5 + 0.5) * 100));
        const mouseAimY = projectedAim ? projectedAim.y : Math.max(5, Math.min(95, (-effMouseY * 0.5 + 0.5) * 100));

        const targetScreen = tgt.id ? projectInViewPct(tgt.x, tgt.y, tgt.z) : null;

        let leadScreen: { x: number; y: number } | null = null;
        if (p.settings.gameplay.showLeadIndicator && tgt.kind === 'drone' && tgt.id) {
          const ai = aiBots.find((a) => a.id === tgt.id && a.hp > 0);
          const rp = p.remotePilots.find((r) => r.id === tgt.id && r.hp > 0);
          const tvx = ai ? ai.vx : rp ? rp.vx : 0;
          const tvy = ai ? ai.vy : rp ? rp.vy : 0;
          const tvz = ai ? ai.vz : rp ? rp.vz : 0;
          const projSpeed = WEAPONS[selectedWeaponId].initialSpeedMs + 210;
          const leadPt = computeLeadPoint(
            { x: drone.x, y: drone.y, z: drone.z },
            { x: tgt.x, y: tgt.y, z: tgt.z },
            { vx: tvx, vy: tvy, vz: tvz },
            projSpeed,
          );
          leadScreen = projectInViewPct(leadPt.x, leadPt.y, leadPt.z);
        }

        // Project all live Allied & Hostile AI Squadron bots strictly within safe viewport bounds
        const projSpeedForContacts = WEAPONS[selectedWeaponId].initialSpeedMs + 210;
        const airContacts: AirContactHud[] = [];
        for (const bot of aiBots) {
          if (bot.hp <= 0) continue;
          const scr = projectInViewPct(bot.x, bot.y, bot.z);
          if (!scr) continue;
          const distM = Math.round(Math.hypot(bot.x - drone.x, bot.y - drone.y, bot.z - drone.z));
          let leadX: number | null = null;
          let leadY: number | null = null;
          if (bot.team === 'bravo' && p.settings.gameplay.showLeadIndicator && distM < 2600) {
            const lp = computeLeadPoint(
              { x: drone.x, y: drone.y, z: drone.z },
              { x: bot.x, y: bot.y, z: bot.z },
              { vx: bot.vx, vy: bot.vy, vz: bot.vz },
              projSpeedForContacts,
            );
            const lScr = projectInViewPct(lp.x, lp.y, lp.z);
            if (lScr) {
              leadX = lScr.x;
              leadY = lScr.y;
            }
          }
          airContacts.push({
            id: bot.id,
            callsign: bot.callsign,
            team: bot.team,
            role: bot.role,
            screenX: scr.x,
            screenY: scr.y,
            distM,
            hpPct: Math.round((bot.hp / bot.maxHp) * 100),
            locked: bot.id === tgt.id,
            leadX,
            leadY,
          });
        }

        p.onHudUpdate({
          airspeedKnots: Math.round(drone.airspeedMs * 1.94384),
          mach: Number(drone.mach.toFixed(2)),
          altitudeMsl: Math.round(drone.y + theater.baseElevationM),
          altitudeAgl: Math.round(drone.aglMeters),
          headingDeg: Math.round(headingDeg),
          pitchDeg: Math.round((drone.pitch * 180) / Math.PI),
          rollDeg: Math.round((drone.roll * 180) / Math.PI),
          gLoad: Number(drone.gLoad.toFixed(1)),
          throttlePct: Math.round(drone.throttle * 100),
          hp: Math.round(drone.hp),
          maxHp: drone.maxHp,
          fuelPct: Math.round((drone.fuelKg / Math.max(1, drone.maxFuelKg)) * 100),
          stalling: drone.stalling,
          activeSlot,
          slotAmmo: [...slotAmmo] as [number, number, number, number],
          slotCooldowns: slotCooldowns.map((c) => Number(c.toFixed(1))) as [number, number, number, number],
          lockedTargetId: tgt.id,
          lockedTargetKind: tgt.kind,
          lockedTargetName: tgt.name,
          lockedTargetDistM: Math.round(targetDist),
          lockedTargetHpPct: tgt.hpPct !== null ? Math.round(tgt.hpPct) : null,
          lockedTargetCompromisedSec: Math.max(
            0,
            Math.ceil((cyberStatus.get(tgt.id ?? '')?.until ?? 0) - sortieTimeSec),
          ),
          incomingCyberThreat: incomingThreat
            ? `${incomingThreat.sourceName} (${Math.max(0, incomingThreat.remainingSec).toFixed(1)}s)`
            : null,
          playerCyberDisruptedSec: Math.max(0, Math.ceil(playerDisruptedUntil - sortieTimeSec)),
          cyberCooldownSec: Number(cyberCooldownSec.toFixed(1)),
          predictedCepM: Math.round(cepM),
          predictedApogeeM: Math.round(prediction.apogeeM + theater.baseElevationM),
          score,
          targetsDestroyed: landmarks.length - aliveCount,
          totalTargets: landmarks.length,
          localGravityMs2: Number(atmos.localGravityMs2.toFixed(3)),
          solarElevationDeg: Math.round(solar.elevationDeg),
          solarChargeW: Math.round(drone.solarChargeRateW),
          windSpeedKnots: Math.round(weather.windSpeedMs * 1.94384),
          sortieTimeSec: Math.round(sortieTimeSec),
          missilesIncoming: activeOrdnance.filter(
            (o) => o.ownerId !== 'player' && !o.ownerId.startsWith('ally-'),
          ).length,
          radarLocked,
          flaresRemaining,
          flareCooldownSec: Number(flareCooldownSec.toFixed(1)),
          mouseAimScreenX: mouseAimX,
          mouseAimScreenY: mouseAimY,
          noseScreenX: noseScreen.x,
          noseScreenY: noseScreen.y,
          targetScreenX: targetScreen ? targetScreen.x : null,
          targetScreenY: targetScreen ? targetScreen.y : null,
          leadScreenX: leadScreen ? leadScreen.x : null,
          leadScreenY: leadScreen ? leadScreen.y : null,
          zoomed: zoomHeld || zoomToggled,
          wepActive: drone.throttle > 1.0,
          kamikazeArmed,
          kamikazeCapable: AIRFRAMES[p.loadout.airframeId].kamikazeCapable,
          reserveDrones,
          blueTickets,
          redTickets,
          freeLooking,
          combatHitCallout,
          airContacts,
        });
      }

      broadcastAccum += dt;
      if (p.phase === 'playing' && broadcastAccum >= 0.08) {
        broadcastAccum = 0;
        p.onPlayerStateBroadcast(drone, sortieTimeSec);
      }

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    if (isSoftwareGl) {
      if (propsRef.current.phase === 'title') {
        camera.position.set(drone.x + 34, drone.y + 11, drone.z);
        camera.lookAt(drone.x, drone.y + 1, drone.z - 12);
      } else {
        camera.position.set(drone.x, drone.y + 7.5, drone.z + 24);
        camera.lookAt(drone.x, drone.y, drone.z - 45);
      }
      renderer.render(scene, camera);
      afterDraw(tick);
    } else {
      frameId = requestAnimationFrame(tick);
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', clearInputs);
      document.removeEventListener('visibilitychange', clearInputs);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('pointerup', handleCanvasPointerUp);
      renderer.domElement.removeEventListener('pointerdown', handleCanvasPointerDown);
      renderer.domElement.removeEventListener('pointermove', handleCanvasPointerMove);
      renderer.domElement.removeEventListener('wheel', handleCanvasWheel);
      renderer.domElement.removeEventListener('contextmenu', handleContextMenu);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      audio.dispose();
      renderer.dispose();
    };
  }, []);

  if (webglUnavailable) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-slate-950 text-slate-200 p-8">
        <div className="max-w-md text-center space-y-3">
          <h2 className="font-display text-2xl font-bold">3D Tactical Viewport Unavailable</h2>
          <p className="text-sm text-slate-400">
            WebGL hardware or software rendering could not be initialized in this browser context.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={mountRef}
      data-testid="flight-viewport"
      className="fixed inset-0 w-full h-full bg-[#080c10]"
    />
  );
};
