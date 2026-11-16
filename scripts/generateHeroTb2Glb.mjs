import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/**
 * Generates real binary glTF 2.0 (.glb) LOD0 / LOD1 / LOD2 hero aircraft assets for Bayraktar TB2
 * directly in Node without browser DOM dependencies.
 *
 * External dimensions reflect publicly published Bayraktar TB2 airframe proportions:
 * - Wingspan: 12.0 m (x in [-6.0, +6.0])
 * - Fuselage Length: 6.5 m (z from -3.1 nose to +3.4 tail)
 * - Signature features: central pod fuselage, twin tail booms, inverted V-tail (-38 deg),
 *   rear 2-blade pusher propeller, tricycle fixed landing gear, chin EO/IR gimbal turret,
 *   and 4 underwing hardpoint pylons.
 *
 * Hierarchy preserves named articulated sub-nodes for runtime animation:
 * - root
 * - fuselage_pod
 * - wing_main
 * - aileron_port / aileron_stbd
 * - ruddervator_port / ruddervator_stbd
 * - eoir_turret
 * - propeller_assembly
 */

const OUT_DIR = path.resolve(process.cwd(), 'public/assets/models/bayraktar_tb2');
fs.mkdirSync(OUT_DIR, { recursive: true });

// Minimal CRC32 + zlib PNG writer for embedding PBR albedo & metallic-roughness maps into GLB
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePngRgba(width, height, rgba) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const compressed = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function createAirframePbrTextures(size = 512) {
  const albedo = Buffer.alloc(size * size * 4);
  const metalRough = Buffer.alloc(size * size * 4);
  const normal = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const u = x / size;
      const v = y / size;
      const noise = Math.sin(x * 0.37 + y * 0.21) * Math.cos(x * 0.13 - y * 0.43);

      // Panel seam grid (fine tactical carbon-composite paneling)
      const seamX = x % 64 === 0 || x % 64 === 1;
      const seamY = y % 64 === 0 || y % 64 === 1;
      const rivet = x % 64 === 6 && (y % 16 === 6 || y % 16 === 7);

      // Matte NATO low-visibility tactical composite grey with subtle weathering
      let baseR = 114 + Math.round(noise * 5);
      let baseG = 123 + Math.round(noise * 5);
      let baseB = 132 + Math.round(noise * 5);

      // Caution / inspection stencil strip near band v ~ 0.18
      if (v > 0.175 && v < 0.195 && u > 0.1 && u < 0.9) {
        baseR = 205;
        baseG = 152;
        baseB = 46;
      }

      if (seamX || seamY) {
        baseR -= 26;
        baseG -= 26;
        baseB -= 24;
      } else if (rivet) {
        baseR += 18;
        baseG += 18;
        baseB += 18;
      }

      albedo[idx] = Math.max(0, Math.min(255, baseR));
      albedo[idx + 1] = Math.max(0, Math.min(255, baseG));
      albedo[idx + 2] = Math.max(0, Math.min(255, baseB));
      albedo[idx + 3] = 255;

      // glTF MetallicRoughness: G = roughness, B = metalness
      const roughVal = seamX || seamY ? 205 : Math.max(95, Math.min(185, 136 + Math.round(noise * 14)));
      const metalVal = rivet ? 190 : 48;
      metalRough[idx] = 255;
      metalRough[idx + 1] = roughVal;
      metalRough[idx + 2] = metalVal;
      metalRough[idx + 3] = 255;

      // Tangent-space normal map perturbation along panel seams & rivets
      let nx = 0;
      let ny = 0;
      if (x % 64 === 0) nx = -0.35;
      else if (x % 64 === 1) nx = 0.35;
      if (y % 64 === 0) ny = -0.35;
      else if (y % 64 === 1) ny = 0.35;
      const nz = Math.sqrt(Math.max(0.01, 1 - nx * nx - ny * ny));
      normal[idx] = Math.round((nx * 0.5 + 0.5) * 255);
      normal[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normal[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normal[idx + 3] = 255;
    }
  }

  return {
    albedoPng: encodePngRgba(size, size, albedo),
    metalRoughPng: encodePngRgba(size, size, metalRough),
    normalPng: encodePngRgba(size, size, normal),
  };
}

// Geometry builder helpers (positions, normals, uvs, indices -> indexed primitive)
function createPrimBuilder() {
  const pos = [];
  const norm = [];
  const uv = [];
  const idx = [];

  function pushVertex(px, py, pz, nx, ny, nz, u, v) {
    const len = Math.hypot(nx, ny, nz) || 1;
    pos.push(px, py, pz);
    norm.push(nx / len, ny / len, nz / len);
    uv.push(u, v);
    return pos.length / 3 - 1;
  }

  function addQuad(a, b, c, d) {
    idx.push(a, b, c, a, c, d);
  }

  // Loft a closed cross-section ring sequence along an axis
  function addLoftedTube(rings, closedCaps = true) {
    const ringLen = rings[0].length;
    const baseVert = pos.length / 3;

    for (let r = 0; r < rings.length; r++) {
      const ring = rings[r];
      const cx = ring.reduce((s, p) => s + p[0], 0) / ringLen;
      const cy = ring.reduce((s, p) => s + p[1], 0) / ringLen;
      const cz = ring.reduce((s, p) => s + p[2], 0) / ringLen;
      const vCoord = r / Math.max(1, rings.length - 1);

      for (let i = 0; i < ringLen; i++) {
        const p = ring[i];
        const prev = ring[(i - 1 + ringLen) % ringLen];
        const next = ring[(i + 1) % ringLen];
        // Radial approximation blended with local tangent normal
        const rx = p[0] - cx;
        const ry = p[1] - cy;
        const rz = p[2] - cz;
        const rLen = Math.hypot(rx, ry, rz) || 1;
        const tx = next[0] - prev[0];
        const ty = next[1] - prev[1];
        const tz = next[2] - prev[2];
        const axRing = r < rings.length - 1 ? rings[r + 1][i] : p;
        const prevAx = r > 0 ? rings[r - 1][i] : p;
        const bx = axRing[0] - prevAx[0];
        const by = axRing[1] - prevAx[1];
        const bz = axRing[2] - prevAx[2];
        // Cross tangent x axial for smooth normal
        let nx = ty * bz - tz * by;
        let ny = tz * bx - tx * bz;
        let nz = tx * by - ty * bx;
        if (nx * rx + ny * ry + nz * rz < 0) {
          nx = -nx;
          ny = -ny;
          nz = -nz;
        }
        const nLen = Math.hypot(nx, ny, nz);
        if (nLen < 1e-4) {
          nx = rx / rLen;
          ny = ry / rLen;
          nz = rz / rLen;
        }
        pushVertex(p[0], p[1], p[2], nx, ny, nz, i / ringLen, vCoord);
      }
    }

    for (let r = 0; r < rings.length - 1; r++) {
      for (let i = 0; i < ringLen; i++) {
        const nextI = (i + 1) % ringLen;
        const a = baseVert + r * ringLen + i;
        const b = baseVert + r * ringLen + nextI;
        const c = baseVert + (r + 1) * ringLen + nextI;
        const d = baseVert + (r + 1) * ringLen + i;
        addQuad(a, b, c, d);
      }
    }

    if (closedCaps) {
      const startRing = rings[0];
      const scx = startRing.reduce((s, p) => s + p[0], 0) / ringLen;
      const scy = startRing.reduce((s, p) => s + p[1], 0) / ringLen;
      const scz = startRing.reduce((s, p) => s + p[2], 0) / ringLen;
      const sCenter = pushVertex(scx, scy, scz, 0, 0, -1, 0.5, 0);
      for (let i = 0; i < ringLen; i++) {
        const nextI = (i + 1) % ringLen;
        idx.push(sCenter, baseVert + nextI, baseVert + i);
      }

      const lastR = rings.length - 1;
      const endRing = rings[lastR];
      const ecx = endRing.reduce((s, p) => s + p[0], 0) / ringLen;
      const ecy = endRing.reduce((s, p) => s + p[1], 0) / ringLen;
      const ecz = endRing.reduce((s, p) => s + p[2], 0) / ringLen;
      const eCenter = pushVertex(ecx, ecy, ecz, 0, 0, 1, 0.5, 1);
      const eBase = baseVert + lastR * ringLen;
      for (let i = 0; i < ringLen; i++) {
        const nextI = (i + 1) % ringLen;
        idx.push(eCenter, eBase + i, eBase + nextI);
      }
    }
  }

  function addBox(cx, cy, cz, sx, sy, sz, rotX = 0, rotY = 0, rotZ = 0) {
    const hx = sx * 0.5;
    const hy = sy * 0.5;
    const hz = sz * 0.5;
    const corners = [
      [-hx, -hy, -hz],
      [hx, -hy, -hz],
      [hx, hy, -hz],
      [-hx, hy, -hz],
      [-hx, -hy, hz],
      [hx, -hy, hz],
      [hx, hy, hz],
      [-hx, hy, hz],
    ];
    const xform = (v) => {
      let [x, y, z] = v;
      if (rotX) {
        const c = Math.cos(rotX), s = Math.sin(rotX);
        [y, z] = [y * c - z * s, y * s + z * c];
      }
      if (rotY) {
        const c = Math.cos(rotY), s = Math.sin(rotY);
        [x, z] = [x * c + z * s, -x * s + z * c];
      }
      if (rotZ) {
        const c = Math.cos(rotZ), s = Math.sin(rotZ);
        [x, y] = [x * c - y * s, x * s + y * c];
      }
      return [x + cx, y + cy, z + cz];
    };
    const pts = corners.map(xform);
    const faces = [
      [[0, 3, 2, 1], [0, 0, -1]],
      [[4, 5, 6, 7], [0, 0, 1]],
      [[3, 7, 6, 2], [0, 1, 0]],
      [[0, 1, 5, 4], [0, -1, 0]],
      [[1, 2, 6, 5], [1, 0, 0]],
      [[0, 4, 7, 3], [-1, 0, 0]],
    ];
    for (const [fIdx, rawN] of faces) {
      const rn = xform([rawN[0], rawN[1], rawN[2]]);
      const fnx = rn[0] - cx;
      const fny = rn[1] - cy;
      const fnz = rn[2] - cz;
      const base = pos.length / 3;
      const uvs = [[0, 0], [0, 1], [1, 1], [1, 0]];
      for (let k = 0; k < 4; k++) {
        const p = pts[fIdx[k]];
        pushVertex(p[0], p[1], p[2], fnx, fny, fnz, uvs[k][0], uvs[k][1]);
      }
      addQuad(base, base + 1, base + 2, base + 3);
    }
  }

  function addCylinder(x0, y0, z0, x1, y1, z1, r0, r1, segs = 12) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dy, dz) || 1;
    const ax = dx / len, ay = dy / len, az = dz / len;
    // Orthogonal basis
    const up = Math.abs(ay) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let ux = ay * up[2] - az * up[1];
    let uy = az * up[0] - ax * up[2];
    let uz = ax * up[1] - ay * up[0];
    const uLen = Math.hypot(ux, uy, uz) || 1;
    ux /= uLen; uy /= uLen; uz /= uLen;
    const vx = ay * uz - az * uy;
    const vy = az * ux - ax * uz;
    const vz = ax * uy - ay * ux;

    const ring0 = [];
    const ring1 = [];
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      ring0.push([
        x0 + (ux * ca + vx * sa) * r0,
        y0 + (uy * ca + vy * sa) * r0,
        z0 + (uz * ca + vz * sa) * r0,
      ]);
      ring1.push([
        x1 + (ux * ca + vx * sa) * r1,
        y1 + (uy * ca + vy * sa) * r1,
        z1 + (uz * ca + vz * sa) * r1,
      ]);
    }
    addLoftedTube([ring0, ring1], true);
  }

  function addAirfoilSpan(spanStations, chordPts = 14) {
    // NACA-2412-like cambered airfoil ring at each station { x, y, z, chord, thickness, twistRad }
    const rings = spanStations.map((st) => {
      const ring = [];
      for (let i = 0; i < chordPts * 2; i++) {
        // Walk from trailing edge upper -> leading edge -> trailing edge lower
        const isUpper = i < chordPts;
        const frac = isUpper ? 1 - i / chordPts : (i - chordPts) / chordPts;
        const xc = 0.5 * (1 - Math.cos(frac * Math.PI)); // cosine clustering at LE & TE
        const yt =
          5 *
          st.thickness *
          (0.2969 * Math.sqrt(Math.max(0, xc)) - 0.126 * xc - 0.3516 * xc * xc + 0.2843 * xc * xc * xc - 0.1036 * Math.pow(xc, 4));
        const camber = st.chord * 0.024 * Math.sin(Math.PI * xc);
        const halfT = yt * st.chord;
        const localY = camber + (isUpper ? halfT : -halfT);
        const localZ = (xc - 0.32) * st.chord;
        const cT = Math.cos(st.twistRad || 0);
        const sT = Math.sin(st.twistRad || 0);
        const ry = localY * cT - localZ * sT;
        const rz = localY * sT + localZ * cT;
        ring.push([st.x, st.y + ry, st.z + rz]);
      }
      return ring;
    });
    addLoftedTube(rings, true);
  }

  return {
    pos,
    norm,
    uv,
    idx,
    addLoftedTube,
    addBox,
    addCylinder,
    addAirfoilSpan,
    get triCount() {
      return idx.length / 3;
    },
  };
}

function buildTb2LodModel(detailLevel) {
  // detailLevel: 0 (LOD0 hero), 1 (LOD1 mid), 2 (LOD2 far)
  const radSegs = detailLevel === 0 ? 20 : detailLevel === 1 ? 12 : 7;
  const chordPts = detailLevel === 0 ? 14 : detailLevel === 1 ? 8 : 4;
  const wingSteps = detailLevel === 0 ? 7 : detailLevel === 1 ? 4 : 2;

  const hullPrim = createPrimBuilder();
  const darkMetalPrim = createPrimBuilder();
  const opticGlassPrim = createPrimBuilder();
  const pylonOrdnancePrim = createPrimBuilder();
  const aileronPortPrim = createPrimBuilder();
  const aileronStbdPrim = createPrimBuilder();
  const rvPortPrim = createPrimBuilder();
  const rvStbdPrim = createPrimBuilder();
  const propPrim = createPrimBuilder();

  // 1. Blended Teardrop TB2 Central Fuselage Pod (6.5m overall craft; main pod z: -3.05 to +1.85)
  const fuseStations = [
    { z: -3.08, yOff: -0.02, rx: 0.03, ry: 0.03 },
    { z: -2.85, yOff: 0.02, rx: 0.14, ry: 0.12 },
    { z: -2.42, yOff: 0.07, rx: 0.23, ry: 0.21 }, // bulbous SATCOM fairing nose
    { z: -1.75, yOff: 0.11, rx: 0.29, ry: 0.28 },
    { z: -0.95, yOff: 0.08, rx: 0.30, ry: 0.26 },
    { z: -0.15, yOff: 0.05, rx: 0.29, ry: 0.24 },
    { z: 0.65, yOff: 0.04, rx: 0.27, ry: 0.22 },
    { z: 1.35, yOff: 0.04, rx: 0.22, ry: 0.18 },
    { z: 1.82, yOff: 0.04, rx: 0.15, ry: 0.14 }, // Rotax pusher spinner collar
  ];
  const fuseRings = fuseStations.map((st) => {
    const ring = [];
    for (let i = 0; i < radSegs; i++) {
      const a = (i / radSegs) * Math.PI * 2;
      // Slightly flatter belly + smooth top dorsal SATCOM bulge
      const yScale = Math.sin(a) < 0 ? 0.86 : 1.08;
      ring.push([
        Math.cos(a) * st.rx,
        st.yOff + Math.sin(a) * st.ry * yScale,
        st.z,
      ]);
    }
    return ring;
  });
  hullPrim.addLoftedTube(fuseRings, true);

  // Dorsal NACA engine air scoop on rear upper fuselage
  hullPrim.addBox(0, 0.28, 0.85, 0.2, 0.12, 0.72, -0.08, 0, 0);

  // 2. Main 12.0m High-Aspect Wing (span x: -6.0 .. +6.0m) with dihedral & swept upturned winglets
  for (const side of [-1, 1]) {
    const stations = [];
    for (let s = 0; s <= wingSteps; s++) {
      const frac = s / wingSteps;
      const x = side * (0.22 + frac * 5.45);
      const chord = 0.92 * (1 - frac * 0.44);
      const zCenter = 0.02 + frac * 0.28; // slight leading edge sweep
      const y = 0.15 + Math.pow(frac, 1.3) * 0.14; // subtle elastic dihedral
      stations.push({ x, y, z: zCenter, chord, thickness: 0.125, twistRad: -0.02 * frac });
    }
    // Upturned composite winglet tip (span +0.33m)
    stations.push({ x: side * 5.95, y: 0.56, z: 0.45, chord: 0.34, thickness: 0.09, twistRad: 0 });
    if (side === -1) stations.reverse();
    hullPrim.addAirfoilSpan(stations, chordPts);
  }

  // Articulated Ailerons (built at local hinge origin inside aileron_port/aileron_stbd nodes)
  aileronPortPrim.addBox(0, 0, 0, 1.9, 0.035, 0.22);
  aileronStbdPrim.addBox(0, 0, 0, 1.9, 0.035, 0.22);

  // 3. Twin Tail Booms (x = +/- 1.18m, z = 0.15m .. +3.35m) & Inverted V-Tail
  for (const side of [-1, 1]) {
    hullPrim.addCylinder(side * 1.18, 0.18, 0.05, side * 1.18, 0.24, 3.38, 0.082, 0.056, Math.max(8, radSegs - 4));
    // Boom fairing root fairing collar
    if (detailLevel === 0) {
      hullPrim.addBox(side * 1.18, 0.18, 0.25, 0.2, 0.16, 0.65);
    }
  }

  // Inverted V-Tail fixed stabilizers meeting at central dorsal apex (y = +0.96m, z = 3.22m)
  for (const side of [-1, 1]) {
    const vStabStations = [
      { x: side * 0.05, y: 0.94, z: 3.12, chord: 0.58, thickness: 0.09, twistRad: 0 },
      { x: side * 1.18, y: 0.24, z: 3.28, chord: 0.48, thickness: 0.09, twistRad: 0 },
      { x: side * 1.46, y: 0.06, z: 3.34, chord: 0.38, thickness: 0.08, twistRad: 0 },
    ];
    if (side === -1) vStabStations.reverse();
    hullPrim.addAirfoilSpan(vStabStations, Math.max(4, chordPts - 2));
  }
  // Articulated inverted-V ruddervators (built at local origin inside rotated/translated tail hinge nodes)
  rvPortPrim.addBox(0, 0, 0, 1.38, 0.04, 0.22);
  rvStbdPrim.addBox(0, 0, 0, 1.38, 0.04, 0.22);

  // 4. Pusher Engine Exhaust, Spinner & 2-Blade Propeller Assembly (at z = 1.92m, pivoted at origin in node)
  darkMetalPrim.addCylinder(0, 0.04, 1.72, 0, 0.04, 1.94, 0.13, 0.1, 12);
  // Prop assembly built centered around local (0, 0, 0) in node placed at (0, 0.04, 1.94)
  propPrim.addCylinder(0, 0, -0.02, 0, 0, 0.24, 0.125, 0.02, 12); // Spinner cone
  for (const side of [-1, 1]) {
    propPrim.addBox(0, side * 0.38, 0.03, 0.11, 0.68, 0.025, 0.22 * side, 0, 0);
  }

  // 5. Tricycle Fixed Landing Gear (nose wheel + twin bowed main spring-steel legs)
  if (detailLevel <= 1) {
    // Nose gear
    darkMetalPrim.addCylinder(0, -0.14, -2.05, 0, -0.68, -2.2, 0.035, 0.028, 8);
    darkMetalPrim.addCylinder(-0.07, -0.7, -2.2, 0.07, -0.7, -2.2, 0.14, 0.14, detailLevel === 0 ? 14 : 8);
    // Main gear bowed legs + tires
    for (const side of [-1, 1]) {
      darkMetalPrim.addCylinder(side * 0.22, -0.12, 0.36, side * 0.84, -0.66, 0.44, 0.042, 0.03, 8);
      darkMetalPrim.addCylinder(side * 0.78, -0.68, 0.44, side * 0.94, -0.68, 0.44, 0.18, 0.18, detailLevel === 0 ? 14 : 8);
      if (detailLevel === 0) {
        // Aerodynamic wheel pant spats
        hullPrim.addBox(side * 0.86, -0.64, 0.44, 0.14, 0.2, 0.44);
      }
    }
  }

  // 6. Chin WESCAM MX-15D EO/IR Gimbal Turret (placed inside eoir_turret node at (0, -0.26, -1.62))
  darkMetalPrim.addCylinder(0, 0.04, -1.62, 0, -0.1, -1.62, 0.16, 0.18, 12); // Mounting collar
  const turretRadius = 0.22;
  // Build turret ball centered at (0,0,0) in its own gimbal node
  const turretSegs = detailLevel === 0 ? 14 : 8;
  const ballRings = [];
  for (let lat = 0; lat <= 6; lat++) {
    const phi = (lat / 6) * Math.PI;
    const r = Math.sin(phi) * turretRadius;
    const y = Math.cos(phi) * turretRadius;
    const ring = [];
    for (let lon = 0; lon < turretSegs; lon++) {
      const th = (lon / turretSegs) * Math.PI * 2;
      ring.push([Math.cos(th) * r, y, Math.sin(th) * r]);
    }
    ballRings.push(ring);
  }
  // Forward FLIR/laser aperture lens dome inside opticGlassPrim
  opticGlassPrim.addLoftedTube(ballRings, false);

  // 7. 4 Underwing Pylons + MAM-L Precision Stores
  const pylonsX = [-2.55, -1.55, 1.55, 2.55];
  for (const px of pylonsX) {
    darkMetalPrim.addBox(px, 0.06, 0.1, 0.07, 0.18, 0.56);
    if (detailLevel <= 1) {
      pylonOrdnancePrim.addCylinder(px, -0.09, -0.35, px, -0.09, 0.55, 0.075, 0.075, detailLevel === 0 ? 10 : 6);
      pylonOrdnancePrim.addCylinder(px, -0.09, -0.58, px, -0.09, -0.35, 0.015, 0.075, detailLevel === 0 ? 10 : 6);
      pylonOrdnancePrim.addBox(px, -0.09, 0.42, 0.34, 0.02, 0.16);
    }
  }

  return {
    hullPrim,
    darkMetalPrim,
    opticGlassPrim,
    pylonOrdnancePrim,
    aileronPortPrim,
    aileronStbdPrim,
    rvPortPrim,
    rvStbdPrim,
    propPrim,
    totalTriangles:
      hullPrim.triCount +
      darkMetalPrim.triCount +
      opticGlassPrim.triCount +
      pylonOrdnancePrim.triCount +
      aileronPortPrim.triCount +
      aileronStbdPrim.triCount +
      rvPortPrim.triCount +
      rvStbdPrim.triCount +
      propPrim.triCount,
  };
}

function writeGlbFile(outPath, model, texSet) {
  // Pack binary chunk: vertex/index data for all primitives + 3 embedded PNG images
  const binChunks = [];
  const bufferViews = [];
  const accessors = [];
  let byteOffset = 0;

  function appendBuffer(buf, target) {
    const pad = (4 - (buf.length % 4)) % 4;
    const padded = pad ? Buffer.concat([buf, Buffer.alloc(pad)]) : buf;
    const bvIdx = bufferViews.length;
    const view = { buffer: 0, byteOffset, byteLength: buf.length };
    if (target) view.target = target;
    bufferViews.push(view);
    binChunks.push(padded);
    byteOffset += padded.length;
    return bvIdx;
  }

  function addPrimToGltf(prim, materialIdx) {
    const posArr = new Float32Array(prim.pos);
    const normArr = new Float32Array(prim.norm);
    const uvArr = new Float32Array(prim.uv);
    const idxArr = new Uint32Array(prim.idx);

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < posArr.length; i += 3) {
      minX = Math.min(minX, posArr[i]); maxX = Math.max(maxX, posArr[i]);
      minY = Math.min(minY, posArr[i + 1]); maxY = Math.max(maxY, posArr[i + 1]);
      minZ = Math.min(minZ, posArr[i + 2]); maxZ = Math.max(maxZ, posArr[i + 2]);
    }

    const posBv = appendBuffer(Buffer.from(posArr.buffer), 34962);
    const normBv = appendBuffer(Buffer.from(normArr.buffer), 34962);
    const uvBv = appendBuffer(Buffer.from(uvArr.buffer), 34962);
    const idxBv = appendBuffer(Buffer.from(idxArr.buffer), 34963);

    const posAcc = accessors.length;
    accessors.push({
      bufferView: posBv,
      componentType: 5126,
      count: posArr.length / 3,
      type: 'VEC3',
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    });
    const normAcc = accessors.length;
    accessors.push({ bufferView: normBv, componentType: 5126, count: normArr.length / 3, type: 'VEC3' });
    const uvAcc = accessors.length;
    accessors.push({ bufferView: uvBv, componentType: 5126, count: uvArr.length / 2, type: 'VEC2' });
    const idxAcc = accessors.length;
    accessors.push({ bufferView: idxBv, componentType: 5125, count: idxArr.length, type: 'SCALAR' });

    return {
      attributes: { POSITION: posAcc, NORMAL: normAcc, TEXCOORD_0: uvAcc },
      indices: idxAcc,
      material: materialIdx,
    };
  }

  const albedoBv = appendBuffer(texSet.albedoPng);
  const mrBv = appendBuffer(texSet.metalRoughPng);
  const normalBv = appendBuffer(texSet.normalPng);

  const airframeMesh = {
    name: 'tb2_airframe',
    primitives: [
      addPrimToGltf(model.hullPrim, 0),
      addPrimToGltf(model.darkMetalPrim, 1),
      addPrimToGltf(model.pylonOrdnancePrim, 2),
    ],
  };
  const aileronPortMesh = { name: 'aileron_port_mesh', primitives: [addPrimToGltf(model.aileronPortPrim, 0)] };
  const aileronStbdMesh = { name: 'aileron_stbd_mesh', primitives: [addPrimToGltf(model.aileronStbdPrim, 0)] };
  const rvPortMesh = { name: 'ruddervator_port_mesh', primitives: [addPrimToGltf(model.rvPortPrim, 0)] };
  const rvStbdMesh = { name: 'ruddervator_stbd_mesh', primitives: [addPrimToGltf(model.rvStbdPrim, 0)] };
  const turretMesh = { name: 'eoir_turret_mesh', primitives: [addPrimToGltf(model.opticGlassPrim, 3)] };
  const propMesh = { name: 'propeller_mesh', primitives: [addPrimToGltf(model.propPrim, 1)] };

  const gltf = {
    asset: {
      version: '2.0',
      generator: 'AeroStrike Stage-A TB2 Parametric CAD Exporter',
      copyright: 'Original created Stage-A asset for AeroStrike (inspired by published Bayraktar TB2 external dimensions)',
    },
    scene: 0,
    scenes: [{ name: 'bayraktar_tb2', nodes: [0] }],
    nodes: [
      { name: 'bayraktar_tb2_root', children: [1, 2, 3, 4, 5, 6, 7] },
      { name: 'airframe_hull', mesh: 0 },
      { name: 'aileron_port', mesh: 1, translation: [-3.95, 0.2, 0.52] },
      { name: 'aileron_stbd', mesh: 2, translation: [3.95, 0.2, 0.52] },
      { name: 'ruddervator_port', mesh: 3, translation: [-0.62, 0.56, 3.46], rotation: [0, 0, Math.sin(0.28), Math.cos(0.28)] },
      { name: 'ruddervator_stbd', mesh: 4, translation: [0.62, 0.56, 3.46], rotation: [0, 0, Math.sin(-0.28), Math.cos(-0.28)] },
      { name: 'eoir_turret', mesh: 5, translation: [0, -0.22, -1.62] },
      { name: 'propeller_assembly', mesh: 6, translation: [0, 0.04, 1.94] },
    ],
    meshes: [airframeMesh, aileronPortMesh, aileronStbdMesh, rvPortMesh, rvStbdMesh, turretMesh, propMesh],
    images: [
      { bufferView: albedoBv, mimeType: 'image/png', name: 'tb2_albedo' },
      { bufferView: mrBv, mimeType: 'image/png', name: 'tb2_metal_rough' },
      { bufferView: normalBv, mimeType: 'image/png', name: 'tb2_normal' },
    ],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    textures: [
      { sampler: 0, source: 0 },
      { sampler: 0, source: 1 },
      { sampler: 0, source: 2 },
    ],
    materials: [
      {
        name: 'TB2_Composite_Slate',
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          metallicRoughnessTexture: { index: 1 },
          metallicFactor: 1.0,
          roughnessFactor: 1.0,
        },
        normalTexture: { index: 2, scale: 0.75 },
      },
      {
        name: 'TB2_Structural_Steel_Carbon',
        pbrMetallicRoughness: {
          baseColorFactor: [0.13, 0.15, 0.18, 1.0],
          metallicFactor: 0.85,
          roughnessFactor: 0.28,
        },
      },
      {
        name: 'TB2_Ordnance_OliveSteel',
        pbrMetallicRoughness: {
          baseColorFactor: [0.34, 0.4, 0.28, 1.0],
          metallicFactor: 0.45,
          roughnessFactor: 0.42,
        },
      },
      {
        name: 'TB2_Sapphire_EOIR_Optic',
        pbrMetallicRoughness: {
          baseColorFactor: [0.06, 0.38, 0.56, 1.0],
          metallicFactor: 0.18,
          roughnessFactor: 0.06,
        },
        emissiveFactor: [0.02, 0.11, 0.18],
      },
    ],
    accessors,
    bufferViews,
    buffers: [{ byteLength: byteOffset }],
  };

  let jsonBuf = Buffer.from(JSON.stringify(gltf), 'utf8');
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  if (jsonPad) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);

  const binBuf = Buffer.concat(binChunks);
  const totalLen = 12 + 8 + jsonBuf.length + 8 + binBuf.length;

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // 'glTF'
  header.writeUInt32LE(2, 4); // v2
  header.writeUInt32LE(totalLen, 8);

  const jsonChunkHdr = Buffer.alloc(8);
  jsonChunkHdr.writeUInt32LE(jsonBuf.length, 0);
  jsonChunkHdr.writeUInt32LE(0x4e4f534a, 4); // 'JSON'

  const binChunkHdr = Buffer.alloc(8);
  binChunkHdr.writeUInt32LE(binBuf.length, 0);
  binChunkHdr.writeUInt32LE(0x004e4942, 4); // 'BIN\0'

  const glb = Buffer.concat([header, jsonChunkHdr, jsonBuf, binChunkHdr, binBuf]);
  fs.writeFileSync(outPath, glb);
  return { byteLength: glb.length, triangles: model.totalTriangles };
}

const texLod0 = createAirframePbrTextures(512);
const texLod1 = createAirframePbrTextures(256);
const texLod2 = createAirframePbrTextures(128);

const lod0Meta = writeGlbFile(path.join(OUT_DIR, 'bayraktar_tb2_lod0.glb'), buildTb2LodModel(0), texLod0);
const lod1Meta = writeGlbFile(path.join(OUT_DIR, 'bayraktar_tb2_lod1.glb'), buildTb2LodModel(1), texLod1);
const lod2Meta = writeGlbFile(path.join(OUT_DIR, 'bayraktar_tb2_lod2.glb'), buildTb2LodModel(2), texLod2);

console.log('Generated bayraktar_tb2_lod0.glb:', lod0Meta);
console.log('Generated bayraktar_tb2_lod1.glb:', lod1Meta);
console.log('Generated bayraktar_tb2_lod2.glb:', lod2Meta);
