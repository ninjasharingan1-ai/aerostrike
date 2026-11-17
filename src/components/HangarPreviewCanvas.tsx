import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { AirframeId, WeaponId } from '../sim/types';
import { sharedAssetPipeline } from '../engine/assetPipeline';
import { buildDroneMesh, DroneMeshHandle } from '../engine/droneModels';

interface HangarPreviewCanvasProps {
  airframeId: AirframeId;
  slots?: [WeaponId, WeaponId, WeaponId, WeaponId];
}

/**
 * Interactive 3D War Thunder-style Hangar Turntable Canvas with drag-to-orbit inspection,
 * live hardpoint munition rendering, studio PBR lighting, and software-WebGL safe pacing.
 */
export const HangarPreviewCanvas: React.FC<HangarPreviewCanvasProps> = ({ airframeId, slots }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const airframeRef = useRef<AirframeId>(airframeId);
  const slotsRef = useRef<WeaponId[] | undefined>(slots);
  const requestRenderRef = useRef<(() => void) | null>(null);
  const rebuildModelRef = useRef<((id: AirframeId, wSlots?: WeaponId[]) => void) | null>(null);
  const setPresetRef = useRef<((preset: 'overview' | 'pylons') => void) | null>(null);
  const [viewPreset, setViewPreset] = useState<'overview' | 'pylons'>('overview');

  const slotsKey = slots ? slots.join(',') : '';

  useEffect(() => {
    airframeRef.current = airframeId;
    slotsRef.current = slots;
    rebuildModelRef.current?.(airframeId, slots);
    requestRenderRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [airframeId, slotsKey]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

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
      renderer = new THREE.WebGLRenderer({ antialias: !isSoftwareGl, alpha: false });
    } catch {
      return;
    }

    const width = container.clientWidth || 440;
    const height = container.clientHeight || 240;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b121c);
    scene.fog = new THREE.FogExp2(0x0b121c, 0.018);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.2, 200);

    const hemi = new THREE.HemisphereLight(0x93c5fd, 0x1e293b, 0.9);
    scene.add(hemi);
    const keyLight = new THREE.DirectionalLight(0xfff4e0, 2.1);
    keyLight.position.set(10, 14, 10);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x38bdf8, 1.1);
    rimLight.position.set(-12, 6, -10);
    scene.add(rimLight);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(28, 36),
      new THREE.MeshStandardMaterial({ color: 0x131c28, roughness: 0.72, metalness: 0.25 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.6;
    scene.add(floor);

    const padRing = new THREE.Mesh(
      new THREE.RingGeometry(5.6, 5.95, 48),
      new THREE.MeshBasicMaterial({ color: 0xf59e0b, side: THREE.DoubleSide }),
    );
    padRing.rotation.x = -Math.PI / 2;
    padRing.position.y = -1.56;
    scene.add(padRing);

    const shadowDisc = new THREE.Mesh(
      new THREE.CircleGeometry(5.1, 32),
      new THREE.MeshBasicMaterial({ color: 0x020617, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    shadowDisc.rotation.x = -Math.PI / 2;
    shadowDisc.position.y = -1.57;
    scene.add(shadowDisc);

    let handle: DroneMeshHandle = buildDroneMesh(airframeRef.current, 0xf59e0b, slotsRef.current);
    scene.add(handle.group);

    rebuildModelRef.current = (nextId: AirframeId, wSlots?: WeaponId[]) => {
      if (handle.disposeToken) handle.disposeToken.disposed = true;
      scene.remove(handle.group);
      sharedAssetPipeline.disposeObject3D(handle.group);
      handle = buildDroneMesh(nextId, 0xf59e0b, wSlots);
      scene.add(handle.group);
    };

    let orbitYaw = 0.65;
    let orbitPitch = 0.28;
    let orbitDist = 11.5;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    setPresetRef.current = (preset: 'overview' | 'pylons') => {
      if (preset === 'pylons') {
        orbitYaw = 2.48;
        orbitPitch = -0.04;
        orbitDist = 6.9;
      } else {
        orbitYaw = 0.65;
        orbitPitch = 0.28;
        orbitDist = 11.5;
      }
      requestRenderRef.current?.();
    };

    let frameId = 0;
    let disposed = false;
    let renderBusy = false;
    let renderDirty = false;

    const afterDraw = (cb: () => void) => {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl.fenceSync) {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const st = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (st === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    };

    const requestRender = () => {
      if (disposed) return;
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame(() => {
        if (disposed) return;
        renderDirty = false;
        const cx = Math.cos(orbitPitch) * Math.sin(orbitYaw) * orbitDist;
        const cy = Math.sin(orbitPitch) * orbitDist + 0.3;
        const cz = Math.cos(orbitPitch) * Math.cos(orbitYaw) * orbitDist;
        camera.position.set(cx, cy, cz);
        camera.lookAt(0, -0.2, 0);
        renderer.render(scene, camera);
        const done = () => {
          renderBusy = false;
          if (renderDirty) requestRender();
        };
        if (isSoftwareGl) afterDraw(done);
        else done();
      });
    };

    requestRenderRef.current = requestRender;
    requestRender();

    const onPointerDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      orbitYaw -= dx * 0.01;
      orbitPitch = Math.max(-0.24, Math.min(1.15, orbitPitch + dy * 0.008));
      requestRender();
    };
    const onPointerUp = () => {
      dragging = false;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      orbitDist = Math.max(5.5, Math.min(22, orbitDist + e.deltaY * 0.01));
      requestRender();
    };

    const onResize = () => {
      const w = container.clientWidth || 440;
      const h = container.clientHeight || 240;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      requestRender();
    };

    const dom = renderer.domElement;
    dom.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    dom.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('resize', onResize);

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      if (handle.disposeToken) handle.disposeToken.disposed = true;
      sharedAssetPipeline.disposeObject3D(scene);
      dom.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      dom.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
    };
  }, []);

  return (
    <div className="relative w-full h-44 sm:h-52 rounded-lg overflow-hidden border border-slate-700/80 bg-[#0b121c]">
      <div ref={containerRef} className="w-full h-full cursor-grab active:cursor-grabbing" />
      <div className="absolute top-2 left-2.5 flex items-center gap-1">
        <button
          type="button"
          onClick={() => {
            setViewPreset('overview');
            setPresetRef.current?.('overview');
          }}
          className={`px-2 py-0.5 rounded text-[10px] font-mono-tabular border cursor-pointer ${
            viewPreset === 'overview'
              ? 'bg-amber-500/20 border-amber-400 text-amber-200'
              : 'bg-black/65 border-slate-700 text-slate-300 hover:text-white'
          }`}
        >
          Overview
        </button>
        <button
          type="button"
          onClick={() => {
            setViewPreset('pylons');
            setPresetRef.current?.('pylons');
          }}
          className={`px-2 py-0.5 rounded text-[10px] font-mono-tabular border cursor-pointer ${
            viewPreset === 'pylons'
              ? 'bg-amber-500/20 border-amber-400 text-amber-200'
              : 'bg-black/65 border-slate-700 text-slate-300 hover:text-white'
          }`}
        >
          Pylons &amp; Guns
        </button>
      </div>
      <div className="absolute bottom-2 right-2.5 text-[10px] font-mono-tabular text-slate-400 pointer-events-none bg-black/55 px-2 py-0.5 rounded">
        Drag to Orbit · Scroll to Zoom
      </div>
    </div>
  );
};
