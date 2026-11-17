import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { AIRFRAMES, WEAPONS } from '../sim/arsenalData';
import { AarEventType } from '../sim/aarLogger';
import { computeLeadPoint, aimAnglesToDirection, clampAimPitchRad, wrapAngleRad } from '../sim/flightPhysics';
import { groundHeightAt } from '../sim/geoTheaters';
import {
  clearMousePendingDeltas,
  consumeMouseFrameInput,
  createMouseInputState,
  handleMouseFocusLoss,
  handleMousePointerEnter,
  handleMousePointerLeave,
  handleMousePointerLockChange,
  handleMousePointerLockError,
  handleMousePointerMove,
  PointerRoute,
} from '../sim/mouseAimInput';
import { GameSettings } from '../sim/settings';
import { SimEvent, SimWorld, SimWorldConfig } from '../sim/core/simWorld';
import {
  AirContactHud,
  CameraMode,
  CyberPayloadId,
  DroneFlightState,
  GamePhase,
  GunFireMode,
  HudSnapshot,
  LoadoutConfig,
  PilotSkillBonuses,
  RemotePilotState,
  SandboxConfig,
  TheaterId,
  WeaponId,
  WeatherId,
} from '../sim/types';
import { STAGE_A_PATHS } from '../assets/assetManifest';
import { CyberTargetOption } from '../components/CyberWarfareModal';
import { sharedAssetPipeline } from './assetPipeline';
import { TacticalAudioSynth } from './audioSynth';
import { buildDroneMesh, buildOrdnanceMesh, buildTargetStructure, DroneMeshHandle } from './droneModels';
import { buildTheaterTerrain } from './terrainEngine';

export interface SimCommandBridge {
  resetSortie: (theaterId?: TheaterId) => void;
  setActiveSlot: (slot: number) => void;
  fireActiveOrdnance: () => void;
  cycleFireMode: () => GunFireMode;
  requestPointerLock: () => void;
  cycleTarget: () => void;
  markReconTarget: () => { marked: boolean; targetName: string | null };
  deployFlares: () => boolean;
  armKamikazeDive: () => boolean;
  setWaypointTarget: (x: number, z: number) => void;
  getCyberTargets: () => CyberTargetOption[];
  triggerCyberAttack: (
    targetId: string,
    payloadId: CyberPayloadId,
  ) => {
    ok: boolean;
    targetName: string;
    targetKind: 'base' | 'drone';
    destroyed: boolean;
    damageDealt: number;
    isRemotePilot: boolean;
    message: string;
  };
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
  reticleFrameRef?: React.MutableRefObject<HTMLDivElement | null>;
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
  onGameOver: (
    victory: boolean,
    summary: { score: number; targetsDestroyed: number; totalTargets: number; bestCep: number | null },
  ) => void;
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

function toSimWorldConfig(p: FlightViewportProps): SimWorldConfig {
  return {
    theaterId: p.theaterId,
    weatherId: p.weatherId,
    utcHours: p.utcHours,
    loadout: p.loadout,
    sandbox: p.sandbox,
    skillBonuses: p.skillBonuses,
    flightModel: p.settings.gameplay.flightModel,
    controlScheme: p.settings.controls.scheme,
    instructorAutoLevel: p.settings.controls.instructorAutoLevel,
    radarWarningAudio: p.settings.gameplay.radarWarningAudio,
    disableFuelDepletion: true,
  };
}

function createSoftSmokeSpriteTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 128, 128);
    const puffs = [
      [64, 64, 58, 0.72],
      [48, 56, 40, 0.48],
      [78, 58, 38, 0.45],
      [58, 78, 36, 0.42],
    ];
    for (const [cx, cy, r, a] of puffs) {
      const grad = ctx.createRadialGradient(cx, cy, r * 0.08, cx, cy, r);
      grad.addColorStop(0, `rgba(255,255,255,${a})`);
      grad.addColorStop(0.42, `rgba(255,255,255,${a * 0.55})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
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

    sharedAssetPipeline.bindRenderer(renderer);

    // Studio & Outdoor PBR reflections — start with fast RoomEnvironment, upgrade asynchronously to Poly Haven HDRI
    const pmrem = new THREE.PMREMGenerator(renderer);
    let initialEnvTex: THREE.Texture | null = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = initialEnvTex;
    scene.environmentIntensity = 0.78;
    pmrem.dispose();

    // Atmospheric Sky Dome (backlit sunlit desert scattering)
    const sky = new Sky();
    sky.scale.setScalar(25000);
    scene.add(sky);
    const skyUniforms = sky.material.uniforms;
    skyUniforms['turbidity'].value = 1.45;
    skyUniforms['rayleigh'].value = 0.58;
    skyUniforms['mieCoefficient'].value = 0.0018;
    skyUniforms['mieDirectionalG'].value = 0.78;

    // Warm/cool 3-point outdoor lighting calibrated to desert IBL
    const hemiLight = new THREE.HemisphereLight(0xaad1f0, 0x5c4732, 0.82);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xfff1d6, 2.25);
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

    scene.fog = new THREE.FogExp2(0xc4b092, 0.00016);

    // Headless Simulation World (fixed-timestep)
    const world = new SimWorld(toSimWorldConfig(propsRef.current));

    // Dynamic Scene Holders
    const theaterGroup = new THREE.Group();
    scene.add(theaterGroup);

    let playerMeshHandle: DroneMeshHandle = buildDroneMesh(
      world.config.loadout.airframeId,
      0xf59e0b,
      world.config.loadout.slots,
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

    const targetMarker = new THREE.Mesh(
      new THREE.RingGeometry(28, 36, 4),
      new THREE.MeshBasicMaterial({ color: 0xef4444, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
    );
    targetMarker.rotation.x = -Math.PI / 2;
    scene.add(targetMarker);

    // Pooled 3D EW Cyber Disruption Wireframe Spheres
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

    // Pooled 3D Explosion Shockwaves & Dynamic Flash Lights
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

    // Pooled Soft Camera-Facing Wispy Billboard Particle Cloud (Zero-GC ShaderMaterial)
    const PARTICLE_COUNT = 320;
    const smokeTex = createSoftSmokeSpriteTexture();
    const pPositions = new Float32Array(PARTICLE_COUNT * 3);
    const pColors = new Float32Array(PARTICLE_COUNT * 3);
    const pSizes = new Float32Array(PARTICLE_COUNT);
    const pAlphas = new Float32Array(PARTICLE_COUNT);

    const particleGeo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(pPositions, 3);
    const colAttr = new THREE.BufferAttribute(pColors, 3);
    const sizeAttr = new THREE.BufferAttribute(pSizes, 1);
    const alphaAttr = new THREE.BufferAttribute(pAlphas, 1);
    particleGeo.setAttribute('position', posAttr);
    particleGeo.setAttribute('aColor', colAttr);
    particleGeo.setAttribute('aSize', sizeAttr);
    particleGeo.setAttribute('aAlpha', alphaAttr);

    const particleMat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: smokeTex },
        uProjScale: { value: (container.clientHeight || window.innerHeight) * 0.85 },
      },
      vertexShader: `
        attribute float aSize;
        attribute float aAlpha;
        attribute vec3 aColor;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float uProjScale;
        void main() {
          vColor = aColor;
          vAlpha = aAlpha;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aAlpha <= 0.001 ? 0.0 : clamp(aSize * (uProjScale / max(6.0, -mvPosition.z)), 2.0, 220.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          if (vAlpha <= 0.001) discard;
          vec4 tex = texture2D(uMap, gl_PointCoord);
          float alpha = tex.a * vAlpha;
          if (alpha <= 0.01) discard;
          gl_FragColor = vec4(vColor * tex.rgb, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    const particlePoints = new THREE.Points(particleGeo, particleMat);
    particlePoints.frustumCulled = false;
    scene.add(particlePoints);

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
    let lastVfxEvent: { type: string; x: number; y: number; z: number; count: number; tSec: number } | null = null;

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
      const preset = propsRef.current.settings.graphics.preset;
      const densityScale = preset === 'low' ? 0.5 : preset === 'balanced' ? 0.8 : 1.0;
      const spawnTotal = Math.max(1, Math.round(count * densityScale));
      lastVfxEvent = {
        type: 'particle_burst',
        x: Math.round(x),
        y: Math.round(y),
        z: Math.round(z),
        count: spawnTotal,
        tSec: Number(world.sortieTimeSec.toFixed(2)),
      };
      for (let i = 0; i < spawnTotal; i++) {
        const pt = particles[particleCursor];
        particleCursor = (particleCursor + 1) % PARTICLE_COUNT;
        pt.active = true;
        pt.x = x + (Math.random() - 0.5) * size * 0.4;
        pt.y = y + (Math.random() - 0.5) * size * 0.4;
        pt.z = z + (Math.random() - 0.5) * size * 0.4;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.random() * Math.PI - Math.PI / 2;
        const v = speed * (0.25 + Math.random() * 0.75);
        pt.vx = Math.cos(theta) * Math.cos(phi) * v;
        pt.vy = Math.abs(Math.sin(phi)) * v + speed * 0.2;
        pt.vz = Math.sin(theta) * Math.cos(phi) * v;
        pt.age = 0;
        pt.life = life * (0.75 + Math.random() * 0.55);
        pt.size = size * 2.35 * (0.75 + Math.random() * 0.55);
        pt.r = r;
        pt.g = g;
        pt.b = b;
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

    const audio = new TacticalAudioSynth();

    const landmarkMeshes = new Map<string, THREE.Group>();
    const aiMeshes = new Map<string, DroneMeshHandle>();
    const remoteMeshes = new Map<string, DroneMeshHandle>();
    const ordnanceMeshes = new Map<string, THREE.Group>();
    let cloudGroupRef: THREE.Group | null = null;
    let terrainDisposeToken: { disposed: boolean } | null = null;
    let lastResScale = propsRef.current.settings.graphics.resolutionScale;

    // Camera & Viewport Input State
    let hudEmitAccum = 0;
    let broadcastAccum = 0;
    let orbitYawOffset = 0;
    let freeLookYawOffset = 0;
    let freeLookPitchOffset = 0;
    let eoirYawOffset = 0;
    let eoirPitchOffset = 0;
    let camYaw = world.aimYaw;
    let camPitch = clampAimPitchRad(world.aimPitch * 0.72);
    let flybyAnchor: THREE.Vector3 | null = null;
    let prevCamMode: CameraMode = propsRef.current.cameraMode;
    let prevPhase: GamePhase = propsRef.current.phase;
    const mouseInput = createMouseInputState();
    let pointerLockRejected = false;
    let lastMouseAimScreen = { x: 50, y: 50, onScreen: true, edgeAngleDeg: 0 };
    let lastDebugSample = {
      rawDeltaX: 0,
      rawDeltaY: 0,
      appliedAimSensitivity: propsRef.current.settings.controls.mouseSensitivity,
      appliedFreeLookSensitivity: propsRef.current.settings.controls.freeLookSensitivity,
    };
    let zoomHeld = false;
    let zoomToggled = false;
    let hdriOwned = false;
    let lastRollInput = 0;
    let lastPitchInput = 0;
    let lastYawInput = 0;
    let rotarySpinRate = 0;

    sharedAssetPipeline
      .loadHdriEnvironment(STAGE_A_PATHS.hdriDesert, renderer)
      .then((hdriEnvTex) => {
        if (disposed) return;
        scene.environment = hdriEnvTex;
        scene.environmentIntensity = 0.85;
        hdriOwned = true;
        if (initialEnvTex) {
          initialEnvTex.dispose();
          initialEnvTex = null;
        }
      })
      .catch(() => {});

    function rebuildTheaterMeshes(theaterId: TheaterId) {
      if (terrainDisposeToken) {
        terrainDisposeToken.disposed = true;
        terrainDisposeToken = null;
      }
      while (theaterGroup.children.length > 0) {
        const child = theaterGroup.children[0];
        theaterGroup.remove(child);
        sharedAssetPipeline.disposeObject3D(child);
      }
      landmarkMeshes.clear();

      const maxAniso = renderer.capabilities.getMaxAnisotropy();
      const { terrainMesh, waterMesh, cloudGroup, propGroup, disposeToken } = buildTheaterTerrain(
        theaterId,
        maxAniso,
        isSoftwareGl,
      );
      terrainDisposeToken = disposeToken;
      theaterGroup.add(terrainMesh);
      theaterGroup.add(propGroup);
      if (waterMesh) theaterGroup.add(waterMesh);
      cloudGroupRef = cloudGroup;
      cloudGroup.visible = propsRef.current.settings.graphics.clouds;
      theaterGroup.add(cloudGroup);

      const { theater } = world.getEnvironmentSnapshot();
      for (const lm of world.landmarks) {
        const mesh = buildTargetStructure(lm);
        const y = Math.max(theater.waterLevelM, groundHeightAt(theaterId, lm.x, lm.z));
        mesh.position.set(lm.x, y, lm.z);
        mesh.rotation.y = lm.headingRad ?? 0;
        mesh.visible = lm.hp > 0;
        theaterGroup.add(mesh);
        landmarkMeshes.set(lm.id, mesh);
      }

      for (const m of aiMeshes.values()) {
        if (m.disposeToken) m.disposeToken.disposed = true;
        scene.remove(m.group);
        sharedAssetPipeline.disposeObject3D(m.group);
      }
      aiMeshes.clear();
      for (const bot of world.aiBots) {
        const handle = buildDroneMesh(bot.airframeId, bot.team === 'alpha' ? 0x38bdf8 : 0xef4444);
        handle.group.position.set(bot.x, bot.y, bot.z);
        scene.add(handle.group);
        aiMeshes.set(bot.id, handle);
      }
    }

    function dispatchSimEvents(events: SimEvent[]) {
      const p = propsRef.current;
      for (const ev of events) {
        switch (ev.type) {
          case 'theater_reset':
            rebuildTheaterMeshes(ev.theaterId);
            break;
          case 'ordnance_spawned': {
            const spec = WEAPONS[ev.ord.weaponId];
            const mesh = buildOrdnanceMesh(spec.category, ev.ord.weaponId);
            mesh.position.set(ev.ord.x, ev.ord.y, ev.ord.z);
            scene.add(mesh);
            ordnanceMeshes.set(ev.ord.id, mesh);
            break;
          }
          case 'ordnance_removed': {
            const mesh = ordnanceMeshes.get(ev.id);
            if (mesh) {
              scene.remove(mesh);
              sharedAssetPipeline.disposeObject3D(mesh);
              ordnanceMeshes.delete(ev.id);
            }
            break;
          }
          case 'ordnance_fired_net':
            p.onOrdnanceFired(ev.payload);
            break;
          case 'landmark_visibility': {
            const mesh = landmarkMeshes.get(ev.landmarkId);
            if (mesh) mesh.visible = ev.visible;
            break;
          }
          case 'target_destroyed':
            p.onTargetDestroyed(ev.info);
            break;
          case 'air_kill':
            p.onAirKill(ev.info);
            break;
          case 'cyber_success':
            p.onCyberSuccess(ev.info);
            break;
          case 'aar':
            p.onAarEvent(ev.event);
            break;
          case 'particle_burst':
            spawnParticleBurst(ev.x, ev.y, ev.z, ev.count, ev.speed, ev.size, ev.r, ev.g, ev.b, ev.life);
            break;
          case 'shockwave':
            spawnShockwave(ev.x, ev.y, ev.z, ev.scale);
            break;
          case 'sound': {
            const coords =
              typeof ev.x === 'number' && typeof ev.y === 'number' && typeof ev.z === 'number'
                ? { x: ev.x, y: ev.y, z: ev.z, vx: ev.vx, vy: ev.vy, vz: ev.vz }
                : undefined;
            if (ev.kind === 'cannon') {
              audio.playCannonShot(coords, ev.gunProfile);
              rotarySpinRate = Math.min(54, rotarySpinRate + 26);
            } else if (ev.kind === 'glide_release') audio.playGlideRelease(coords);
            else if (ev.kind === 'missile_launch') audio.playMissileLaunch(Boolean(ev.isBallistic), coords);
            else if (ev.kind === 'lock_chirp') audio.playLockChirp();
            else if (ev.kind === 'hit_marker') audio.playHitMarker(Boolean(ev.isKill));
            else if (ev.kind === 'explosion') audio.playExplosion(ev.intensity ?? 1.0, coords);
            else if (ev.kind === 'aaa_burst') audio.playAntiAirBurst(coords);
            else if (ev.kind === 'flare_pop') audio.playFlarePop(coords);
            else if (ev.kind === 'cyber_inject') audio.playCyberInject();
            else if (ev.kind === 'cyber_purge') audio.playCyberPurge();
            else if (ev.kind === 'cyber_alert') audio.playCyberAlert();
            else if (ev.kind === 'kamikaze_siren') audio.playKamikazeLockSiren();
            else if (ev.kind === 'recon_mark') audio.playReconMark();
            break;
          }
          case 'game_over':
            p.onGameOver(ev.victory, ev.summary);
            break;
        }
      }
    }

    // Initial theater scene build
    rebuildTheaterMeshes(world.config.theaterId);

    // Input Tracking (cleared on blur/visibilitychange)
    const keys = new Set<string>();
    let mouseFireHeld = false;

    const handleKeyDown = (e: KeyboardEvent) => {
      audio.warmUp();
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      const code = e.code;
      keys.add(code);

      if (propsRef.current.phase !== 'playing') return;

      if (code === 'Digit1') {
        world.setActiveSlot(0);
        hudEmitAccum = 0.1;
      } else if (code === 'Digit2') {
        world.setActiveSlot(1);
        hudEmitAccum = 0.1;
      } else if (code === 'Digit3') {
        world.setActiveSlot(2);
        hudEmitAccum = 0.1;
      } else if (code === 'Digit4') {
        world.setActiveSlot(3);
        hudEmitAccum = 0.1;
      } else if (code === 'Tab') {
        e.preventDefault();
        dispatchSimEvents(world.cycleTarget(propsRef.current.remotePilots));
        hudEmitAccum = 0.1;
      } else if (code === 'Space') {
        e.preventDefault();
        if (!e.repeat) {
          const res = world.fireActiveOrdnance(true, propsRef.current.remotePilots);
          dispatchSimEvents(res.events);
          if (res.fired) hudEmitAccum = 0.1;
        }
      } else if (code === 'KeyL') {
        if (!e.repeat) {
          e.preventDefault();
          if (mouseInput.pointerLocked) {
            releasePointerLock();
          } else {
            requestCanvasPointerLock();
          }
        }
      } else if (code === 'KeyF') {
        e.preventDefault();
        const res = world.deployFlares(true);
        dispatchSimEvents(res.events);
        if (res.ok) hudEmitAccum = 0.1;
      } else if (code === 'KeyB') {
        e.preventDefault();
        const res = world.armKamikazeDive(true);
        dispatchSimEvents(res.events);
        hudEmitAccum = 0.1;
      } else if (code === 'KeyZ') {
        e.preventDefault();
        zoomToggled = !zoomToggled;
      } else if (code === 'KeyR' && !e.repeat) {
        const activeW = world.config.loadout.slots[world.activeSlot];
        if (WEAPONS[activeW]?.category === 'cannon') {
          e.preventDefault();
          world.cycleActiveFireMode();
          hudEmitAccum = 0.1;
        }
      } else if (code === 'KeyT' && !e.repeat) {
        e.preventDefault();
        const res = world.markReconTarget();
        dispatchSimEvents(res.events);
        hudEmitAccum = 0.1;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keys.delete(e.code);
    };

    const clearInputs = () => {
      keys.clear();
      mouseFireHeld = false;
      zoomHeld = false;
      handleMouseFocusLoss(mouseInput);
      world.clearPendingAimDeltas();
    };

    const releasePointerLock = () => {
      if (document.pointerLockElement === renderer.domElement) {
        try {
          document.exitPointerLock?.();
        } catch {
          // Ignore exitPointerLock errors in sandboxed iframes
        }
      }
      if (mouseInput.pointerLocked) {
        handleMousePointerLockChange(mouseInput, false);
      }
    };

    const requestCanvasPointerLock = () => {
      const p = propsRef.current;
      if (
        p.phase !== 'playing' ||
        p.settings.controls.scheme !== 'mouse_aim' ||
        p.cameraMode !== 'chase' ||
        mouseInput.pointerLocked ||
        typeof renderer.domElement.requestPointerLock !== 'function'
      ) {
        return;
      }
      pointerLockRejected = false;
      try {
        const lockResult = renderer.domElement.requestPointerLock() as unknown as Promise<void> | undefined;
        if (lockResult && typeof lockResult.catch === 'function') {
          lockResult.catch(() => {
            pointerLockRejected = true;
            handleMousePointerLockError(mouseInput);
            hudEmitAccum = 0.1;
          });
        }
      } catch {
        pointerLockRejected = true;
        handleMousePointerLockError(mouseInput);
      }
      hudEmitAccum = 0.1;
    };

    const getPointerRoute = (): PointerRoute => {
      const p = propsRef.current;
      if (p.phase !== 'playing') return 'none';
      if (p.cameraMode === 'eoir') return 'eoir';
      if (keys.has('KeyC') && p.cameraMode !== 'orbit') return 'freelook';
      if (p.cameraMode === 'chase' && p.settings.controls.scheme === 'mouse_aim') return 'aim';
      return 'none';
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        releasePointerLock();
        clearInputs();
      } else {
        clearMousePendingDeltas(mouseInput, true);
        world.clearPendingAimDeltas();
      }
    };

    const handleWindowBlur = () => {
      releasePointerLock();
      clearInputs();
    };

    const handlePointerLockChange = () => {
      const isLocked = document.pointerLockElement === renderer.domElement;
      mouseFireHeld = false;
      handleMousePointerLockChange(mouseInput, isLocked);
      if (isLocked) {
        pointerLockRejected = false;
      }
      world.clearPendingAimDeltas();
      hudEmitAccum = 0.1;
    };

    const handlePointerLockError = () => {
      pointerLockRejected = true;
      mouseFireHeld = false;
      handleMousePointerLockError(mouseInput);
      world.clearPendingAimDeltas();
      hudEmitAccum = 0.1;
    };

    const handleCanvasPointerEnter = (e: PointerEvent) => {
      handleMousePointerEnter(mouseInput, e.clientX, e.clientY);
    };

    const handleCanvasPointerLeave = () => {
      handleMousePointerLeave(mouseInput);
      world.clearPendingAimDeltas();
    };

    const handleCanvasPointerDown = (e: PointerEvent) => {
      audio.warmUp();
      const p = propsRef.current;
      if (p.phase !== 'playing') return;
      if (e.target !== renderer.domElement) return;

      handleMousePointerEnter(mouseInput, e.clientX, e.clientY);

      if (e.button === 0) {
        mouseFireHeld = true;
        const res = world.fireActiveOrdnance(true, p.remotePilots);
        dispatchSimEvents(res.events);
        if (res.fired) hudEmitAccum = 0.1;
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
      handleMousePointerMove(mouseInput, e, getPointerRoute());
    };

    const handleCanvasWheel = (e: WheelEvent) => {
      if (propsRef.current.phase !== 'playing') return;
      e.preventDefault();
      world.adjustThrottleDirect(e.deltaY < 0 ? 0.08 : -0.08);
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('pointerlockchange', handlePointerLockChange);
    document.addEventListener('pointerlockerror', handlePointerLockError);
    renderer.domElement.addEventListener('pointerenter', handleCanvasPointerEnter);
    renderer.domElement.addEventListener('pointerleave', handleCanvasPointerLeave);
    renderer.domElement.addEventListener('pointerdown', handleCanvasPointerDown);
    renderer.domElement.addEventListener('pointermove', handleCanvasPointerMove);
    renderer.domElement.addEventListener('wheel', handleCanvasWheel, { passive: false });
    renderer.domElement.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('pointerup', handleCanvasPointerUp);

    // Bind command bridge for UI & WebSocket callbacks
    propsRef.current.bridgeRef.current = {
      resetSortie: (nextTheaterId) => {
        dispatchSimEvents(world.resetSortie(nextTheaterId ?? propsRef.current.theaterId));
        freeLookYawOffset = 0;
        freeLookPitchOffset = 0;
        eoirYawOffset = 0;
        eoirPitchOffset = 0;
        camYaw = world.aimYaw;
        camPitch = clampAimPitchRad(world.aimPitch * 0.72);
        clearMousePendingDeltas(mouseInput, true);
        world.clearPendingAimDeltas();
        zoomHeld = false;
        zoomToggled = false;
        hudEmitAccum = 0.1;
      },
      setActiveSlot: (s) => {
        world.setActiveSlot(s);
        hudEmitAccum = 0.1;
      },
      fireActiveOrdnance: () => {
        const res = world.fireActiveOrdnance(propsRef.current.phase === 'playing', propsRef.current.remotePilots);
        dispatchSimEvents(res.events);
        if (res.fired) hudEmitAccum = 0.1;
      },
      cycleFireMode: () => {
        const nextMode = world.cycleActiveFireMode();
        hudEmitAccum = 0.1;
        return nextMode;
      },
      requestPointerLock: requestCanvasPointerLock,
      cycleTarget: () => {
        dispatchSimEvents(world.cycleTarget(propsRef.current.remotePilots));
        hudEmitAccum = 0.1;
      },
      markReconTarget: () => {
        const res = world.markReconTarget();
        dispatchSimEvents(res.events);
        hudEmitAccum = 0.1;
        return { marked: res.marked, targetName: res.targetName };
      },
      deployFlares: () => {
        const res = world.deployFlares(propsRef.current.phase === 'playing');
        dispatchSimEvents(res.events);
        if (res.ok) hudEmitAccum = 0.1;
        return res.ok;
      },
      armKamikazeDive: () => {
        const res = world.armKamikazeDive(propsRef.current.phase === 'playing');
        dispatchSimEvents(res.events);
        hudEmitAccum = 0.1;
        return res.armed;
      },
      setWaypointTarget: (x, z) => {
        dispatchSimEvents(world.setWaypointTarget(x, z));
      },
      getCyberTargets: () => world.getCyberTargets(propsRef.current.remotePilots),
      triggerCyberAttack: (targetId, payloadId) => {
        const res = world.triggerCyberAttack(targetId, payloadId, propsRef.current.remotePilots);
        dispatchSimEvents(res.events);
        return res.result;
      },
      purgeCyberIntrusion: () => {
        const res = world.purgeCyberIntrusion();
        dispatchSimEvents(res.events);
        return res.hadThreat;
      },
      receiveRemoteCyberAttack: (payloadId, attackerCallsign) => {
        dispatchSimEvents(world.receiveRemoteCyberAttack(payloadId, attackerCallsign));
      },
      spawnRemoteOrdnance: (payload) => {
        dispatchSimEvents(world.spawnRemoteOrdnance(payload));
      },
      applyTargetHpSync: (targetHp) => {
        dispatchSimEvents(world.applyTargetHpSync(targetHp));
      },
    };

    const handleResize = () => {
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      particleMat.uniforms.uProjScale.value = h * 0.85;
    };
    window.addEventListener('resize', handleResize);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    camera.position.set(world.drone.x, world.drone.y + 12, world.drone.z + 32);
    camera.lookAt(world.drone.x, world.drone.y, world.drone.z - 60);

    let lastTimeMs = performance.now();
    let frameId = 0;
    let disposed = false;

    // Rolling 60-frame timing & Stage-A diagnostic telemetry bridge
    const frameTimesMs: number[] = [];
    const winAny = window as unknown as Record<string, unknown>;
    winAny.__AEROSTRIKE_DEBUG__ = {
      getMetrics: () => {
        const sorted = [...frameTimesMs].sort((a, b) => a - b);
        const avgMs =
          frameTimesMs.length > 0
            ? frameTimesMs.reduce((s, v) => s + v, 0) / frameTimesMs.length
            : 16.7;
        const p95Ms = sorted.length > 0 ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 16.7;
        const { theater } = world.getEnvironmentSnapshot();
        return {
          fps: Number((1000 / Math.max(0.5, avgMs)).toFixed(1)),
          avgFrameMs: Number(avgMs.toFixed(2)),
          p95FrameMs: Number(p95Ms.toFixed(2)),
          isSoftwareGl,
          rendererMemory: {
            geometries: renderer.info.memory.geometries,
            textures: renderer.info.memory.textures,
          },
          rendererRender: {
            calls: renderer.info.render.calls,
            triangles: renderer.info.render.triangles,
          },
          assetPipeline: sharedAssetPipeline.getStats(),
          audio: audio.getAudioTelemetry(),
          playerGlbLoaded: Boolean(playerMeshHandle.isGlbHero),
          cameraMode: propsRef.current.cameraMode,
          fuelPct: Math.round((world.drone.fuelKg / Math.max(1, world.drone.maxFuelKg)) * 100),
          dronePos: {
            x: Number(world.drone.x.toFixed(1)),
            y: Number(world.drone.y.toFixed(1)),
            z: Number(world.drone.z.toFixed(1)),
          },
          theaterName: theater.name,
          landmarkNames: world.landmarks.map((l) => l.name),
          lastVfxEvent,
          ordnance: {
            activeSlot: world.activeSlot,
            activeWeaponId: world.config.loadout.slots[world.activeSlot],
            activeFireMode: world.getActiveFireMode(),
            slotAmmo: [...world.slotAmmo],
            activeOrdnanceCount: world.activeOrdnance.length,
          },
          mission: {
            phase: world.mission.phase,
            phaseNumber: world.mission.phaseNumber,
            markedTargetIds: [...world.mission.markedTargetIds],
            reconScanProgress: Number(world.mission.reconScanProgress.toFixed(2)),
            convoyLandmark: (() => {
              const c = world.landmarks.find((l) => l.type === 'convoy');
              return c
                ? {
                    id: c.id,
                    x: Number(c.x.toFixed(1)),
                    z: Number(c.z.toFixed(1)),
                    hp: c.hp,
                    headingRad: Number((c.headingRad ?? 0).toFixed(3)),
                  }
                : null;
            })(),
          },
          mouseAim: {
            ...world.getAimTelemetry(),
            scheme: propsRef.current.settings.controls.scheme,
            pointerLocked: mouseInput.pointerLocked,
            pointerInside: mouseInput.pointerInside,
            pointerLockRejected,
            freeLooking: keys.has('KeyC') && propsRef.current.cameraMode !== 'orbit',
            rawDeltaX: lastDebugSample.rawDeltaX,
            rawDeltaY: lastDebugSample.rawDeltaY,
            appliedAimSensitivity: lastDebugSample.appliedAimSensitivity,
            appliedFreeLookSensitivity: lastDebugSample.appliedFreeLookSensitivity,
            aimScreenX: Number(lastMouseAimScreen.x.toFixed(2)),
            aimScreenY: Number(lastMouseAimScreen.y.toFixed(2)),
            aimOnScreen: lastMouseAimScreen.onScreen,
            freeLookYawOffset: Number(freeLookYawOffset.toFixed(4)),
            freeLookPitchOffset: Number(freeLookPitchOffset.toFixed(4)),
            substepsLastFrame: world.clock.lastSubsteps,
            simTickCount: world.clock.tickCount,
          },
        };
      },
      runResourceSwapAudit: () => {
        const initialGeo = renderer.info.memory.geometries;
        const initialTex = renderer.info.memory.textures;
        // Cycle airframe (bayraktar_tb2 <-> mq9x) & theater (edwards <-> alps) with explicit disposal
        const tempGroup = new THREE.Group();
        const swapAirframes: Array<'mq9x' | 'bayraktar_tb2'> = ['mq9x', 'bayraktar_tb2', 'mq9x', 'bayraktar_tb2'];
        for (const af of swapAirframes) {
          const h = buildDroneMesh(af, 0xf59e0b, world.config.loadout.slots);
          tempGroup.add(h.group);
          if (h.disposeToken) h.disposeToken.disposed = true;
          tempGroup.remove(h.group);
          sharedAssetPipeline.disposeObject3D(h.group);
        }
        const swapTheaters: Array<'alps' | 'edwards'> = ['alps', 'edwards', 'alps', 'edwards'];
        for (const th of swapTheaters) {
          const built = buildTheaterTerrain(th, renderer.capabilities.getMaxAnisotropy(), isSoftwareGl);
          built.disposeToken.disposed = true;
          sharedAssetPipeline.disposeObject3D(built.terrainMesh);
          sharedAssetPipeline.disposeObject3D(built.propGroup);
          sharedAssetPipeline.disposeObject3D(built.cloudGroup);
          if (built.waterMesh) sharedAssetPipeline.disposeObject3D(built.waterMesh);
        }
        const finalGeo = renderer.info.memory.geometries;
        const finalTex = renderer.info.memory.textures;
        return {
          initialGeo,
          finalGeo,
          deltaGeo: finalGeo - initialGeo,
          initialTex,
          finalTex,
          deltaTex: finalTex - initialTex,
          pipelineStats: sharedAssetPipeline.getStats(),
        };
      },
    };

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
      const rawDt = Math.max(0.001, (nowMs - lastTimeMs) / 1000);
      lastTimeMs = nowMs;
      frameTimesMs.push(rawDt * 1000);
      if (frameTimesMs.length > 60) frameTimesMs.shift();
      const visualDt = Math.min(0.05, rawDt);
      const p = propsRef.current;

      // Synchronize config (theater / loadout / sandbox / settings / skill bonuses)
      const sync = world.syncConfig(toSimWorldConfig(p));
      if (sync.loadoutChanged) {
        if (playerMeshHandle.disposeToken) playerMeshHandle.disposeToken.disposed = true;
        scene.remove(playerMeshHandle.group);
        sharedAssetPipeline.disposeObject3D(playerMeshHandle.group);
        playerMeshHandle = buildDroneMesh(p.loadout.airframeId, 0xf59e0b, p.loadout.slots);
        scene.add(playerMeshHandle.group);
      }
      if (sync.events.length > 0) {
        dispatchSimEvents(sync.events);
      }

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

      // Phase & Camera-Mode Lifecycle (release pointer lock & purge stale mouse deltas on pause/modals/switch)
      if (p.phase !== prevPhase) {
        prevPhase = p.phase;
        if (p.phase !== 'playing') {
          releasePointerLock();
          keys.clear();
          mouseFireHeld = false;
          zoomHeld = false;
          handleMouseFocusLoss(mouseInput);
          world.clearPendingAimDeltas();
        } else {
          clearMousePendingDeltas(mouseInput, true);
          world.clearPendingAimDeltas();
        }
      }

      if (p.cameraMode !== prevCamMode) {
        prevCamMode = p.cameraMode;
        clearMousePendingDeltas(mouseInput, true);
        world.clearPendingAimDeltas();
        if (p.cameraMode !== 'flyby') flybyAnchor = null;
        if (p.cameraMode !== 'chase' && mouseInput.pointerLocked) {
          releasePointerLock();
        }
        if (p.cameraMode === 'chase') {
          camYaw = world.aimYaw;
          camPitch = clampAimPitchRad(world.aimPitch * 0.72);
        }
      }

      // Gather player control inputs & advance fixed-timestep SimWorld
      const invertSign = p.settings.controls.invertY ? -1 : 1;
      const pitchOverride =
        ((keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) -
          (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0)) *
        invertSign;
      const rollOverride =
        (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) -
        (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0);
      const yawOverride = (keys.has('KeyQ') ? 1 : 0) - (keys.has('KeyE') ? 1 : 0);
      const throttleDelta =
        (keys.has('ShiftLeft') || keys.has('ShiftRight') || keys.has('Equal') ? 1 : 0) -
        (keys.has('ControlLeft') || keys.has('Minus') ? 1 : 0);
      const freeLookingInput = p.phase === 'playing' && keys.has('KeyC') && p.cameraMode !== 'orbit';

      const consumedMouse = consumeMouseFrameInput(mouseInput, {
        aimSensitivity: p.settings.controls.mouseSensitivity,
        freeLookSensitivity: p.settings.controls.freeLookSensitivity,
        invertY: p.settings.controls.invertY,
        aimSmoothing: p.settings.controls.aimSmoothing,
      });

      if (p.phase === 'playing') {
        lastDebugSample = {
          rawDeltaX: consumedMouse.rawDeltaX,
          rawDeltaY: consumedMouse.rawDeltaY,
          appliedAimSensitivity: consumedMouse.appliedAimSensitivity,
          appliedFreeLookSensitivity: consumedMouse.appliedFreeLookSensitivity,
        };
      }

      if (freeLookingInput) {
        freeLookYawOffset = Math.max(
          -Math.PI,
          Math.min(Math.PI, freeLookYawOffset + consumedMouse.freeLookDeltaYawRad),
        );
        freeLookPitchOffset = Math.max(
          -0.85,
          Math.min(0.95, freeLookPitchOffset + consumedMouse.freeLookDeltaPitchRad),
        );
      } else {
        freeLookYawOffset = THREE.MathUtils.damp(freeLookYawOffset, 0, 14, visualDt);
        freeLookPitchOffset = THREE.MathUtils.damp(freeLookPitchOffset, 0, 14, visualDt);
        if (Math.abs(freeLookYawOffset) < 1e-4) freeLookYawOffset = 0;
        if (Math.abs(freeLookPitchOffset) < 1e-4) freeLookPitchOffset = 0;
      }

      if (p.phase === 'playing' && p.cameraMode === 'eoir') {
        eoirYawOffset = Math.max(
          -Math.PI * 0.85,
          Math.min(Math.PI * 0.85, eoirYawOffset + consumedMouse.eoirDeltaYawRad),
        );
        eoirPitchOffset = Math.max(
          -1.05,
          Math.min(0.35, eoirPitchOffset + consumedMouse.eoirDeltaPitchRad),
        );
      } else {
        eoirYawOffset = THREE.MathUtils.damp(eoirYawOffset, 0, 10, visualDt);
        eoirPitchOffset = THREE.MathUtils.damp(eoirPitchOffset, 0, 10, visualDt);
      }

      const stepOut = world.stepFrame(
        rawDt,
        p.phase === 'playing',
        {
          pitchOverride,
          rollOverride,
          yawOverride,
          throttleDelta,
          aimDeltaYawRad:
            p.cameraMode === 'chase' && !freeLookingInput ? consumedMouse.aimDeltaYawRad : 0,
          aimDeltaPitchRad:
            p.cameraMode === 'chase' && !freeLookingInput ? consumedMouse.aimDeltaPitchRad : 0,
          aimSmoothing: p.settings.controls.aimSmoothing,
          freeLooking: freeLookingInput,
          firingHeld: keys.has('Space') || mouseFireHeld,
          cameraOrbitMode: p.cameraMode === 'orbit',
          cameraEoirMode: p.cameraMode === 'eoir',
        },
        p.remotePilots,
      );
      if (stepOut.events.length > 0) {
        dispatchSimEvents(stepOut.events);
      }

      lastRollInput = THREE.MathUtils.damp(lastRollInput, world.lastInstructorCmd.roll, 12, visualDt);
      lastPitchInput = THREE.MathUtils.damp(lastPitchInput, world.lastInstructorCmd.pitch, 12, visualDt);
      lastYawInput = THREE.MathUtils.damp(lastYawInput, world.lastInstructorCmd.yaw, 12, visualDt);

      const d = world.drone;
      const sortieTimeSec = world.sortieTimeSec;
      const { theater, weather, solar, atmos } = world.getEnvironmentSnapshot();

      if (p.phase === 'playing' && world.hitstopTimer <= 0) {
        audio.updateEngine(d.throttle, d.mach, world.getPropulsionLabel(), p.cameraMode, weather.windSpeedMs);
      }
      skyUniforms['sunPosition'].value.set(solar.sunDirX, solar.sunDirY, solar.sunDirZ);
      const isSector04GoldenHour =
        world.config.theaterId === 'edwards' && solar.elevationDeg > 2 && solar.elevationDeg <= 24;
      if (isSector04GoldenHour) {
        skyUniforms['turbidity'].value = 2.8 + weather.cloudCover * 5.0;
        skyUniforms['rayleigh'].value = 1.45;
        skyUniforms['mieCoefficient'].value = 0.0065;
        skyUniforms['mieDirectionalG'].value = 0.86;
        hemiLight.color.setHex(0xf5c894);
        hemiLight.groundColor.setHex(0x6b4c30);
        hemiLight.intensity = 0.86;
      } else {
        skyUniforms['turbidity'].value = 1.45 + weather.cloudCover * 6.5;
        skyUniforms['rayleigh'].value = 0.58;
        skyUniforms['mieCoefficient'].value = 0.0018;
        skyUniforms['mieDirectionalG'].value = 0.78;
        hemiLight.color.setHex(0xaad1f0);
        hemiLight.groundColor.setHex(0x5c4732);
        hemiLight.intensity = solar.isDaylight ? 0.72 : 0.35;
      }

      sunLight.position.set(
        d.x + solar.sunDirX * 1200,
        Math.max(120, d.y + solar.sunDirY * 1200),
        d.z + solar.sunDirZ * 1200,
      );
      sunLight.target.position.set(d.x, 0, d.z);
      sunLight.color.setHex(solar.sunColorHex);
      sunLight.intensity = solar.isDaylight
        ? (isSector04GoldenHour ? 2.15 : 1.85) * (1 - weather.cloudCover * 0.45)
        : 0.45;

      const fog = scene.fog as THREE.FogExp2;
      const fogHex = p.weatherId === 'desert_dust' ? 0xb89668 : solar.fogColorHex;
      fog.color.setHex(fogHex);
      fog.density = weather.fogDensity;

      // Rotate radar dishes & advance terrain-grounded moving convoys
      for (const lm of world.landmarks) {
        if (lm.hp <= 0) continue;
        const lmGroup = landmarkMeshes.get(lm.id);
        if (!lmGroup) continue;
        if (lm.type === 'radar') {
          const scanner = lmGroup.getObjectByName('radarScanner');
          if (scanner) scanner.rotation.y += visualDt * 1.8;
        } else if (lm.type === 'convoy') {
          const cy = Math.max(theater.waterLevelM, groundHeightAt(world.config.theaterId, lm.x, lm.z));
          lmGroup.position.set(lm.x, cy, lm.z);
          lmGroup.rotation.y = lm.headingRad ?? 0;
          lmGroup.traverse((child) => {
            if (child.name === 'convoyWheel') {
              child.rotation.x -= visualDt * 7.5;
            }
          });
        }
      }

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
          po.x += wVx * visualDt;
          po.y += fallSpeed * visualDt;
          po.z += wVz * visualDt;
          if (po.y < -40) po.y += 140;
          if (po.x > 130) po.x -= 260;
          if (po.x < -130) po.x += 260;
          if (po.z > 130) po.z -= 260;
          if (po.z < -130) po.z += 260;
          _vec3A.set(d.x + po.x, d.y + po.y, d.z + po.z);
          _scaleVec.set(1, weather.precipitation === 'rain' ? 1.6 : 0.45, 1);
          _quat.identity();
          _mat4.compose(_vec3A, _quat, _scaleVec);
          precipMesh.setMatrixAt(i, _mat4);
        }
        precipMesh.instanceMatrix.needsUpdate = true;
      }

      // Sync Player Mesh & Stage-A Articulated TB2 Sub-Nodes
      playerMeshHandle.group.position.set(d.x, d.y, d.z);
      _euler.set(d.pitch, d.yaw, d.roll, 'YXZ');
      playerMeshHandle.group.quaternion.setFromEuler(_euler);
      for (const prop of playerMeshHandle.propellers) {
        prop.rotation.z += visualDt * (22 + d.throttle * 44);
      }
      if (playerMeshHandle.rotaryClusters && playerMeshHandle.rotaryClusters.length > 0) {
        for (const cluster of playerMeshHandle.rotaryClusters) {
          cluster.rotation.z += visualDt * rotarySpinRate;
        }
      }
      rotarySpinRate *= Math.exp(-5.5 * visualDt);
      if (rotarySpinRate < 0.05) rotarySpinRate = 0;
      if (playerMeshHandle.aileronsPort) {
        for (const a of playerMeshHandle.aileronsPort) a.rotation.x = lastRollInput * 0.34;
      }
      if (playerMeshHandle.aileronsStbd) {
        for (const a of playerMeshHandle.aileronsStbd) a.rotation.x = -lastRollInput * 0.34;
      }
      if (playerMeshHandle.ruddervatorsPort) {
        for (const r of playerMeshHandle.ruddervatorsPort) r.rotation.x = lastPitchInput * 0.28 + lastYawInput * 0.22;
      }
      if (playerMeshHandle.ruddervatorsStbd) {
        for (const r of playerMeshHandle.ruddervatorsStbd) r.rotation.x = lastPitchInput * 0.28 - lastYawInput * 0.22;
      }
      for (const glow of playerMeshHandle.exhaustGlows) {
        glow.scale.setScalar(0.7 + d.throttle * 0.6);
      }

      // Sync AI Squadron Meshes
      for (const bot of world.aiBots) {
        const handle = aiMeshes.get(bot.id);
        if (!handle) continue;
        if (bot.hp <= 0) {
          handle.group.visible = false;
          continue;
        }
        handle.group.visible = true;
        handle.group.position.set(bot.x, bot.y, bot.z);
        _euler.set(bot.pitch, bot.yaw, bot.roll, 'YXZ');
        handle.group.quaternion.setFromEuler(_euler);
        handle.group.scale.setScalar(bot.hitFlash > 0 ? 1.07 : 1.0);
        for (const prop of handle.propellers) prop.rotation.z += visualDt * 35;
      }

      // Sync Active Ordnance Meshes
      for (const ord of world.activeOrdnance) {
        const mesh = ordnanceMeshes.get(ord.id);
        if (mesh) {
          mesh.position.set(ord.x, ord.y, ord.z);
          _vec3A.set(ord.x + ord.vx, ord.y + ord.vy, ord.z + ord.vz);
          mesh.lookAt(_vec3A);
          const wings = mesh.getObjectByName('deployWings');
          if (wings) {
            wings.scale.x = ord.wingDeployed ? 1 : 0.15;
          }
        }
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
        for (const prop of handle.propellers) prop.rotation.z += visualDt * 32;
      }
      for (const [id, handle] of remoteMeshes.entries()) {
        if (!activeRemoteIds.has(id)) {
          if (handle.disposeToken) handle.disposeToken.disposed = true;
          scene.remove(handle.group);
          sharedAssetPipeline.disposeObject3D(handle.group);
          remoteMeshes.delete(id);
        }
      }

      // Step Visual Shockwaves, Flash Lights, Pooled Billboard Particles & EW Wireframes
      for (let i = 0; i < SHOCKWAVE_POOL_SIZE; i++) {
        const sw = shockwaves[i];
        if (!sw.active) continue;
        sw.age += visualDt;
        if (sw.age >= sw.life) {
          sw.active = false;
          sw.ring.visible = false;
          sw.core.visible = false;
          continue;
        }
        const t = sw.age / sw.life;
        sw.ring.scale.setScalar(1 + t * sw.maxScale);
        (sw.ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, (1 - t) * 0.85);
        sw.core.scale.setScalar(1 + t * sw.maxScale * 0.42);
        (sw.core.material as THREE.MeshBasicMaterial).opacity = Math.max(0, (1 - t * 1.45) * 0.9);
      }
      for (const fl of flashLights) {
        if (fl.intensity > 1) fl.intensity *= Math.exp(-9.5 * visualDt);
        else fl.intensity = 0;
      }

      const windRadPart = (weather.windHeadingDeg * Math.PI) / 180;
      const windPartVx = Math.sin(windRadPart) * weather.windSpeedMs * 0.35;
      const windPartVz = -Math.cos(windRadPart) * weather.windSpeedMs * 0.35;

      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const pt = particles[i];
        if (!pt.active) {
          pAlphas[i] = 0;
          pSizes[i] = 0;
          continue;
        }
        pt.age += visualDt;
        if (pt.age >= pt.life) {
          pt.active = false;
          pAlphas[i] = 0;
          pSizes[i] = 0;
          continue;
        }
        pt.vx = pt.vx * Math.exp(-1.6 * visualDt) + windPartVx * visualDt * 0.35;
        pt.vz = pt.vz * Math.exp(-1.6 * visualDt) + windPartVz * visualDt * 0.35;
        pt.vy = pt.vy * Math.exp(-1.2 * visualDt) + 4.8 * visualDt;
        pt.x += pt.vx * visualDt;
        pt.y += pt.vy * visualDt;
        pt.z += pt.vz * visualDt;

        const progress = pt.age / pt.life;
        const lifeRatio = 1 - progress;
        const idx3 = i * 3;
        pPositions[idx3] = pt.x;
        pPositions[idx3 + 1] = pt.y;
        pPositions[idx3 + 2] = pt.z;
        pColors[idx3] = pt.r;
        pColors[idx3 + 1] = pt.g;
        pColors[idx3 + 2] = pt.b;
        pSizes[i] = pt.size * (0.65 + progress * 1.45);
        pAlphas[i] = Math.min(0.85, lifeRatio * lifeRatio * 1.25);
      }
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
      sizeAttr.needsUpdate = true;
      alphaAttr.needsUpdate = true;

      let ewCursor = 0;
      for (const [tid, st] of world.cyberStatus.entries()) {
        if (sortieTimeSec >= st.until || ewCursor >= EW_POOL_SIZE) continue;
        const lm = world.landmarks.find((l) => l.id === tid && l.hp > 0);
        const ai = world.aiBots.find((a) => a.id === tid && a.hp > 0);
        const rp = p.remotePilots.find((r) => r.id === tid && r.hp > 0);
        const sphere = ewSpheres[ewCursor];
        if (lm) {
          const ly = Math.max(theater.waterLevelM, groundHeightAt(world.config.theaterId, lm.x, lm.z)) + 16;
          sphere.position.set(lm.x, ly, lm.z);
          sphere.scale.setScalar(1.35 + Math.sin(sortieTimeSec * 4) * 0.08);
          sphere.rotation.y += visualDt * 1.8;
          sphere.visible = true;
          ewCursor++;
        } else if (ai) {
          sphere.position.set(ai.x, ai.y, ai.z);
          sphere.scale.setScalar(0.55 + Math.sin(sortieTimeSec * 5) * 0.06);
          sphere.rotation.y += visualDt * 2.4;
          sphere.visible = true;
          ewCursor++;
        } else if (rp) {
          sphere.position.set(rp.x, rp.y, rp.z);
          sphere.scale.setScalar(0.55 + Math.sin(sortieTimeSec * 5) * 0.06);
          sphere.rotation.y += visualDt * 2.4;
          sphere.visible = true;
          ewCursor++;
        }
      }
      for (let i = ewCursor; i < EW_POOL_SIZE; i++) {
        ewSpheres[i].visible = false;
      }

      // Predicted Ordnance Trajectory Arc & Target Marker
      const { target: tgt, prediction, weaponId: selectedWeaponId } = world.predictActiveWeapon(p.remotePilots);
      targetMarker.visible = p.phase === 'playing' && tgt.id !== null;
      targetMarker.position.set(tgt.x, tgt.y + 3, tgt.z);
      targetMarker.rotation.z += visualDt * 1.4;

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

      // Point locked target turret toward locked target azimuth cleanly
      if (playerMeshHandle.eoirTurrets && tgt.id) {
        const relAz = Math.atan2(tgt.x - d.x, tgt.z - d.z) - d.yaw;
        for (const t of playerMeshHandle.eoirTurrets) {
          t.rotation.y = relAz;
        }
      }

      // Camera Choreography (Chase, EO/IR Sensor Pod, Cinematic Flyby, Orbit)
      const freeLooking = freeLookingInput && p.cameraMode === 'chase';

      if (p.phase === 'title') {
        camera.up.set(0, 1, 0);
        const t = performance.now() * 0.00028;
        camera.position.set(d.x + Math.cos(t) * 20, d.y + 5.5 + Math.sin(t * 1.6) * 2.2, d.z + Math.sin(t) * 20);
        camera.lookAt(d.x, d.y + 0.5, d.z - 2);
      } else if (p.cameraMode === 'eoir') {
        camera.up.set(0, 1, 0);
        const gimbalYaw = wrapAngleRad(d.yaw + eoirYawOffset + (freeLookingInput ? freeLookYawOffset : 0));
        const gimbalPitch = clampAimPitchRad(d.pitch + eoirPitchOffset + (freeLookingInput ? freeLookPitchOffset : 0));
        const gDir = aimAnglesToDirection(gimbalYaw, gimbalPitch);
        const cosP = Math.cos(d.pitch);
        const fwdX = -Math.sin(d.yaw) * cosP;
        const fwdZ = -Math.cos(d.yaw) * cosP;
        camera.position.set(d.x + fwdX * 2.5, d.y - 1.1, d.z + fwdZ * 2.5);
        _vec3B.set(tgt.x, tgt.y, tgt.z);
        _vec3C.set(d.x + gDir.x * 420, d.y + gDir.y * 420, d.z + gDir.z * 420);
        if (Math.abs(eoirYawOffset) > 0.03 || Math.abs(eoirPitchOffset) > 0.03 || freeLookingInput) {
          camera.lookAt(_vec3C);
        } else {
          _vec3B.lerp(_vec3C, 0.35);
          camera.lookAt(_vec3B);
        }
      } else if (p.cameraMode === 'flyby') {
        camera.up.set(0, 1, 0);
        const speed = Math.max(25, Math.hypot(d.vx, d.vy, d.vz));
        const vxN = d.vx / speed;
        const vzN = d.vz / speed;
        if (!flybyAnchor || camera.position.distanceTo(_vec3A.set(d.x, d.y, d.z)) > 110) {
          flybyAnchor = new THREE.Vector3(
            d.x + vxN * 36 - vzN * 14,
            Math.max(groundHeightAt(world.config.theaterId, d.x, d.z) + 14, d.y - 3),
            d.z + vzN * 36 + vxN * 14,
          );
        }
        camera.position.copy(flybyAnchor);
        camera.lookAt(d.x, d.y, d.z);
        const flyDist = camera.position.distanceTo(_vec3A.set(d.x, d.y, d.z));
        const targetFov = THREE.MathUtils.clamp(52 - Math.min(20, flyDist * 0.25), 28, 54);
        if (Math.abs(camera.fov - targetFov) > 0.1) {
          camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 7, visualDt);
          camera.updateProjectionMatrix();
        }
      } else if (p.cameraMode === 'orbit') {
        camera.up.set(0, 1, 0);
        orbitYawOffset += visualDt * 0.35;
        camera.position.set(
          d.x + Math.sin(d.yaw + orbitYawOffset) * 20,
          d.y + 6.5,
          d.z + Math.cos(d.yaw + orbitYawOffset) * 20,
        );
        camera.lookAt(d.x, d.y, d.z);
      } else {
        // War Thunder Chase Camera: follow persistent world-space aim direction (or nose on manual override)
        const baseCamYaw = world.manualOverrideActive ? d.yaw : world.aimYaw;
        const baseCamPitch = clampAimPitchRad((world.manualOverrideActive ? d.pitch : world.aimPitch) * 0.72);
        const dampAlpha = 1 - Math.exp(-9.5 * visualDt);
        camYaw = wrapAngleRad(camYaw + wrapAngleRad(baseCamYaw - camYaw) * dampAlpha);
        camPitch = THREE.MathUtils.damp(camPitch, baseCamPitch, 9.5, visualDt);

        const viewYaw = wrapAngleRad(camYaw + freeLookYawOffset);
        const viewPitch = clampAimPitchRad(camPitch + freeLookPitchOffset);
        const viewDir = aimAnglesToDirection(viewYaw, viewPitch);

        const distBack = 18.5 + d.mach * 8.5;
        const targetCamX = d.x - viewDir.x * distBack;
        const rawCamY = d.y + 4.2 - viewDir.y * distBack * 0.72;
        const targetCamZ = d.z - viewDir.z * distBack;
        const minCamY =
          Math.max(theater.waterLevelM, groundHeightAt(world.config.theaterId, targetCamX, targetCamZ)) + 3.0;
        const targetCamY = Math.max(minCamY, rawCamY);
        camera.position.set(targetCamX, targetCamY, targetCamZ);

        const lookFwdDist = freeLooking ? 18 : 65;
        const lookAheadX = d.x + viewDir.x * lookFwdDist;
        const lookAheadY = d.y + 1.4 + viewDir.y * lookFwdDist;
        const lookAheadZ = d.z + viewDir.z * lookFwdDist;

        const camBank = freeLooking ? 0 : -d.roll * 0.14;
        camera.up.set(Math.sin(camBank), Math.cos(camBank), 0);
        camera.lookAt(lookAheadX, lookAheadY, lookAheadZ);

        const isZoomed = zoomHeld || zoomToggled;
        const baseFov = p.settings.graphics.fovDeg;
        const targetFov = isZoomed ? 30 : baseFov + Math.min(18, d.mach * 12);
        if (Math.abs(camera.fov - targetFov) > 0.1) {
          camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 9, visualDt);
          camera.updateProjectionMatrix();
        }
      }

      if (world.trauma > 0) {
        const shake = world.trauma * world.trauma * 1.4;
        camera.position.x += (Math.random() - 0.5) * shake;
        camera.position.y += (Math.random() - 0.5) * shake;
        world.trauma = Math.max(0, world.trauma - visualDt * 1.8);
      }

      camera.updateMatrixWorld();

      // Synchronize Web Audio 3D listener with active camera & player velocity
      camera.getWorldDirection(_vec3B);
      audio.updateListener(
        { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        { x: _vec3B.x, y: _vec3B.y, z: _vec3B.z },
        { x: camera.up.x, y: camera.up.y, z: camera.up.z },
        { vx: d.vx, vy: d.vy, vz: d.vz },
      );

      // Every rendered frame: project world-space aim direction & update frame-synced reticle DOM node directly
      const aimDir = world.getDesiredAimDirection();
      const aimFarX = d.x + aimDir.x * 2500;
      const aimFarY = d.y + aimDir.y * 2500;
      const aimFarZ = d.z + aimDir.z * 2500;
      _vec3C.set(aimFarX - camera.position.x, aimFarY - camera.position.y, aimFarZ - camera.position.z);
      const aimForwardDot = _vec3C.dot(_vec3B);
      _vec3A.set(aimFarX, aimFarY, aimFarZ).project(camera);
      let aimNdcX = _vec3A.x;
      let aimNdcY = _vec3A.y;
      if (aimForwardDot <= 0) {
        aimNdcX = -aimNdcX;
        aimNdcY = -aimNdcY;
      }
      const aimOnScreen = aimForwardDot > 1 && Math.abs(aimNdcX) <= 0.94 && Math.abs(aimNdcY) <= 0.92;
      let aimScrX = (aimNdcX * 0.5 + 0.5) * 100;
      let aimScrY = (-aimNdcY * 0.5 + 0.5) * 100;
      const aimDx = aimScrX - 50;
      const aimDy = aimScrY - 50;
      const aimEdgeAngleDeg = (Math.atan2(aimDy, aimDx) * 180) / Math.PI;
      if (!aimOnScreen) {
        const edgeScale = Math.max(Math.abs(aimDx) / 44, Math.abs(aimDy) / 42, 1);
        aimScrX = 50 + aimDx / edgeScale;
        aimScrY = 50 + aimDy / edgeScale;
      }
      aimScrX = Math.max(4, Math.min(96, aimScrX));
      aimScrY = Math.max(5, Math.min(95, aimScrY));
      lastMouseAimScreen = {
        x: aimScrX,
        y: aimScrY,
        onScreen: aimOnScreen,
        edgeAngleDeg: aimEdgeAngleDeg,
      };
      if (p.reticleFrameRef?.current && p.phase === 'playing' && p.settings.controls.scheme === 'mouse_aim') {
        p.reticleFrameRef.current.style.left = `${aimScrX.toFixed(2)}%`;
        p.reticleFrameRef.current.style.top = `${aimScrY.toFixed(2)}%`;
      }

      // Throttled HUD updates (<= 10 Hz)
      hudEmitAccum += visualDt;
      if (hudEmitAccum >= 0.1) {
        hudEmitAccum = 0;
        const headingDeg = (((-d.yaw * 180) / Math.PI) % 360 + 360) % 360;
        const targetDist = Math.hypot(tgt.x - d.x, tgt.y - d.y, tgt.z - d.z);
        const cepM = Math.hypot(prediction.impactX - tgt.x, prediction.impactZ - tgt.z);
        const aliveCount = world.landmarks.filter((l) => l.hp > 0).length;

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

        const cosP = Math.cos(d.pitch);
        const noseScreen = projectPct(
          d.x - Math.sin(d.yaw) * cosP * 2500,
          d.y + Math.sin(d.pitch) * 2500,
          d.z - Math.cos(d.yaw) * cosP * 2500,
        ) ?? { x: 50, y: 50 };

        const mouseAimX = lastMouseAimScreen.x;
        const mouseAimY = lastMouseAimScreen.y;

        const targetScreen = tgt.id ? projectInViewPct(tgt.x, tgt.y, tgt.z) : null;

        let leadScreen: { x: number; y: number } | null = null;
        if (p.settings.gameplay.showLeadIndicator && tgt.kind === 'drone' && tgt.id) {
          const ai = world.aiBots.find((a) => a.id === tgt.id && a.hp > 0);
          const rp = p.remotePilots.find((r) => r.id === tgt.id && r.hp > 0);
          const tvx = ai ? ai.vx : rp ? rp.vx : 0;
          const tvy = ai ? ai.vy : rp ? rp.vy : 0;
          const tvz = ai ? ai.vz : rp ? rp.vz : 0;
          const projSpeed = WEAPONS[selectedWeaponId].initialSpeedMs + 210;
          const leadPt = computeLeadPoint(
            { x: d.x, y: d.y, z: d.z },
            { x: tgt.x, y: tgt.y, z: tgt.z },
            { vx: tvx, vy: tvy, vz: tvz },
            projSpeed,
          );
          leadScreen = projectInViewPct(leadPt.x, leadPt.y, leadPt.z);
        }

        const projSpeedForContacts = WEAPONS[selectedWeaponId].initialSpeedMs + 210;
        const airContacts: AirContactHud[] = [];
        for (const bot of world.aiBots) {
          if (bot.hp <= 0) continue;
          const scr = projectInViewPct(bot.x, bot.y, bot.z);
          if (!scr) continue;
          const distM = Math.round(Math.hypot(bot.x - d.x, bot.y - d.y, bot.z - d.z));
          let leadX: number | null = null;
          let leadY: number | null = null;
          if (bot.team === 'bravo' && p.settings.gameplay.showLeadIndicator && distM < 2600) {
            const lp = computeLeadPoint(
              { x: d.x, y: d.y, z: d.z },
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
          airspeedKnots: Math.round(d.airspeedMs * 1.94384),
          groundSpeedKnots: Math.round(d.groundSpeedMs * 1.94384),
          verticalSpeedMs: Math.round(d.vy),
          mach: Number(d.mach.toFixed(2)),
          altitudeMsl: Math.round(d.y + theater.baseElevationM),
          altitudeAgl: Math.round(d.aglMeters),
          headingDeg: Math.round(headingDeg),
          pitchDeg: Math.round((d.pitch * 180) / Math.PI),
          rollDeg: Math.round((d.roll * 180) / Math.PI),
          gLoad: Number(d.gLoad.toFixed(1)),
          throttlePct: Math.round(d.throttle * 100),
          hp: Math.round(d.hp),
          maxHp: d.maxHp,
          fuelPct: Math.round((d.fuelKg / Math.max(1, d.maxFuelKg)) * 100),
          stalling: d.stalling,
          activeSlot: world.activeSlot,
          activeFireMode: world.getActiveFireMode(),
          slotAmmo: [...world.slotAmmo] as [number, number, number, number],
          slotCooldowns: world.slotCooldowns.map((c) => Number(c.toFixed(1))) as [number, number, number, number],
          lockedTargetId: tgt.id,
          lockedTargetKind: tgt.kind,
          lockedTargetName: tgt.name,
          lockedTargetDistM: Math.round(targetDist),
          lockedTargetHpPct: tgt.hpPct !== null ? Math.round(tgt.hpPct) : null,
          lockedTargetCompromisedSec: Math.max(
            0,
            Math.ceil((world.cyberStatus.get(tgt.id ?? '')?.until ?? 0) - sortieTimeSec),
          ),
          incomingCyberThreat: world.incomingThreat
            ? `${world.incomingThreat.sourceName} (${Math.max(0, world.incomingThreat.remainingSec).toFixed(1)}s)`
            : null,
          playerCyberDisruptedSec: Math.max(0, Math.ceil(world.playerDisruptedUntil - sortieTimeSec)),
          cyberCooldownSec: Number(world.cyberCooldownSec.toFixed(1)),
          predictedCepM: Math.round(cepM),
          predictedApogeeM: Math.round(prediction.apogeeM + theater.baseElevationM),
          score: world.score,
          targetsDestroyed: world.landmarks.length - aliveCount,
          totalTargets: world.landmarks.length,
          localGravityMs2: Number(atmos.localGravityMs2.toFixed(3)),
          solarElevationDeg: Math.round(solar.elevationDeg),
          solarChargeW: Math.round(d.solarChargeRateW),
          windSpeedKnots: Math.round(weather.windSpeedMs * 1.94384),
          sortieTimeSec: Math.round(sortieTimeSec),
          missilesIncoming: world.activeOrdnance.filter(
            (o) => o.ownerId !== 'player' && !o.ownerId.startsWith('ally-'),
          ).length,
          radarLocked: world.isRadarLocked(),
          flaresRemaining: world.flaresRemaining,
          flareCooldownSec: Number(world.flareCooldownSec.toFixed(1)),
          mouseAimScreenX: mouseAimX,
          mouseAimScreenY: mouseAimY,
          aimOnScreen: lastMouseAimScreen.onScreen,
          aimEdgeAngleDeg: Number(lastMouseAimScreen.edgeAngleDeg.toFixed(1)),
          pointerLocked: mouseInput.pointerLocked,
          noseScreenX: noseScreen.x,
          noseScreenY: noseScreen.y,
          targetScreenX: targetScreen ? targetScreen.x : null,
          targetScreenY: targetScreen ? targetScreen.y : null,
          leadScreenX: leadScreen ? leadScreen.x : null,
          leadScreenY: leadScreen ? leadScreen.y : null,
          zoomed: zoomHeld || zoomToggled,
          wepActive: d.throttle > 1.0,
          kamikazeArmed: world.kamikazeArmed,
          kamikazeCapable: AIRFRAMES[p.loadout.airframeId].kamikazeCapable,
          reserveDrones: world.reserveDrones,
          blueTickets: world.blueTickets,
          redTickets: world.redTickets,
          freeLooking,
          combatHitCallout: world.combatHitCallout,
          airContacts,
          missionPhase: world.mission.phase,
          missionPhaseNumber: world.mission.phaseNumber,
          missionTitle: world.mission.title,
          missionObjective: world.mission.objective,
          markedTargetIds: [...world.mission.markedTargetIds],
          requiredReconMarks: world.mission.requiredReconMarks,
          reconScanProgress: Number(world.mission.reconScanProgress.toFixed(2)),
          reconScanTargetName:
            world.landmarks.find((l) => l.id === world.mission.reconScanTargetId)?.name ?? null,
        });
      }

      broadcastAccum += visualDt;
      if (p.phase === 'playing' && broadcastAccum >= 0.08) {
        broadcastAccum = 0;
        p.onPlayerStateBroadcast(d, sortieTimeSec);
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
        camera.position.set(world.drone.x + 34, world.drone.y + 11, world.drone.z);
        camera.lookAt(world.drone.x, world.drone.y + 1, world.drone.z - 12);
      } else {
        camera.position.set(world.drone.x, world.drone.y + 7.5, world.drone.z + 24);
        camera.lookAt(world.drone.x, world.drone.y, world.drone.z - 45);
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
      if (terrainDisposeToken) terrainDisposeToken.disposed = true;
      if (playerMeshHandle.disposeToken) playerMeshHandle.disposeToken.disposed = true;
      for (const m of aiMeshes.values()) {
        if (m.disposeToken) m.disposeToken.disposed = true;
      }
      for (const m of remoteMeshes.values()) {
        if (m.disposeToken) m.disposeToken.disposed = true;
      }
      sharedAssetPipeline.disposeObject3D(scene);
      if (initialEnvTex && !hdriOwned) {
        initialEnvTex.dispose();
        initialEnvTex = null;
      }
      smokeTex.dispose();
      delete winAny.__AEROSTRIKE_DEBUG__;

      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      document.removeEventListener('pointerlockerror', handlePointerLockError);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('pointerup', handleCanvasPointerUp);
      renderer.domElement.removeEventListener('pointerenter', handleCanvasPointerEnter);
      renderer.domElement.removeEventListener('pointerleave', handleCanvasPointerLeave);
      renderer.domElement.removeEventListener('pointerdown', handleCanvasPointerDown);
      renderer.domElement.removeEventListener('pointermove', handleCanvasPointerMove);
      renderer.domElement.removeEventListener('wheel', handleCanvasWheel);
      renderer.domElement.removeEventListener('contextmenu', handleContextMenu);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      releasePointerLock();
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
