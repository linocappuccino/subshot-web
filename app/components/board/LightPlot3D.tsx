"use client";

// 2026-11-20 (light plot v2), Lino: «wenn man die kamera platziert braucht es eine view aus der kamera damit man sieht
// wie das licht reagiert». A real-time 3D view through the chosen camera of the plan: walls (with window / door
// openings) at the room height, floor, set pieces, talent as a mannequin, every light as a real light (colour from
// Kelvin, brightness from the fixture's power × intensity × modifier, beam angle, softness, height, tilt, shadows),
// flags cast shadows, diffusion frames soften the lights behind them; the camera's white balance tints the picture.
// three.js is loaded ONLY here, on demand (dynamic import) — never on the board. Renders on change (no animation
// loop), handles WebGL context loss and frees everything on close (iOS memory).

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type * as T from "three";
import type { LightPlotData, LpLabels, LpLook, LpPerson } from "@/lib/lightPlot";
import { ASPECT, buildScene, type ScanHead } from "./lightPlot3dScene";

// 2026-11-21 (v4): the scanned talent head (CC BY 3.0, public/models/LICENSE-human.txt), ~650 KB, fetched only when
// the camera view opens; kept for the page's life (shared by every rebuild), sculpted head as fallback on failure
const HEAD_URL = "/models/light-plot-head.glb";
let headPromise: Promise<ScanHead | null> | null = null;
function loadHead(THREE: typeof T): Promise<ScanHead | null> {
  if (!headPromise) headPromise = (async () => {
    try {
      const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
      const gltf = await new GLTFLoader().loadAsync(HEAD_URL);
      let mesh: T.Mesh | null = null;
      gltf.scene.traverse((o) => { if (!mesh && (o as T.Mesh).isMesh) mesh = o as T.Mesh; });
      if (!mesh) return null;
      const m = (mesh as T.Mesh).material as T.MeshStandardMaterial;
      for (const t of [m.map, m.normalMap]) if (t) { t.userData.shared = true; t.anisotropy = 4; }
      if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
      // GLTFLoader flips normalScale.y for meshes without tangents — keep its sign on our own skin material
      return { geometry: (mesh as T.Mesh).geometry, map: m.map, normalMap: m.normalMap, normalScaleY: m.normalScale?.y ?? -1 };
    } catch {
      headPromise = null;   // retry next time the view opens
      return null;
    }
  })();
  return headPromise;
}

export type LightPlot3DHandle = { capture: (w: number, h: number, type?: string) => Promise<Blob | null>; stats: () => { ms: number; geometries: number; textures: number; calls: number } | null };

const BASE_EXPOSURE = 0.0045;
// v4 auto exposure: the face meter (lux at the talent's face) maps to this reference — calibrated on the demo plan so
// skin sits a little above middle grey (3000 lx ↔ the former EV −2); the manual slider is an offset from it
const AUTO_REF_LUX = 750;
export const autoExposureEv = (lux: number) => Math.log2(AUTO_REF_LUX / Math.max(1, lux));
const isPhone = () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches && Math.min(window.innerWidth, window.innerHeight) < 768;

function disposeTree(obj: T.Object3D) {
  obj.traverse((o) => {
    const m = o as T.Mesh;
    if (m.geometry && !o.userData.shared) m.geometry.dispose();
    const mats = (Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) as T.MeshStandardMaterial[];
    mats.forEach((x) => { if (x.map && !x.map.userData.shared) x.map.dispose(); x.dispose(); });
    const l = o as T.SpotLight;
    if (l.shadow?.map) l.shadow.map.dispose();
  });
}

export const LightPlot3D = forwardRef<LightPlot3DHandle, { plot: LightPlotData; look: LpLook; cam: LpPerson | null; L: LpLabels; onMeter?: (lux: number) => void }>(function LightPlot3D({ plot, look, cam, L, onMeter }, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const three = useRef<{ THREE: typeof T; renderer: T.WebGLRenderer; scene: T.Scene | null; camera: T.PerspectiveCamera | null; ms: number; head: ScanHead | null; aspect: number; fit?: () => void } | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "lost" | "nowebgl">("loading");
  const [scanned, setScanned] = useState(false);
  const latest = useRef({ plot, look, cam, onMeter });
  latest.current = { plot, look, cam, onMeter };
  const frame = useRef(0);

  const draw = () => {
    const t = three.current;
    if (!t || !t.scene || !t.camera) return;
    const s = performance.now();
    t.renderer.render(t.scene, t.camera);
    t.ms = performance.now() - s;
    t.renderer.domElement.dataset.ms = String(Math.round(t.ms * 10) / 10);  // frame time (proof / debugging)
  };
  const rebuild = () => {
    const t = three.current;
    const { plot: p, look: lk, cam: c } = latest.current;
    if (!t || !c) return;
    if (t.scene) disposeTree(t.scene);
    const built = buildScene(t.THREE, p, lk, c, isPhone(), t.head);
    t.scene = built.scene;
    t.camera = built.camera;
    const auto = p.view.auto_exposure !== false && built.meter.lux > 0;
    // v4 manual exposure: with auto off and an aperture set, the camera's f-stop / ISO / shutter decide — compared with
    // what an incident meter asks for at the face (N² = E·S·t / 250), the difference in stops shifts the picture
    let manualEv = 0;
    if (!auto && c.fstop && built.meter.lux > 0) {
      const nNeed = Math.sqrt((built.meter.lux * (c.iso ?? 800) * (1 / (c.shutter ?? 50))) / 250);
      manualEv = autoExposureEv(built.meter.lux) + 2 * Math.log2(nNeed / c.fstop);
    }
    t.renderer.toneMappingExposure = BASE_EXPOSURE * Math.pow(2, (p.view.exposure ?? 0) + (auto ? autoExposureEv(built.meter.lux) : manualEv));
    if (Math.abs(built.aspect - t.aspect) > 0.001) { t.aspect = built.aspect; t.fit?.(); }
    t.renderer.domElement.dataset.lux = String(Math.round(built.meter.lux));
    latest.current.onMeter?.(built.meter.lux);
    draw();
  };

  // set up once (three.js loaded only now)
  useEffect(() => {
    let alive = true;
    const host = hostRef.current!;
    let canvas: HTMLCanvasElement | null = null;
    let ro: ResizeObserver | null = null;
    const onLost = (e: Event) => { e.preventDefault(); setState("lost"); };
    const onRestored = () => { setState("ready"); rebuild(); };
    (async () => {
      const THREE = await import("three");
      const { RectAreaLightUniformsLib } = await import("three/examples/jsm/lights/RectAreaLightUniformsLib.js");
      if (!alive) return;
      RectAreaLightUniformsLib.init();
      let renderer: T.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
      } catch {
        setState("nowebgl");
        return;
      }
      renderer.setPixelRatio(Math.min(isPhone() ? 1.5 : 2, window.devicePixelRatio || 1));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;  // honours shadow.radius (sharp key on the face, soft elsewhere)
      renderer.toneMapping = THREE.AgXToneMapping;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      canvas = renderer.domElement;
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.setAttribute("data-lp-3d-canvas", "");
      canvas.addEventListener("webglcontextlost", onLost);
      canvas.addEventListener("webglcontextrestored", onRestored);
      host.appendChild(canvas);
      three.current = { THREE, renderer, scene: null, camera: null, ms: 0, head: null, aspect: ASPECT };
      const fit = () => {
        const w = host.clientWidth, h = host.clientHeight;
        const a = three.current?.aspect ?? ASPECT;
        const cw = Math.min(w, h * a), ch = cw / a;
        renderer.setSize(Math.max(1, Math.round(cw)), Math.max(1, Math.round(ch)), true);
        canvas!.style.width = `${cw}px`;
        canvas!.style.height = `${ch}px`;
        draw();
      };
      three.current.fit = fit;
      ro = new ResizeObserver(fit);
      ro.observe(host);
      fit();
      // the scanned head first (one fetch per page, ~650 KB) — the sculpted head stands in if it fails
      const t0 = performance.now();
      const head = await loadHead(THREE);
      if (!alive || !three.current) return;
      three.current.head = head;
      setScanned(!!head);
      canvas.dataset.head = head ? "scan" : "sculpted";
      canvas.dataset.headMs = String(Math.round(performance.now() - t0));
      setState("ready");
      rebuild();
    })();
    return () => {
      alive = false;
      cancelAnimationFrame(frame.current);
      ro?.disconnect();
      const t = three.current;
      if (t) {
        if (t.scene) disposeTree(t.scene);
        t.renderer.dispose();
        t.renderer.forceContextLoss();
        canvas?.removeEventListener("webglcontextlost", onLost);
        canvas?.removeEventListener("webglcontextrestored", onRestored);
        canvas?.remove();
        three.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // rebuild when the plan changes (at most once per frame — dragging stays smooth)
  useEffect(() => {
    if (state !== "ready") return;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(rebuild);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, look, cam, state]);

  useImperativeHandle(ref, () => ({
    capture: async (w, h, type = "image/jpeg") => {
      const t = three.current;
      if (!t || !t.scene || !t.camera) return null;
      const r = t.renderer;
      const prev = new t.THREE.Vector2();
      r.getSize(prev);
      const pr = r.getPixelRatio();
      r.setPixelRatio(1);
      h = Math.round(w / t.aspect);   // v4: the camera's frame (anamorphic = wider)
      r.setSize(w, h, false);
      r.render(t.scene, t.camera);
      const url = r.domElement.toDataURL(type, 0.9);   // read right after rendering (no preserveDrawingBuffer needed)
      r.setPixelRatio(pr);
      r.setSize(prev.x, prev.y, false);
      draw();
      return (await fetch(url)).blob();
    },
    stats: () => {
      const t = three.current;
      return t ? { ms: Math.round(t.ms * 10) / 10, geometries: t.renderer.info.memory.geometries, textures: t.renderer.info.memory.textures, calls: t.renderer.info.render.calls } : null;
    },
  }));

  return (
    <div ref={hostRef} data-lp-3d className="relative w-full h-full flex items-center justify-center bg-black">
      {!cam && <div className="absolute inset-0 flex items-center justify-center text-[13px] text-white/60 px-6 text-center">{L.noCamera}</div>}
      {state === "loading" && cam && <div className="absolute inset-0 flex items-center justify-center text-[12px] text-white/50">…</div>}
      {state === "lost" && <div className="absolute inset-0 flex items-center justify-center text-[12px] text-white/60">{L.webglLost}</div>}
      {scanned && state === "ready" && cam && (
        <a href="/models/LICENSE-human.txt" target="_blank" rel="noopener" data-lp-head-credit className="absolute right-2 bottom-1.5 text-[9px] text-white/35 hover:text-white/70 pointer-events-auto">{L.headCredit}</a>
      )}
      {state === "nowebgl" && <div className="absolute inset-0 flex items-center justify-center text-[12px] text-white/60 px-6 text-center">{L.noWebgl}</div>}
    </div>
  );
});
