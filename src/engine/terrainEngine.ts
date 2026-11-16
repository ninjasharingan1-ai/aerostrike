import * as THREE from 'three';
import { STAGE_A_PATHS } from '../assets/assetManifest';
import { groundHeightAt, THEATERS } from '../sim/geoTheaters';
import { TheaterId } from '../sim/types';
import { sharedAssetPipeline } from './assetPipeline';

function createTerrainAlbedoDetailTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#ece6dc';
    ctx.fillRect(0, 0, 512, 512);

    for (let i = 0; i < 1600; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const w = 4 + Math.random() * 24;
      const h = 2 + Math.random() * 8;
      const shade = 212 + Math.floor(Math.random() * 40);
      ctx.fillStyle = `rgb(${shade},${shade - 4},${shade - 10})`;
      ctx.fillRect(x, y, w, h);
    }

    for (let c = 0; c < 14; c++) {
      const cx = Math.random() * 512;
      const cy = Math.random() * 512;
      const r = 6 + Math.random() * 14;
      const grad = ctx.createRadialGradient(cx, cy, r * 0.15, cx, cy, r);
      grad.addColorStop(0, 'rgba(65, 55, 44, 0.24)');
      grad.addColorStop(0.65, 'rgba(95, 82, 66, 0.10)');
      grad.addColorStop(1, 'rgba(95, 82, 66, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = 'rgba(110, 96, 78, 0.14)';
    ctx.lineWidth = 1;
    for (let y = 0; y < 512; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= 512; x += 16) {
        ctx.lineTo(x, y + Math.sin(x * 0.04 + y * 0.02) * 3);
      }
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(42, 42);
  return tex;
}

function createTerrainBumpTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const img = ctx.createImageData(256, 256);
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const idx = (y * 256 + x) * 4;
        const ridge = Math.sin(x * 0.09) * Math.cos(y * 0.07) * 24;
        const v = Math.max(0, Math.min(255, Math.floor(126 + ridge + (Math.random() - 0.5) * 38)));
        img.data[idx] = v;
        img.data[idx + 1] = v;
        img.data[idx + 2] = v;
        img.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(52, 52);
  return tex;
}

function createCloudTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 256, 256);
    const puffs = [
      [128, 128, 102, 0.42],
      [82, 136, 74, 0.36],
      [174, 130, 76, 0.34],
      [118, 88, 66, 0.3],
      [148, 162, 64, 0.28],
    ];
    for (const [cx, cy, r, alpha] of puffs) {
      const grad = ctx.createRadialGradient(cx, cy, r * 0.12, cx, cy, r);
      grad.addColorStop(0, `rgba(255, 252, 245, ${alpha})`);
      grad.addColorStop(0.52, `rgba(236, 242, 249, ${alpha * 0.52})`);
      grad.addColorStop(1, 'rgba(236, 242, 249, 0)');
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

export interface TheaterTerrainBuild {
  terrainMesh: THREE.Mesh;
  waterMesh: THREE.Mesh | null;
  cloudGroup: THREE.Group;
  propGroup: THREE.Group;
  disposeToken: { disposed: boolean };
}

function findFirstMesh(root: THREE.Object3D): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  root.traverse((obj) => {
    if (!found && (obj as THREE.Mesh).isMesh) {
      found = obj as THREE.Mesh;
    }
  });
  return found;
}

/**
 * Generates hypsometrically + slope-shaded 3D DEM terrain matching groundHeightAt(theaterId, x, z) 1-to-1.
 * Stage A upgrades Sector 04 ('edwards') with Poly Haven CC0 1K PBR sand/rock/asphalt maps,
 * slope-splatted cliff rock shader injection, instanced Barrel_01 drums, and bounded boulder_01 outcrops.
 */
export function buildTheaterTerrain(
  theaterId: TheaterId,
  maxAnisotropy: number,
  isSoftwareGl = false,
): TheaterTerrainBuild {
  const theater = THEATERS[theaterId];
  const size = theater.worldRadiusM * 2;
  const segments = theaterId === 'edwards' ? 144 : 144;
  const disposeToken = { disposed: false };

  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, groundHeightAt(theaterId, x, z));
  }
  geo.computeVertexNormals();

  const normals = geo.attributes.normal as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const cliffColor = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ny = Math.max(0, Math.min(1, normals.getY(i)));
    const slopeFactor = Math.max(0, 1 - ny);

    if (theaterId === 'edwards') {
      if (y < 6) {
        c.setHex(0xd4be9b); // Sunlit alkali lakebed
      } else if (y < 75) {
        c.setHex(0xc29e72); // Desert alluvial basin sand
      } else if (y < 190) {
        c.setHex(0x9a714d); // Sandstone mid-ridges
      } else {
        c.setHex(0x745845); // High basalt crests
      }
      cliffColor.setHex(0x5d4434);
    } else if (theaterId === 'alps') {
      if (y < 45) c.setHex(0x3f7547);
      else if (y < 190) c.setHex(0x475e43);
      else if (y < 360) c.setHex(0x6c747e);
      else c.setHex(0xeef4fa);
      cliffColor.setHex(0x525a64);
    } else if (theaterId === 'hormuz') {
      if (y < 2) c.setHex(0x9a8866);
      else if (y < 65) c.setHex(0xc7a372);
      else c.setHex(0x916746);
      cliffColor.setHex(0x694832);
    } else {
      if (y < 3) c.setHex(0x9b9479);
      else if (y < 32) c.setHex(0x376646);
      else c.setHex(0x547052);
      cliffColor.setHex(0x4a554c);
    }

    c.lerp(cliffColor, Math.min(0.85, slopeFactor * 2.1));

    const shade = 0.92 + Math.sin(x * 0.014) * Math.cos(z * 0.014) * 0.08;
    colors[i * 3] = c.r * shade;
    colors[i * 3 + 1] = c.g * shade;
    colors[i * 3 + 2] = c.b * shade;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const detailTex = createTerrainAlbedoDetailTexture();
  detailTex.anisotropy = maxAnisotropy;
  const bumpTex = createTerrainBumpTexture();
  bumpTex.anisotropy = maxAnisotropy;

  const mat = new THREE.MeshStandardMaterial({
    map: detailTex,
    vertexColors: true,
    roughness: theaterId === 'edwards' ? 0.9 : 0.86,
    metalness: 0.03,
    bumpMap: bumpTex,
    bumpScale: theaterId === 'edwards' ? 1.8 : 2.6,
  });

  const terrainMesh = new THREE.Mesh(geo, mat);
  terrainMesh.receiveShadow = true;

  const propGroup = new THREE.Group();

  // Stage A Sector 04 Poly Haven CC0 1K PBR Texture & Scanned Prop Upgrades
  if (theaterId === 'edwards') {
    Promise.all([
      sharedAssetPipeline.loadTexture(STAGE_A_PATHS.sandDiff, { srgb: true, repeatX: 46, repeatY: 46 }),
      sharedAssetPipeline.loadTexture(STAGE_A_PATHS.sandNor, { srgb: false, repeatX: 46, repeatY: 46 }),
      sharedAssetPipeline.loadTexture(STAGE_A_PATHS.sandRough, { srgb: false, repeatX: 46, repeatY: 46 }),
      sharedAssetPipeline.loadTexture(STAGE_A_PATHS.rockDiff, { srgb: true, repeatX: 38, repeatY: 38 }),
    ])
      .then(([sandDiff, sandNor, sandRough, rockDiff]) => {
        if (disposeToken.disposed) return;

        mat.map = sandDiff;
        mat.normalMap = sandNor;
        mat.normalScale.set(1.15, 1.15);
        mat.roughnessMap = sandRough;
        mat.bumpMap = null;
        mat.roughness = 0.92;
        mat.onBeforeCompile = (shader) => {
          shader.uniforms.uRockMap = { value: rockDiff };
          shader.vertexShader = shader.vertexShader
            .replace(
              '#include <common>',
              '#include <common>\nvarying vec3 vWorldPos;\nvarying vec3 vWorldNorm;',
            )
            .replace(
              '#include <begin_vertex>',
              '#include <begin_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWorldNorm = normalize(mat3(modelMatrix) * objectNormal);',
            );
          shader.fragmentShader = shader.fragmentShader
            .replace(
              '#include <common>',
              '#include <common>\nuniform sampler2D uRockMap;\nvarying vec3 vWorldPos;\nvarying vec3 vWorldNorm;',
            )
            .replace(
              '#include <map_fragment>',
              `#include <map_fragment>
               vec2 sandMacroUv = mat2(0.8, -0.6, 0.6, 0.8) * (vWorldPos.xz * 0.0024) + vec2(0.37, 0.71);
               vec4 sandMacro = texture2D(map, sandMacroUv);
               float sandBlend = 0.5 + 0.5 * sin(vWorldPos.x * 0.0027) * cos(vWorldPos.z * 0.0031);
               diffuseColor.rgb = mix(diffuseColor.rgb, sandMacro.rgb, 0.36 + 0.24 * sandBlend);

               vec2 rockUvA = vWorldPos.xz * 0.011;
               vec2 rockUvB = mat2(0.8, -0.6, 0.6, 0.8) * (vWorldPos.xz * 0.0041) + vec2(0.19, 0.43);
               vec4 rockTexelA = texture2D(uRockMap, rockUvA);
               vec4 rockTexelB = texture2D(uRockMap, rockUvB);
               vec4 rockTexel = mix(rockTexelA, rockTexelB, 0.45);
               float slopeMix = smoothstep(0.08, 0.34, 1.0 - max(0.0, vWorldNorm.y));
               float elevMix = smoothstep(45.0, 180.0, vWorldPos.y) * 0.65;
               float rockWeight = clamp(max(slopeMix, elevMix), 0.0, 0.88);
               diffuseColor.rgb = mix(diffuseColor.rgb, rockTexel.rgb * 1.15, rockWeight);`,
            );
        };
        mat.customProgramCacheKey = () => 'aerostrike-sector04-splat-v2';
        mat.needsUpdate = true;

        // Clean local procedural detail/bump once Poly Haven maps are active
        detailTex.dispose();
        bumpTex.dispose();
      })
      .catch(() => {
        // Fallback procedural canvas textures remain valid
      });

    // Marked Mesa Dry Lake Runway & Tarmac Apron with Poly Haven Asphalt PBR
    const runwayGroup = new THREE.Group();
    const apronBaseY = groundHeightAt(theaterId, 0, -200);
    const asphaltMat = new THREE.MeshStandardMaterial({
      color: 0x3b3f46,
      roughness: 0.85,
      metalness: 0.08,
    });
    const runwaySlab = new THREE.Mesh(new THREE.BoxGeometry(34, 0.6, 360), asphaltMat);
    runwaySlab.position.set(0, apronBaseY + 0.3, -200);
    runwaySlab.receiveShadow = true;
    runwayGroup.add(runwaySlab);

    const apronPad = new THREE.Mesh(new THREE.BoxGeometry(88, 0.55, 110), asphaltMat);
    apronPad.position.set(-46, apronBaseY + 0.28, -200);
    apronPad.receiveShadow = true;
    runwayGroup.add(apronPad);

    const markMat = new THREE.MeshBasicMaterial({ color: 0xf1f5f9 });
    for (let z = -340; z <= -60; z += 24) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 10), markMat);
      dash.position.set(0, apronBaseY + 0.64, z);
      runwayGroup.add(dash);
    }
    for (let t = -3; t <= 3; t++) {
      if (t === 0) continue;
      for (const tz of [-366, -34]) {
        const piano = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 12), markMat);
        piano.position.set(t * 4.2, apronBaseY + 0.64, tz);
        runwayGroup.add(piano);
      }
    }
    propGroup.add(runwayGroup);

    Promise.all([
      sharedAssetPipeline.loadTexture(STAGE_A_PATHS.asphaltDiff, { srgb: true, repeatX: 4, repeatY: 16 }),
      sharedAssetPipeline.loadTexture(STAGE_A_PATHS.asphaltNor, { srgb: false, repeatX: 4, repeatY: 16 }),
      sharedAssetPipeline.loadTexture(STAGE_A_PATHS.asphaltRough, { srgb: false, repeatX: 4, repeatY: 16 }),
    ])
      .then(([aDiff, aNor, aRough]) => {
        if (disposeToken.disposed) return;
        asphaltMat.map = aDiff;
        asphaltMat.normalMap = aNor;
        asphaltMat.roughnessMap = aRough;
        asphaltMat.color.setHex(0xffffff);
        asphaltMat.needsUpdate = true;
      })
      .catch(() => {});

    // Instanced Poly Haven Barrel_01 drums around Mesa Airfield & Logistics Depot
    sharedAssetPipeline
      .loadModel(STAGE_A_PATHS.propBarrel)
      .then((sceneRoot) => {
        if (disposeToken.disposed) return;
        const barrelSrc = findFirstMesh(sceneRoot);
        if (!barrelSrc) return;
        barrelSrc.geometry.computeBoundingSphere();

        const barrelCount = 20;
        const barrelInst = new THREE.InstancedMesh(barrelSrc.geometry, barrelSrc.material, barrelCount);
        barrelInst.castShadow = !isSoftwareGl;
        barrelInst.receiveShadow = true;

        const anchors: [number, number][] = [
          [-26, -210], [-27.5, -211], [-26, -212.5], [-28, -208],
          [-25, -184], [-26.5, -185], [-27, -182.5],
          [22, -196], [23.4, -197], [21.8, -198.2],
          [1160, -1942], [1161.5, -1940.5], [1158.5, -1943], [1163, -1942.5],
          [1198, -1962], [1199.4, -1960.8], [1197, -1963.5],
          [-1230, -2090], [-1228.5, -2091.5], [-1232, -2089],
        ];
        const dummy = new THREE.Object3D();
        for (let i = 0; i < barrelCount; i++) {
          const [bx, bz] = anchors[i];
          const by = groundHeightAt(theaterId, bx, bz);
          dummy.position.set(bx, by, bz);
          dummy.rotation.set(0, (i * 1.17) % (Math.PI * 2), 0);
          dummy.scale.setScalar(1.45);
          dummy.updateMatrix();
          barrelInst.setMatrixAt(i, dummy.matrix);
        }
        barrelInst.instanceMatrix.needsUpdate = true;
        propGroup.add(barrelInst);
      })
      .catch(() => {});

    // Bounded Poly Haven Scanned boulder_01 outcrops (~66k tris -> capped strictly at 10 hero outcrops)
    sharedAssetPipeline
      .loadModel(STAGE_A_PATHS.propBoulder)
      .then((sceneRoot) => {
        if (disposeToken.disposed) return;
        const boulderSrc = findFirstMesh(sceneRoot);
        if (!boulderSrc) return;
        boulderSrc.geometry.computeBoundingSphere();

        const boulderCount = isSoftwareGl ? 2 : 5;
        const boulderInst = new THREE.InstancedMesh(boulderSrc.geometry, boulderSrc.material, boulderCount);
        boulderInst.castShadow = false;
        boulderInst.receiveShadow = true;

        const sites: [number, number, number][] = [
          [-240, 260, 4.2],
          [290, 180, 5.4],
          [-410, -480, 6.0],
          [480, -640, 5.8],
          [-640, -1180, 7.2],
        ];
        const dummy = new THREE.Object3D();
        for (let i = 0; i < boulderCount; i++) {
          const [rx, rz, sc] = sites[i];
          const ry = groundHeightAt(theaterId, rx, rz);
          dummy.position.set(rx, ry - sc * 0.25, rz);
          dummy.rotation.set(0.08 * (i % 3), i * 1.37, 0);
          dummy.scale.set(sc, sc * 0.72, sc * 0.9);
          dummy.updateMatrix();
          boulderInst.setMatrixAt(i, dummy.matrix);
        }
        boulderInst.instanceMatrix.needsUpdate = true;
        propGroup.add(boulderInst);
      })
      .catch(() => {});
  }

  let waterMesh: THREE.Mesh | null = null;
  if (theater.waterLevelM > -100) {
    const waterGeo = new THREE.PlaneGeometry(size, size, 1, 1);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshStandardMaterial({
      color: theaterId === 'hormuz' ? 0x0e5a6d : 0x16465e,
      roughness: 0.12,
      metalness: 0.68,
      transparent: true,
      opacity: 0.9,
    });
    waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.position.y = theater.waterLevelM;
    waterMesh.receiveShadow = true;
  }

  // Non-Stage-A procedural cover (pines/rocks) on Alps/Hormuz/Baltic, plus craters across theaters
  const isArid = theaterId === 'edwards' || theaterId === 'hormuz';
  const dummy = new THREE.Object3D();

  if (theaterId !== 'edwards') {
    const coverCount = 120;
    const coverGeo = isArid
      ? new THREE.DodecahedronGeometry(6.5, 0)
      : new THREE.ConeGeometry(5.5, 22, 6);
    if (!isArid) {
      coverGeo.translate(0, 11, 0);
    } else {
      coverGeo.translate(0, 2.5, 0);
    }
    const coverMat = new THREE.MeshStandardMaterial({
      color: isArid ? 0x7c6348 : 0x264b34,
      roughness: 0.9,
      metalness: 0.04,
    });
    const coverInst = new THREE.InstancedMesh(coverGeo, coverMat, coverCount);
    coverInst.frustumCulled = false;

    let coverPlaced = 0;
    for (let i = 0; i < 240 && coverPlaced < coverCount; i++) {
      const px = Math.sin(i * 12.9898 + 1.4) * theater.worldRadiusM * 0.72;
      const pz = Math.cos(i * 78.233 + 0.7) * theater.worldRadiusM * 0.72;
      const py = groundHeightAt(theaterId, px, pz);
      if (py <= theater.waterLevelM + 2) continue;
      const nearLandmark = theater.landmarks.some((l) => Math.hypot(l.x - px, l.z - pz) < 95);
      if (nearLandmark) continue;
      dummy.position.set(px, py, pz);
      dummy.rotation.set(0, (i * 1.7) % (Math.PI * 2), 0);
      const sc = 0.7 + ((i * 37) % 100) / 90;
      dummy.scale.set(sc, sc * (isArid ? 0.65 : 1.1), sc);
      dummy.updateMatrix();
      coverInst.setMatrixAt(coverPlaced++, dummy.matrix);
    }
    coverInst.count = coverPlaced;
    coverInst.instanceMatrix.needsUpdate = true;
    propGroup.add(coverInst);
  }

  // Battlefield impact craters
  const craterCount = 32;
  const craterGeo = new THREE.RingGeometry(4.5, 11.5, 12);
  craterGeo.rotateX(-Math.PI / 2);
  const craterMat = new THREE.MeshStandardMaterial({
    color: 0x3b3026,
    roughness: 0.96,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const craterInst = new THREE.InstancedMesh(craterGeo, craterMat, craterCount);
  craterInst.frustumCulled = false;

  let cratersPlaced = 0;
  for (let i = 0; i < 80 && cratersPlaced < craterCount; i++) {
    const cx = Math.sin(i * 45.12 + 3.1) * 1650;
    const cz = -950 + Math.cos(i * 29.7 + 1.2) * 1450;
    const cy = groundHeightAt(theaterId, cx, cz);
    if (cy <= theater.waterLevelM + 1.5) continue;
    const nearRunway = theaterId === 'edwards' && Math.abs(cx) < 120 && cz > -420 && cz < 40;
    if (nearRunway) continue;
    dummy.position.set(cx, cy + 0.28, cz);
    dummy.rotation.set(0, i * 0.8, 0);
    const sc = 0.75 + ((i * 19) % 10) * 0.14;
    dummy.scale.set(sc, 1, sc);
    dummy.updateMatrix();
    craterInst.setMatrixAt(cratersPlaced++, dummy.matrix);
  }
  craterInst.count = cratersPlaced;
  craterInst.instanceMatrix.needsUpdate = true;
  propGroup.add(craterInst);

  // Backlit volumetric desert cloud deck billboards (3 altitude tiers)
  const cloudGroup = new THREE.Group();
  const cloudTex = createCloudTexture();
  const cloudMat = new THREE.MeshBasicMaterial({
    map: cloudTex,
    color: theaterId === 'edwards' ? 0xfcf5e8 : 0xf8fafc,
    transparent: true,
    opacity: theaterId === 'edwards' ? 0.56 : 0.62,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const cloudPlaneGeo = new THREE.PlaneGeometry(860, 860);
  cloudPlaneGeo.rotateX(-Math.PI / 2);

  const spread = theater.worldRadiusM * 1.55;
  for (let i = 0; i < 42; i++) {
    const angle = i * 2.39996;
    const rad = Math.sqrt((i + 0.5) / 42) * spread;
    const baseY = 920 + (i % 5) * 165;
    const scale = 0.8 + (i % 5) * 0.25;
    const cx = Math.cos(angle) * rad;
    const cz = Math.sin(angle) * rad;

    const card = new THREE.Mesh(cloudPlaneGeo, cloudMat);
    card.position.set(cx, baseY, cz);
    card.scale.setScalar(scale);
    card.rotation.y = angle;
    cloudGroup.add(card);

    if (i % 2 === 0) {
      const upper = new THREE.Mesh(cloudPlaneGeo, cloudMat);
      upper.position.set(cx + 68, baseY + 58, cz - 46);
      upper.scale.setScalar(scale * 0.72);
      upper.rotation.y = angle + 0.9;
      cloudGroup.add(upper);
    }
  }

  return { terrainMesh, waterMesh, cloudGroup, propGroup, disposeToken };
}
