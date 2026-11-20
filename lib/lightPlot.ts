// 2026-11-20, Lino: «Lichtplan» (light plot) canvas node — one lighting setup per node, top-down, in METRES
// (origin top-left, y down, rotation in degrees: 0 = right, 90 = down). Mirrors subshot-api app/light_plot.py
// (which validates / clamps everything on save).

export type WallKind = "wall" | "curve" | "window" | "door" | "opening";
export type ItemKind = "table" | "sofa" | "bed" | "car" | "tree" | "stairs" | "rect" | "circle";
export type Role = "key" | "fill" | "rim" | "back" | "practical" | "ambience" | "custom";
export type Modifier = "bare" | "dish55" | "fresnel" | "softbox" | "lantern" | "custom";

export interface LpWall { id: string; kind: WallKind; x1: number; y1: number; x2: number; y2: number; bend?: number }
export interface LpLabel { id: string; x: number; y: number; text: string }
export interface LpItem { id: string; kind: ItemKind; x: number; y: number; w: number; h: number; rot: number; label: string }
export interface LpPerson { id: string; kind: "talent" | "camera"; x: number; y: number; rot: number; name: string; body?: string; kelvin?: number; lens_mm?: number; sensor?: "s35" | "ff" }
export interface LpLight {
  id: string; preset: string; name: string; role: Role; role_label?: string; kelvin: number; intensity: number;
  modifier: Modifier; modifier_label?: string; beam: number; rot: number; x: number; y: number;
}
export interface LpMod { id: string; kind: "diffusion" | "flag"; x1: number; y1: number; x2: number; y2: number; label: string }
export interface LpLook { id: string; name: string; lights: LpLight[]; mods: LpMod[] }
export interface LpRoom { walls: LpWall[]; labels: LpLabel[]; items: LpItem[]; bg?: { x: number; y: number; w: number; h: number; opacity: number } }
export interface LpView { snap: boolean; labels: boolean; beams: boolean; spill: number }
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
    room: { walls: el.room?.walls ?? [], labels: el.room?.labels ?? [], items: el.room?.items ?? [], ...(el.room?.bg ? { bg: el.room.bg } : {}) },
    people: el.people ?? [],
    looks,
    active_look: looks.some((l) => l.id === el.active_look) ? (el.active_look as string) : looks[0].id,
    view: { ...base.view, ...(el.view ?? {}) },
  };
}

export const activeLook = (p: LightPlotData) => p.looks.find((l) => l.id === p.active_look) ?? p.looks[0];

// ── fixtures ───────────────────────────────────────────────────────────────
export interface LightPreset { name: string; brand: string; k: [number, number, number]; shape: "point" | "tube" | "panel" }
const BI: [number, number, number] = [5600, 2700, 6500];
const RGB: [number, number, number] = [5600, 2300, 10000];
const DAY: [number, number, number] = [5600, 5600, 5600];
export const LIGHT_PRESETS: LightPreset[] = [
  { name: "Amaran 150c", brand: "Aputure", k: RGB, shape: "point" },
  { name: "Amaran 300c", brand: "Aputure", k: RGB, shape: "point" },
  { name: "Aputure LS 600d", brand: "Aputure", k: DAY, shape: "point" },
  { name: "Aputure Nova P300c", brand: "Aputure", k: RGB, shape: "panel" },
  { name: "Aputure Nova P600c", brand: "Aputure", k: RGB, shape: "panel" },
  { name: "Godox SL60W", brand: "Godox", k: DAY, shape: "point" },
  { name: "Godox VL300", brand: "Godox", k: DAY, shape: "point" },
  { name: "Godox UL150", brand: "Godox", k: DAY, shape: "point" },
  { name: "Nanlite Forza 150B", brand: "Nanlite", k: BI, shape: "point" },
  { name: "Nanlite Forza 500B II", brand: "Nanlite", k: BI, shape: "point" },
  { name: "Nanlite PavoTube II 15X", brand: "Nanlite", k: RGB, shape: "tube" },
  { name: "Nanlite PavoTube II 30X", brand: "Nanlite", k: RGB, shape: "tube" },
  { name: "Nanlite PavoSlim 60C", brand: "Nanlite", k: RGB, shape: "panel" },
  { name: "FC-720C", brand: "Weitere", k: RGB, shape: "point" },
  { name: "Vela 150C", brand: "Weitere", k: RGB, shape: "point" },
  { name: "Vela 300C", brand: "Weitere", k: RGB, shape: "point" },
  { name: "Alien 150C", brand: "Weitere", k: RGB, shape: "point" },
  { name: "Alien 300C", brand: "Weitere", k: RGB, shape: "point" },
  { name: "Evoke 150C", brand: "Weitere", k: RGB, shape: "point" },
  { name: "Evoke 600C", brand: "Weitere", k: RGB, shape: "point" },
  { name: "Evoke 5C", brand: "Weitere", k: RGB, shape: "point" },
];
export const presetOf = (name: string) => LIGHT_PRESETS.find((p) => p.name === name);
export const kelvinRange = (preset: string): [number, number] => {
  const p = presetOf(preset);
  return p ? [p.k[1], p.k[2]] : [1700, 20000];
};
export const MODIFIER_BEAM: Record<Modifier, number> = { bare: 110, dish55: 55, fresnel: 30, softbox: 90, lantern: 300, custom: 60 };
export const ROLES: Role[] = ["key", "fill", "rim", "back", "practical", "ambience", "custom"];
export const MODIFIERS: Modifier[] = ["bare", "dish55", "fresnel", "softbox", "lantern", "custom"];

export function newLight(preset: string, x: number, y: number, role: Role = "key"): LpLight {
  const p = presetOf(preset);
  return { id: lpId(), preset, name: preset || "Licht", role, kelvin: p ? p.k[0] : 5600, intensity: 100, modifier: "bare", beam: MODIFIER_BEAM.bare, rot: 0, x, y };
}

export const ITEM_SIZE: Record<ItemKind, [number, number]> = {
  table: [1.6, 0.9], sofa: [2.0, 0.9], bed: [2.0, 1.6], car: [4.4, 1.8], tree: [1.6, 1.6], stairs: [1.0, 2.6], rect: [1, 1], circle: [1, 1],
};

/** camera horizontal angle of view (degrees) from the lens and the sensor width */
export function cameraFov(lensMm = 35, sensor: "s35" | "ff" = "s35") {
  const w = sensor === "ff" ? 36 : 24.89;
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
  talent: "Talent", camera: "Kamera", light: "Licht", flag: "Flag", diffusion: "Diffusion", set: "Set-Stück", photo: "Grundriss-Foto", photoRemove: "Foto entfernen",
  table: "Tisch", sofa: "Sofa", bed: "Bett", car: "Auto", tree: "Baum", stairs: "Treppe", rect: "Rechteck", circle: "Kreis",
  key: "Key", fill: "Fill", rim: "Edge/Rim", back: "Back", practical: "Practical", ambience: "Ambience", custom: "Eigene",
  bare: "Bare", dish55: "Dish 55", fresnel: "Fresnel", softbox: "Softbox", lantern: "Lantern",
  snap: "Snap", showLabels: "Labels", beams: "Kegel", spill: "Spill", undo: "Rückgängig", redo: "Wiederholen", png: "PNG", pdf: "PDF", close: "Schliessen",
  addLook: "+ Look", duplicate: "Duplizieren", rename: "Umbenennen", deleteLook: "Look löschen", fixtures: "Fixture-Liste", noFixtures: "Noch keine Lichter in diesem Look.",
  name: "Name", role: "Rolle", kelvin: "Kelvin", intensity: "Intensität", modifier: "Modifier", beamAngle: "Abstrahlwinkel", rotation: "Rotation",
  body: "Body", wb: "Weissabgleich", lens: "Objektiv", sensor: "Sensor", width: "Breite", depth: "Tiefe", label: "Beschriftung", bend: "Rundung", delete: "Löschen",
  preset: "Gerät", customName: "Eigenes Gerät", library: "Licht-Bibliothek", readOnly: "Nur ansehen", fit: "Alles zeigen", title: "Titel", opacity: "Deckkraft",
  hint: "Klick setzt Punkte, Doppelklick oder Esc beendet die Wand.", distance: "Distanz", roleLabel: "Eigene Rolle", modLabel: "Eigener Modifier",
};
const EN: typeof DE = {
  node: "Light plot", edit: "Edit", view: "View", lights: "lights", empty: "No lights yet – «Edit» opens the editor.",
  select: "Select (V)", box: "Box select (B)", hand: "Pan (H)", walls: "Draw walls (W)", measure: "Measure (M)", text: "Label (T)",
  wall: "Wall", curve: "Curved wall", window: "Window", door: "Door", opening: "Opening",
  talent: "Talent", camera: "Camera", light: "Light", flag: "Flag", diffusion: "Diffusion", set: "Set piece", photo: "Floor plan photo", photoRemove: "Remove photo",
  table: "Table", sofa: "Sofa", bed: "Bed", car: "Car", tree: "Tree", stairs: "Stairs", rect: "Rectangle", circle: "Circle",
  key: "Key", fill: "Fill", rim: "Edge/Rim", back: "Back", practical: "Practical", ambience: "Ambience", custom: "Custom",
  bare: "Bare", dish55: "Dish 55", fresnel: "Fresnel", softbox: "Softbox", lantern: "Lantern",
  snap: "Snap", showLabels: "Labels", beams: "Beams", spill: "Spill", undo: "Undo", redo: "Redo", png: "PNG", pdf: "PDF", close: "Close",
  addLook: "+ Look", duplicate: "Duplicate", rename: "Rename", deleteLook: "Delete look", fixtures: "Fixture list", noFixtures: "No lights in this look yet.",
  name: "Name", role: "Role", kelvin: "Kelvin", intensity: "Intensity", modifier: "Modifier", beamAngle: "Beam angle", rotation: "Rotation",
  body: "Body", wb: "White balance", lens: "Lens", sensor: "Sensor", width: "Width", depth: "Depth", label: "Label", bend: "Curve", delete: "Delete",
  preset: "Fixture", customName: "Custom fixture", library: "Light library", readOnly: "View only", fit: "Show all", title: "Title", opacity: "Opacity",
  hint: "Click to set points, double click or Esc ends the wall.", distance: "Distance", roleLabel: "Custom role", modLabel: "Custom modifier",
};
export type LpLabels = typeof DE;
export const lpLabels = (language: string): LpLabels => (language === "de" ? DE : EN);
export const roleText = (L: LpLabels, li: LpLight) => (li.role === "custom" ? li.role_label || L.custom : L[li.role]);
export const modifierText = (L: LpLabels, li: LpLight) => (li.modifier === "custom" ? li.modifier_label || L.custom : L[li.modifier]);
