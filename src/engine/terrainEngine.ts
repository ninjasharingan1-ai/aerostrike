import * as THREE from 'three';
import { groundHeightAt, THEATERS } from '../sim/geoTheaters';
import { TheaterId } from '../sim/types';

function createTerrainAlbedoDetailTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#e5e7eb';
    ctx.fillRect(0, 0, 512, 512);

    for (let i = 0; i < 1600; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const w = 4 + Math.random() * 24;
      const h = 2 + Math.random() * 8;
      const shade = 200 + Math.floor(Math.random() * 52);
      ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
      ctx.fillRect(x, y, w, h);
    }

    // Scorched artillery/shell craters and tactical terrain tracks
    for (let c = 0; c < 18; c++) {
      const cx = Math.random() * 512;
      const cy = Math.random() * 512;
      const r = 6 + Math.random() * 14;
      const grad = ctx.createRadialGradient(cx, cy, r * 0.15, cx, cy, r);
      grad.addColorStop(0, 'rgba(30, 26, 22, 0.32)');
      grad.addColorStop(0.65, 'rgba(65, 58, 50, 0.14)');
      grad.addColorStop(1, 'rgba(65, 58, 50, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = 'rgba(80, 90, 100, 0.14)';
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
  tex.repeat.set(38, 38);
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
        const ridge = Math.sin(x * 0.09) * Math.cos(y * 0.07) * 28;
        const v = Math.max(0, Math.min(255, Math.floor(124 + ridge + (Math.random() - 0.5) * 48)));
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
      [128, 128, 96, 0.38],
      [88, 134, 68, 0.34],
      [170, 132, 72, 0.32],
      [120, 94, 62, 0.28],
      [146, 156, 60, 0.26],
    ];
    for (const [cx, cy, r, alpha] of puffs) {
      const grad = ctx.createRadialGradient(cx, cy, r * 0.15, cx, cy, r);
      grad.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
      grad.addColorStop(0.55, `rgba(241, 245, 249, ${alpha * 0.55})`);
      grad.addColorStop(1, 'rgba(241, 245, 249, 0)');
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

/**
 * Generates hypsometrically + slope-shaded 3D DEM terrain matching groundHeightAt(theaterId, x, z) 1-to-1,
 * plus instanced battlefield cover (pines/desert rocks/craters), specular water, and volumetric cloud cards.
 */
export function buildTheaterTerrain(
  theaterId: TheaterId,
  maxAnisotropy: number,
): { terrainMesh: THREE.Mesh; waterMesh: THREE.Mesh | null; cloudGroup: THREE.Group; propGroup: THREE.Group } {
  const theater = THEATERS[theaterId];
  const size = theater.worldRadiusM * 2;
  const segments = 160;

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
      if (y < 8) {
        c.setHex(0xc2ab87);
      } else if (y < 110) {
        c.setHex(0xa8845b);
      } else if (y < 240) {
        c.setHex(0x845f40);
      } else {
        c.setHex(0x635044);
      }
      cliffColor.setHex(0x543e30);
    } else if (theaterId === 'alps') {
      if (y < 45) {
        c.setHex(0x3f7547);
      } else if (y < 190) {
        c.setHex(0x475e43);
      } else if (y < 360) {
        c.setHex(0x6c747e);
      } else {
        c.setHex(0xeef4fa);
      }
      cliffColor.setHex(0x525a64);
    } else if (theaterId === 'hormuz') {
      if (y < 2) {
        c.setHex(0x9a8866);
      } else if (y < 65) {
        c.setHex(0xc7a372);
      } else {
        c.setHex(0x916746);
      }
      cliffColor.setHex(0x694832);
    } else {
      if (y < 3) {
        c.setHex(0x9b9479);
      } else if (y < 32) {
        c.setHex(0x376646);
      } else {
        c.setHex(0x547052);
      }
      cliffColor.setHex(0x4a554c);
    }

    c.lerp(cliffColor, Math.min(0.85, slopeFactor * 2.1));

    const shade = 0.9 + Math.sin(x * 0.015) * Math.cos(z * 0.015) * 0.09;
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
    roughness: 0.86,
    metalness: 0.05,
    bumpMap: bumpTex,
    bumpScale: 2.6,
  });

  const terrainMesh = new THREE.Mesh(geo, mat);
  terrainMesh.receiveShadow = true;

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

  // Instanced Ground Cover Props (Pines for Alps/Baltic, Desert Boulders for Edwards/Hormuz) + Battlefield Craters
  const propGroup = new THREE.Group();
  const isArid = theaterId === 'edwards' || theaterId === 'hormuz';
  const coverCount = 130;
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

  const craterCount = 40;
  const craterGeo = new THREE.RingGeometry(4.5, 11.5, 10);
  craterGeo.rotateX(-Math.PI / 2);
  const craterMat = new THREE.MeshStandardMaterial({
    color: 0x27211c,
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const craterInst = new THREE.InstancedMesh(craterGeo, craterMat, craterCount);
  craterInst.frustumCulled = false;

  const dummy = new THREE.Object3D();
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

  let cratersPlaced = 0;
  for (let i = 0; i < 80 && cratersPlaced < craterCount; i++) {
    const cx = Math.sin(i * 45.12 + 3.1) * 1650;
    const cz = -950 + Math.cos(i * 29.7 + 1.2) * 1450;
    const cy = groundHeightAt(theaterId, cx, cz);
    if (cy <= theater.waterLevelM + 1.5) continue;
    dummy.position.set(cx, cy + 0.35, cz);
    dummy.rotation.set(0, i * 0.8, 0);
    const sc = 0.8 + ((i * 19) % 10) * 0.16;
    dummy.scale.set(sc, 1, sc);
    dummy.updateMatrix();
    craterInst.setMatrixAt(cratersPlaced++, dummy.matrix);
  }
  craterInst.count = cratersPlaced;
  craterInst.instanceMatrix.needsUpdate = true;
  propGroup.add(craterInst);

  // Tactical ground supply tracks/runway strips linking major theater installations
  const roadMat = new THREE.MeshStandardMaterial({
    color: isArid ? 0x6f5b43 : 0x3f4742,
    roughness: 0.94,
    metalness: 0.02,
  });
  for (let i = 0; i < Math.min(4, theater.landmarks.length - 1); i++) {
    const a = theater.landmarks[i];
    const b = theater.landmarks[i + 1];
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    if (dist < 80) continue;
    const midX = (a.x + b.x) * 0.5;
    const midZ = (a.z + b.z) * 0.5;
    const gy = groundHeightAt(theaterId, midX, midZ);
    if (gy <= theater.waterLevelM + 1) continue;
    const roadGeo = new THREE.BoxGeometry(10, 0.4, dist);
    const road = new THREE.Mesh(roadGeo, roadMat);
    road.position.set(midX, gy + 0.2, midZ);
    road.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
    propGroup.add(road);
  }

  // Multi-layer high-altitude volumetric cloud deck billboards (3 altitude tiers)
  const cloudGroup = new THREE.Group();
  const cloudTex = createCloudTexture();
  const cloudMat = new THREE.MeshBasicMaterial({
    map: cloudTex,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const cloudPlaneGeo = new THREE.PlaneGeometry(820, 820);
  cloudPlaneGeo.rotateX(-Math.PI / 2);

  const spread = theater.worldRadiusM * 1.5;
  for (let i = 0; i < 42; i++) {
    const angle = i * 2.39996;
    const rad = Math.sqrt((i + 0.5) / 42) * spread;
    const baseY = 880 + (i % 5) * 165;
    const scale = 0.78 + (i % 5) * 0.26;
    const cx = Math.cos(angle) * rad;
    const cz = Math.sin(angle) * rad;

    const card = new THREE.Mesh(cloudPlaneGeo, cloudMat);
    card.position.set(cx, baseY, cz);
    card.scale.setScalar(scale);
    card.rotation.y = angle;
    cloudGroup.add(card);

    // Subtle secondary puff layer for vertical cumulus volume
    if (i % 2 === 0) {
      const upper = new THREE.Mesh(cloudPlaneGeo, cloudMat);
      upper.position.set(cx + 65, baseY + 55, cz - 45);
      upper.scale.setScalar(scale * 0.72);
      upper.rotation.y = angle + 0.9;
      cloudGroup.add(upper);
    }
  }

  return { terrainMesh, waterMesh, cloudGroup, propGroup };
}
