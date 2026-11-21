"use client";

// 2026-11-20 (light plot v2), Lino: «die lichter und kameras und models müssen viel detailierter aussehen» — own
// top-down drawings (1 m = 100 units, facing +x = rot 0, centred on the object). Plain SVG, no images.

import { kelvinColor, presetOf, type ItemKind, type LpLight, type ModKind, type LpPerson } from "@/lib/lightPlot";

const BLUE = "#3b82f6";
const DARK = "#1f1f23";
const METAL = "#52525b";
const LINE = "#a1a1aa";

export type Family = "cob" | "fresnel" | "dish" | "softbox" | "lantern" | "tube" | "panel";
export function familyOf(li: LpLight): Family {
  if (li.modifier === "softbox") return "softbox";
  if (li.modifier === "lantern") return "lantern";
  if (li.modifier === "fresnel") return "fresnel";
  if (li.modifier === "dish55") return "dish";
  const shape = presetOf(li.preset)?.shape;
  return shape === "tube" ? "tube" : shape === "panel" ? "panel" : "cob";
}

/** three stand legs (light stand / tripod / C-stand base) */
export function Legs({ r = 40, rot = 0, color = METAL }: { r?: number; rot?: number; color?: string }) {
  return (
    <g opacity={0.9}>
      {[30, 150, 270].map((a) => {
        const rad = ((a - rot) * Math.PI) / 180;
        const x = r * Math.cos(rad), y = r * Math.sin(rad);
        return (
          <g key={a}>
            <line x1={0} y1={0} x2={x} y2={y} stroke={color} strokeWidth={3} strokeLinecap="round" />
            <circle cx={x} cy={y} r={3.5} fill={color} />
          </g>
        );
      })}
      <circle r={5} fill={color} />
    </g>
  );
}

/** a light, drawn by family; the caller translates + rotates to the light's position / direction */
export function LightSymbol({ li, sel }: { li: LpLight; sel: boolean }) {
  const c = kelvinColor(li.kelvin);
  const fam = familyOf(li);
  const st = sel ? BLUE : "#0a0a0b";
  const sw = sel ? 4 : 2;
  const glow = { fill: c, fillOpacity: 0.35 + li.intensity / 250 };
  switch (fam) {
    case "tube": {
      const len = li.preset.includes("15X") ? 60 : 120;
      return (
        <g>
          <Legs r={26} />
          <rect x={-6} y={-len / 2} width={12} height={len} rx={6} fill={c} stroke={st} strokeWidth={sw} />
          <rect x={-7} y={-len / 2 - 3} width={14} height={8} rx={3} fill={DARK} />
          <rect x={-7} y={len / 2 - 5} width={14} height={8} rx={3} fill={DARK} />
          <line x1={4} y1={-len / 2 + 8} x2={4} y2={len / 2 - 8} stroke="#fff" strokeOpacity={0.5} strokeWidth={2} />
        </g>
      );
    }
    case "panel":
      return (
        <g>
          <Legs r={34} />
          <rect x={-12} y={-32} width={18} height={64} rx={3} fill={DARK} stroke={st} strokeWidth={sw} />
          <rect x={6} y={-30} width={6} height={60} rx={2} {...glow} />
          {[-18, -6, 6, 18].map((y) => <line key={y} x1={-10} y1={y} x2={4} y2={y} stroke="#3f3f46" strokeWidth={1.5} />)}
          <path d="M -12 -32 L -20 -38 M -12 32 L -20 38" stroke={METAL} strokeWidth={3} />
        </g>
      );
    case "softbox":
      return (
        <g>
          <Legs r={34} />
          <rect x={-24} y={-13} width={24} height={26} rx={5} fill={DARK} stroke={st} strokeWidth={sw} />
          <path d="M 0 -14 L 52 -42 L 52 42 L 0 14 Z" fill="#26262b" stroke={st} strokeWidth={sw} strokeLinejoin="round" />
          {[-42, -14, 14, 42].map((y) => <line key={y} x1={2} y1={(y * 14) / 42} x2={52} y2={y} stroke="#3f3f46" strokeWidth={1.2} />)}
          <rect x={50} y={-42} width={6} height={84} rx={2} {...glow} />
        </g>
      );
    case "lantern":
      return (
        <g>
          <Legs r={34} />
          <rect x={-24} y={-12} width={22} height={24} rx={5} fill={DARK} stroke={st} strokeWidth={sw} />
          <circle cx={30} cy={0} r={34} {...glow} stroke={st} strokeWidth={sw} />
          {[12, 24].map((rx) => <ellipse key={rx} cx={30} cy={0} rx={rx} ry={34} fill="none" stroke="#fff" strokeOpacity={0.45} strokeWidth={1.2} />)}
          <line x1={-4} y1={0} x2={30} y2={0} stroke="#fff" strokeOpacity={0.35} strokeWidth={1.2} />
        </g>
      );
    case "fresnel":
      return (
        <g>
          <Legs r={36} />
          <rect x={-30} y={-20} width={40} height={40} rx={6} fill={DARK} stroke={st} strokeWidth={sw} />
          {[-22, -14, -6, 2].map((x) => <line key={x} x1={x} y1={-20} x2={x} y2={20} stroke="#3f3f46" strokeWidth={2} />)}
          <rect x={10} y={-18} width={7} height={36} rx={2} {...glow} />
          {[6, 12].map((r) => <path key={r} d={`M ${13 - r / 3} ${-r} Q ${13 + r / 2} 0 ${13 - r / 3} ${r}`} fill="none" stroke="#fff" strokeOpacity={0.6} strokeWidth={1.2} />)}
          <path d="M 17 -18 L 34 -30 M 17 18 L 34 30" stroke={METAL} strokeWidth={4} strokeLinecap="round" />
        </g>
      );
    case "dish":
      return (
        <g>
          <Legs r={34} />
          <rect x={-24} y={-14} width={26} height={28} rx={5} fill={DARK} stroke={st} strokeWidth={sw} />
          <path d="M 2 -30 A 30 30 0 0 1 2 30 L 8 30 A 30 30 0 0 0 8 -30 Z" fill="#d4d4d8" stroke={st} strokeWidth={sw} />
          <path d="M 4 -28 Q 30 0 4 28" fill={c} fillOpacity={0.4} />
          <circle cx={10} cy={0} r={5} fill="#e4e4e7" />
        </g>
      );
    default:
      return (
        <g>
          <Legs r={34} />
          <rect x={-24} y={-16} width={30} height={32} rx={6} fill={DARK} stroke={st} strokeWidth={sw} />
          {[-16, -9, -2].map((x) => <line key={x} x1={x} y1={-16} x2={x} y2={16} stroke="#3f3f46" strokeWidth={2} />)}
          <path d="M 6 -13 L 30 -24 L 30 24 L 6 13 Z" fill="#3f3f46" stroke={st} strokeWidth={sw} strokeLinejoin="round" />
          <path d="M 9 -11 L 28 -20 L 28 20 L 9 11 Z" {...glow} />
        </g>
      );
  }
}

/** camera on a tripod: body, lens (longer with more mm), matte box, monitor */
export function CameraSymbol({ p, sel }: { p: LpPerson; sel: boolean }) {
  const st = sel ? BLUE : "#facc15";
  const lens = Math.max(18, Math.min(64, 14 + (p.lens_mm ?? 35) / 4));
  return (
    <g>
      <Legs r={52} color="#71717a" />
      <rect x={-34} y={-20} width={46} height={40} rx={6} fill="#27272a" stroke={st} strokeWidth={sel ? 4 : 3} />
      <rect x={-40} y={-9} width={8} height={18} rx={2} fill="#3f3f46" />
      <path d={`M 12 -12 L ${12 + lens} -10 L ${12 + lens} 10 L 12 12 Z`} fill="#18181b" stroke={st} strokeWidth={2} />
      {[0.35, 0.7].map((f) => <line key={f} x1={12 + lens * f} y1={-11} x2={12 + lens * f} y2={11} stroke="#52525b" strokeWidth={2} />)}
      <path d={`M ${12 + lens} -14 L ${24 + lens} -22 L ${24 + lens} 22 L ${12 + lens} 14 Z`} fill="#27272a" stroke={st} strokeWidth={2} />
      <rect x={-22} y={-34} width={22} height={12} rx={2} fill="#3f3f46" stroke="#71717a" strokeWidth={1.5} />
      <rect x={-20} y={-32} width={18} height={8} fill="#60a5fa" fillOpacity={0.5} />
    </g>
  );
}

/** a person from above: shoulders, arms, head and nose (facing +x); sitting = with chair and knees */
export function TalentSymbol({ p, sel }: { p: LpPerson; sel: boolean }) {
  const st = sel ? BLUE : "#f472b6";
  const s = (p.height_m ?? 1.75) / 1.75;
  return (
    <g transform={`scale(${s})`}>
      {p.pose === "sitting" && (
        <g>
          <rect x={-30} y={-26} width={44} height={52} rx={6} fill="#3f3f46" stroke="#71717a" strokeWidth={2} />
          <rect x={-34} y={-26} width={8} height={52} rx={3} fill="#52525b" />
          <rect x={8} y={-17} width={30} height={12} rx={6} fill="#71717a" stroke={st} strokeWidth={2} />
          <rect x={8} y={5} width={30} height={12} rx={6} fill="#71717a" stroke={st} strokeWidth={2} />
        </g>
      )}
      <ellipse cx={-2} cy={-27} rx={9} ry={7} fill="#52525b" stroke={st} strokeWidth={2} />
      <ellipse cx={-2} cy={27} rx={9} ry={7} fill="#52525b" stroke={st} strokeWidth={2} />
      <ellipse cx={-2} cy={0} rx={14} ry={26} fill="#3f3f46" stroke={st} strokeWidth={sel ? 4 : 3} />
      <circle cx={2} cy={0} r={12} fill="#d6b49a" stroke={st} strokeWidth={2} />
      <path d="M 13 -4 L 19 0 L 13 4 Z" fill="#d6b49a" stroke={st} strokeWidth={1.5} />
      <path d="M -9 -8 Q -4 0 -9 8" fill="#57534e" />
    </g>
  );
}

/** set pieces (w × h metres, already scaled by the caller: w, h in units) */
export function ItemSymbol({ kind, w, h, sel }: { kind: ItemKind; w: number; h: number; sel: boolean }) {
  const st = sel ? BLUE : "rgba(255,255,255,0.6)";
  const sw = sel ? 4 : 2.5;
  const box = (x: number, y: number, ww: number, hh: number, rx = 4, fill = "rgba(255,255,255,0.06)") => <rect x={x} y={y} width={ww} height={hh} rx={rx} fill={fill} stroke={st} strokeWidth={sw} />;
  switch (kind) {
    case "sofa":
      return (
        <g>
          {box(-w / 2, -h / 2, w, h, 14)}
          {box(-w / 2, -h / 2, w, h * 0.28, 10, "rgba(255,255,255,0.1)")}
          {box(-w / 2, -h / 2, w * 0.1, h, 8, "rgba(255,255,255,0.1)")}
          {box(w / 2 - w * 0.1, -h / 2, w * 0.1, h, 8, "rgba(255,255,255,0.1)")}
          {[1, 2].map((i) => <line key={i} x1={-w / 2 + w * 0.1 + ((w * 0.8) / 3) * i} y1={-h / 2 + h * 0.3} x2={-w / 2 + w * 0.1 + ((w * 0.8) / 3) * i} y2={h / 2 - 6} stroke={st} strokeWidth={1.5} />)}
        </g>
      );
    case "bed":
      return (
        <g>
          {box(-w / 2, -h / 2, w, h, 8)}
          {box(-w / 2 + 6, -h / 2 + 8, w * 0.16, h / 2 - 12, 8, "rgba(255,255,255,0.14)")}
          {box(-w / 2 + 6, 4, w * 0.16, h / 2 - 12, 8, "rgba(255,255,255,0.14)")}
          <path d={`M ${-w / 2 + w * 0.3} ${-h / 2} L ${-w / 2 + w * 0.3} ${h / 2}`} stroke={st} strokeWidth={2} />
          <path d={`M ${-w / 2 + w * 0.3} ${-h / 2 + 6} Q ${-w / 2 + w * 0.38} 0 ${-w / 2 + w * 0.3} ${h / 2 - 6}`} fill="none" stroke={st} strokeWidth={1.5} />
        </g>
      );
    case "car":
      return (
        <g>
          {box(-w / 2, -h / 2, w, h, h / 3)}
          <path d={`M ${w * 0.12} ${-h / 2 + 10} L ${w * 0.26} ${-h / 2 + 18} L ${w * 0.26} ${h / 2 - 18} L ${w * 0.12} ${h / 2 - 10} Z`} fill="#60a5fa" fillOpacity={0.3} stroke={st} strokeWidth={1.5} />
          <path d={`M ${-w * 0.3} ${-h / 2 + 12} L ${-w * 0.38} ${-h / 2 + 18} L ${-w * 0.38} ${h / 2 - 18} L ${-w * 0.3} ${h / 2 - 12} Z`} fill="#60a5fa" fillOpacity={0.3} stroke={st} strokeWidth={1.5} />
          <rect x={-w * 0.3} y={-h / 2 + 12} width={w * 0.42} height={h - 24} rx={10} fill="none" stroke={st} strokeWidth={1.5} />
          <rect x={w * 0.14} y={-h / 2 - 8} width={10} height={8} rx={2} fill="#71717a" />
          <rect x={w * 0.14} y={h / 2} width={10} height={8} rx={2} fill="#71717a" />
        </g>
      );
    case "tree":
      return (
        <g>
          {[[0, 0, 0.5], [-0.22, -0.18, 0.32], [0.24, -0.12, 0.3], [0.05, 0.25, 0.32], [-0.25, 0.18, 0.26]].map(([x, y, r], i) => (
            <circle key={i} cx={x * w} cy={y * h} r={r * Math.min(w, h)} fill="rgba(74,222,128,0.16)" stroke={sel ? BLUE : "rgba(134,239,172,0.7)"} strokeWidth={sel ? 3 : 2} />
          ))}
          <circle r={6} fill="#78350f" />
        </g>
      );
    case "chair":
      return (
        <g>
          {box(-w / 2, -h / 2, w, h, 6)}
          {box(-w / 2, -h / 2, w * 0.2, h, 4, "rgba(255,255,255,0.14)")}
        </g>
      );
    case "table":
      return (
        <g>
          {box(-w / 2, -h / 2, w, h, 6)}
          <rect x={-w / 2 + 8} y={-h / 2 + 8} width={w - 16} height={h - 16} rx={4} fill="none" stroke={st} strokeOpacity={0.4} strokeWidth={1.5} />
        </g>
      );
    case "circle":
      return <ellipse rx={w / 2} ry={h / 2} fill="rgba(255,255,255,0.06)" stroke={st} strokeWidth={sw} />;
    case "stairs": {
      const n = Math.max(2, Math.round(h / 28));
      return (
        <g>
          {box(-w / 2, -h / 2, w, h, 3)}
          {Array.from({ length: n }, (_, i) => <line key={i} x1={-w / 2} x2={w / 2} y1={-h / 2 + ((i + 1) * h) / (n + 1)} y2={-h / 2 + ((i + 1) * h) / (n + 1)} stroke={st} strokeOpacity={0.6} strokeWidth={1.5} />)}
          <path d={`M 0 ${h / 2 - 10} L 0 ${-h / 2 + 14} M -8 ${-h / 2 + 24} L 0 ${-h / 2 + 12} L 8 ${-h / 2 + 24}`} fill="none" stroke={st} strokeWidth={2} />
        </g>
      );
    }
    default:
      return box(-w / 2, -h / 2, w, h, 4);
  }
}

/** a flag on a C-stand, or a diffusion frame (from p1 to p2 in units) */
const SURFACE_FILL: Record<string, string> = { white: "#f4f4f5", silver: "#a1a1aa", gold: "#d4a72c", black: "#09090b" };

export function ModSymbol({ kind, x1, y1, x2, y2, sel, surface }: { kind: ModKind; x1: number; y1: number; x2: number; y2: number; sel: boolean; surface?: string }) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const a = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  const st = sel ? BLUE : kind === "flag" ? "#e4e4e7" : "#f4f4f5";
  if (kind === "reflector" || kind === "vflat" || kind === "card") {
    // 2026-11-21 (v4) bounce objects, top view: the board in its surface colour (black = negative fill, white outline)
    const fill = SURFACE_FILL[surface ?? "white"] ?? SURFACE_FILL.white;
    const edge = sel ? BLUE : surface === "black" ? "#e4e4e7" : "#52525b";
    const t = kind === "vflat" ? 12 : kind === "reflector" ? 8 : 5;
    return (
      <g transform={`translate(${x1} ${y1}) rotate(${a})`}>
        {kind === "reflector" && <><g transform={`translate(${len / 2} 22)`}><Legs r={18} color={LINE} /></g><line x1={len / 2} y1={22} x2={len / 2} y2={0} stroke={LINE} strokeWidth={2} /></>}
        {kind === "vflat"
          ? <path d={`M0 ${-t / 2} L${len} ${-t / 2} L${len} ${t / 2} L0 ${t / 2} Z M${len * 0.5} ${-t / 2} L${len * 0.5} ${t / 2}`} fill={fill} stroke={edge} strokeWidth={sel ? 3 : 1.5} />
          : <rect x={0} y={-t / 2} width={len} height={t} rx={kind === "reflector" ? t / 2 : 1} fill={fill} stroke={edge} strokeWidth={sel ? 3 : 1.5} />}
        {surface === "silver" && Array.from({ length: Math.max(2, Math.floor(len / 14)) }, (_, i) => <line key={i} x1={i * 14 + 3} y1={-t / 2 + 1} x2={i * 14 + 9} y2={t / 2 - 1} stroke="#e4e4e7" strokeWidth={1} />)}
      </g>
    );
  }
  return (
    <g transform={`translate(${x1} ${y1}) rotate(${a})`}>
      {/* C-stand base + arm at the first end */}
      <g transform="translate(0 26)"><Legs r={22} color={LINE} /></g>
      <line x1={0} y1={26} x2={len * 0.2} y2={4} stroke={LINE} strokeWidth={2.5} />
      {kind === "flag" ? (
        <rect x={0} y={-5} width={len} height={10} rx={2} fill="#09090b" stroke={st} strokeWidth={sel ? 3 : 2} />
      ) : (
        <g>
          <rect x={0} y={-6} width={len} height={12} rx={2} fill="rgba(255,255,255,0.12)" stroke={st} strokeWidth={sel ? 3 : 2} />
          {Array.from({ length: Math.max(2, Math.floor(len / 18)) }, (_, i) => (
            <line key={i} x1={i * 18 + 4} y1={-5} x2={i * 18 + 14} y2={5} stroke={st} strokeOpacity={0.55} strokeWidth={1.2} />
          ))}
        </g>
      )}
    </g>
  );
}
