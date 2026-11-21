// 2026-11-20 (light plot v2.1), Lino: «viel detailierter» — the 3D scene of the camera view, built from the plan.
// Everything procedural (no downloaded models / textures): a properly proportioned human figure, set pieces, real
// looking fixtures (stands, heads, softboxes, lanterns, tubes, panels, flags on C-stands, diffusion frames), soft
// area lights for soft sources (+ a soft shadow spot), physically based falloff, a bounce approximation from the
// wall / floor colour, procedural plaster / wood textures. Only ever imported by LightPlot3D (dynamic import).

import type * as T from "three";
import { BOUNCE_Z, cameraFov, isBounce, kelvinColor, MODIFIER_GAIN, MODIFIER_SOFT, presetOf, SURFACE_REFLECT, type LightPlotData, type LpLight, type LpLook, type LpPerson } from "@/lib/lightPlot";

export const ASPECT = 16 / 9;

type Three = typeof T;

function noiseTexture(THREE: Three, base: string, kind: "plaster" | "wood", size = 256) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  if (kind === "wood") {
    const planks = 6;
    for (let i = 0; i < planks; i++) {
      const y = (i * size) / planks;
      g.fillStyle = `rgba(0,0,0,${0.04 + rnd() * 0.08})`;
      g.fillRect(0, y, size, size / planks);
      g.fillStyle = "rgba(0,0,0,0.25)";
      g.fillRect(0, y, size, 1.5);
      for (let k = 0; k < 40; k++) {
        g.strokeStyle = `rgba(60,35,15,${0.05 + rnd() * 0.08})`;
        g.beginPath();
        const yy = y + rnd() * (size / planks);
        g.moveTo(0, yy);
        g.bezierCurveTo(size * 0.3, yy + rnd() * 4 - 2, size * 0.6, yy + rnd() * 4 - 2, size, yy + rnd() * 3 - 1.5);
        g.stroke();
      }
    }
  } else {
    for (let k = 0; k < 2600; k++) {
      g.fillStyle = `rgba(${rnd() > 0.5 ? "255,255,255" : "0,0,0"},${rnd() * 0.05})`;
      g.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 3, 1 + rnd() * 3);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** a tapered limb segment from a to b (radii ra → rb) */
function limb(THREE: Three, mat: T.Material, a: T.Vector3, b: T.Vector3, ra: number, rb: number) {
  const len = a.distanceTo(b);
  const geo = new THREE.CylinderGeometry(rb, ra, len, 14, 1);
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  m.castShadow = m.receiveShadow = true;
  return m;
}
function ball(THREE: Three, mat: T.Material, p: T.Vector3, r: number, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), mat);
  m.position.copy(p);
  m.scale.set(sx, sy, sz);
  m.castShadow = m.receiveShadow = true;
  return m;
}

const smooth = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const gauss = (a: number, sa: number, b: number, sb: number) => Math.exp(-((a * a) / (sa * sa) + (b * b) / (sb * sb)));

/** a procedurally sculpted head (facing +x, centred, ≈ 23 cm tall): a dense ellipsoid displaced into nose (bridge,
 * tip, nostrils), brow ridge, eye sockets with eyeballs, cheekbones, lips, chin and a narrower jaw; ears; hair */
export function sculptedHead(THREE: Three, skin: T.Material, hair: T.Material) {
  const g = new THREE.Group();
  const geo = new THREE.SphereGeometry(1, 160, 120);
  const pos = geo.attributes.position as T.BufferAttribute;
  const RX = 0.098, RY = 0.118, RZ = 0.078;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const f = Math.max(0, x);              // front of the face
    const az = Math.abs(z);
    // jaw narrower towards the chin, back of the skull a little fuller
    const jaw = y < 0 ? 1 - 0.28 * Math.pow(-y, 1.6) : 1;
    let px = x * RX * (x < 0 ? 1.04 : 1), py = y * RY, pz = z * RZ * jaw;
    // nose: bridge between the eyes → tip, wider and further out towards the tip
    const t = Math.min(1, Math.max(0, (0.16 - y) / 0.42));
    const noseMask = smooth(-0.33, -0.25, y) * (1 - smooth(0.12, 0.2, y));
    // ridge rises gently, the tip is a rounded ball, the wings (nostrils) sit low and wide
    const ridge = (0.002 + 0.0165 * Math.pow(t, 1.6)) * Math.exp(-((z * z) / Math.pow(0.05 + 0.045 * t, 2))) * noseMask;
    const tip = 0.006 * gauss(y + 0.235, 0.06, z, 0.075);
    const nose = (ridge + tip) * Math.pow(f, 6);
    const nostrils = 0.0065 * gauss(y + 0.265, 0.055, az - 0.105, 0.055) * Math.pow(f, 4);
    const underNose = -0.0035 * gauss(y + 0.315, 0.03, z, 0.13) * Math.pow(f, 4);
    const philtrum = -0.0016 * gauss(y + 0.38, 0.045, z, 0.035) * Math.pow(f, 5) + 0.0008 * gauss(y + 0.38, 0.045, az - 0.05, 0.02) * Math.pow(f, 5);
    const brow = 0.008 * gauss(y - 0.26, 0.08, z, 0.5) * Math.pow(f, 3);
    const sockets = -0.012 * gauss(y - 0.12, 0.1, az - 0.33, 0.13) * Math.pow(f, 3);
    const cheeks = 0.009 * gauss(y + 0.06, 0.16, az - 0.55, 0.2) * Math.pow(f, 2);
    // closed lips: upper + lower volume, only a hairline between them (no gap)
    const lips = (0.0055 * gauss(y + 0.445, 0.035, z, 0.24) + 0.0065 * gauss(y + 0.525, 0.04, z, 0.22) - 0.0011 * gauss(y + 0.485, 0.008, z, 0.26)) * Math.pow(f, 4);
    const chin = 0.01 * gauss(y + 0.73, 0.11, z, 0.28) * Math.pow(f, 3);
    const nasolabial = -0.0018 * gauss(y + 0.36, 0.12, az - 0.22, 0.05) * Math.pow(f, 3);
    const d = nose + nostrils + underNose + philtrum + brow + sockets + cheeks + lips + chin + nasolabial;
    const n = new THREE.Vector3(px / (RX * RX), py / (RY * RY), pz / (RZ * RZ)).normalize();
    px += n.x * d; py += n.y * d; pz += n.z * d;
    pos.setXYZ(i, px, py, pz);
  }
  geo.computeVertexNormals();
  const face = new THREE.Mesh(geo, skin);
  face.castShadow = face.receiveShadow = true;
  g.add(face);
  // eyes in the sockets: white + iris + pupil, looking forward
  const white = new THREE.MeshPhysicalMaterial({ color: "#ece6dd", roughness: 0.25, clearcoat: 1, emissive: new THREE.Color("#2a2622") });
  const iris = new THREE.MeshStandardMaterial({ color: "#3a2a1e", roughness: 0.35 });
  for (const sz of [-1, 1]) {
    const uy = 0.12, uz = 0.33 * sz, ux = Math.sqrt(1 - uy * uy - uz * uz);
    const c = new THREE.Vector3(ux * RX - 0.0135, uy * RY, uz * RZ);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.0118, 24, 16), white); eye.position.copy(c); eye.receiveShadow = true; g.add(eye);
    const ir = new THREE.Mesh(new THREE.CircleGeometry(0.0062, 20), iris); ir.position.copy(c).add(new THREE.Vector3(0.0116, -0.001, 0)); ir.rotation.y = Math.PI / 2; g.add(ir);
    // eyelids: upper lid covers the top third, lower lid a sliver — the eye sits in the face, not on it
    const lidGeo = new THREE.SphereGeometry(0.0128, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.4);
    const upper = new THREE.Mesh(lidGeo, skin); upper.position.copy(c); upper.rotation.z = -0.3; upper.castShadow = upper.receiveShadow = true; g.add(upper);
    const lower = new THREE.Mesh(new THREE.SphereGeometry(0.0126, 24, 10, 0, Math.PI * 2, Math.PI * 0.72, Math.PI * 0.28), skin);
    lower.position.copy(c); lower.rotation.z = 0.25; lower.receiveShadow = true; g.add(lower);
  }
  // ears
  for (const sz of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), skin);
    ear.position.set(-0.008, 0.004, sz * RZ * 0.98); ear.scale.set(0.55, 1.05, 0.28);
    ear.castShadow = ear.receiveShadow = true; g.add(ear);
  }
  // hair: top + back of the skull
  // a cap of 90° tilted back: hairline on the forehead, down to the nape at the back
  // hair volume: the skull shape 3–5 % larger above the hairline, sinking just under the skin below it — a closed
  // volume whose edge meets the skin (no shell, no gap); hairline high in front, above the ears, low at the nape
  const capGeo = new THREE.SphereGeometry(1, 120, 80);
  const cp = capGeo.attributes.position as T.BufferAttribute;
  for (let i = 0; i < cp.count; i++) {
    const x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i);
    const line = y - (0.3 * x + 0.16 - 0.12 * Math.abs(z) * (x < 0 ? 1 : 0));
    const amt = smooth(-0.05, 0.07, line);
    const k = 0.985 + amt * (0.045 + 0.025 * Math.max(0, y));
    const jaw = y < 0 ? 1 - 0.28 * Math.pow(-y, 1.6) : 1;
    cp.setXYZ(i, x * RX * (x < 0 ? 1.04 : 1) * k, y * RY * k, z * RZ * jaw * k);
  }
  capGeo.computeVertexNormals();
  const cap = new THREE.Mesh(capGeo, hair);
  cap.castShadow = true;
  g.add(cap);
  return g;
}

// 2026-11-21 (v4), Lino: «kann er die augen geöffnet haben??» — the scan's closed lids are cut open into an almond
// (public/models build, EYE_Z / EYE_Y there); behind each opening sits an eyeball: sclera, iris, pupil with a glossy
// clear coat (catchlights of the lights), and a dark socket so nothing shows through the corners
const SCAN_EYES: [number, number, number][] = [[0.065, 0.0028, 0.0045 - 0.0295], [0.065, 0.0028, 0.0045 + 0.0295]];
function irisTexture(THREE: Three) {
  // a small radial iris: dark limbal ring, brown with lighter streaks towards the pupil, black pupil
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const x = c.getContext("2d")!;
  const g = x.createRadialGradient(64, 64, 6, 64, 64, 64);
  g.addColorStop(0, "#050505"); g.addColorStop(0.36, "#050505"); g.addColorStop(0.4, "#6b5236");
  g.addColorStop(0.75, "#4a3622"); g.addColorStop(0.92, "#2a1d12"); g.addColorStop(1, "#1b130c");
  x.fillStyle = g; x.beginPath(); x.arc(64, 64, 64, 0, Math.PI * 2); x.fill();
  x.globalAlpha = 0.18; x.strokeStyle = "#b08a5a";
  for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2; x.beginPath(); x.moveTo(64 + Math.cos(a) * 26, 64 + Math.sin(a) * 26); x.lineTo(64 + Math.cos(a) * 54, 64 + Math.sin(a) * 54); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function scanEyes(THREE: Three) {
  const g = new THREE.Group();
  const sclera = new THREE.MeshPhysicalMaterial({ color: "#d6cbbd", roughness: 0.45, clearcoat: 1, clearcoatRoughness: 0.05 });
  const iris = new THREE.MeshPhysicalMaterial({ map: irisTexture(THREE), roughness: 0.5, clearcoat: 1, clearcoatRoughness: 0.03 });
  const socket = new THREE.MeshBasicMaterial({ color: "#6a3a30" });   // caruncle / inner lid tone in the corners
  for (const [x, y, z] of SCAN_EYES) {
    const so = new THREE.Mesh(new THREE.SphereGeometry(0.0165, 16, 12), socket);
    so.position.set(x - 0.006, y, z);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.0123, 32, 24), sclera);
    ball.position.set(x, y, z);
    ball.receiveShadow = true;
    // iris: a shallow cap on the front of the ball (follows its curvature — no z-fighting, catchlight on the curve)
    const capGeo = new THREE.SphereGeometry(0.01245, 32, 12, 0, Math.PI * 2, 0, 0.54);
    const cp = capGeo.attributes.position as T.BufferAttribute, cuv = capGeo.attributes.uv as T.BufferAttribute;
    const rr = 0.01245 * Math.sin(0.54);   // just outside the 12.3 mm ball
    for (let i = 0; i < cp.count; i++) cuv.setXY(i, 0.5 + cp.getX(i) / (2 * rr), 0.5 + cp.getZ(i) / (2 * rr));   // planar: the disc texture lies flat on the cap
    const ir = new THREE.Mesh(capGeo, iris);
    ir.position.set(x, y, z); ir.rotation.z = -Math.PI / 2; ir.receiveShadow = true;
    g.add(so, ball, ir);
  }
  return g;
}

/** skin with wrap lighting: light reaches a little past the terminator and warms it — a cheap subsurface look */
export function skinMaterial(THREE: Three, scan?: { map: T.Texture | null; normalMap: T.Texture | null; normalScaleY?: number }) {
  // 2026-11-21 (v4): body skin = the scan's neck tone (#bf978b, measured from its colour map) so head and body meet
  // without a seam; the scanned head uses its colour + normal map with the same wrap lighting
  const m = new THREE.MeshPhysicalMaterial(scan
    ? { map: scan.map, normalMap: scan.normalMap, normalScale: new THREE.Vector2(1, scan.normalScaleY ?? -1), color: new THREE.Color(0.86, 0.84, 0.84), roughness: 0.55, sheen: 0.3, sheenColor: new THREE.Color("#ffd2bd"), sheenRoughness: 0.6 }
    : { color: "#bf978b", roughness: 0.52, sheen: 0.35, sheenColor: new THREE.Color("#ffd2bd"), sheenRoughness: 0.6 });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace("#include <lights_physical_pars_fragment>", THREE.ShaderChunk.lights_physical_pars_fragment.replace(
      "vec3 irradiance = dotNL * directLight.color;",
      "float wrapNL = saturate( ( dot( geometryNormal, directLight.direction ) + 0.2 ) / 1.2 );\n\tvec3 irradiance = mix( vec3( dotNL ), wrapNL * vec3( 1.0, 0.78, 0.66 ), 0.4 ) * directLight.color;"));
  };
  m.customProgramCacheKey = () => "subshot-skin-wrap";
  return m;
}

/** a human figure with real proportions (≈ 7.5 heads), facing +x; standing or sitting */
export function humanFigure(THREE: Three, sitting: boolean, mats: { skin: T.Material; shirt: T.Material; pants: T.Material; shoes: T.Material; hair: T.Material; headSkin?: T.Material }, scanHead?: T.BufferGeometry | null) {
  const g = new THREE.Group();
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const { skin, shirt, pants, shoes, hair } = mats;
  // reference figure 1.75 m: hip 0.92, waist 1.05, chest 1.30, shoulder 1.44, neck 1.52, head centre 1.64
  const hipY = sitting ? 0.5 : 0.92;
  const lift = hipY - 0.92;
  for (const s of [-1, 1]) {
    const hip = V(0, hipY, s * 0.095);
    let knee: T.Vector3, ankle: T.Vector3;
    if (sitting) { knee = V(0.44, hipY + 0.02, s * 0.11); ankle = V(0.46, 0.08, s * 0.12); }
    else { knee = V(0.01, 0.5, s * 0.1); ankle = V(-0.01, 0.08, s * 0.1); }
    g.add(limb(THREE, pants, hip, knee, 0.085, 0.06));
    g.add(ball(THREE, pants, knee, 0.06));
    g.add(limb(THREE, pants, knee, ankle, 0.058, 0.042));
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.08, 0.1), shoes);
    foot.position.set(ankle.x + 0.07, 0.04, ankle.z);
    foot.castShadow = foot.receiveShadow = true;
    g.add(foot);
  }
  // pelvis + torso (lathe profile: hips → waist → chest → shoulders)
  const prof = [[0.0, 0.0], [0.16, 0.0], [0.165, 0.06], [0.14, 0.15], [0.135, 0.2], [0.16, 0.32], [0.175, 0.42], [0.17, 0.5], [0.12, 0.55], [0.0, 0.56]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const torso = new THREE.Mesh(new THREE.LatheGeometry(prof, 24), shirt);
  torso.position.set(0, hipY - 0.02, 0);
  torso.scale.set(0.62, 1, 1.12);
  torso.castShadow = torso.receiveShadow = true;
  g.add(torso);
  const shoulderY = 1.44 + lift;
  for (const s of [-1, 1]) {
    const sh = V(-0.01, shoulderY - 0.035, s * 0.2);
    g.add(ball(THREE, shirt, sh, 0.058, 1.0, 0.82, 1.05));
    const elbow = sitting ? V(0.12, shoulderY - 0.3, s * 0.23) : V(-0.02, shoulderY - 0.3, s * 0.235);
    const wrist = sitting ? V(0.36, shoulderY - 0.4, s * 0.2) : V(0.0, shoulderY - 0.56, s * 0.24);
    g.add(limb(THREE, shirt, sh, elbow, 0.048, 0.04));
    g.add(ball(THREE, shirt, elbow, 0.04));
    g.add(limb(THREE, skin, elbow, wrist, 0.037, 0.028));
    g.add(ball(THREE, skin, wrist.clone().add(sitting ? V(0.05, -0.01, 0) : V(0, -0.06, 0)), 0.04, 1.1, 1.3, 0.6));
  }
  // trapezius: the slope from the neck down to the shoulders
  g.add(ball(THREE, shirt, V(-0.025, shoulderY - 0.005, 0), 0.1, 0.85, 0.5, 2.0));
  const headC = V(0.015, shoulderY + 0.175, 0);
  // the scan's neck ends in a 5.8 cm tube 3 cm behind the head centre (public/models build) — the body's neck continues it
  if (scanHead && mats.headSkin) g.add(limb(THREE, skin, V(headC.x - 0.03, shoulderY - 0.04, 0), V(headC.x - 0.024, headC.y - 0.11, 0), 0.062, 0.054));
  else g.add(limb(THREE, skin, V(0, shoulderY - 0.04, 0), V(0.005, shoulderY + 0.105, 0), 0.058, 0.052));
  // 2026-11-21 (v3): a sculpted head (nose, brow, eye sockets, cheekbones, lips, chin) — its forms cast the face
  // shadows Rembrandt / loop / split light depend on
  // 2026-11-21 (v4), Lino: «ein Gratismodell … was realistisch aussieht» — a real 3D head scan (Lee Perry-Smith,
  // CC BY 3.0, public/models/LICENSE-human.txt), cut at the neck, in metres, facing +x, centred like the sculpted head.
  // Its geometry is shared across rebuilds (userData.shared → never disposed per rebuild). Fallback: sculpted head.
  if (scanHead && mats.headSkin) {
    const head = new THREE.Mesh(scanHead, mats.headSkin);
    head.userData.shared = true;
    head.castShadow = head.receiveShadow = true;
    head.position.copy(headC);
    head.rotation.z = 0.08;   // the scan looks a little down — level the gaze so a high key throws the nose shadow
    head.add(scanEyes(THREE));
    g.add(head);
  } else {
    const head = sculptedHead(THREE, skin, hair);
    head.position.copy(headC);
    g.add(head);
  }
  if (sitting) {
    const wood = new THREE.MeshStandardMaterial({ color: "#6b5440", roughness: 0.7 });
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.05, 0.46), wood);
    seat.position.set(0.0, 0.45, 0); seat.castShadow = seat.receiveShadow = true; g.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.48, 0.44), wood);
    back.position.set(-0.22, 0.72, 0); back.castShadow = true; g.add(back);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.43), wood);
      leg.position.set(sx * 0.19, 0.215, sz * 0.19); leg.castShadow = true; g.add(leg);
    }
  }
  return g;
}

function family(li: LpLight) {
  if (li.modifier === "softbox") return "softbox";
  if (li.modifier === "lantern") return "lantern";
  if (li.modifier === "fresnel") return "fresnel";
  if (li.modifier === "dish55") return "dish";
  const s = presetOf(li.preset)?.shape;
  return s === "tube" ? "tube" : s === "panel" ? "panel" : "cob";
}

/** a light stand: three legs + pole up to `h` */
function stand(THREE: Three, mat: T.Material, h: number) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, h, 10), mat);
  pole.position.y = h / 2; pole.castShadow = true; g.add(pole);
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.62, 8), mat);
    leg.position.set(Math.cos(a) * 0.24, 0.2, Math.sin(a) * 0.24);
    leg.lookAt(0, 0.45, 0); leg.rotateX(Math.PI / 2);
    leg.castShadow = true; g.add(leg);
  }
  return g;
}

// 2026-11-21 (v4): PCSS — percentage-closer soft shadows for the key light's face shadow map: a blocker search finds
// how far the occluder is from the receiver, the penumbra grows with that gap × the source size (contact hardening:
// the nose shadow is sharp at the nose and softer further away, the shadow on the wall softer than on the face).
// Patched once into three's PCF path; only a light whose shadow.radius is NEGATIVE uses it — the radius then encodes
// the depth range (far/near) and the source size (see pcssRadius). Every other light keeps plain PCF.
let pcssInstalled = false;
export function installPcss(THREE: Three, phone: boolean) {
  if (pcssInstalled) return;
  pcssInstalled = true;
  // samples: blocker search / filter — the filter needs more (grain in the penumbra); phone fewer search samples
  const [ns, nf] = phone ? [8, 24] : [16, 32];
  const fn = `
	#define PCSS_NS ${ns}
	#define PCSS_NF ${nf}
	vec2 pcssDisk( int i, float n, float rot ) {
		float fi = float( i ) + 0.5;
		float r = sqrt( fi / n );
		float a = fi * 2.39996323 + rot;   // golden-angle (Vogel) spiral
		return vec2( cos( a ), sin( a ) ) * r;
	}
	float pcssShadow( sampler2D sm, vec2 mapSize, float enc, vec3 c ) {
		float e = - enc;
		float kq = floor( e / 1000.0 );
		float F = max( 1.01, e - kq * 1000.0 );     // far / near of the shadow camera
		float K = kq / 100.0;                        // source size / (frustum width per metre × near)
		float zR = F / ( F - c.z * ( F - 1.0 ) );    // receiver distance / near (linearised depth)
		vec2 texel = 1.0 / mapSize;
		float rot = 0.0;   // one fixed spiral for every pixel: a per-pixel random rotation showed as dots in the penumbra
		// 1) blocker search: how far in front of the receiver are the occluders (average)?
		float searchUV = clamp( 0.5 * K / zR, 2.0 * texel.x, 0.04 );
		float sum = 0.0; float cnt = 0.0;
		for ( int i = 0; i < PCSS_NS; i ++ ) {
			float d = unpackRGBAToDepth( texture2D( sm, c.xy + pcssDisk( i, float( PCSS_NS ), rot ) * searchUV ) );
			if ( d < c.z - 0.0002 ) { sum += d; cnt += 1.0; }   // ≈ 3 mm: the surface's own depth is no blocker (no grain)
		}
		if ( cnt < 0.5 ) return 1.0;
		float zB = F / ( F - ( sum / cnt ) * ( F - 1.0 ) );
		// 2) penumbra from similar triangles: size × (receiver − blocker) / blocker, in shadow-map units at the receiver
		float filterUV = clamp( K * ( zR - zB ) / ( zB * zR ), 5.0 * texel.x, 0.035 );   // ≥ 5 texels (≈ 2 mm on the face): no facet / dot artefacts in creases
		float lit = 0.0;
		for ( int i = 0; i < PCSS_NF; i ++ ) {
			vec2 o = pcssDisk( i, float( PCSS_NF ), rot + 1.7 ) * filterUV;
			lit += texture2DCompare( sm, c.xy + o, c.z );
		}
		return lit / float( PCSS_NF );
	}
`;
  let chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
  const anchor = "\tvec2 texture2DDistribution(";
  const pcfStart = "\t\t#if defined( SHADOWMAP_TYPE_PCF )\n";
  const pcfEnd = "\t\t#elif defined( SHADOWMAP_TYPE_PCF_SOFT )";
  if (!chunk.includes(anchor) || !chunk.includes(pcfStart) || !chunk.includes(pcfEnd)) return;   // three changed: plain PCF
  chunk = chunk.replace(anchor, fn + anchor);
  chunk = chunk.replace(pcfStart, pcfStart + "\t\t\tif ( shadowRadius < 0.0 ) { shadow = pcssShadow( shadowMap, shadowMapSize, shadowRadius, shadowCoord.xyz ); } else {\n");
  chunk = chunk.replace(pcfEnd, "\t\t\t}\n" + pcfEnd);
  THREE.ShaderChunk.shadowmap_pars_fragment = chunk;
}

/** shadow.radius for a PCSS light: −(far/near + 1000 × round(100 × K)), K = size / (2·tan(fov/2) × near) */
export function pcssRadius(srcSize: number, fovHalf: number, near: number, far: number) {
  const F = Math.min(999, Math.max(2, Math.round(far / near)));
  const K = Math.min(9999, Math.max(1, Math.round((100 * srcSize) / (2 * Math.tan(fovHalf) * near))));
  return -(F + 1000 * K);
}

const DEFAULT_WALL = "#d8d2c6";
const DEFAULT_WALL_LUM = (() => { const r = 0xd8 / 255, g = 0xd2 / 255, b = 0xc6 / 255; const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); })();
type Emitter = { pos: T.Vector3; dir: T.Vector3; cd: number; omni: boolean; cosO: number; cosI: number; color: T.Color };
/** illuminance (lux-like, the scene's photometric units) from one fixture at point p with surface normal n;
 * dome = incident-meter dome response (1 + cos) / 2 instead of a flat cosine */
function irradiance(THREE: Three, e: Emitter, p: T.Vector3, n: T.Vector3, dome = false) {
  const l = e.pos.clone().sub(p);
  const d2 = Math.max(0.04, l.lengthSq());
  l.normalize();
  const c = n.dot(l);
  const inc = dome ? (1 + c) / 2 : Math.max(0, c);
  if (inc <= 0) return 0;
  const cone = e.omni ? 1 : smooth(e.cosO, Math.max(e.cosO + 1e-4, e.cosI), e.dir.dot(l.clone().negate()));
  void THREE;
  return (e.cd * cone * inc) / d2;
}

export type ScanHead = { geometry: T.BufferGeometry; map: T.Texture | null; normalMap: T.Texture | null; normalScaleY: number };

export function buildScene(THREE: Three, plot: LightPlotData, look: LpLook, cam: LpPerson, phone: boolean, scan?: ScanHead | null, noPcss = false) {
  if (!noPcss) installPcss(THREE, phone);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#060607");
  const H = plot.room.height ?? 2.6;
  const add = <M extends T.Object3D>(o: M, cast = true, receive = true) => { o.traverse((x) => { x.castShadow = cast; x.receiveShadow = receive; }); scene.add(o); return o; };

  // floor (wood) + walls (plaster) with procedural textures
  const floorTex = noiseTexture(THREE, "#8a7458", "wood");
  floorTex.repeat.set(30, 30);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.62 }));
  floor.rotation.x = -Math.PI / 2;
  add(floor, false, true);
  const wallHex = plot.room.wall_color ?? DEFAULT_WALL;
  const wallTex = noiseTexture(THREE, wallHex, "plaster");
  wallTex.repeat.set(3, 1.5);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.92 });
  const trimMat = new THREE.MeshStandardMaterial({ color: "#efece6", roughness: 0.6 });
  const glassMat = new THREE.MeshPhysicalMaterial({ color: "#cfe8ff", transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0 });
  const frameMat = new THREE.MeshStandardMaterial({ color: "#f4f4f2", roughness: 0.5 });
  const wallBox = (x1: number, y1: number, x2: number, y2: number, z0: number, z1: number, mat: T.Material = wallMat, depth = 0.12) => {
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 0.01 || z1 <= z0) return null;
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, z1 - z0, depth), mat);
    m.position.set((x1 + x2) / 2, (z0 + z1) / 2, (y1 + y2) / 2);
    m.rotation.y = -Math.atan2(y2 - y1, x2 - x1);
    return add(m);
  };
  for (const w of plot.room.walls) {
    if (w.kind === "curve") {
      const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1) || 1;
      const nx = -(w.y2 - w.y1) / len, ny = (w.x2 - w.x1) / len, b = (w.bend ?? 0.25) * len * 2;
      const cx = (w.x1 + w.x2) / 2 + nx * b, cy = (w.y1 + w.y2) / 2 + ny * b;
      const pt = (t: number) => ({ x: (1 - t) ** 2 * w.x1 + 2 * (1 - t) * t * cx + t * t * w.x2, y: (1 - t) ** 2 * w.y1 + 2 * (1 - t) * t * cy + t * t * w.y2 });
      for (let i = 0; i < 12; i++) { const a = pt(i / 12), c = pt((i + 1) / 12); wallBox(a.x, a.y, c.x, c.y, 0, H); }
    } else if (w.kind === "window") {
      wallBox(w.x1, w.y1, w.x2, w.y2, 0, 0.9);
      wallBox(w.x1, w.y1, w.x2, w.y2, 2.1, H);
      wallBox(w.x1, w.y1, w.x2, w.y2, 0.86, 0.9, frameMat, 0.2);
      wallBox(w.x1, w.y1, w.x2, w.y2, 0.9, 2.1, glassMat, 0.02);
    } else if (w.kind === "door") {
      wallBox(w.x1, w.y1, w.x2, w.y2, 2.1, H);
      wallBox(w.x1, w.y1, w.x2, w.y2, 2.06, 2.1, trimMat, 0.16);
    } else if (w.kind === "opening") {
      wallBox(w.x1, w.y1, w.x2, w.y2, Math.min(H, 2.3), H);
    } else {
      wallBox(w.x1, w.y1, w.x2, w.y2, 0, H);
      wallBox(w.x1, w.y1, w.x2, w.y2, 0, 0.08, trimMat, 0.14); // skirting board
    }
  }

  // set pieces
  const wood = new THREE.MeshStandardMaterial({ map: noiseTexture(THREE, "#6e5641", "wood", 128), roughness: 0.55 });
  const fabric = new THREE.MeshStandardMaterial({ color: "#5b6573", roughness: 0.95 });
  const linen = new THREE.MeshStandardMaterial({ color: "#e9e6df", roughness: 0.95 });
  const paint = new THREE.MeshPhysicalMaterial({ color: "#2f3d4c", roughness: 0.3, metalness: 0.5, clearcoat: 0.8 });
  const glass = new THREE.MeshStandardMaterial({ color: "#1b2530", roughness: 0.1, metalness: 0.2 });
  const leaf = new THREE.MeshStandardMaterial({ color: "#3d6e3f", roughness: 0.9 });
  for (const it of plot.room.items) {
    const g = new THREE.Group();
    g.position.set(it.x, 0, it.y);
    g.rotation.y = -(it.rot * Math.PI) / 180;
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: T.Material, r = 0) => {
      const geo = new THREE.BoxGeometry(w, h, d);
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); void r; g.add(m); return m;
    };
    const cyl = (r: number, h: number, x: number, y: number, z: number, mat: T.Material) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 12), mat); m.position.set(x, y, z); g.add(m); return m; };
    switch (it.kind) {
      case "table":
        box(it.w, 0.04, it.h, 0, 0.74, 0, wood);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.05, 0.72, 0.05, sx * (it.w / 2 - 0.07), 0.36, sz * (it.h / 2 - 0.07), wood);
        box(it.w - 0.2, 0.08, 0.03, 0, 0.67, it.h / 2 - 0.07, wood); box(it.w - 0.2, 0.08, 0.03, 0, 0.67, -it.h / 2 + 0.07, wood);
        break;
      case "chair":
        box(it.w, 0.05, it.h, 0, 0.45, 0, wood);
        box(0.04, 0.48, it.h, -it.w / 2 + 0.02, 0.72, 0, wood);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(0.018, 0.43, sx * (it.w / 2 - 0.04), 0.215, sz * (it.h / 2 - 0.04), wood);
        break;
      case "sofa":
        box(it.w, 0.2, it.h, 0, 0.18, 0, fabric);
        box(it.w * 0.8, 0.14, it.h * 0.7, 0, 0.35, it.h * 0.1, fabric);
        box(it.w, 0.5, it.h * 0.22, 0, 0.55, -it.h * 0.39, fabric);
        box(it.w * 0.1, 0.32, it.h, -it.w * 0.45, 0.42, 0, fabric); box(it.w * 0.1, 0.32, it.h, it.w * 0.45, 0.42, 0, fabric);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(0.025, 0.08, sx * (it.w / 2 - 0.08), 0.04, sz * (it.h / 2 - 0.08), wood);
        break;
      case "bed":
        box(it.w, 0.3, it.h, 0, 0.2, 0, wood);
        box(it.w * 0.98, 0.2, it.h * 0.96, 0, 0.45, 0, linen);
        box(0.08, 0.9, it.h, -it.w / 2, 0.45, 0, wood);
        for (const sz of [-1, 1]) box(it.w * 0.15, 0.12, it.h * 0.4, -it.w * 0.38, 0.6, sz * it.h * 0.22, linen);
        box(it.w * 0.6, 0.06, it.h * 0.98, it.w * 0.18, 0.57, 0, fabric);
        break;
      case "car":
        box(it.w, 0.6, it.h, 0, 0.55, 0, paint);
        box(it.w * 0.52, 0.48, it.h * 0.88, -it.w * 0.06, 1.08, 0, paint);
        box(it.w * 0.5, 0.36, it.h * 0.9, -it.w * 0.06, 1.1, 0, glass);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const w = cyl(0.33, 0.22, sx * it.w * 0.32, 0.33, sz * it.h * 0.45, glass); w.rotation.x = Math.PI / 2; }
        break;
      case "tree": {
        cyl(0.09, 2.0, 0, 1.0, 0, wood);
        const r = Math.min(it.w, it.h) / 2;
        for (const [x, y, z, s] of [[0, 2.4, 0, 1], [0.3, 2.1, 0.2, 0.7], [-0.3, 2.2, -0.2, 0.75], [0, 2.9, 0, 0.6]]) {
          const c = new THREE.Mesh(new THREE.IcosahedronGeometry(r * s, 1), leaf); c.position.set(x * r, y, z * r); g.add(c);
        }
        break;
      }
      case "stairs": {
        const n = Math.max(2, Math.round(it.h / 0.28));
        for (let i = 0; i < n; i++) box(it.w, 0.18 * (i + 1), it.h / n, 0, 0.09 * (i + 1), -it.h / 2 + (it.h / n) * (i + 0.5), wood);
        break;
      }
      case "circle": cyl(it.w / 2, 0.75, 0, 0.375, 0, fabric); break;
      default: box(it.w, 0.8, it.h, 0, 0.4, 0, fabric);
    }
    add(g);
  }

  // talent
  const mats = {
    skin: skinMaterial(THREE),
    shirt: new THREE.MeshStandardMaterial({ color: "#3e5266", roughness: 0.9 }),
    pants: new THREE.MeshStandardMaterial({ color: "#2b2e35", roughness: 0.85 }),
    shoes: new THREE.MeshStandardMaterial({ color: "#151517", roughness: 0.5 }),
    hair: new THREE.MeshStandardMaterial({ color: "#3a2a1f", roughness: 0.7 }),
    headSkin: scan ? skinMaterial(THREE, scan) : undefined,
  };
  for (const p of plot.people) {
    if (p.kind !== "talent") continue;
    const f = humanFigure(THREE, p.pose === "sitting", mats, scan?.geometry);
    f.position.set(p.x, 0, p.y);
    f.rotation.y = -(p.rot * Math.PI) / 180;
    f.scale.setScalar((p.height_m ?? 1.75) / 1.75);
    add(f);
  }

  // lights — the camera's white balance tints them
  const wb = new THREE.Color(kelvinColor(cam.kelvin ?? 5600));
  const tint = (k: number) => {
    const c = new THREE.Color(kelvinColor(k));
    c.r /= Math.max(0.05, wb.r); c.g /= Math.max(0.05, wb.g); c.b /= Math.max(0.05, wb.b);
    return c.multiplyScalar(1 / Math.max(c.r, c.g, c.b));
  };
  const diffusers = look.mods.filter((m) => m.kind === "diffusion");
  const nearDiff = (x: number, y: number) => diffusers.some((d) => {
    const vx = d.x2 - d.x1, vy = d.y2 - d.y1, L2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((x - d.x1) * vx + (y - d.y1) * vy) / L2));
    return Math.hypot(x - (d.x1 + t * vx), y - (d.y1 + t * vy)) < 1.3;
  });
  const metal = new THREE.MeshStandardMaterial({ color: "#2a2a2e", roughness: 0.45, metalness: 0.7 });
  const black = new THREE.MeshStandardMaterial({ color: "#121214", roughness: 0.6, metalness: 0.2 });
  const shadowSize = phone ? 512 : 1024;
  let totalPower = 0;
  // v4: every light as a simple emitter (position, axis, candela, cone) — the bounce objects and the face meter use it
  const emitters: Emitter[] = [];
  // v3: the key light gets a sharp, tight shadow around the talent's head (the nose / cheekbone shadows of
  // Rembrandt, loop, split …); the other lights keep their normal shadow maps
  const keyId = (look.lights.find((l) => l.role === "key") ?? look.lights[0])?.id;
  const talent0 = plot.people.find((p) => p.kind === "talent");
  const headPos = talent0 ? new THREE.Vector3(talent0.x, (talent0.pose === "sitting" ? 1.18 : 1.62) * ((talent0.height_m ?? 1.75) / 1.75), talent0.y) : null;
  look.lights.forEach((li, i) => {
    const fam = family(li);
    const watts = presetOf(li.preset)?.watts ?? 150;
    const diffused = nearDiff(li.x, li.y);
    const color = tint(li.kelvin);
    const cd = watts * 55 * MODIFIER_GAIN[li.modifier] * (li.intensity / 100) * (diffused ? 0.55 : 1);
    totalPower += cd;
    const z = li.z ?? 2, tilt = ((li.tilt ?? 25) * Math.PI) / 180, r = (li.rot * Math.PI) / 180;
    const dir = new THREE.Vector3(Math.cos(r) * Math.cos(tilt), -Math.sin(tilt), Math.sin(r) * Math.cos(tilt));
    const pos = new THREE.Vector3(li.x, z, li.y);
    const soft = fam === "softbox" || fam === "panel" || fam === "tube" || diffused;
    {
      const omni = fam === "lantern" || li.beam >= 180;
      const ang = Math.min(Math.PI * 0.47, ((li.beam / 2) * Math.PI) / 180 * (diffused ? 1.35 : 1));
      const pen = soft ? 1 : MODIFIER_SOFT[li.modifier];
      emitters.push({ pos, dir, cd: omni ? cd / 2.2 : cd, omni, cosO: Math.cos(ang), cosI: Math.cos(ang * (1 - pen)), color });
    }
    // apparent size of the source (m): drives how soft its shadow edges are
    const srcSize = diffused ? 1.2 : ({ softbox: 0.9, lantern: 0.6, panel: 0.6, tube: 0.8, dish: 0.55, fresnel: 0.15, cob: 0.1 } as Record<string, number>)[fam] ?? 0.2;

    // the light itself
    if (fam === "lantern" || li.beam >= 180) {
      const pl = new THREE.PointLight(color, cd / 2.2, 0, 2);
      pl.position.copy(pos);
      if (i < 6) { pl.castShadow = true; pl.shadow.mapSize.set(shadowSize / 2, shadowSize / 2); pl.shadow.bias = -0.002; pl.shadow.radius = 8; }
      scene.add(pl);
    } else {
      if (soft) {
        // soft source: an area light the size of the softbox / panel / tube + a weaker soft spot for its shadow
        const [aw, ah] = fam === "softbox" ? [0.9, 0.9] : fam === "panel" ? [0.3, 0.6] : fam === "tube" ? [0.05, li.preset.includes("15X") ? 0.6 : 1.2] : [0.8, 0.8];
        const area = new THREE.RectAreaLight(color, (cd * 0.4) / (aw * ah * 3.2), aw, ah);
        area.position.copy(pos.clone().add(dir.clone().multiplyScalar(fam === "softbox" ? 0.45 : 0.1)));
        area.lookAt(pos.clone().add(dir.clone().multiplyScalar(4)));
        scene.add(area);
      }
      const sp = new THREE.SpotLight(color, soft ? cd * 0.62 : cd, 0, Math.min(Math.PI * 0.47, ((li.beam / 2) * Math.PI) / 180 * (diffused ? 1.35 : 1)), soft ? 1 : MODIFIER_SOFT[li.modifier], 2);
      sp.position.copy(pos);
      sp.target.position.copy(pos.clone().add(dir.clone().multiplyScalar(3)));
      scene.add(sp.target);
      if (i < 8) {
        sp.castShadow = true;
        sp.shadow.mapSize.set(shadowSize, shadowSize);
        sp.shadow.bias = -0.0005;
        sp.shadow.normalBias = 0.02;
        sp.shadow.radius = Math.min(9, 1 + (14 * srcSize) / Math.max(0.5, pos.length() > 0 ? z + 1 : 2));
        sp.shadow.camera.near = 0.2;
        if (li.id === keyId && headPos) {
          const dist = pos.distanceTo(headPos);
          const need = 2 * Math.atan(0.9 / Math.max(0.3, dist));          // ≈ 1.8 m wide around the head
          sp.shadow.focus = Math.min(1, need / (2 * sp.angle));
          sp.shadow.mapSize.set(phone ? 2048 : 4096, phone ? 2048 : 4096);
          sp.shadow.bias = -0.00012;
          sp.shadow.normalBias = 0.0025;
          sp.shadow.radius = Math.min(9, 1 + (14 * srcSize) / Math.max(0.5, dist));  // penumbra grows with the source size / distance
          sp.shadow.camera.near = Math.max(0.1, dist - 1.5);
          sp.shadow.camera.far = dist + 6;
          // v4: contact-hardening soft shadow (PCSS) from the real source size; the PCF radius above is the fallback
          if (pcssInstalled && !noPcss) sp.shadow.radius = pcssRadius(srcSize, sp.angle * sp.shadow.focus, sp.shadow.camera.near, sp.shadow.camera.far);
        }
      }
      scene.add(sp);
    }

    // the fixture model: stand + head by family, glowing where the light exits
    // where the light exits: unlit, not tone-mapped (would be black at the scene's photometric exposure)
    const glow = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(0.55 + li.intensity / 250), toneMapped: false });
    const fixture = new THREE.Group();
    fixture.add(stand(THREE, metal, Math.max(0.3, z - 0.12)));
    const head = new THREE.Group();
    head.position.set(0, z, 0);
    head.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
    const yoke = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.012, 6, 16, Math.PI), metal);
    yoke.rotation.y = Math.PI / 2;
    const m = (geo: T.BufferGeometry, mat: T.Material, x = 0) => { const o = new THREE.Mesh(geo, mat); o.position.x = x; o.castShadow = true; head.add(o); return o; };
    if (fam === "softbox") {
      m(new THREE.BoxGeometry(0.22, 0.2, 0.2), black, -0.12);
      const box = m(new THREE.CylinderGeometry(0.62, 0.12, 0.5, 4, 1, true), new THREE.MeshStandardMaterial({ color: "#111", roughness: 0.9, side: THREE.DoubleSide }), 0.2);
      box.rotation.z = -Math.PI / 2; box.rotation.x = Math.PI / 4;
      const front = m(new THREE.PlaneGeometry(0.86, 0.86), glow, 0.455); front.rotation.y = Math.PI / 2; front.castShadow = false;
    } else if (fam === "lantern") {
      m(new THREE.BoxGeometry(0.2, 0.18, 0.18), black, -0.25);
      const ball = m(new THREE.SphereGeometry(0.32, 20, 14), new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(0.55 + li.intensity / 250), transparent: true, opacity: 0.95, toneMapped: false }), 0.12);
      ball.castShadow = false;
      head.quaternion.identity();
    } else if (fam === "tube") {
      head.quaternion.identity();  // tubes stand upright
      const len = li.preset.includes("15X") ? 0.6 : 1.2;
      const t = m(new THREE.CylinderGeometry(0.025, 0.025, len, 12), glow); t.castShadow = false;
      head.position.y = Math.max(len / 2 + 0.2, z);
    } else if (fam === "panel") {
      m(new THREE.BoxGeometry(0.05, 0.62, 0.32), black, -0.03);
      const face = m(new THREE.PlaneGeometry(0.3, 0.58), glow, 0.0); face.rotation.y = Math.PI / 2; face.castShadow = false;
    } else if (fam === "dish") {
      m(new THREE.CylinderGeometry(0.1, 0.1, 0.24, 16), black, -0.12).rotation.z = Math.PI / 2;
      const dish = m(new THREE.SphereGeometry(0.28, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2.6), new THREE.MeshStandardMaterial({ color: "#d8d8dc", roughness: 0.35, metalness: 0.6, side: THREE.DoubleSide }), 0.12);
      dish.rotation.z = Math.PI / 2;
      const bulb = m(new THREE.SphereGeometry(0.05, 12, 8), glow, 0.1); bulb.castShadow = false;
    } else if (fam === "fresnel") {
      m(new THREE.CylinderGeometry(0.15, 0.15, 0.32, 20), black, -0.08).rotation.z = Math.PI / 2;
      const lens = m(new THREE.CircleGeometry(0.13, 24), glow, 0.081); lens.rotation.y = Math.PI / 2; lens.castShadow = false;
      for (const s of [-1, 1]) { const door = m(new THREE.BoxGeometry(0.12, 0.26, 0.01), black, 0.14); door.position.z = s * 0.15; door.rotation.y = s * 0.6; }
    } else {
      m(new THREE.BoxGeometry(0.26, 0.2, 0.2), black, -0.1);
      const refl = m(new THREE.CylinderGeometry(0.14, 0.08, 0.14, 20, 1, true), new THREE.MeshStandardMaterial({ color: "#bbb", roughness: 0.3, metalness: 0.8, side: THREE.DoubleSide }), 0.09);
      refl.rotation.z = -Math.PI / 2;
      const face = m(new THREE.CircleGeometry(0.075, 20), glow, 0.03); face.rotation.y = Math.PI / 2; face.castShadow = false;
    }
    head.add(yoke);
    fixture.add(head);
    fixture.position.set(li.x, 0, li.y);
    // the fixture must not shadow its own light
    fixture.traverse((o) => { o.castShadow = false; });
    scene.add(fixture);
  });

  // flags on C-stands, diffusion frames as translucent cloth in a frame
  const cloth = new THREE.MeshStandardMaterial({ color: "#ffffff", transparent: true, opacity: 0.55, roughness: 1, side: THREE.DoubleSide });
  const flagMat = new THREE.MeshStandardMaterial({ color: "#0a0a0b", roughness: 1, side: THREE.DoubleSide });
  for (const mo of look.mods) {
    if (isBounce(mo)) continue;   // v4: drawn + lit below
    const len = Math.hypot(mo.x2 - mo.x1, mo.y2 - mo.y1);
    if (len < 0.05) continue;
    const g = new THREE.Group();
    g.position.set((mo.x1 + mo.x2) / 2, 0, (mo.y1 + mo.y2) / 2);
    g.rotation.y = -Math.atan2(mo.y2 - mo.y1, mo.x2 - mo.x1);
    const hgt = mo.kind === "flag" ? 0.75 : 1.2;
    const cy = mo.kind === "flag" ? 1.75 : 1.5;
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(len, hgt), mo.kind === "flag" ? flagMat : cloth);
    panel.position.y = cy;
    panel.castShadow = mo.kind === "flag";
    g.add(panel);
    for (const [w, h, x, y] of [[len, 0.02, 0, cy + hgt / 2], [len, 0.02, 0, cy - hgt / 2], [0.02, hgt, -len / 2, cy], [0.02, hgt, len / 2, cy]] as const) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.02), metal); f.position.set(x, y, 0); g.add(f);
    }
    const st = stand(THREE, metal, cy - hgt / 2);
    st.position.set(-len / 2 - 0.25, 0, 0.3);
    g.add(st);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.6), metal);
    arm.position.set(-len / 2 - 0.1, cy - hgt / 2, 0.15); arm.rotation.z = Math.PI / 2; arm.rotation.y = 0.6;
    g.add(arm);
    scene.add(g);
  }

  // bounce approximation: floor / wall colour, stronger with more light in the room; v4: scaled with the wall colour
  const wallC = new THREE.Color(wallHex);
  const wallLum = (0.2126 * wallC.r + 0.7152 * wallC.g + 0.0722 * wallC.b) / DEFAULT_WALL_LUM;
  const hemiI = (1.5 + Math.min(40, totalPower / 3500)) * Math.max(0.15, Math.min(1.25, wallLum));
  scene.add(new THREE.HemisphereLight(wallC.clone().lerp(new THREE.Color("#d9d2c6"), 0.35), "#7a6650", hemiI));

  // v4 bounce objects (reflector, V-flat / poly board, bounce card): each receives light from every fixture (inverse
  // square × cosine of incidence × the fixture's cone) and re-emits ρ·E/π as a soft area light of its own size, facing
  // its normal; black boards (ρ 0) take the room bounce away on their side (negative area light = negative fill)
  const bounces: { pos: T.Vector3; n: T.Vector3; area: number; L: number; color: T.Color }[] = [];
  const headAim = headPos ?? new THREE.Vector3(0, 1.5, 0);
  const surfMat: Record<string, T.Material> = {
    white: new THREE.MeshStandardMaterial({ color: "#f2f2f0", roughness: 0.95, side: THREE.DoubleSide }),
    silver: new THREE.MeshStandardMaterial({ color: "#d4d4d8", roughness: 0.3, metalness: 0.85, side: THREE.DoubleSide }),
    gold: new THREE.MeshStandardMaterial({ color: "#d9a640", roughness: 0.32, metalness: 0.85, side: THREE.DoubleSide }),
    black: new THREE.MeshStandardMaterial({ color: "#0b0b0c", roughness: 1, side: THREE.DoubleSide }),
  };
  const goldTint = (() => { const w = new THREE.Color(kelvinColor(5600)), g = new THREE.Color(kelvinColor(3200)); return new THREE.Color(g.r / w.r, g.g / w.g, g.b / w.b).multiplyScalar(1 / Math.max(g.r / w.r, g.g / w.g, g.b / w.b)); })();
  for (const mo of look.mods) {
    if (!isBounce(mo)) continue;
    const len = Math.max(0.1, Math.hypot(mo.x2 - mo.x1, mo.y2 - mo.y1));
    const surface = mo.surface ?? "white";
    const cz = Math.min(H - 0.05, mo.z ?? BOUNCE_Z[mo.kind] ?? 1.2);
    const pos = new THREE.Vector3((mo.x1 + mo.x2) / 2, cz, (mo.y1 + mo.y2) / 2);
    const [w, h] = mo.kind === "vflat" ? [len, Math.min(2.4, H)] : mo.kind === "card" ? [len, len * 0.75] : [len, len];
    // the board faces the nearest talent: V-flats stand upright (normal in the floor plane), reflectors / cards aim at the head
    const seg = new THREE.Vector3(mo.x2 - mo.x1, 0, mo.y2 - mo.y1).normalize();
    let n = new THREE.Vector3(-seg.z, 0, seg.x);
    if (n.dot(headAim.clone().sub(pos)) < 0) n.negate();
    if (mo.kind !== "vflat") n = headAim.clone().sub(pos).normalize();
    const vpos = mo.kind === "vflat" ? pos.clone().setY(h / 2) : pos;
    // received light
    let E = 0;
    const col = new THREE.Color(0, 0, 0);
    for (const e of emitters) { const ei = irradiance(THREE, e, vpos, n); E += ei; col.add(e.color.clone().multiplyScalar(ei)); }
    if (E > 0) col.multiplyScalar(1 / Math.max(col.r, col.g, col.b, 1e-6)); else col.set("#ffffff");
    if (surface === "gold") col.multiply(goldTint);
    const rho = SURFACE_REFLECT[surface];
    // silver: more specular — a smaller, punchier source; black: minus the room bounce it hides
    const L = surface === "black" ? -(hemiI / Math.PI) * 0.8 : (rho * E) / Math.PI * (surface === "silver" ? 1.6 : 1);
    const [rw, rh] = mo.kind === "reflector" ? [len * 0.886, len * 0.886] : [w, h];
    const shrink = surface === "silver" ? 0.7 : 1;
    const rect = new THREE.RectAreaLight(surface === "black" ? new THREE.Color("#ffffff") : col, L, rw * shrink, rh * shrink);
    rect.position.copy(vpos).add(n.clone().multiplyScalar(0.03));
    rect.lookAt(vpos.clone().add(n.clone().multiplyScalar(2)));
    scene.add(rect);
    bounces.push({ pos: vpos.clone(), n: n.clone(), area: rw * rh * shrink * shrink, L, color: col });
    // the board itself
    const g = new THREE.Group();
    g.position.copy(vpos);
    g.lookAt(vpos.clone().add(n));
    const board = new THREE.Mesh(mo.kind === "reflector" ? new THREE.CircleGeometry(len / 2, 40) : new THREE.PlaneGeometry(w, h), surfMat[surface]);
    board.castShadow = board.receiveShadow = true;
    g.add(board);
    if (mo.kind === "vflat") {   // the second leaf of the V, hinged at one edge, behind the face
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.05), surfMat[surface === "black" ? "black" : "white"]);
      leaf.position.set(w * 0.25, 0, -w * 0.43); leaf.rotation.y = -Math.PI / 3; leaf.castShadow = true; g.add(leaf);
    } else {
      const rim = new THREE.Mesh(mo.kind === "reflector" ? new THREE.TorusGeometry(len / 2, 0.008, 6, 40) : new THREE.BoxGeometry(w + 0.02, h + 0.02, 0.01), metal);
      rim.position.z = -0.006; g.add(rim);
    }
    scene.add(g);
    if (mo.kind !== "vflat") {
      const st = stand(THREE, metal, Math.max(0.3, cz - h / 2));
      st.position.set(pos.x - n.x * 0.05, 0, pos.z - n.z * 0.05);
      scene.add(st);
    }
  }

  // v4 face meter (spot meter / incident dome at the face, pointed at the camera): fixtures + bounce boards + room
  let lux = 0;
  if (headPos && talent0) {
    const fr = -(talent0.rot * Math.PI) / 180;
    const face = headPos.clone().add(new THREE.Vector3(Math.cos(-fr) * 0.1, 0, Math.sin(-fr) * 0.1));
    const toCam = new THREE.Vector3(cam.x, cam.z ?? 1.5, cam.y).sub(face).normalize();
    for (const e of emitters) lux += irradiance(THREE, e, face, toCam, true);
    for (const b of bounces) {
      const v = b.pos.clone().sub(face); const d2 = Math.max(0.04, v.lengthSq()); v.normalize();
      const cosB = Math.max(0, -v.dot(b.n)), dome = (1 + v.dot(toCam)) / 2;
      lux += (b.L * b.area * cosB * dome) / d2;
    }
    lux = Math.max(0, lux + hemiI);
  }

  // the camera
  const hfov = cameraFov(cam.lens_mm, cam.sensor);
  const vfov = (2 * Math.atan(Math.tan(((hfov / 2) * Math.PI) / 180) / ASPECT) * 180) / Math.PI;
  const camera = new THREE.PerspectiveCamera(vfov, ASPECT, 0.05, 300);
  const cz = cam.z ?? 1.5, ct = ((cam.tilt ?? 0) * Math.PI) / 180, cr = (cam.rot * Math.PI) / 180;
  camera.position.set(cam.x, cz, cam.y);
  camera.lookAt(cam.x + Math.cos(cr) * Math.cos(ct), cz - Math.sin(ct), cam.y + Math.sin(cr) * Math.cos(ct));
  return { scene, camera, meter: { lux } };
}
