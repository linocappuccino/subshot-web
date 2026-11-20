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
import { cameraFov, kelvinColor, MODIFIER_GAIN, MODIFIER_SOFT, presetOf, type LightPlotData, type LpLabels, type LpLook, type LpPerson } from "@/lib/lightPlot";

export type LightPlot3DHandle = { capture: (w: number, h: number, type?: string) => Promise<Blob | null>; stats: () => { ms: number; geometries: number; textures: number; calls: number } | null };

const ASPECT = 16 / 9;
const BASE_EXPOSURE = 0.0045;
const isPhone = () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches && Math.min(window.innerWidth, window.innerHeight) < 768;

function disposeTree(obj: T.Object3D) {
  obj.traverse((o) => {
    const m = o as T.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as T.Material | T.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
    const l = o as T.SpotLight;
    if (l.shadow?.map) l.shadow.map.dispose();
  });
}

function buildScene(THREE: typeof T, plot: LightPlotData, look: LpLook, cam: LpPerson, phone: boolean) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#050506");
  const H = plot.room.height ?? 2.6;
  const std = (color: string, rough = 0.85, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  const add = (mesh: T.Mesh, cast = true, receive = true) => { mesh.castShadow = cast; mesh.receiveShadow = receive; scene.add(mesh); return mesh; };

  // floor (big, so the camera never sees its edge)
  const floor = add(new THREE.Mesh(new THREE.PlaneGeometry(200, 200), std("#6f6a64", 0.9)), false, true);
  floor.rotation.x = -Math.PI / 2;

  // walls: boxes along each segment; windows / doors / openings leave a gap
  const wallMat = std("#d9d4cb", 0.88);
  const glassMat = new THREE.MeshStandardMaterial({ color: "#9fd8ff", transparent: true, opacity: 0.12, roughness: 0.05 });
  const wallBox = (x1: number, y1: number, x2: number, y2: number, z0: number, z1: number, mat: T.Material = wallMat, cast = true) => {
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 0.01 || z1 <= z0) return;
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, z1 - z0, mat === glassMat ? 0.02 : 0.12), mat);
    m.position.set((x1 + x2) / 2, (z0 + z1) / 2, (y1 + y2) / 2);
    m.rotation.y = -Math.atan2(y2 - y1, x2 - x1);
    add(m, cast, true);
  };
  for (const w of plot.room.walls) {
    if (w.kind === "curve") {
      const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1) || 1;
      const nx = -(w.y2 - w.y1) / len, ny = (w.x2 - w.x1) / len, b = (w.bend ?? 0.25) * len * 2;
      const cx = (w.x1 + w.x2) / 2 + nx * b, cy = (w.y1 + w.y2) / 2 + ny * b;
      const pt = (t: number) => ({ x: (1 - t) ** 2 * w.x1 + 2 * (1 - t) * t * cx + t * t * w.x2, y: (1 - t) ** 2 * w.y1 + 2 * (1 - t) * t * cy + t * t * w.y2 });
      for (let i = 0; i < 10; i++) { const a = pt(i / 10), c = pt((i + 1) / 10); wallBox(a.x, a.y, c.x, c.y, 0, H); }
    } else if (w.kind === "window") {
      wallBox(w.x1, w.y1, w.x2, w.y2, 0, 0.9);
      wallBox(w.x1, w.y1, w.x2, w.y2, 2.1, H);
      wallBox(w.x1, w.y1, w.x2, w.y2, 0.9, 2.1, glassMat, false);
    } else if (w.kind === "door") {
      wallBox(w.x1, w.y1, w.x2, w.y2, 2.1, H);
    } else if (w.kind === "opening") {
      wallBox(w.x1, w.y1, w.x2, w.y2, Math.min(H, 2.3), H);
    } else {
      wallBox(w.x1, w.y1, w.x2, w.y2, 0, H);
    }
  }

  // set pieces as simple 3D shapes
  const wood = std("#7c6a58", 0.7), fabric = std("#4b5563", 0.95), carMat = std("#334155", 0.35, 0.4), leaf = std("#3f7d4a", 0.9);
  for (const it of plot.room.items) {
    const g = new THREE.Group();
    g.position.set(it.x, 0, it.y);
    g.rotation.y = -(it.rot * Math.PI) / 180;
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: T.Material) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m);
    };
    if (it.kind === "table") {
      box(it.w, 0.04, it.h, 0, 0.74, 0, wood);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.05, 0.72, 0.05, sx * (it.w / 2 - 0.06), 0.36, sz * (it.h / 2 - 0.06), wood);
    } else if (it.kind === "sofa") {
      box(it.w, 0.42, it.h, 0, 0.21, 0, fabric); box(it.w, 0.45, it.h * 0.25, 0, 0.62, -it.h * 0.375, fabric);
      box(it.w * 0.1, 0.25, it.h, -it.w * 0.45, 0.55, 0, fabric); box(it.w * 0.1, 0.25, it.h, it.w * 0.45, 0.55, 0, fabric);
    } else if (it.kind === "bed") {
      box(it.w, 0.5, it.h, 0, 0.25, 0, std("#e5e7eb", 0.95)); box(it.w * 0.15, 0.12, it.h * 0.8, -it.w * 0.4, 0.56, 0, std("#f8fafc", 0.95));
    } else if (it.kind === "car") {
      box(it.w, 0.75, it.h, 0, 0.55, 0, carMat); box(it.w * 0.5, 0.5, it.h * 0.9, -it.w * 0.05, 1.15, 0, carMat);
    } else if (it.kind === "tree") {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 2.2), wood); trunk.position.y = 1.1; trunk.castShadow = true; g.add(trunk);
      const crown = new THREE.Mesh(new THREE.SphereGeometry(Math.min(it.w, it.h) / 2, 16, 12), leaf); crown.position.y = 2.6; crown.castShadow = true; g.add(crown);
    } else if (it.kind === "stairs") {
      const n = Math.max(2, Math.round(it.h / 0.28));
      for (let i = 0; i < n; i++) box(it.w, 0.18 * (i + 1), it.h / n, 0, 0.09 * (i + 1), -it.h / 2 + (it.h / n) * (i + 0.5), wood);
    } else if (it.kind === "circle") {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(it.w / 2, it.w / 2, 0.8, 24), fabric); m.position.y = 0.4; m.castShadow = m.receiveShadow = true; g.add(m);
    } else {
      box(it.w, 0.8, it.h, 0, 0.4, 0, fabric);
    }
    scene.add(g);
  }

  // talent: a mannequin (standing / sitting), facing its rotation
  const skin = std("#c9a58b", 0.55), cloth = std("#3b4756", 0.9), pants = std("#262b33", 0.9);
  for (const p of plot.people) {
    if (p.kind !== "talent") continue;
    const s = (p.height_m ?? 1.75) / 1.75;
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.y);
    g.rotation.y = -(p.rot * Math.PI) / 180;
    g.scale.setScalar(s);
    const cap = (r: number, len: number, mat: T.Material, x: number, y: number, z: number, rz = 0, rx = 0) => {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat); m.position.set(x, y, z); m.rotation.z = rz; m.rotation.x = rx; m.castShadow = m.receiveShadow = true; g.add(m);
    };
    const sitting = p.pose === "sitting";
    if (sitting) {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.05, 0.45), wood); seat.position.set(-0.05, 0.45, 0); seat.castShadow = seat.receiveShadow = true; g.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.45), wood); back.position.set(-0.27, 0.72, 0); back.castShadow = true; g.add(back);
      for (const z of [-0.1, 0.1]) {
        cap(0.075, 0.38, pants, 0.14, 0.52, z, Math.PI / 2);   // thighs forward (+x)
        cap(0.065, 0.36, pants, 0.36, 0.25, z);                 // shins down
      }
    } else {
      for (const z of [-0.1, 0.1]) cap(0.075, 0.72, pants, 0, 0.44, z);
    }
    const hip = sitting ? 0.52 : 0.86;
    cap(0.16, 0.42, cloth, -0.02, hip + 0.3, 0);                               // torso
    for (const z of [-0.23, 0.23]) cap(0.055, 0.5, cloth, 0.0, hip + 0.22, z, 0, z > 0 ? -0.08 : 0.08); // arms
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 18, 14), skin); head.position.set(0.0, hip + 0.73, 0); head.castShadow = true; g.add(head);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), skin); nose.position.set(0.1, hip + 0.73, 0); g.add(nose);
    scene.add(g);
  }

  // lights; the camera's white balance tints them (a 3200 K light on a 5600 K camera looks warm)
  const wb = new THREE.Color(kelvinColor(cam.kelvin ?? 5600));
  const tint = (k: number) => {
    const c = new THREE.Color(kelvinColor(k));
    c.r /= Math.max(0.05, wb.r); c.g /= Math.max(0.05, wb.g); c.b /= Math.max(0.05, wb.b);
    const m = Math.max(c.r, c.g, c.b);
    return c.multiplyScalar(1 / m);
  };
  const diffusers = look.mods.filter((m) => m.kind === "diffusion");
  const near = (x: number, y: number) => diffusers.some((d) => {
    const vx = d.x2 - d.x1, vy = d.y2 - d.y1, L2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((x - d.x1) * vx + (y - d.y1) * vy) / L2));
    return Math.hypot(x - (d.x1 + t * vx), y - (d.y1 + t * vy)) < 1.3;
  });
  const shadowSize = phone ? 512 : 1024;
  look.lights.forEach((li, i) => {
    const watts = presetOf(li.preset)?.watts ?? 150;
    const diffused = near(li.x, li.y);
    const color = tint(li.kelvin);
    const cd = watts * 55 * MODIFIER_GAIN[li.modifier] * (li.intensity / 100) * (diffused ? 0.55 : 1);
    const z = li.z ?? 2, tilt = ((li.tilt ?? 25) * Math.PI) / 180, r = (li.rot * Math.PI) / 180;
    const dir = new THREE.Vector3(Math.cos(r) * Math.cos(tilt), -Math.sin(tilt), Math.sin(r) * Math.cos(tilt));
    const pos = new THREE.Vector3(li.x, z, li.y);
    let light: T.SpotLight | T.PointLight;
    if (li.beam >= 180) {
      light = new THREE.PointLight(color, cd / 2.2, 0, 2);
    } else {
      const sp = new THREE.SpotLight(color, cd, 0, Math.min(Math.PI * 0.47, ((li.beam / 2) * Math.PI) / 180 * (diffused ? 1.35 : 1)), diffused ? 1 : MODIFIER_SOFT[li.modifier], 2);
      sp.target.position.copy(pos.clone().add(dir.clone().multiplyScalar(3)));
      scene.add(sp.target);
      light = sp;
    }
    light.position.copy(pos);
    if (i < 8) {
      light.castShadow = true;
      light.shadow.mapSize.set(shadowSize, shadowSize);
      light.shadow.bias = -0.0006;
      (light.shadow as T.SpotLightShadow).radius = 2 + 6 * (MODIFIER_SOFT[li.modifier] ?? 0.5);
    }
    scene.add(light);
    // the fixture itself: stand + glowing front
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, z), std("#3f3f46", 0.5, 0.6)); stand.position.set(li.x, z / 2, li.y); stand.castShadow = true; scene.add(stand);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 0.18), std("#18181b", 0.5, 0.3)); head.position.copy(pos); head.lookAt(pos.clone().add(dir)); scene.add(head);
    const face = new THREE.Mesh(new THREE.CircleGeometry(li.modifier === "softbox" ? 0.35 : 0.08, 20), new THREE.MeshBasicMaterial({ color }));
    face.position.copy(pos.clone().add(dir.clone().multiplyScalar(0.12)));
    face.lookAt(pos.clone().add(dir.clone().multiplyScalar(2)));
    scene.add(face);
  });

  // flags cast shadows; diffusion frames are a pale screen
  for (const m of look.mods) {
    const len = Math.hypot(m.x2 - m.x1, m.y2 - m.y1);
    if (len < 0.05) continue;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(len, m.kind === "flag" ? 0.75 : 1.2),
      m.kind === "flag" ? new THREE.MeshStandardMaterial({ color: "#0b0b0c", roughness: 1, side: THREE.DoubleSide })
        : new THREE.MeshStandardMaterial({ color: "#ffffff", transparent: true, opacity: 0.35, roughness: 1, side: THREE.DoubleSide }));
    plane.position.set((m.x1 + m.x2) / 2, m.kind === "flag" ? 1.75 : 1.6, (m.y1 + m.y2) / 2);
    plane.rotation.y = -Math.atan2(m.y2 - m.y1, m.x2 - m.x1);
    plane.castShadow = m.kind === "flag";
    scene.add(plane);
  }

  scene.add(new THREE.HemisphereLight("#b9c3d1", "#2b2622", 18));

  // the camera: angle of view from lens + sensor, height + tilt
  const hfov = cameraFov(cam.lens_mm, cam.sensor);
  const vfov = (2 * Math.atan(Math.tan(((hfov / 2) * Math.PI) / 180) / ASPECT) * 180) / Math.PI;
  const camera = new THREE.PerspectiveCamera(vfov, ASPECT, 0.05, 300);
  const cz = cam.z ?? 1.5, ct = ((cam.tilt ?? 0) * Math.PI) / 180, cr = (cam.rot * Math.PI) / 180;
  camera.position.set(cam.x, cz, cam.y);
  camera.lookAt(cam.x + Math.cos(cr) * Math.cos(ct), cz - Math.sin(ct), cam.y + Math.sin(cr) * Math.cos(ct));
  return { scene, camera };
}

export const LightPlot3D = forwardRef<LightPlot3DHandle, { plot: LightPlotData; look: LpLook; cam: LpPerson | null; L: LpLabels }>(function LightPlot3D({ plot, look, cam, L }, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const three = useRef<{ THREE: typeof T; renderer: T.WebGLRenderer; scene: T.Scene | null; camera: T.PerspectiveCamera | null; ms: number } | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "lost" | "nowebgl">("loading");
  const latest = useRef({ plot, look, cam });
  latest.current = { plot, look, cam };
  const frame = useRef(0);

  const draw = () => {
    const t = three.current;
    if (!t || !t.scene || !t.camera) return;
    const s = performance.now();
    t.renderer.render(t.scene, t.camera);
    t.ms = performance.now() - s;
  };
  const rebuild = () => {
    const t = three.current;
    const { plot: p, look: lk, cam: c } = latest.current;
    if (!t || !c) return;
    if (t.scene) disposeTree(t.scene);
    const built = buildScene(t.THREE, p, lk, c, isPhone());
    t.scene = built.scene;
    t.camera = built.camera;
    t.renderer.toneMappingExposure = BASE_EXPOSURE * Math.pow(2, p.view.exposure ?? 0);
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
      if (!alive) return;
      let renderer: T.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
      } catch {
        setState("nowebgl");
        return;
      }
      renderer.setPixelRatio(Math.min(isPhone() ? 1.5 : 2, window.devicePixelRatio || 1));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      canvas = renderer.domElement;
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.setAttribute("data-lp-3d-canvas", "");
      canvas.addEventListener("webglcontextlost", onLost);
      canvas.addEventListener("webglcontextrestored", onRestored);
      host.appendChild(canvas);
      three.current = { THREE, renderer, scene: null, camera: null, ms: 0 };
      const fit = () => {
        const w = host.clientWidth, h = host.clientHeight;
        const cw = Math.min(w, h * ASPECT), ch = cw / ASPECT;
        renderer.setSize(Math.max(1, Math.round(cw)), Math.max(1, Math.round(ch)), true);
        canvas!.style.width = `${cw}px`;
        canvas!.style.height = `${ch}px`;
        draw();
      };
      ro = new ResizeObserver(fit);
      ro.observe(host);
      fit();
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
      {state === "nowebgl" && <div className="absolute inset-0 flex items-center justify-center text-[12px] text-white/60 px-6 text-center">{L.noWebgl}</div>}
    </div>
  );
});
