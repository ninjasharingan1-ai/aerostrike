import * as THREE from 'three';
import { STAGE_A_PATHS } from '../assets/assetManifest';
import { WEAPONS } from '../sim/arsenalData';
import { AirframeId, TheaterLandmark, WeaponCategory, WeaponId } from '../sim/types';
import { sharedAssetPipeline } from './assetPipeline';

export interface DroneMeshHandle {
  group: THREE.Group;
  propellers: THREE.Object3D[];
  exhaustGlows: THREE.Mesh[];
  aileronsPort?: THREE.Object3D[];
  aileronsStbd?: THREE.Object3D[];
  ruddervatorsPort?: THREE.Object3D[];
  ruddervatorsStbd?: THREE.Object3D[];
  eoirTurrets?: THREE.Object3D[];
  lod?: THREE.LOD | null;
  isGlbHero?: boolean;
  disposeToken?: { disposed: boolean };
}

function createAirframePanelTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#5c6672';
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = 'rgba(20, 26, 34, 0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 256; i += 32) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 256);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(256, i);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    for (let x = 8; x < 256; x += 32) {
      for (let y = 8; y < 256; y += 32) {
        ctx.fillRect(x, y, 2, 2);
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

let sharedPanelTex: THREE.CanvasTexture | null = null;
function getPanelTexture(): THREE.CanvasTexture {
  if (!sharedPanelTex) {
    sharedPanelTex = createAirframePanelTexture();
  }
  return sharedPanelTex;
}

function getAirframeBaseColor(airframeId: AirframeId): number {
  switch (airframeId) {
    case 'bayraktar_tb2':
      return 0x5c6670; // Tactical Ukrainian/Turkish slate grey
    case 'baba_yaga':
      return 0x262b33; // Carbon-fiber matte black
    case 'punisher_ua':
      return 0x3b4440; // Olive stealth composite
    case 'shahed_136':
      return 0x4b4e45; // Olive-charcoal Geran-2 composite
    case 'iai_harop':
      return 0x8b95a1; // Light IAF air-defense grey
    case 'hermes_900':
      return 0x9aa3ad; // Israeli bright tactical grey
    case 'mohajer_6':
      return 0xa89b7e; // Desert sand-khaki
    case 'orion_ru':
      return 0x505964; // Russian RuAF dark steel grey
    case 'zala_lancet':
      return 0x626b75; // Tactical grey composite
    case 'xq58a':
      return 0x363d47; // RAM stealth charcoal
    case 'switchblade_x':
      return 0x454f5b;
    default:
      return 0x7c8794;
  }
}

function attachHardpointOrdnance(
  group: THREE.Group,
  pylonOffsets: [number, number, number][],
  equippedSlots: WeaponId[] | undefined,
  darkMetalMat: THREE.Material,
  accentMat: THREE.Material,
) {
  const oliveOrdMat = new THREE.MeshStandardMaterial({ color: 0x4b5d3f, roughness: 0.45, metalness: 0.4 });
  const lightOrdMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.35, metalness: 0.65 });
  const copperMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.32, metalness: 0.78 });

  const slots: WeaponId[] = equippedSlots ?? ['mam_l', 'pg7vl_drop', 'r73_archer', 'm61_vulcan'];

  for (let i = 0; i < pylonOffsets.length; i++) {
    const [px, py, pz] = pylonOffsets[i];
    const wId = slots[i % slots.length];
    const spec = WEAPONS[wId];

    // Pylon strut
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.48), darkMetalMat);
    pylon.position.set(px, py + 0.1, pz);
    group.add(pylon);

    const storeY = py - 0.08;
    if (spec.category === 'drop_bomb') {
      // Twin-cluster RPG/mortar drop canister
      for (const offset of [-0.07, 0.07]) {
        const bombBody = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.045, 0.72, 8), oliveOrdMat);
        bombBody.rotation.x = Math.PI / 2;
        bombBody.position.set(px + offset, storeY, pz);
        group.add(bombBody);
        const nose = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 8), copperMat);
        nose.rotation.x = -Math.PI / 2;
        nose.position.set(px + offset, storeY, pz - 0.44);
        group.add(nose);
      }
    } else if (spec.category === 'cannon') {
      // Twin-barrel rotary autocannon gun pod
      const pod = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 1.05), darkMetalMat);
      pod.position.set(px, storeY, pz);
      group.add(pod);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.65, 8), lightOrdMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(px, storeY, pz - 0.7);
      group.add(barrel);
    } else if (spec.category === 'glide_bomb') {
      const bomb = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.075, 1.1, 10), lightOrdMat);
      bomb.rotation.x = Math.PI / 2;
      bomb.position.set(px, storeY, pz);
      group.add(bomb);
      const foldedWing = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.03, 0.52), darkMetalMat);
      foldedWing.position.set(px, storeY + 0.04, pz);
      group.add(foldedWing);
    } else if (spec.category === 'ballistic_missile' || spec.category === 'cruise_missile') {
      const heavyBody = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 1.65, 10), oliveOrdMat);
      heavyBody.rotation.x = Math.PI / 2;
      heavyBody.position.set(px, storeY - 0.04, pz);
      group.add(heavyBody);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.38, 10), accentMat);
      tip.rotation.x = -Math.PI / 2;
      tip.position.set(px, storeY - 0.04, pz - 1.0);
      group.add(tip);
    } else {
      // ATGM / AAM missile rail
      const mBody = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.25, 8), lightOrdMat);
      mBody.rotation.x = Math.PI / 2;
      mBody.position.set(px, storeY, pz);
      group.add(mBody);
      const seeker = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), darkMetalMat);
      seeker.position.set(px, storeY, pz - 0.64);
      group.add(seeker);
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.03, 0.16), darkMetalMat);
      fin.position.set(px, storeY, pz + 0.48);
      group.add(fin);
    }
  }
}

/**
 * Builds composite 8-14 part procedural 3D UAV drone models oriented along -Z forward.
 * Supports Ukraine, Israel, Iran, Russia, Syria, and experimental airframes with live mounted weapons.
 */
export function buildDroneMesh(
  airframeId: AirframeId,
  accentHex = 0xf59e0b,
  equippedSlots?: WeaponId[],
): DroneMeshHandle {
  const outerGroup = new THREE.Group();
  const group = new THREE.Group();
  outerGroup.add(group);

  const propellers: THREE.Object3D[] = [];
  const exhaustGlows: THREE.Mesh[] = [];
  const disposeToken = { disposed: false };
  const handle: DroneMeshHandle = {
    group: outerGroup,
    propellers,
    exhaustGlows,
    aileronsPort: [],
    aileronsStbd: [],
    ruddervatorsPort: [],
    ruddervatorsStbd: [],
    eoirTurrets: [],
    lod: null,
    isGlbHero: false,
    disposeToken,
  };

  const hullMat = new THREE.MeshStandardMaterial({
    color: getAirframeBaseColor(airframeId),
    map: getPanelTexture(),
    roughness: airframeId === 'xq58a' ? 0.72 : 0.54,
    metalness: 0.26,
  });

  const darkMetalMat = new THREE.MeshStandardMaterial({
    color: 0x1a2029,
    roughness: 0.25,
    metalness: 0.88,
  });

  const opticGlassMat = new THREE.MeshPhysicalMaterial({
    color: 0x0ea5e9,
    roughness: 0.08,
    metalness: 0.1,
    clearcoat: 1.0,
    emissive: 0x062d42,
    emissiveIntensity: 0.75,
  });

  const accentMat = new THREE.MeshStandardMaterial({
    color: accentHex,
    emissive: accentHex,
    emissiveIntensity: 0.45,
    roughness: 0.3,
    metalness: 0.4,
  });

  const glowMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
  });

  const buildProp = (x: number, y: number, z: number, bladeLen: number, blades = 2) => {
    const propHub = new THREE.Group();
    propHub.position.set(x, y, z);
    const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.3, 10), darkMetalMat);
    spinner.rotation.x = Math.PI / 2;
    propHub.add(spinner);
    for (let b = 0; b < blades; b++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.09, bladeLen, 0.025), darkMetalMat);
      blade.rotation.z = (b * Math.PI * 2) / blades;
      blade.position.set(Math.sin(blade.rotation.z) * (bladeLen * 0.32), Math.cos(blade.rotation.z) * (bladeLen * 0.32), 0);
      propHub.add(blade);
    }
    group.add(propHub);
    propellers.push(propHub);
  };

  if (airframeId === 'bayraktar_tb2' || airframeId === 'mohajer_6') {
    const isMohajer = airframeId === 'mohajer_6';
    const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 4.6, 14), hullMat);
    fuse.rotation.x = Math.PI / 2;
    fuse.position.set(0, 0, -0.35);
    group.add(fuse);

    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 10), hullMat);
    nose.scale.set(0.85, 0.8, 1.85);
    nose.position.set(0, 0.08, -2.55);
    group.add(nose);

    const wing = new THREE.Mesh(new THREE.BoxGeometry(isMohajer ? 8.8 : 9.8, 0.08, 0.78), hullMat);
    wing.position.set(0, 0.14, 0.05);
    group.add(wing);

    for (const side of [-1, 1]) {
      // Twin tail booms extending backward from wing
      const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.055, 4.1, 8), darkMetalMat);
      boom.rotation.x = Math.PI / 2;
      boom.position.set(side * 1.15, 0.16, 1.8);
      group.add(boom);

      if (isMohajer) {
        // Vertical H-tail fins
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.85, 0.55), hullMat);
        fin.position.set(side * 1.15, 0.52, 3.65);
        group.add(fin);
      } else {
        // Inverted V-tail joining booms (classic TB2 silhouette)
        const vTail = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.06, 0.48), hullMat);
        vTail.position.set(side * 0.62, 0.55, 3.65);
        vTail.rotation.z = side * 0.65;
        group.add(vTail);
      }
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.09, 0.66), accentMat);
      tip.position.set(side * (isMohajer ? 4.45 : 4.95), 0.16, 0.1);
      group.add(tip);
    }
    if (isMohajer) {
      const hStab = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.06, 0.48), hullMat);
      hStab.position.set(0, 0.92, 3.65);
      group.add(hStab);
    }

    // Chin WESCAM EO/IR ball turret
    const opticBall = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), opticGlassMat);
    opticBall.position.set(0, -0.36, -1.75);
    group.add(opticBall);

    attachHardpointOrdnance(
      group,
      [
        [-2.6, -0.02, 0.08],
        [-1.65, -0.02, 0.08],
        [1.65, -0.02, 0.08],
        [2.6, -0.02, 0.08],
      ],
      equippedSlots,
      darkMetalMat,
      accentMat,
    );
    buildProp(0, 0.06, 1.98, 1.25, 2);
  } else if (airframeId === 'baba_yaga') {
    // Ukrainian Heavy Hexacopter Night Bomber ("Baba Yaga")
    const centerDeck = new THREE.Mesh(new THREE.CylinderGeometry(0.88, 0.95, 0.34, 6), hullMat);
    group.add(centerDeck);

    const canopyDome = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 8), darkMetalMat);
    canopyDome.scale.set(1.0, 0.45, 1.1);
    canopyDome.position.set(0, 0.22, -0.1);
    group.add(canopyDome);

    const thermalCam = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 10), opticGlassMat);
    thermalCam.position.set(0, -0.26, -0.62);
    group.add(thermalCam);

    // 6 radial arms + motor bells + spinning horizontal rotors
    for (let i = 0; i < 6; i++) {
      const ang = (i * Math.PI) / 3 + Math.PI / 6;
      const armX = Math.cos(ang) * 1.45;
      const armZ = Math.sin(ang) * 1.45;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.09, 2.2), darkMetalMat);
      arm.position.set(armX * 0.65, 0.06, armZ * 0.65);
      arm.rotation.y = Math.atan2(armX, armZ);
      group.add(arm);

      const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.18, 10), accentMat);
      motor.position.set(Math.cos(ang) * 2.15, 0.14, Math.sin(ang) * 2.15);
      group.add(motor);

      const rotorHub = new THREE.Group();
      rotorHub.position.set(Math.cos(ang) * 2.15, 0.26, Math.sin(ang) * 2.15);
      for (let b = 0; b < 2; b++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.02, 0.1), darkMetalMat);
        blade.rotation.y = b * (Math.PI / 2);
        rotorHub.add(blade);
      }
      // Subtle translucent rotor blur disc
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(0.76, 18),
        new THREE.MeshBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.18, side: THREE.DoubleSide }),
      );
      disc.rotation.x = -Math.PI / 2;
      rotorHub.add(disc);
      // Push horizontal spinning axis marker by wrapping with rotation.x = Math.PI/2? No, tick rotates rotation.z!
      // Orient hub so rotation.z spins in horizontal XZ plane
      rotorHub.rotation.x = Math.PI / 2;
      for (const child of rotorHub.children) {
        if (child === disc) {
          child.rotation.x = 0;
        } else {
          child.rotation.set(Math.PI / 2, 0, child.rotation.y);
        }
      }
      group.add(rotorHub);
      propellers.push(rotorHub);
    }

    // Skid landing legs + underbelly multi-bomb drop rack
    for (const side of [-1, 1]) {
      const skid = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 8), darkMetalMat);
      skid.rotation.x = Math.PI / 2;
      skid.position.set(side * 0.82, -0.78, 0);
      group.add(skid);
    }
    attachHardpointOrdnance(
      group,
      [
        [-0.45, -0.24, -0.15],
        [-0.18, -0.24, 0.2],
        [0.18, -0.24, 0.2],
        [0.45, -0.24, -0.15],
      ],
      equippedSlots,
      darkMetalMat,
      accentMat,
    );
  } else if (airframeId === 'shahed_136' || airframeId === 'iai_harop') {
    const isHarop = airframeId === 'iai_harop';
    const deltaShape = new THREE.Shape();
    deltaShape.moveTo(0, -2.55);
    deltaShape.lineTo(0.45, -1.65);
    deltaShape.lineTo(isHarop ? 2.45 : 2.15, 1.35);
    deltaShape.lineTo(isHarop ? 2.45 : 2.15, 2.05);
    deltaShape.lineTo(0.32, 1.9);
    deltaShape.lineTo(-0.32, 1.9);
    deltaShape.lineTo(isHarop ? -2.45 : -2.15, 2.05);
    deltaShape.lineTo(isHarop ? -2.45 : -2.15, 1.35);
    deltaShape.lineTo(-0.45, -1.65);
    deltaShape.closePath();

    const wingGeo = new THREE.ExtrudeGeometry(deltaShape, {
      depth: 0.14,
      bevelEnabled: true,
      bevelSize: 0.05,
      bevelThickness: 0.04,
    });
    wingGeo.rotateX(Math.PI / 2);
    const wing = new THREE.Mesh(wingGeo, hullMat);
    wing.position.set(0, 0.06, 0);
    group.add(wing);

    // Central spine & warhead nose section
    const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 3.8, 12), hullMat);
    spine.rotation.x = Math.PI / 2;
    spine.position.set(0, 0.08, -0.2);
    group.add(spine);

    const warheadNose = new THREE.Mesh(
      new THREE.ConeGeometry(0.24, 1.15, 12),
      isHarop ? opticGlassMat : darkMetalMat,
    );
    warheadNose.rotation.x = -Math.PI / 2;
    warheadNose.position.set(0, 0.08, -2.65);
    group.add(warheadNose);

    // Vertical wingtip fins (classic Shahed-136 & Harop endplates)
    for (const side of [-1, 1]) {
      const tipFin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.85, 0.92), hullMat);
      tipFin.position.set(side * (isHarop ? 2.45 : 2.15), 0.15, 1.65);
      group.add(tipFin);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.18, 0.88), accentMat);
      stripe.position.set(side * (isHarop ? 2.45 : 2.15), 0.42, 1.65);
      group.add(stripe);
    }

    attachHardpointOrdnance(
      group,
      [
        [-1.15, -0.08, 0.75],
        [-0.55, -0.08, 0.45],
        [0.55, -0.08, 0.45],
        [1.15, -0.08, 0.75],
      ],
      equippedSlots,
      darkMetalMat,
      accentMat,
    );
    buildProp(0, 0.08, 2.02, 1.15, 2);
  } else if (airframeId === 'zala_lancet') {
    // Russian ZALA Lancet-3 Dual Cruciform X-Wing Loitering Munition
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.16, 3.2, 12), hullMat);
    tube.rotation.x = Math.PI / 2;
    group.add(tube);

    const noseDome = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), opticGlassMat);
    noseDome.position.set(0, 0, -1.62);
    group.add(noseDome);

    // 4 Forward X-wings + 4 Aft X-wings at 45°
    for (const angle of [Math.PI / 4, -Math.PI / 4]) {
      const fwdX = new THREE.Mesh(new THREE.BoxGeometry(2.65, 0.045, 0.36), hullMat);
      fwdX.position.set(0, 0, -0.35);
      fwdX.rotation.z = angle;
      group.add(fwdX);

      const aftX = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.04, 0.28), darkMetalMat);
      aftX.position.set(0, 0, 1.08);
      aftX.rotation.z = angle;
      group.add(aftX);
    }
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.3, 12), accentMat);
    band.rotation.x = Math.PI / 2;
    band.position.set(0, 0, -0.95);
    group.add(band);

    attachHardpointOrdnance(
      group,
      [
        [-0.45, -0.18, -0.25],
        [-0.22, -0.18, 0.15],
        [0.22, -0.18, 0.15],
        [0.45, -0.18, -0.25],
      ],
      equippedSlots,
      darkMetalMat,
      accentMat,
    );
    buildProp(0, 0, 1.68, 0.92, 2);
  } else if (airframeId === 'punisher_ua') {
    // UA Dynamics Punisher Composite Spec-Ops Raid Bomber
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.16, 3.6, 12), hullMat);
    pod.rotation.x = Math.PI / 2;
    group.add(pod);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.07, 0.56), hullMat);
    wing.position.set(0, 0.1, -0.1);
    group.add(wing);
    const vTailL = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.05, 0.38), hullMat);
    vTailL.position.set(-0.38, 0.35, 1.55);
    vTailL.rotation.z = -0.62;
    group.add(vTailL);
    const vTailR = vTailL.clone();
    vTailR.position.x = 0.38;
    vTailR.rotation.z = 0.62;
    group.add(vTailR);
    const optic = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), opticGlassMat);
    optic.position.set(0, -0.22, -1.1);
    group.add(optic);
    attachHardpointOrdnance(
      group,
      [
        [-1.35, 0.02, -0.05],
        [-0.65, 0.02, -0.05],
        [0.65, 0.02, -0.05],
        [1.35, 0.02, -0.05],
      ],
      equippedSlots,
      darkMetalMat,
      accentMat,
    );
    buildProp(0, 0.02, 1.85, 0.95, 2);
  } else if (airframeId === 'mq9x' || airframeId === 'hermes_900' || airframeId === 'orion_ru') {
    const fuseGeo = new THREE.CylinderGeometry(0.32, 0.22, 6.2, 16);
    fuseGeo.rotateX(Math.PI / 2);
    group.add(new THREE.Mesh(fuseGeo, hullMat));

    const domeGeo = new THREE.SphereGeometry(0.42, 16, 12);
    domeGeo.scale(0.88, 0.82, 1.85);
    const dome = new THREE.Mesh(domeGeo, hullMat);
    dome.position.set(0, 0.14, -2.15);
    group.add(dome);

    const wing = new THREE.Mesh(new THREE.BoxGeometry(airframeId === 'orion_ru' ? 10.6 : 11.4, 0.09, 0.82), hullMat);
    wing.position.set(0, 0.04, 0.15);
    group.add(wing);

    for (const side of [-1, 1]) {
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.1, 0.72), accentMat);
      tip.position.set(side * (airframeId === 'orion_ru' ? 5.35 : 5.75), 0.06, 0.22);
      group.add(tip);
      const vTail = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.07, 0.55), hullMat);
      vTail.position.set(side * 0.58, 0.48, 2.55);
      // Hermes 900 & Orion feature upward V-tail; Reaper features inverted V-tail
      vTail.rotation.z = side * (airframeId === 'mq9x' ? 0.62 : -0.62);
      group.add(vTail);
    }
    if (airframeId === 'mq9x') {
      const ventralFin = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.75, 0.65), darkMetalMat);
      ventralFin.position.set(0, -0.45, 2.45);
      group.add(ventralFin);
    }

    const turretHousing = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.22, 12), darkMetalMat);
    turretHousing.position.set(0, -0.35, -1.9);
    group.add(turretHousing);
    const opticBall = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 12), opticGlassMat);
    opticBall.position.set(0, -0.48, -1.9);
    group.add(opticBall);

    attachHardpointOrdnance(
      group,
      [
        [-2.4, -0.1, 0.15],
        [-1.35, -0.1, 0.15],
        [1.35, -0.1, 0.15],
        [2.4, -0.1, 0.15],
      ],
      equippedSlots,
      darkMetalMat,
      accentMat,
    );
    buildProp(0, 0, 3.15, 1.35, 3);
  } else if (airframeId === 'xq58a') {
    const chineShape = new THREE.Shape();
    chineShape.moveTo(0, -3.4);
    chineShape.lineTo(0.65, -1.2);
    chineShape.lineTo(0.55, 2.4);
    chineShape.lineTo(0.32, 3.1);
    chineShape.lineTo(-0.32, 3.1);
    chineShape.lineTo(-0.55, 2.4);
    chineShape.lineTo(-0.65, -1.2);
    chineShape.closePath();

    const chineGeo = new THREE.ExtrudeGeometry(chineShape, {
      depth: 0.48,
      bevelEnabled: true,
      bevelThickness: 0.12,
      bevelSize: 0.14,
      bevelSegments: 2,
    });
    chineGeo.rotateX(Math.PI / 2);
    const body = new THREE.Mesh(chineGeo, hullMat);
    body.position.set(0, 0.24, 0);
    group.add(body);

    const wingShape = new THREE.Shape();
    wingShape.moveTo(0.45, -0.7);
    wingShape.lineTo(4.2, 1.25);
    wingShape.lineTo(4.2, 1.85);
    wingShape.lineTo(0.45, 1.35);
    wingShape.closePath();
    const wingGeoR = new THREE.ExtrudeGeometry(wingShape, { depth: 0.08, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.02 });
    wingGeoR.rotateX(Math.PI / 2);
    const wingR = new THREE.Mesh(wingGeoR, hullMat);
    wingR.position.set(0, 0.05, 0);
    group.add(wingR);
    const wingL = wingR.clone();
    wingL.scale.x = -1;
    group.add(wingL);

    const intake = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.24, 1.4), darkMetalMat);
    intake.position.set(0, 0.36, -0.7);
    group.add(intake);

    for (const side of [-1, 1]) {
      const tail = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.07, 0.72), hullMat);
      tail.position.set(side * 0.65, 0.56, 2.35);
      tail.rotation.z = -side * 0.78;
      group.add(tail);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.08, 0.14), accentMat);
      stripe.position.set(side * 0.9, 0.78, 2.35);
      stripe.rotation.z = -side * 0.78;
      group.add(stripe);
    }

    const sensorWindow = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.28), opticGlassMat);
    sensorWindow.position.set(0, -0.26, -1.8);
    group.add(sensorWindow);

    attachHardpointOrdnance(
      group,
      [
        [-2.1, -0.08, 0.65],
        [-1.1, -0.14, 0.35],
        [1.1, -0.14, 0.35],
        [2.1, -0.08, 0.65],
      ],
      equippedSlots,
      darkMetalMat,
      accentMat,
    );

    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.5, 12), darkMetalMat);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.set(0, 0.05, 3.05);
    group.add(nozzle);

    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.19, 12), glowMat);
    glow.position.set(0, 0.05, 3.31);
    group.add(glow);
    exhaustGlows.push(glow);
  } else if (airframeId === 'akinci') {
    const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.26, 6.8, 16), hullMat);
    fuse.rotation.x = Math.PI / 2;
    group.add(fuse);

    const hump = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 12), hullMat);
    hump.scale.set(0.85, 0.75, 2.2);
    hump.position.set(0, 0.22, -1.7);
    group.add(hump);

    for (const side of [-1, 1]) {
      const innerWing = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.11, 1.05), hullMat);
      innerWing.position.set(side * 1.3, 0.18, 0.25);
      innerWing.rotation.z = side * 0.12;
      group.add(innerWing);

      const outerWing = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.09, 0.78), hullMat);
      outerWing.position.set(side * 4.1, 0.34, 0.35);
      outerWing.rotation.z = -side * 0.04;
      group.add(outerWing);

      const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 1.65, 12), darkMetalMat);
      nacelle.rotation.x = Math.PI / 2;
      nacelle.position.set(side * 2.1, 0.25, -0.1);
      group.add(nacelle);

      buildProp(side * 2.1, 0.25, -0.98, 1.15, 4);
    }

    attachHardpointOrdnance(
      group,
      [
        [-3.4, 0.18, 0.3],
        [-1.3, -0.1, 0.2],
        [1.3, -0.1, 0.2],
        [3.4, 0.18, 0.3],
      ],
      equippedSlots,
      darkMetalMat,
      accentMat,
    );

    const vStab = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.25, 0.85), hullMat);
    vStab.position.set(0, 0.72, 2.85);
    group.add(vStab);
    const hStab = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.08, 0.6), hullMat);
    hStab.position.set(0, 0.12, 2.85);
    group.add(hStab);
  } else {
    // Switchblade-X high-speed delta interceptor
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 4.6, 12), hullMat);
    body.rotation.x = Math.PI / 2;
    group.add(body);

    const noseCone = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.2, 12), darkMetalMat);
    noseCone.rotation.x = -Math.PI / 2;
    noseCone.position.set(0, 0, -2.9);
    group.add(noseCone);

    const deltaShape = new THREE.Shape();
    deltaShape.moveTo(0.18, -1.3);
    deltaShape.lineTo(2.85, 1.45);
    deltaShape.lineTo(2.85, 1.95);
    deltaShape.lineTo(0.22, 1.85);
    deltaShape.closePath();
    const deltaGeo = new THREE.ExtrudeGeometry(deltaShape, { depth: 0.06, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02 });
    deltaGeo.rotateX(Math.PI / 2);
    const wingR = new THREE.Mesh(deltaGeo, hullMat);
    group.add(wingR);
    const wingL = wingR.clone();
    wingL.scale.x = -1;
    group.add(wingL);

    const canard = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.04, 0.35), accentMat);
    canard.position.set(0, 0.02, -1.55);
    group.add(canard);

    attachHardpointOrdnance(
      group,
      [
        [-1.4, -0.1, 0.9],
        [-0.75, -0.12, 0.45],
        [0.75, -0.12, 0.45],
        [1.4, -0.1, 0.9],
      ],
      equippedSlots,
      darkMetalMat,
      accentMat,
    );

    const ramjetPod = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 1.9, 12), darkMetalMat);
    ramjetPod.rotation.x = Math.PI / 2;
    ramjetPod.position.set(0, 0.32, 1.15);
    group.add(ramjetPod);

    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.18, 12), glowMat);
    glow.position.set(0, 0.32, 2.11);
    group.add(glow);
    exhaustGlows.push(glow);
  }

  group.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  if (airframeId === 'bayraktar_tb2') {
    sharedAssetPipeline
      .buildLodGroup(
        {
          lod0: STAGE_A_PATHS.tb2Lod0,
          lod1: STAGE_A_PATHS.tb2Lod1,
          lod2: STAGE_A_PATHS.tb2Lod2,
        },
        [0, 140, 480],
      )
      .then((lod) => {
        if (disposeToken.disposed) {
          sharedAssetPipeline.disposeObject3D(lod);
          return;
        }

        const nextProps: THREE.Object3D[] = [];
        const aPort: THREE.Object3D[] = [];
        const aStbd: THREE.Object3D[] = [];
        const rPort: THREE.Object3D[] = [];
        const rStbd: THREE.Object3D[] = [];
        const turrets: THREE.Object3D[] = [];

        lod.traverse((node) => {
          if (node.name === 'propeller_assembly') nextProps.push(node);
          else if (node.name === 'aileron_port') aPort.push(node);
          else if (node.name === 'aileron_stbd') aStbd.push(node);
          else if (node.name === 'ruddervator_port') rPort.push(node);
          else if (node.name === 'ruddervator_stbd') rStbd.push(node);
          else if (node.name === 'eoir_turret') turrets.push(node);
        });

        outerGroup.remove(group);
        sharedAssetPipeline.disposeObject3D(group);
        outerGroup.add(lod);

        handle.propellers.length = 0;
        handle.propellers.push(...nextProps);
        handle.aileronsPort = aPort;
        handle.aileronsStbd = aStbd;
        handle.ruddervatorsPort = rPort;
        handle.ruddervatorsStbd = rStbd;
        handle.eoirTurrets = turrets;
        handle.lod = lod;
        handle.isGlbHero = true;
      })
      .catch(() => {
        // Keep clean procedural TB2 fallback active on load error
      });
  }

  return handle;
}

/**
 * Builds composite 3D ordnance meshes (ballistic missiles, glide bombs, drop bombs, cruise missiles, cannon tracers)
 */
export function buildOrdnanceMesh(category: WeaponCategory): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color:
      category === 'ballistic_missile'
        ? 0xd97706
        : category === 'drop_bomb'
          ? 0x4b5d3f
          : category === 'glide_bomb'
            ? 0x94a3b8
            : 0x334155,
    roughness: 0.35,
    metalness: 0.72,
  });
  const noseMat = new THREE.MeshStandardMaterial({
    color: category === 'drop_bomb' ? 0xd97706 : 0x0f172a,
    roughness: 0.25,
    metalness: 0.85,
  });
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xfb923c });

  if (category === 'cannon') {
    const tracer = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.14, 10.5, 6),
      new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.85 }),
    );
    tracer.rotation.x = Math.PI / 2;
    g.add(tracer);
    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(0.085, 0.085, 11.4, 6),
      new THREE.MeshBasicMaterial({ color: 0xfffbeb }),
    );
    core.rotation.x = Math.PI / 2;
    g.add(core);
    return g;
  }

  if (category === 'drop_bomb') {
    const warhead = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.12, 1.35, 8), bodyMat);
    warhead.rotation.x = Math.PI / 2;
    g.add(warhead);
    const fuseTip = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.45, 8), noseMat);
    fuseTip.rotation.x = -Math.PI / 2;
    fuseTip.position.z = -0.9;
    g.add(fuseTip);
    const tailFins = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.04, 0.35), noseMat);
    tailFins.position.z = 0.65;
    g.add(tailFins);
    return g;
  }

  const len = category === 'ballistic_missile' ? 4.4 : category === 'cruise_missile' ? 3.6 : 2.1;
  const rad = category === 'ballistic_missile' ? 0.28 : 0.16;

  const tube = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, len, 10), bodyMat);
  tube.rotation.x = Math.PI / 2;
  g.add(tube);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(rad, len * 0.35, 10), noseMat);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -len * 0.67;
  g.add(nose);

  if (category === 'glide_bomb' || category === 'cruise_missile') {
    const wings = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.04, 0.36), bodyMat);
    wings.name = 'deployWings';
    g.add(wings);
  }

  if (category !== 'glide_bomb') {
    const plume = new THREE.Mesh(new THREE.ConeGeometry(rad * 1.25, 1.65, 8), flameMat);
    plume.rotation.x = Math.PI / 2;
    plume.position.z = len * 0.68;
    plume.name = 'plume';
    g.add(plume);
  }

  return g;
}

/**
 * Builds composite fortified war-zone ground structures pivoted at bottom-center (y = 0)
 */
export function buildTargetStructure(landmark: Omit<TheaterLandmark, 'hp'>): THREE.Group {
  const g = new THREE.Group();
  const concreteMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.85, metalness: 0.08 });
  const sandbagMat = new THREE.MeshStandardMaterial({ color: 0x7c7058, roughness: 0.92, metalness: 0.02 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.32, metalness: 0.82 });
  const hazardMat = new THREE.MeshStandardMaterial({
    color: landmark.type === 'sam' || landmark.type === 'radar' ? 0xef4444 : 0xf59e0b,
    roughness: 0.4,
    metalness: 0.35,
    emissive: 0x7f1d1d,
    emissiveIntensity: 0.5,
  });

  // Fortified defensive blast berm perimeter for SAM/radar/bunker/depot targets
  if (landmark.type === 'sam' || landmark.type === 'radar' || landmark.type === 'depot') {
    const berm = new THREE.Mesh(
      new THREE.TorusGeometry(landmark.type === 'depot' ? 24 : 21, 2.2, 6, 14),
      sandbagMat,
    );
    berm.rotation.x = Math.PI / 2;
    berm.position.y = 1.1;
    g.add(berm);
  }

  if (landmark.type === 'sam') {
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(16, 18, 2, 12), concreteMat);
    pad.position.y = 1;
    g.add(pad);
    const turret = new THREE.Mesh(new THREE.BoxGeometry(10, 6, 12), steelMat);
    turret.position.y = 5;
    g.add(turret);
    for (let i = -1; i <= 1; i++) {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 14, 8), hazardMat);
      tube.position.set(i * 2.8, 10, -2);
      tube.rotation.x = 0.65;
      g.add(tube);
    }
    const aaaMount = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.8, 3.5, 8), steelMat);
    aaaMount.position.set(13, 1.75, 10);
    g.add(aaaMount);
    const aaaBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 7.5, 6), steelMat);
    aaaBarrel.position.set(13, 5.2, 8);
    aaaBarrel.rotation.x = 0.72;
    g.add(aaaBarrel);
  } else if (landmark.type === 'radar') {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(12, 14, 6, 8), concreteMat);
    base.position.y = 3;
    g.add(base);
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(3, 5, 16, 6), steelMat);
    tower.position.y = 14;
    g.add(tower);
    const radome = new THREE.Mesh(new THREE.SphereGeometry(8.5, 16, 12), concreteMat);
    radome.position.y = 25;
    g.add(radome);
    const scannerArm = new THREE.Mesh(new THREE.BoxGeometry(19, 2.2, 1.8), steelMat);
    scannerArm.position.y = 35.5;
    scannerArm.name = 'radarScanner';
    g.add(scannerArm);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 8), hazardMat);
    beacon.position.y = 38;
    g.add(beacon);
  } else if (landmark.type === 'bunker') {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(36, 8, 28), concreteMat);
    slab.position.y = 4;
    g.add(slab);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(14, 18, 26, 6), concreteMat);
    roof.rotation.z = Math.PI / 2;
    roof.position.y = 9;
    g.add(roof);
    const door = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 2), steelMat);
    door.position.set(0, 3.5, 14.2);
    g.add(door);
  } else if (landmark.type === 'depot') {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(34, 1.5, 28), concreteMat);
    pad.position.y = 0.75;
    g.add(pad);
    for (const [tx, tz] of [[-9, -6], [9, -6], [-9, 6], [9, 6]]) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 5.5, 11, 14), steelMat);
      tank.position.set(tx, 7, tz);
      g.add(tank);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(5.7, 5.7, 1.2, 14), hazardMat);
      cap.position.set(tx, 12.6, tz);
      g.add(cap);
    }
  } else if (landmark.type === 'airbase') {
    const hangar = new THREE.Mesh(new THREE.BoxGeometry(26, 12, 34), concreteMat);
    hangar.position.set(-34, 6, -15);
    g.add(hangar);
    const hangarDoor = new THREE.Mesh(new THREE.BoxGeometry(2, 9, 26), steelMat);
    hangarDoor.position.set(-20.8, 4.5, -15);
    g.add(hangarDoor);
    const shelterB = new THREE.Mesh(new THREE.BoxGeometry(22, 9, 26), concreteMat);
    shelterB.position.set(-34, 4.5, 24);
    g.add(shelterB);
    const tower = new THREE.Mesh(new THREE.BoxGeometry(8, 22, 8), concreteMat);
    tower.position.set(28, 11, 0);
    g.add(tower);
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 5, 4.5, 8), steelMat);
    cab.position.set(28, 23.5, 0);
    g.add(cab);
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 5.6, 1.4, 8), hazardMat);
    beacon.position.set(28, 26.2, 0);
    g.add(beacon);
  } else {
    for (let i = -1; i <= 1; i++) {
      const hull = new THREE.Mesh(new THREE.BoxGeometry(7, 3.6, 13), steelMat);
      hull.position.set(i * 12, 2.2, i * 8);
      g.add(hull);
      const turret = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.0, 2.0, 8), concreteMat);
      turret.position.set(i * 12, 4.8, i * 8 - 1);
      g.add(turret);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 7.5, 6), steelMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(i * 12, 5.0, i * 8 - 5.2);
      g.add(barrel);
      const beacon = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 1.4), hazardMat);
      beacon.position.set(i * 12, 6.1, i * 8 - 1);
      g.add(beacon);
    }
  }

  g.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  return g;
}
