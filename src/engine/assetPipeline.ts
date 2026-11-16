import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export interface AssetPipelineStats {
  modelsCached: number;
  texturesCached: number;
  hdrisCached: number;
  loadsStarted: number;
  loadsCompleted: number;
  loadErrors: number;
  disposedObjects: number;
  disposedGeometries: number;
  disposedMaterials: number;
  disposedTextures: number;
}

/**
 * Shared Three.js Stage-A asset loader & cache configuring:
 * - GLTFLoader + DRACOLoader (/libs/draco/) + MeshoptDecoder + KTX2Loader (/libs/basis/)
 * - RGBELoader (HDRI IBL)
 * - TextureLoader (proper colorSpace & anisotropy)
 * - Recursive Three.js resource disposal tracking
 */
export class ThreeAssetPipeline {
  private readonly loadingManager: THREE.LoadingManager;
  private readonly textureLoader: THREE.TextureLoader;
  private readonly rgbeLoader: RGBELoader;
  private readonly gltfLoader: GLTFLoader;
  private readonly dracoLoader: DRACOLoader;
  private readonly ktx2Loader: KTX2Loader;

  private readonly modelCache = new Map<string, Promise<THREE.Group>>();
  private readonly textureCache = new Map<string, Promise<THREE.Texture>>();
  private readonly hdriCache = new Map<string, Promise<THREE.Texture>>();
  private readonly cachedResourceSet = new Set<object>();

  private rendererRef: THREE.WebGLRenderer | null = null;
  private maxAnisotropy = 4;
  private ktx2Supported = false;

  public readonly stats: AssetPipelineStats = {
    modelsCached: 0,
    texturesCached: 0,
    hdrisCached: 0,
    loadsStarted: 0,
    loadsCompleted: 0,
    loadErrors: 0,
    disposedObjects: 0,
    disposedGeometries: 0,
    disposedMaterials: 0,
    disposedTextures: 0,
  };

  constructor() {
    this.loadingManager = new THREE.LoadingManager();
    this.loadingManager.onStart = () => {
      this.stats.loadsStarted++;
    };
    this.loadingManager.onLoad = () => {
      this.stats.loadsCompleted++;
    };
    this.loadingManager.onError = () => {
      this.stats.loadErrors++;
    };

    this.textureLoader = new THREE.TextureLoader(this.loadingManager);
    this.rgbeLoader = new RGBELoader(this.loadingManager);

    this.dracoLoader = new DRACOLoader(this.loadingManager);
    this.dracoLoader.setDecoderPath('/libs/draco/');

    this.ktx2Loader = new KTX2Loader(this.loadingManager);
    this.ktx2Loader.setTranscoderPath('/libs/basis/');

    this.gltfLoader = new GLTFLoader(this.loadingManager);
    this.gltfLoader.setDRACOLoader(this.dracoLoader);
    this.gltfLoader.setMeshoptDecoder(MeshoptDecoder);
    this.gltfLoader.setKTX2Loader(this.ktx2Loader);
  }

  public bindRenderer(renderer: THREE.WebGLRenderer): void {
    if (this.rendererRef === renderer) return;
    this.rendererRef = renderer;
    this.maxAnisotropy = Math.max(1, renderer.capabilities.getMaxAnisotropy());
    if (!this.ktx2Supported) {
      try {
        this.ktx2Loader.detectSupport(renderer);
        this.ktx2Supported = true;
      } catch {
        // KTX2 optional if WebGL compressed texture extension missing
      }
    }
  }

  public loadTexture(
    url: string,
    options: { srgb?: boolean; repeatX?: number; repeatY?: number } = {},
  ): Promise<THREE.Texture> {
    const cacheKey = `${url}|${options.srgb ? 'srgb' : 'lin'}|${options.repeatX ?? 1}|${options.repeatY ?? 1}`;
    const existing = this.textureCache.get(cacheKey);
    if (existing) return existing;

    const promise = new Promise<THREE.Texture>((resolve, reject) => {
      this.textureLoader.load(
        url,
        (tex) => {
          tex.colorSpace = options.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.RepeatWrapping;
          tex.repeat.set(options.repeatX ?? 1, options.repeatY ?? 1);
          tex.anisotropy = this.maxAnisotropy;
          tex.needsUpdate = true;
          this.cachedResourceSet.add(tex);
          this.stats.texturesCached = this.textureCache.size;
          resolve(tex);
        },
        undefined,
        (err) => {
          this.stats.loadErrors++;
          reject(err);
        },
      );
    });
    this.textureCache.set(cacheKey, promise);
    return promise;
  }

  public loadHdriEnvironment(url: string, renderer: THREE.WebGLRenderer): Promise<THREE.Texture> {
    this.bindRenderer(renderer);
    const existing = this.hdriCache.get(url);
    if (existing) return existing;

    const promise = new Promise<THREE.Texture>((resolve, reject) => {
      this.rgbeLoader.load(
        url,
        (equirect) => {
          const pmrem = new THREE.PMREMGenerator(renderer);
          pmrem.compileEquirectangularShader();
          const envRT = pmrem.fromEquirectangular(equirect);
          equirect.dispose();
          pmrem.dispose();
          this.cachedResourceSet.add(envRT.texture);
          this.stats.hdrisCached = this.hdriCache.size;
          resolve(envRT.texture);
        },
        undefined,
        (err) => {
          this.stats.loadErrors++;
          reject(err);
        },
      );
    });
    this.hdriCache.set(url, promise);
    return promise;
  }

  public loadModel(url: string): Promise<THREE.Group> {
    const existing = this.modelCache.get(url);
    if (existing) {
      return existing.then((src) => src.clone(true));
    }

    const promise = new Promise<THREE.Group>((resolve, reject) => {
      this.gltfLoader.load(
        url,
        (gltf) => {
          const root = gltf.scene;
          root.traverse((obj) => {
            const mesh = obj as THREE.Mesh;
            if (mesh.isMesh) {
              mesh.castShadow = true;
              mesh.receiveShadow = true;
              this.cachedResourceSet.add(mesh.geometry);
              const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
              for (const m of mats) {
                if (!m) continue;
                this.cachedResourceSet.add(m);
                const std = m as THREE.MeshStandardMaterial;
                if (std.map) this.cachedResourceSet.add(std.map);
                if (std.normalMap) this.cachedResourceSet.add(std.normalMap);
                if (std.roughnessMap) this.cachedResourceSet.add(std.roughnessMap);
                if (std.metalnessMap) this.cachedResourceSet.add(std.metalnessMap);
                if (std.aoMap) this.cachedResourceSet.add(std.aoMap);
              }
            }
          });
          this.stats.modelsCached = this.modelCache.size;
          resolve(root);
        },
        undefined,
        (err) => {
          this.stats.loadErrors++;
          reject(err);
        },
      );
    });

    this.modelCache.set(url, promise);
    return promise.then((src) => src.clone(true));
  }

  public async buildLodGroup(
    urls: { lod0: string; lod1: string; lod2: string },
    distances: [number, number, number] = [0, 140, 480],
  ): Promise<THREE.LOD> {
    const [m0, m1, m2] = await Promise.all([
      this.loadModel(urls.lod0),
      this.loadModel(urls.lod1),
      this.loadModel(urls.lod2),
    ]);
    const lod = new THREE.LOD();
    lod.addLevel(m0, distances[0]);
    lod.addLevel(m1, distances[1]);
    lod.addLevel(m2, distances[2]);
    return lod;
  }

  /**
   * Deterministically disposes non-shared Three.js geometries, materials, and textures
   * attached to an Object3D subtree so swapping vehicles/theaters does not leak GPU memory.
   */
  public disposeObject3D(root: THREE.Object3D, forceCached = false): void {
    const seenGeos = new Set<THREE.BufferGeometry>();
    const seenMats = new Set<THREE.Material>();
    const seenTexs = new Set<THREE.Texture>();

    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (mesh.geometry && (forceCached || !this.cachedResourceSet.has(mesh.geometry))) {
        seenGeos.add(mesh.geometry);
      }
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        if (!mat) continue;
        if (forceCached || !this.cachedResourceSet.has(mat)) {
          seenMats.add(mat);
          const anyMat = mat as unknown as Record<string, unknown>;
          for (const key of [
            'map',
            'normalMap',
            'roughnessMap',
            'metalnessMap',
            'aoMap',
            'bumpMap',
            'emissiveMap',
            'alphaMap',
          ]) {
            const tex = anyMat[key] as THREE.Texture | undefined;
            if (tex && tex.isTexture && (forceCached || !this.cachedResourceSet.has(tex))) {
              seenTexs.add(tex);
            }
          }
        }
      }
    });

    for (const geo of seenGeos) {
      geo.dispose();
      this.stats.disposedGeometries++;
    }
    for (const mat of seenMats) {
      mat.dispose();
      this.stats.disposedMaterials++;
    }
    for (const tex of seenTexs) {
      tex.dispose();
      this.stats.disposedTextures++;
    }
    this.stats.disposedObjects++;
  }

  public getStats(): AssetPipelineStats {
    return { ...this.stats };
  }
}

export const sharedAssetPipeline = new ThreeAssetPipeline();
