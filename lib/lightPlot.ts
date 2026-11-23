// 2026-11-20, Lino: «Lichtplan» (light plot) canvas node — one lighting setup per node, top-down, in METRES
// (origin top-left, y down, rotation in degrees: 0 = right, 90 = down). Mirrors subshot-api app/light_plot.py
// (which validates / clamps everything on save).

import { frameAspect, SENSORS, type LensKey, type Rig, type SensorKey } from "./lightCatalog";
import { GENERIC_FIXTURES, MODIFIER_KEYS, MODIFIER_SPECS, type FabricKey, type FixtureCat, type FixtureShape, type FlagSize, type FrameKey, type ModifierKey } from "./lightCatalog";
export type WallKind = "wall" | "curve" | "window" | "door" | "opening";
export type ItemKind = "table" | "chair" | "sofa" | "bed" | "car" | "tree" | "stairs" | "rect" | "circle";
export type TalentModel = "female" | "male" | "scan";
export const TALENT_MODELS: TalentModel[] = ["female", "male", "scan"];
export type Role = "key" | "fill" | "rim" | "back" | "practical" | "ambience" | "custom";
export type Modifier = ModifierKey;

export interface LpWall { id: string; kind: WallKind; x1: number; y1: number; x2: number; y2: number; bend?: number }
export interface LpLabel { id: string; x: number; y: number; text: string }
export interface LpItem { id: string; kind: ItemKind; x: number; y: number; w: number; h: number; rot: number; label: string }
export interface LpPerson {
  id: string; kind: "talent" | "camera"; x: number; y: number; rot: number; name: string;
  /** talent (v2): pose + body height (m) */
  pose?: "standing" | "sitting"; height_m?: number;
  /** camera: body, white balance, lens, sensor; v2: lens height (m) + tilt (° down) */
  body?: string; kelvin?: number; lens_mm?: number; sensor?: SensorKey; z?: number; tilt?: number;
  /** v4 camera catalogue: lens preset, anamorphic squeeze, aperture, ISO, shutter (1/x s), rig */
  lens?: LensKey; squeeze?: number; fstop?: number; iso?: number; shutter?: number; rig?: Rig;
  /** 2026-11-22: talent figure — woman / man (MakeHuman, CC0) or the man with the head scan (default for old boards) */
  model?: TalentModel;
}
export interface LpLight {
  id: string; preset: string; name: string; role: Role; role_label?: string; kelvin: number; intensity: number;
  modifier: Modifier; modifier_label?: string; beam: number; rot: number; x: number; y: number;
  /** v2 (camera view): height (m) and tilt (° down) */
  z?: number; tilt?: number;
}
export type ModKind = "diffusion" | "flag" | "reflector" | "vflat" | "card";
export type BounceSurface = "white" | "silver" | "gold" | "black" | "sunfire" | "ultrabounce" | "poly";
export interface LpMod {
  id: string; kind: ModKind; x1: number; y1: number; x2: number; y2: number; label: string;
  /** v4 bounce objects (reflector / vflat / card): surface + centre height (m) */
  surface?: BounceSurface; z?: number;
  /** v4 catalogue: diffusion frame size + fabric; flag size + cloth */
  frame?: FrameKey; fabric?: FabricKey; size?: FlagSize; cloth?: "solid" | "duvetyne";
}
export const BOUNCE_KINDS: ModKind[] = ["reflector", "vflat", "card"];
export const isBounce = (m: LpMod) => BOUNCE_KINDS.includes(m.kind);
/** default centre height (m) — mirrors app/light_plot.py BOUNCE_Z */
export const BOUNCE_Z: Record<string, number> = { reflector: 1.0, vflat: 1.2, card: 1.3 };
/** reflectance of the surfaces (black = negative fill: absorbs, and takes away the room bounce from its side) */
export const SURFACE_REFLECT: Record<BounceSurface, number> = { white: 0.8, silver: 0.9, gold: 0.8, black: 0, sunfire: 0.85, ultrabounce: 0.9, poly: 0.85 };
export interface LpLook {
  id: string; name: string; lights: LpLight[]; mods: LpMod[];
  /** v2: «Bild rendern» — still of the camera view (board file); render_src added on read */
  render_key?: string; render_src?: string | null;
}
export interface LpRoom { walls: LpWall[]; labels: LpLabel[]; items: LpItem[]; height?: number; bg?: { x: number; y: number; w: number; h: number; opacity: number }; wall_color?: string }
export interface LpView { snap: boolean; labels: boolean; beams: boolean; spill: number; exposure?: number; auto_exposure?: boolean; camera?: string; tile?: "plan" }
export interface LightPlotData { room: LpRoom; people: LpPerson[]; looks: LpLook[]; active_look: string; view: LpView }

export const lpId = () => Math.random().toString(36).slice(2, 12);

export function emptyPlot(): LightPlotData {
  const look = { id: lpId(), name: "Look 1", lights: [], mods: [] };
  return { room: { walls: [], labels: [], items: [] }, people: [], looks: [look], active_look: look.id, view: { snap: true, labels: true, beams: true, spill: 50 } };
}

/** a node's plan, always complete (old / partial data from MCP gets defaults) */
export function plotOf(el: Partial<LightPlotData>): LightPlotData {
  const base = emptyPlot();
  const looks = el.looks?.length ? el.looks : base.looks;
  return {
    room: { walls: el.room?.walls ?? [], labels: el.room?.labels ?? [], items: el.room?.items ?? [], ...(el.room?.bg ? { bg: el.room.bg } : {}),
      ...(el.room?.height ? { height: el.room.height } : {}), ...(el.room?.wall_color ? { wall_color: el.room.wall_color } : {}) },
    people: el.people ?? [],
    looks,
    active_look: looks.some((l) => l.id === el.active_look) ? (el.active_look as string) : looks[0].id,
    view: { ...base.view, ...(el.view ?? {}) },
  };
}

export const activeLook = (p: LightPlotData) => p.looks.find((l) => l.id === p.active_look) ?? p.looks[0];

// ── fixtures ───────────────────────────────────────────────────────────────
export interface LightPreset { name: string; brand: string; k: [number, number, number]; shape: FixtureShape; watts?: number; cat?: FixtureCat; beam?: number; src?: number; example?: string }
const BI: [number, number, number] = [5600, 2700, 6500];
const RGB: [number, number, number] = [5600, 2300, 10000];
const DAY: [number, number, number] = [5600, 5600, 5600];
export const LIGHT_PRESETS: LightPreset[] = [
  { name: "Amaran 150c", brand: "Aputure", k: RGB, shape: "point", watts: 150 },
  { name: "Amaran 300c", brand: "Aputure", k: RGB, shape: "point", watts: 300 },
  { name: "Aputure LS 600d", brand: "Aputure", k: DAY, shape: "point", watts: 600 },
  { name: "Aputure Nova P300c", brand: "Aputure", k: RGB, shape: "panel", watts: 300 },
  { name: "Aputure Nova P600c", brand: "Aputure", k: RGB, shape: "panel", watts: 600 },
  { name: "Godox SL60W", brand: "Godox", k: DAY, shape: "point", watts: 60 },
  { name: "Godox VL300", brand: "Godox", k: DAY, shape: "point", watts: 300 },
  { name: "Godox UL150", brand: "Godox", k: DAY, shape: "point", watts: 150 },
  { name: "Nanlite Forza 150B", brand: "Nanlite", k: BI, shape: "point", watts: 150 },
  { name: "Nanlite Forza 500B II", brand: "Nanlite", k: BI, shape: "point", watts: 500 },
  { name: "Nanlite PavoTube II 15X", brand: "Nanlite", k: RGB, shape: "tube", watts: 20 },
  { name: "Nanlite PavoTube II 30X", brand: "Nanlite", k: RGB, shape: "tube", watts: 40 },
  { name: "Nanlite PavoSlim 60C", brand: "Nanlite", k: RGB, shape: "panel", watts: 60 },
  { name: "FC-720C", brand: "Weitere", k: RGB, shape: "point", watts: 720 },
  { name: "Vela 150C", brand: "Weitere", k: RGB, shape: "point", watts: 150 },
  { name: "Vela 300C", brand: "Weitere", k: RGB, shape: "point", watts: 300 },
  { name: "Alien 150C", brand: "Weitere", k: RGB, shape: "point", watts: 150 },
  { name: "Alien 300C", brand: "Weitere", k: RGB, shape: "point", watts: 300 },
  { name: "Evoke 150C", brand: "Weitere", k: RGB, shape: "point", watts: 150 },
  { name: "Evoke 600C", brand: "Weitere", k: RGB, shape: "point", watts: 600 },
  { name: "Evoke 5C", brand: "Weitere", k: RGB, shape: "point", watts: 5 },
  // v4: generic fixture types by category (lib/lightCatalog.ts) — the library lists them first, grouped
  ...GENERIC_FIXTURES.map((g) => ({ ...g, brand: "Generisch" })),
];
export const presetOf = (name: string) => LIGHT_PRESETS.find((p) => p.name === name);
export const kelvinRange = (preset: string): [number, number] => {
  const p = presetOf(preset);
  return p ? [p.k[1], p.k[2]] : [1700, 20000];
};
const specMap = (k: "beam" | "soft" | "gain" | "src") => Object.fromEntries(MODIFIER_KEYS.map((m) => [m, MODIFIER_SPECS[m][k]])) as Record<Modifier, number>;
export const MODIFIER_BEAM: Record<Modifier, number> = specMap("beam");
/** v4: apparent source size (m) of a modifier — soft shadows (PCSS) */
export const MODIFIER_SIZE: Record<Modifier, number> = specMap("src");
/** camera view: how soft the light edge is (0 hard … 1 very soft) */
export const MODIFIER_SOFT: Record<Modifier, number> = specMap("soft");
/** camera view: how much a modifier eats (softbox / lantern lose light) */
export const MODIFIER_GAIN: Record<Modifier, number> = specMap("gain");
export const ROLES: Role[] = ["key", "fill", "rim", "back", "practical", "ambience", "custom"];
export const MODIFIERS: Modifier[] = MODIFIER_KEYS;

export function newLight(preset: string, x: number, y: number, role: Role = "key"): LpLight {
  const p = presetOf(preset);
  return { id: lpId(), preset, name: preset || "Licht", role, kelvin: p ? p.k[0] : 5600, intensity: 100, modifier: "bare", beam: p?.beam ?? MODIFIER_BEAM.bare, rot: 0, x, y, z: 2, tilt: 25 };
}

export const ITEM_SIZE: Record<ItemKind, [number, number]> = {
  table: [1.6, 0.9], chair: [0.5, 0.5], sofa: [2.0, 0.9], bed: [2.0, 1.6], car: [4.4, 1.8], tree: [1.6, 1.6], stairs: [1.0, 2.6], rect: [1, 1], circle: [1, 1],
};

/** camera horizontal angle of view (degrees) from the lens and the sensor width */
export function cameraFov(lensMm = 35, sensor: SensorKey = "s35", squeeze = 1) {
  // v4: every sensor class + anamorphic squeeze (the de-squeezed width), cropped to the delivered frame
  const sz = SENSORS[sensor] ?? SENSORS.s35;
  const aspect = frameAspect(sensor, squeeze);
  const w = Math.min(sz.w * squeeze, sz.h * aspect);
  return (2 * Math.atan(w / (2 * Math.max(1, lensMm))) * 180) / Math.PI;
}

/** colour of a light / beam from its Kelvin (Tanner Helland approximation) */
export function kelvinColor(k: number): string {
  const t = Math.min(40000, Math.max(1000, k)) / 100;
  let r: number, g: number, b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** bounds (metres) of everything in the plan, with a margin — the node preview and «fit» use it */
export function plotBounds(p: LightPlotData, margin = 1) {
  const xs: number[] = [];
  const ys: number[] = [];
  const add = (x: number, y: number) => { xs.push(x); ys.push(y); };
  p.room.walls.forEach((w) => { add(w.x1, w.y1); add(w.x2, w.y2); });
  p.room.labels.forEach((l) => add(l.x, l.y));
  p.room.items.forEach((i) => { add(i.x - i.w / 2, i.y - i.h / 2); add(i.x + i.w / 2, i.y + i.h / 2); });
  p.people.forEach((q) => add(q.x, q.y));
  p.looks.forEach((l) => { l.lights.forEach((li) => add(li.x, li.y)); l.mods.forEach((m) => { add(m.x1, m.y1); add(m.x2, m.y2); }); });
  if (p.room.bg) { add(p.room.bg.x, p.room.bg.y); add(p.room.bg.x + p.room.bg.w, p.room.bg.y + p.room.bg.h); }
  if (!xs.length) return { x: -margin, y: -margin, w: 8 + 2 * margin, h: 6 + 2 * margin };
  const x0 = Math.min(...xs) - margin, y0 = Math.min(...ys) - margin;
  return { x: x0, y: y0, w: Math.max(4, Math.max(...xs) + margin - x0), h: Math.max(3, Math.max(...ys) + margin - y0) };
}

// ── labels (DE / EN) ───────────────────────────────────────────────────────
const DE = {
  node: "Lichtplan", edit: "Bearbeiten", view: "Ansehen", lights: "Lichter", empty: "Noch keine Lichter – «Bearbeiten» öffnet den Editor.",
  select: "Auswahl (V)", box: "Rahmen-Auswahl (B)", hand: "Verschieben (H)", walls: "Wände zeichnen (W)", measure: "Messen (M)", text: "Beschriftung (T)",
  wall: "Wand", curve: "Rundwand", window: "Fenster", door: "Tür", opening: "Durchgang",
  talent: "Talent", camera: "Kamera", light: "Licht", flag: "Flag", diffusion: "Diffusion", reflector: "Reflektor", vflat: "V-Flat / Styropor", card: "Bounce-Karte",
  surface: "Oberfläche", white: "Weiss", silver: "Silber", gold: "Gold", black: "Schwarz (Negativ)", centerHeight: "Mitte Höhe (m)", size: "Grösse",
  wallColor: "Wandfarbe", autoExposure: "Auto", metered: "Gemessen", bounce: "Aufheller", set: "Set-Stück", photo: "Grundriss-Foto", photoRemove: "Foto entfernen",
  table: "Tisch", chair: "Stuhl", sofa: "Sofa", bed: "Bett", car: "Auto", tree: "Baum", stairs: "Treppe", rect: "Rechteck", circle: "Kreis",
  key: "Key", fill: "Fill", rim: "Edge/Rim", back: "Back", practical: "Practical", ambience: "Ambience", custom: "Eigene",
  bare: "Ohne", dish55: "Beauty Dish 55", fresnel: "Fresnel-Linse", softbox: "Softbox 90", lantern: "Laterne",
  softbox_s: "Softbox S (60 cm)", softbox_l: "Softbox L (120 cm)", strip: "Strip 30×120", octa: "Octa 150", para_s: "Parabolic S 90", para_m: "Parabolic M 120", para_l: "Parabolic L 180",
  dome: "Dome", grid: "Softbox + Grid", snoot: "Snoot", barndoors: "Torblende", projector: "Projektion / Gobo",
  catFresnel: "Fresnel", catHmi: "HMI", catCob: "COB / Point Source", catPar: "Par", catProfile: "Profiler / Spot", catPanel: "LED-Panel", catMat: "Flex-Matte", catTube: "Tubes / Pixel-Bars",
  catSpace: "Space Light / Ballon", catBank: "Kino-Bank", catPractical: "Practicals", catSmall: "Ring / On-Camera", catSun: "Sonne / Fenster", catBrands: "Markenmodelle",
  frame: "Rahmen", fabric: "Stoff", silk: "Silk", grid14: "Grid Cloth 1/4", grid12: "Grid Cloth 1/2", gridFull: "Grid Cloth voll", ultrabounce: "Ultrabounce", muslin: "Muslin", opal: "Opal",
  f216: "Folie 216", f250: "Folie 250", f251: "Folie 251", scrim1: "Scrim Single", scrim2: "Scrim Double", flagSize: "Grösse", cloth: "Stoff", solid: "Solid", duvetyne: "Duvetyne",
  sunfire: "Sunfire", poly: "Poly",
  sn_phone_main: "Smartphone Hauptkamera (1/1.3″)", sn_phone_wide: "Smartphone Ultraweitwinkel (1/2.55″)", sn_phone_tele: "Smartphone Tele (1/3″)", sn_action: "Action-Cam (1/2.3″)", sn_mft: "Micro Four Thirds", sn_apsc: "APS-C", sn_s35: "Super 35", sn_ff: "Vollformat", sn_lf: "Large Format (LF)", sn_f65: "65 mm",
  figure: "Figur", female: "Frau", male: "Mann", scan: "Mann (Scan)", figuresCredit: "Figuren: MakeHuman (CC0)",
  lensPreset: "Objektiv", squeeze: "Anamorphot", spherical: "Sphärisch", anamorphic: "anamorph", aperture: "Blende", shutter: "Verschluss", rig: "Aufbau",
  tripod: "Stativ", shoulder: "Schulter", gimbal: "Gimbal", slider: "Slider", dolly: "Dolly", jib: "Kran / Jib", handheld: "Handheld", noModifier: "ohne Modifier",
  snap: "Snap", showLabels: "Labels", beams: "Kegel", spill: "Spill", undo: "Rückgängig", redo: "Wiederholen", png: "PNG", pdf: "PDF", close: "Schliessen",
  addLook: "+ Look", duplicate: "Duplizieren", rename: "Umbenennen", deleteLook: "Look löschen", fixtures: "Fixture-Liste", noFixtures: "Noch keine Lichter in diesem Look.",
  name: "Name", role: "Rolle", kelvin: "Kelvin", intensity: "Intensität", modifier: "Modifier", beamAngle: "Abstrahlwinkel", rotation: "Rotation",
  body: "Body", wb: "Weissabgleich", lens: "Objektiv", sensor: "Sensor", width: "Breite", depth: "Tiefe", label: "Beschriftung", bend: "Rundung", delete: "Löschen",
  preset: "Gerät", customName: "Eigenes Gerät", library: "Licht-Bibliothek", readOnly: "Nur ansehen", fit: "Alles zeigen", title: "Titel", opacity: "Deckkraft",
  hint: "Klick setzt Punkte, Doppelklick oder Esc beendet die Wand.", distance: "Distanz", roleLabel: "Eigene Rolle", modLabel: "Eigener Modifier",
  camView: "Kamera-View", camViewOff: "Plan", noCamera: "Zuerst eine Kamera platzieren.", exposure: "Belichtung", height: "Höhe (m)", tilt: "Neigung °",
  pose: "Pose", standing: "Stehend", sitting: "Sitzend", bodyHeight: "Körpergrösse (m)", wallHeight: "Wandhöhe (m)", render: "Bild rendern", rendering: "Rendert …",
  rendered: "Bild gespeichert – die Kachel zeigt es.", camViewPng: "PNG (Kamera)", webglLost: "3D-Ansicht neu laden …", noWebgl: "Dieses Gerät kann die 3D-Ansicht nicht anzeigen.", headCredit: "Kopf: 3D-Scan «Infinite» von Lee Perry-Smith (triplegangers.com), CC BY 3.0",
  tilePlan: "Plan", tileRender: "Render", room: "Raum",
  portraitPreset: "Licht-Preset", presetPick: "Preset wählen …", rembrandt: "Rembrandt", loop: "Loop", butterfly: "Butterfly (Paramount)", split: "Split", broad: "Broad", short: "Short",
  closeUp: "Gesicht nah (85 mm)",
};
const EN: typeof DE = {
  node: "Light plot", edit: "Edit", view: "View", lights: "lights", empty: "No lights yet – «Edit» opens the editor.",
  select: "Select (V)", box: "Box select (B)", hand: "Pan (H)", walls: "Draw walls (W)", measure: "Measure (M)", text: "Label (T)",
  wall: "Wall", curve: "Curved wall", window: "Window", door: "Door", opening: "Opening",
  talent: "Talent", camera: "Camera", light: "Light", flag: "Flag", diffusion: "Diffusion", reflector: "Reflector", vflat: "V-flat / poly board", card: "Bounce card",
  surface: "Surface", white: "White", silver: "Silver", gold: "Gold", black: "Black (negative)", centerHeight: "Centre height (m)", size: "Size",
  wallColor: "Wall colour", autoExposure: "Auto", metered: "Metered", bounce: "Bounce", set: "Set piece", photo: "Floor plan photo", photoRemove: "Remove photo",
  table: "Table", chair: "Chair", sofa: "Sofa", bed: "Bed", car: "Car", tree: "Tree", stairs: "Stairs", rect: "Rectangle", circle: "Circle",
  key: "Key", fill: "Fill", rim: "Edge/Rim", back: "Back", practical: "Practical", ambience: "Ambience", custom: "Custom",
  bare: "Bare", dish55: "Beauty dish 55", fresnel: "Fresnel lens", softbox: "Softbox 90", lantern: "Lantern",
  softbox_s: "Softbox S (60 cm)", softbox_l: "Softbox L (120 cm)", strip: "Strip 30×120", octa: "Octa 150", para_s: "Parabolic S 90", para_m: "Parabolic M 120", para_l: "Parabolic L 180",
  dome: "Dome", grid: "Softbox + grid", snoot: "Snoot", barndoors: "Barn doors", projector: "Projection / gobo",
  catFresnel: "Fresnel", catHmi: "HMI", catCob: "COB / point source", catPar: "Par", catProfile: "Profile / spot", catPanel: "LED panel", catMat: "Flex mat", catTube: "Tubes / pixel bars",
  catSpace: "Space light / balloon", catBank: "Kino bank", catPractical: "Practicals", catSmall: "Ring / on-camera", catSun: "Sun / window", catBrands: "Brand models",
  frame: "Frame", fabric: "Fabric", silk: "Silk", grid14: "Grid cloth 1/4", grid12: "Grid cloth 1/2", gridFull: "Grid cloth full", ultrabounce: "Ultrabounce", muslin: "Muslin", opal: "Opal",
  f216: "Gel 216", f250: "Gel 250", f251: "Gel 251", scrim1: "Single scrim", scrim2: "Double scrim", flagSize: "Size", cloth: "Cloth", solid: "Solid", duvetyne: "Duvetyne",
  sunfire: "Sunfire", poly: "Poly",
  sn_phone_main: "Smartphone main camera (1/1.3″)", sn_phone_wide: "Smartphone ultra wide (1/2.55″)", sn_phone_tele: "Smartphone tele (1/3″)", sn_action: "Action cam (1/2.3″)", sn_mft: "Micro Four Thirds", sn_apsc: "APS-C", sn_s35: "Super 35", sn_ff: "Full frame", sn_lf: "Large format (LF)", sn_f65: "65 mm",
  figure: "Figure", female: "Woman", male: "Man", scan: "Man (scan)", figuresCredit: "Figures: MakeHuman (CC0)",
  lensPreset: "Lens", squeeze: "Anamorphic", spherical: "Spherical", anamorphic: "anamorphic", aperture: "Aperture", shutter: "Shutter", rig: "Rig",
  tripod: "Tripod", shoulder: "Shoulder", gimbal: "Gimbal", slider: "Slider", dolly: "Dolly", jib: "Crane / jib", handheld: "Handheld", noModifier: "no modifier",
  snap: "Snap", showLabels: "Labels", beams: "Beams", spill: "Spill", undo: "Undo", redo: "Redo", png: "PNG", pdf: "PDF", close: "Close",
  addLook: "+ Look", duplicate: "Duplicate", rename: "Rename", deleteLook: "Delete look", fixtures: "Fixture list", noFixtures: "No lights in this look yet.",
  name: "Name", role: "Role", kelvin: "Kelvin", intensity: "Intensity", modifier: "Modifier", beamAngle: "Beam angle", rotation: "Rotation",
  body: "Body", wb: "White balance", lens: "Lens", sensor: "Sensor", width: "Width", depth: "Depth", label: "Label", bend: "Curve", delete: "Delete",
  preset: "Fixture", customName: "Custom fixture", library: "Light library", readOnly: "View only", fit: "Show all", title: "Title", opacity: "Opacity",
  hint: "Click to set points, double click or Esc ends the wall.", distance: "Distance", roleLabel: "Custom role", modLabel: "Custom modifier",
  camView: "Camera view", camViewOff: "Plan", noCamera: "Place a camera first.", exposure: "Exposure", height: "Height (m)", tilt: "Tilt °",
  pose: "Pose", standing: "Standing", sitting: "Sitting", bodyHeight: "Body height (m)", wallHeight: "Wall height (m)", render: "Render still", rendering: "Rendering …",
  rendered: "Still saved – the tile shows it.", camViewPng: "PNG (camera)", webglLost: "Reloading the 3D view …", noWebgl: "This device can't show the 3D view.", headCredit: "Head: 3D scan «Infinite» by Lee Perry-Smith (triplegangers.com), CC BY 3.0",
  tilePlan: "Plan", tileRender: "Render", room: "Room",
  portraitPreset: "Lighting preset", presetPick: "Choose preset …", rembrandt: "Rembrandt", loop: "Loop", butterfly: "Butterfly (Paramount)", split: "Split", broad: "Broad", short: "Short",
  closeUp: "Face close-up (85 mm)",
};
export type LpLabels = typeof DE;
export const lpLabels = (language: string): LpLabels => (language === "de" ? DE : EN);
// v4: a custom role without its own label shows the fixture's class (e.g. «Fresnel»), not «Custom»
export const CAT_LABEL: Record<FixtureCat, "catFresnel" | "catHmi" | "catCob" | "catPar" | "catProfile" | "catPanel" | "catMat" | "catTube" | "catSpace" | "catBank" | "catPractical" | "catSmall" | "catSun"> = {
  fresnel: "catFresnel", hmi: "catHmi", cob: "catCob", par: "catPar", profile: "catProfile", panel: "catPanel", mat: "catMat", tube: "catTube",
  space: "catSpace", bank: "catBank", practical: "catPractical", small: "catSmall", sun: "catSun",
};
export const roleText = (L: LpLabels, li: LpLight) => {
  if (li.role !== "custom") return L[li.role];
  if (li.role_label) return li.role_label;
  const cat = presetOf(li.preset)?.cat;
  return cat ? L[CAT_LABEL[cat]] : L.custom;
};
/** v4: the default plan label of a flag / frame / bounce object (its own label wins) */
export function modText(L: LpLabels, m: LpMod) {
  if (m.label) return m.label;
  if (isBounce(m)) return `${L[m.kind]} · ${L[m.surface ?? "white"]}`;
  if (m.kind === "diffusion" && m.frame) return `${m.frame.replace("x", "×")} · ${L[m.fabric === "grid" ? "gridFull" : m.fabric ?? "silk"]}`;
  if (m.kind === "flag" && m.size) return m.size === "floppy" ? "Floppy 4×4" : m.size === "cutter" ? "Cutter 10×42″" : `Flag ${m.size.replace("x", "×")}″`;
  return L[m.kind];
}
export const modifierText = (L: LpLabels, li: LpLight) => (li.modifier === "custom" ? li.modifier_label || L.custom : li.modifier === "bare" ? L.noModifier : L[li.modifier]);

// ── portrait presets (2026-11-21, v3): key light relative to talent + camera — mirrors subshot-api
// app/light_plot.py PRESETS_PORTRAIT / apply_preset ──────────────────────────────────────────────────────────
export type PortraitPreset = "rembrandt" | "loop" | "butterfly" | "split" | "broad" | "short";
// 2026-11-21 (v4): Rembrandt 65° — on the scanned (real) face 55° only gives a loop; 65° closes the triangle on the far cheek
export const PORTRAIT_PRESETS: Record<PortraitPreset, [number, number, number]> = {
  butterfly: [0, 40, 1.6], loop: [35, 30, 1.8], rembrandt: [65, 45, 1.8], split: [90, 5, 1.6], broad: [45, 30, 1.8], short: [45, 30, 1.8],
};
const wrapDeg = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
export const eyeHeight = (t: LpPerson) => ((t.pose === "sitting" ? 1.18 : 1.62) * (t.height_m ?? 1.75)) / 1.75;

export function applyPreset(p: LightPlotData, preset: PortraitPreset, talentId?: string): LightPlotData {
  const t = p.people.find((q) => q.kind === "talent" && (!talentId || q.id === talentId));
  if (!t) return p;
  const cams = p.people.filter((q) => q.kind === "camera");
  const cam = cams.find((c) => c.id === p.view.camera) ?? cams[0];
  const camDir = cam ? (Math.atan2(cam.y - t.y, cam.x - t.x) * 180) / Math.PI : t.rot;
  const [off, elev, presetDist] = PORTRAIT_PRESETS[preset];
  // butterfly sits on the camera axis: the light goes just behind / above the camera, not into its picture
  const camDist = cam ? Math.hypot(cam.x - t.x, cam.y - t.y) : 0;
  // 2026-11-21 (v4): under a low ceiling the light comes closer instead of lower — the elevation (nose shadow, Rembrandt
  // triangle) is what makes the look; never closer than 0.9 m. Butterfly keeps its distance (it must clear the camera).
  const zMax = (p.room.height ?? 2.6) - 0.15;
  const fitDist = Math.max(0.9, (zMax - eyeHeight(t)) / Math.tan((elev * Math.PI) / 180));
  const dist = preset === "butterfly" && cam ? Math.max(presetDist, camDist + 0.35) : Math.min(presetDist, fitDist);
  const side = wrapDeg(t.rot - camDir) < -1 ? -1 : 1;
  const az = preset === "broad" ? camDir - side * off : preset === "short" ? camDir + side * off : camDir + off;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const x = r2(t.x + dist * Math.cos((az * Math.PI) / 180)), y = r2(t.y + dist * Math.sin((az * Math.PI) / 180));
  const z = r2(Math.min(zMax, eyeHeight(t) + dist * Math.tan((elev * Math.PI) / 180)));
  return {
    ...p,
    looks: p.looks.map((lk) => {
      if (lk.id !== p.active_look) return lk;
      const idx = lk.lights.findIndex((l) => l.role === "key");
      const lights = [...lk.lights];
      const base = idx >= 0 ? lights[idx] : lights[0] ?? { ...newLight("Aputure LS 600d", x, y, "key"), modifier: "dish55" as Modifier, beam: 55 };
      // closer than the preset distance → dimmer by the inverse square, so the face keeps its exposure
      const intensity = dist < presetDist - 0.01 ? Math.max(5, Math.round(100 * (dist / presetDist) ** 2)) : base.intensity;
      const moved = { ...base, x, y, z, intensity, rot: Math.round(wrapDeg(az + 180) * 10) / 10, tilt: elev, role: "key" as Role };
      if (idx >= 0) lights[idx] = moved; else if (lights.length) lights[0] = moved; else lights.push(moved);
      return { ...lk, lights };
    }),
  };
}

/** a close-up camera (85 mm) in front of the talent at eye height — the face check */
export function closeUpCamera(p: LightPlotData, talentId?: string): LightPlotData {
  const t = p.people.find((q) => q.kind === "talent" && (!talentId || q.id === talentId));
  if (!t) return p;
  const d = 1.9, a = (t.rot * Math.PI) / 180;
  const cam: LpPerson = { id: "", kind: "camera", name: "Close-up", x: Math.round((t.x + d * Math.cos(a)) * 100) / 100, y: Math.round((t.y + d * Math.sin(a)) * 100) / 100,
    rot: Math.round(wrapDeg(t.rot + 180)), lens_mm: 85, sensor: "ff", z: Math.round(eyeHeight(t) * 100) / 100, tilt: 0, kelvin: 5600, body: "" };
  const existing = p.people.find((q) => q.kind === "camera" && q.name === "Close-up");
  cam.id = existing?.id ?? lpId();
  const people = existing ? p.people.map((q) => (q.id === existing.id ? cam : q)) : [...p.people, cam];
  return { ...p, people, view: { ...p.view, camera: cam.id } };
}
