// 2026-11-21 (light plot v4), Lino: «Es müssen alle gängigen Videolichter, Softboxen, Bouncer und Diffusoren drin sein»
// — a catalogue of GENERIC fixture types (no brands; brand names only as examples in the help text), modifiers,
// diffusion frames + fabrics, bounce / negative surfaces and flag sizes. Physical values are typical class values:
//   watts = output in "LED-COB watts" (the light plot's photometric unit: candela ≈ watts × 55 × modifier gain), so a
//           1 kW tungsten fresnel (≈ 25 lm/W) is ~250, an HMI (≈ 90 lm/W) ~1.3 × its rating
//   beam  = default beam angle (°), src = apparent source size (m) for soft shadows, k = [default, min, max] Kelvin
// Mirrors subshot-api app/light_plot.py (GENERIC_PRESETS, MODIFIERS, FRAMES, FABRICS, FLAG_SIZES, SURFACES).

export type FixtureShape =
  | "point" | "tube" | "panel" | "fresnel" | "par" | "profile" | "mat" | "pixelbar" | "spacelight" | "bank"
  | "practical" | "ring" | "oncam" | "dedo" | "sun" | "window";
export type FixtureCat = "fresnel" | "hmi" | "cob" | "par" | "profile" | "panel" | "mat" | "tube" | "space" | "bank" | "practical" | "small" | "sun";

export interface GenericFixture { name: string; cat: FixtureCat; shape: FixtureShape; watts: number; k: [number, number, number]; beam?: number; src?: number; example?: string }

const T: [number, number, number] = [3200, 3200, 3200];
const D: [number, number, number] = [5600, 5600, 5600];
const BI: [number, number, number] = [5600, 2700, 6500];
const RGB: [number, number, number] = [5600, 2300, 10000];
const WARM: [number, number, number] = [2700, 2700, 2700];

export const GENERIC_FIXTURES: GenericFixture[] = [
  // fresnels — tungsten and LED (spot ↔ flood via the beam)
  { name: "Fresnel 150 W (Tungsten)", cat: "fresnel", shape: "fresnel", watts: 40, k: T, beam: 35, src: 0.08, example: "Arri 150" },
  { name: "Fresnel 650 W (Tungsten)", cat: "fresnel", shape: "fresnel", watts: 160, k: T, beam: 35, src: 0.12, example: "Arri 650" },
  { name: "Fresnel 1 kW (Tungsten)", cat: "fresnel", shape: "fresnel", watts: 250, k: T, beam: 35, src: 0.15, example: "Arri 1000" },
  { name: "Fresnel 2 kW (Tungsten)", cat: "fresnel", shape: "fresnel", watts: 500, k: T, beam: 35, src: 0.2, example: "Arri 2000" },
  { name: "Fresnel 5 kW (Tungsten)", cat: "fresnel", shape: "fresnel", watts: 1250, k: T, beam: 35, src: 0.3, example: "Arri T5" },
  { name: "LED-Fresnel 200 W", cat: "fresnel", shape: "fresnel", watts: 200, k: BI, beam: 35, src: 0.15, example: "Arri L5" },
  { name: "LED-Fresnel 600 W", cat: "fresnel", shape: "fresnel", watts: 600, k: BI, beam: 35, src: 0.25, example: "Arri L10" },
  // HMI
  { name: "HMI-Fresnel 575 W", cat: "hmi", shape: "fresnel", watts: 750, k: D, beam: 35, src: 0.15, example: "Arri M8 class" },
  { name: "HMI-Fresnel 1.2 kW", cat: "hmi", shape: "fresnel", watts: 1550, k: D, beam: 35, src: 0.2 },
  { name: "HMI-Par 1.8 kW", cat: "hmi", shape: "par", watts: 2400, k: D, beam: 25, src: 0.2, example: "Arri M18" },
  { name: "HMI-Par 4 kW", cat: "hmi", shape: "par", watts: 5300, k: D, beam: 25, src: 0.3, example: "Arri M40" },
  { name: "HMI 18 kW", cat: "hmi", shape: "fresnel", watts: 24000, k: D, beam: 30, src: 0.6 },
  // COB / point source with reflector
  { name: "COB 60 W", cat: "cob", shape: "point", watts: 60, k: D, beam: 55, src: 0.08 },
  { name: "COB 150 W", cat: "cob", shape: "point", watts: 150, k: BI, beam: 55, src: 0.1 },
  { name: "COB 300 W", cat: "cob", shape: "point", watts: 300, k: BI, beam: 55, src: 0.12 },
  { name: "COB 600 W", cat: "cob", shape: "point", watts: 600, k: BI, beam: 55, src: 0.15 },
  { name: "COB 1200 W", cat: "cob", shape: "point", watts: 1200, k: D, beam: 55, src: 0.2 },
  // par / profile / dedo
  { name: "Par 64 1 kW (Tungsten)", cat: "par", shape: "par", watts: 250, k: T, beam: 20, src: 0.2 },
  { name: "Profiler / Ellipsoid 750 W", cat: "profile", shape: "profile", watts: 190, k: T, beam: 26, src: 0.06, example: "Source Four" },
  { name: "Dedo-Spot 150 W", cat: "profile", shape: "dedo", watts: 50, k: T, beam: 20, src: 0.05, example: "Dedolight" },
  // panels / mats / banks
  { name: "LED-Panel 1×1 Bi-Color", cat: "panel", shape: "panel", watts: 100, k: BI, beam: 60, src: 0.3 },
  { name: "LED-Panel 1×2 RGB", cat: "panel", shape: "panel", watts: 200, k: RGB, beam: 110, src: 0.6 },
  { name: "LED-Softpanel 2×4 RGB", cat: "panel", shape: "panel", watts: 450, k: RGB, beam: 110, src: 0.9, example: "SkyPanel S60" },
  { name: "LED-Softpanel 4×4 RGB", cat: "panel", shape: "panel", watts: 900, k: RGB, beam: 110, src: 1.2, example: "SkyPanel S120" },
  { name: "Flex-Matte 1×1", cat: "mat", shape: "mat", watts: 100, k: BI, beam: 120, src: 0.3 },
  { name: "Flex-Matte 2×2", cat: "mat", shape: "mat", watts: 300, k: BI, beam: 120, src: 0.6 },
  { name: "Flex-Matte 4×4", cat: "mat", shape: "mat", watts: 800, k: RGB, beam: 120, src: 1.2 },
  { name: "Kino-Bank 4 ft 4-Röhren", cat: "bank", shape: "bank", watts: 150, k: BI, beam: 120, src: 1.2, example: "Kino Flo 4Bank" },
  { name: "Kino-Bank 2 ft 2-Röhren", cat: "bank", shape: "bank", watts: 40, k: BI, beam: 120, src: 0.6 },
  // tubes / pixel bars
  { name: "Tube 2 ft RGB", cat: "tube", shape: "tube", watts: 20, k: RGB, beam: 180, src: 0.6 },
  { name: "Tube 4 ft RGB", cat: "tube", shape: "tube", watts: 40, k: RGB, beam: 180, src: 1.2 },
  { name: "Pixel-Bar 1 m", cat: "tube", shape: "pixelbar", watts: 60, k: RGB, beam: 120, src: 1.0 },
  // space light / balloon
  { name: "Space Light 6 kW", cat: "space", shape: "spacelight", watts: 1500, k: T, beam: 360, src: 0.9 },
  { name: "Ballon 2.5 kW", cat: "space", shape: "spacelight", watts: 1000, k: D, beam: 360, src: 1.2 },
  // practicals / small
  { name: "Glühbirne 60 W (Practical)", cat: "practical", shape: "practical", watts: 12, k: WARM, beam: 360, src: 0.06 },
  { name: "Stehlampe (Practical)", cat: "practical", shape: "practical", watts: 15, k: WARM, beam: 300, src: 0.35 },
  { name: "Tischlampe (Practical)", cat: "practical", shape: "practical", watts: 10, k: WARM, beam: 240, src: 0.25 },
  { name: "Ringlicht 18″", cat: "small", shape: "ring", watts: 60, k: BI, beam: 110, src: 0.45 },
  { name: "On-Camera-Licht", cat: "small", shape: "oncam", watts: 10, k: BI, beam: 90, src: 0.08 },
  // sun / window as a source
  { name: "Sonne (direkt)", cat: "sun", shape: "sun", watts: 3300, k: [5600, 4300, 6500], beam: 12, src: 0.01 },
  { name: "Fensterlicht (Himmel)", cat: "sun", shape: "window", watts: 700, k: [6500, 5000, 9000], beam: 150, src: 1.2 },
];

// ── modifiers (beam °, softness 0…1, gain = light the modifier keeps / concentrates, src = apparent size m) ──
export interface ModifierSpec { beam: number; soft: number; gain: number; src: number }
export const MODIFIER_SPECS = {
  bare: { beam: 110, soft: 0.45, gain: 1, src: 0.1 },
  dish55: { beam: 55, soft: 0.3, gain: 1.6, src: 0.55 },
  fresnel: { beam: 30, soft: 0.15, gain: 2.2, src: 0.15 },
  softbox: { beam: 90, soft: 0.95, gain: 0.8, src: 0.9 },
  lantern: { beam: 300, soft: 1, gain: 0.6, src: 0.6 },
  custom: { beam: 60, soft: 0.5, gain: 1, src: 0.2 },
  // v4
  softbox_s: { beam: 90, soft: 0.9, gain: 0.85, src: 0.6 },
  softbox_l: { beam: 100, soft: 0.97, gain: 0.75, src: 1.2 },
  strip: { beam: 80, soft: 0.9, gain: 0.7, src: 0.6 },          // 30 × 120 cm — narrow side counts less for the penumbra
  octa: { beam: 100, soft: 0.97, gain: 0.75, src: 1.5 },
  para_s: { beam: 60, soft: 0.8, gain: 1.3, src: 0.9 },        // parabolic: focused = harder + brighter, defocused = softer
  para_m: { beam: 65, soft: 0.85, gain: 1.2, src: 1.2 },
  para_l: { beam: 70, soft: 0.9, gain: 1.1, src: 1.8 },
  dome: { beam: 160, soft: 0.95, gain: 0.7, src: 0.35 },
  grid: { beam: 40, soft: 0.9, gain: 0.6, src: 0.9 },          // softbox + egg crate: soft but directed
  snoot: { beam: 15, soft: 0.2, gain: 1.8, src: 0.08 },
  barndoors: { beam: 70, soft: 0.4, gain: 1, src: 0.12 },
  projector: { beam: 26, soft: 0.05, gain: 1.5, src: 0.04 },   // spot projection attachment with gobo
} satisfies Record<string, ModifierSpec>;
export type ModifierKey = keyof typeof MODIFIER_SPECS;
export const MODIFIER_KEYS = Object.keys(MODIFIER_SPECS) as ModifierKey[];

// ── diffusion frames + fabrics ──
/** butterfly / frame sizes (m, square) */
export const FRAMES = { "4x4": 1.2, "6x6": 1.8, "8x8": 2.4, "12x12": 3.6, "20x20": 6.0 } as const;
export type FrameKey = keyof typeof FRAMES;
/** t = transmission (light that gets through), d = how much it scatters (0 = scrim, only dims; 1 = full diffusion) */
export const FABRICS = {
  silk: { t: 0.5, d: 0.85 }, grid14: { t: 0.7, d: 0.55 }, grid12: { t: 0.55, d: 0.75 }, grid: { t: 0.35, d: 0.95 },
  ultrabounce: { t: 0.15, d: 1 }, muslin: { t: 0.25, d: 1 }, opal: { t: 0.7, d: 0.4 },
  f216: { t: 0.4, d: 0.95 }, f250: { t: 0.55, d: 0.8 }, f251: { t: 0.7, d: 0.6 },
  scrim1: { t: 0.7, d: 0 }, scrim2: { t: 0.5, d: 0 },
} as const;
export type FabricKey = keyof typeof FABRICS;

/** flag / floppy / cutter sizes: width × height (m) */
export const FLAG_SIZES = { "18x24": [0.45, 0.6], "24x36": [0.6, 0.9], floppy: [1.2, 1.2], cutter: [0.25, 1.07] } as const;
export type FlagSize = keyof typeof FLAG_SIZES;
export const FLAG_CLOTH = ["solid", "duvetyne"] as const;
