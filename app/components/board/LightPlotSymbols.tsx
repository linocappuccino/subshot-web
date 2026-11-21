"use client";

// 2026-11-20 (light plot v2), Lino: «die lichter und kameras und models müssen viel detailierter aussehen» — own
// top-down drawings (1 m = 100 units, facing +x = rot 0, centred on the object). Plain SVG, no images.

import { kelvinColor, presetOf, type ItemKind, type LpLight, type ModKind, type LpPerson } from "@/lib/lightPlot";

const BLUE = "#3b82f6";
const DARK = "#1f1f23";
const METAL = "#52525b";
const LINE = "#a1a1aa";

// v4: one top-down drawing per catalogue family (modifier first, then the fixture's shape)
export type Family = "cob" | "fresnel" | "dish" | "softbox" | "lantern" | "tube" | "panel" | "strip" | "octa" | "para" | "dome" | "snoot" | "projector"
  | "par" | "profile" | "dedo" | "mat" | "bank" | "pixelbar" | "spacelight" | "practical" | "ring" | "oncam" | "sun" | "window";
export function familyOf(li: LpLight): Family {
  const m = li.modifier;
  if (m === "softbox" || m === "softbox_s" || m === "softbox_l" || m === "grid") return "softbox";
  if (m === "strip") return "strip";
  if (m === "octa") return "octa";
  if (m === "para_s" || m === "para_m" || m === "para_l") return "para";
  if (m === "dome") return "dome";
  if (m === "snoot") return "snoot";
  if (m === "projector") return "projector";
  if (m === "lantern") return "lantern";
  if (m === "fresnel") return "fresnel";
  if (m === "dish55") return "dish";
  const shape = presetOf(li.preset)?.shape;
  switch (shape) {
    case "tube": case "panel": case "fresnel": case "par": case "profile": case "dedo": case "mat": case "bank": case "pixelbar":
    case "spacelight": case "practical": case "ring": case "oncam": case "sun": case "window": return shape;
    default: return "cob";
  }
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
      const len = Math.round((presetOf(li.preset)?.src ?? (li.preset.includes("15X") ? 0.6 : 1.2)) * 100);
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
    case "strip":
      return (
        <g>
          <Legs r={30} />
          <rect x={-22} y={-11} width={22} height={22} rx={5} fill={DARK} stroke={st} strokeWidth={sw} />
          <path d="M 0 -12 L 30 -60 L 30 60 L 0 12 Z" fill="#26262b" stroke={st} strokeWidth={sw} strokeLinejoin="round" />
          <rect x={28} y={-60} width={6} height={120} rx={2} {...glow} />
        </g>
      );
    case "octa":
      return (
        <g>
          <Legs r={34} />
          <rect x={-24} y={-13} width={24} height={26} rx={5} fill={DARK} stroke={st} strokeWidth={sw} />
          <path d="M 0 -14 L 50 -75 L 62 -75 L 62 75 L 50 75 L 0 14 Z" fill="#26262b" stroke={st} strokeWidth={sw} strokeLinejoin="round" />
          {[-75, -38, 0, 38, 75].map((y) => <line key={y} x1={2} y1={(y * 14) / 75} x2={56} y2={y} stroke="#3f3f46" strokeWidth={1.2} />)}
          <rect x={60} y={-75} width={6} height={150} rx={2} {...glow} />
        </g>
      );
    case "para": {
      const r = li.modifier === "para_l" ? 90 : li.modifier === "para_m" ? 60 : 45;
      return (
        <g>
          <Legs r={36} />
          <rect x={-26} y={-13} width={24} height={26} rx={5} fill={DARK} stroke={st} strokeWidth={sw} />
          <path d={`M ${r * 0.9} ${-r} Q -6 0 ${r * 0.9} ${r} L ${r * 0.9 + 6} ${r} Q 2 0 ${r * 0.9 + 6} ${-r} Z`} fill="#d4d4d8" stroke={st} strokeWidth={sw} />
          {[-0.6, -0.2, 0.2, 0.6].map((f) => <line key={f} x1={6} y1={f * r * 0.3} x2={r * 0.85} y2={f * r} stroke="#71717a" strokeWidth={1} />)}
          <path d={`M ${r * 0.9 + 4} ${-r} L ${r * 0.9 + 4} ${r}`} stroke={c} strokeOpacity={0.7} strokeWidth={5} />
          <rect x={-4} y={-4} width={r * 0.45} height={8} rx={3} fill={METAL} />
        </g>
      );
    }
    case "dome":
      return (
        <g>
          <Legs r={30} />
          <rect x={-24} y={-14} width={26} height={28} rx={5} fill={DARK} stroke={st} strokeWidth={sw} />
          <path d="M 2 -18 A 18 18 0 0 1 2 18 Z" {...glow} stroke={st} strokeWidth={sw} />
        </g>
      );
    case "snoot":
      return (
        <g>
          <Legs r={30} />
          <rect x={-24} y={-14} width={26} height={28} rx={5} fill={DARK} stroke={st} strokeWidth={sw} />
          <path d="M 2 -11 L 38 -6 L 38 6 L 2 11 Z" fill="#18181b" stroke={st} strokeWidth={sw} />
          <rect x={37} y={-5} width={4} height={10} {...glow} />
        </g>
      );
    case "projector":
    case "profile":
    case "dedo": {
      const len = fam === "dedo" ? 30 : 58;
      return (
        <g>
          <Legs r={fam === "dedo" ? 24 : 34} />
          <rect x={-22} y={-15} width={26} height={30} rx={5} fill={DARK} stroke={st} strokeWidth={sw} />
          <rect x={4} y={-9} width={len} height={18} rx={3} fill="#27272a" stroke={st} strokeWidth={sw} />
          {[0.3, 0.6].map((f) => <line key={f} x1={4 + len * f} y1={-12} x2={4 + len * f} y2={12} stroke={METAL} strokeWidth={3} />)}
          <rect x={4 + len} y={-8} width={5} height={16} rx={2} {...glow} />
          {fam !== "dedo" && <rect x={4 + len * 0.45} y={-14} width={6} height={5} fill="#fbbf24" />}
        </g>
      );
    }
    case "par":
      return (
        <g>
          <Legs r={34} />
          <path d="M -26 -14 L 12 -24 L 12 24 L -26 14 Z" fill={DARK} stroke={st} strokeWidth={sw} strokeLinejoin="round" />
          <rect x={10} y={-24} width={6} height={48} rx={2} {...glow} />
          <path d="M 16 -24 L 30 -34 M 16 24 L 30 34" stroke={METAL} strokeWidth={4} strokeLinecap="round" />
        </g>
      );
    case "mat":
    case "bank":
    case "window": {
      const len = Math.round((presetOf(li.preset)?.src ?? 0.6) * 100);
      return (
        <g>
          {fam !== "window" && <Legs r={30} />}
          <rect x={-8} y={-len / 2} width={12} height={len} rx={2} fill={fam === "window" ? "#93c5fd" : DARK} fillOpacity={fam === "window" ? 0.4 : 1} stroke={st} strokeWidth={sw} />
          <rect x={4} y={-len / 2 + 2} width={6} height={len - 4} rx={2} {...glow} />
          {fam === "bank" && [0.2, 0.4, 0.6, 0.8].map((f) => <line key={f} x1={-6} y1={-len / 2 + len * f} x2={8} y2={-len / 2 + len * f} stroke="#fff" strokeOpacity={0.6} strokeWidth={2} />)}
          {fam === "mat" && [-1, 1].map((sgn) => <circle key={sgn} cx={-2} cy={sgn * (len / 2 - 4)} r={3} fill={METAL} />)}
          {fam === "window" && <line x1={-2} y1={-len / 2} x2={-2} y2={len / 2} stroke="#e5e7eb" strokeWidth={2} />}
        </g>
      );
    }
    case "pixelbar": {
      const len = Math.round((presetOf(li.preset)?.src ?? 1) * 100);
      return (
        <g>
          <rect x={-5} y={-len / 2} width={10} height={len} rx={2} fill={DARK} stroke={st} strokeWidth={sw} />
          {Array.from({ length: 10 }, (_, i) => <rect key={i} x={-3} y={-len / 2 + 3 + (i * (len - 6)) / 10} width={6} height={(len - 6) / 10 - 2} fill={c} fillOpacity={0.5 + (i % 2) * 0.3} />)}
        </g>
      );
    }
    case "spacelight":
      return (
        <g>
          <circle r={40} fill="#e4e4e7" fillOpacity={0.25} stroke={st} strokeWidth={sw} strokeDasharray="6 4" />
          <circle r={24} {...glow} stroke={st} strokeWidth={sw} />
          <circle r={6} fill={METAL} />
        </g>
      );
    case "practical":
      return (
        <g>
          <circle r={18} fill={c} fillOpacity={0.25} />
          <circle r={10} {...glow} stroke={st} strokeWidth={sw} />
          <path d="M -4 10 L -4 16 L 4 16 L 4 10" fill="none" stroke={METAL} strokeWidth={2} />
        </g>
      );
    case "ring":
      return (
        <g>
          <Legs r={30} />
          <ellipse cx={4} cy={0} rx={8} ry={24} fill="none" stroke={c} strokeOpacity={0.8} strokeWidth={8} />
          <ellipse cx={4} cy={0} rx={8} ry={24} fill="none" stroke={st} strokeWidth={sel ? 3 : 1} />
        </g>
      );
    case "oncam":
      return (
        <g>
          <rect x={-10} y={-8} width={16} height={16} rx={3} fill={DARK} stroke={st} strokeWidth={sw} />
          <rect x={6} y={-7} width={4} height={14} {...glow} />
        </g>
      );
    case "sun":
      return (
        <g>
          <circle r={18} fill="#fbbf24" stroke={st} strokeWidth={sw} />
          {Array.from({ length: 12 }, (_, i) => { const a = (i * Math.PI) / 6; return <line key={i} x1={24 * Math.cos(a)} y1={24 * Math.sin(a)} x2={34 * Math.cos(a)} y2={34 * Math.sin(a)} stroke="#fbbf24" strokeWidth={3} strokeLinecap="round" />; })}
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

/** camera, v4: drawn by class (phone, action cam, cinema body — bigger for LF / 65 mm) on its rig (tripod, slider,
 * dolly on track, jib arm, gimbal handles, shoulder pad, handheld); lens longer with more mm, anamorphic = oval front */
export function CameraSymbol({ p, sel }: { p: LpPerson; sel: boolean }) {
  const st = sel ? BLUE : "#facc15";
  const sensor = p.sensor ?? "s35";
  const rig = p.rig ?? "tripod";
  const phone = sensor.startsWith("phone"), action = sensor === "action";
  const big = sensor === "lf" || sensor === "f65";
  const lens = Math.max(14, Math.min(64, 14 + (p.lens_mm ?? 35) / (phone ? 0.6 : 4)));
  const ana = Number(p.squeeze ?? 1) > 1.01;
  const rigEl = (() => {
    switch (rig) {
      case "dolly": return <g>{[-36, 36].map((y) => <line key={y} x1={-90} y1={y} x2={90} y2={y} stroke="#71717a" strokeWidth={4} />)}{[-80, -50, -20, 10, 40, 70].map((x) => <line key={x} x1={x} y1={-40} x2={x} y2={40} stroke="#52525b" strokeWidth={3} />)}<rect x={-40} y={-30} width={80} height={60} rx={8} fill="#3f3f46" stroke="#71717a" strokeWidth={2} /></g>;
      case "slider": return <g><Legs r={46} color="#71717a" /><rect x={-80} y={-5} width={160} height={10} rx={4} fill="#52525b" /></g>;
      case "jib": return <g><Legs r={46} color="#71717a" /><line x1={-120} y1={0} x2={0} y2={0} stroke="#71717a" strokeWidth={8} strokeLinecap="round" /><circle cx={-120} cy={0} r={14} fill="#52525b" /></g>;
      case "gimbal": return <g><path d="M -20 -40 A 40 40 0 0 0 -20 40" fill="none" stroke="#71717a" strokeWidth={5} />{[-40, 40].map((y) => <line key={y} x1={-20} y1={y} x2={-46} y2={y} stroke="#71717a" strokeWidth={6} strokeLinecap="round" />)}</g>;
      case "shoulder": return <rect x={-58} y={-14} width={26} height={28} rx={8} fill="#3f3f46" stroke="#71717a" strokeWidth={2} />;
      case "handheld": return null;
      default: return <Legs r={52} color="#71717a" />;
    }
  })();
  if (phone || action) {
    return (
      <g>
        {rigEl}
        {phone
          ? <rect x={-6} y={-30} width={10} height={60} rx={4} fill="#27272a" stroke={st} strokeWidth={sel ? 4 : 3} />
          : <rect x={-14} y={-12} width={22} height={24} rx={4} fill="#27272a" stroke={st} strokeWidth={sel ? 4 : 3} />}
        <circle cx={phone ? 6 : 10} cy={phone ? -18 : 0} r={phone ? 4 : 7} fill="#18181b" stroke={st} strokeWidth={2} />
      </g>
    );
  }
  const bw = big ? 56 : 46, bh = big ? 48 : 40;
  return (
    <g>
      {rigEl}
      <rect x={12 - bw} y={-bh / 2} width={bw} height={bh} rx={6} fill="#27272a" stroke={st} strokeWidth={sel ? 4 : 3} />
      <rect x={6 - bw} y={-9} width={8} height={18} rx={2} fill="#3f3f46" />
      <path d={`M 12 -12 L ${12 + lens} -10 L ${12 + lens} 10 L 12 12 Z`} fill="#18181b" stroke={st} strokeWidth={2} />
      {[0.35, 0.7].map((f) => <line key={f} x1={12 + lens * f} y1={-11} x2={12 + lens * f} y2={11} stroke="#52525b" strokeWidth={2} />)}
      {ana
        ? <ellipse cx={14 + lens} cy={0} rx={4} ry={18} fill="#1e3a8a" fillOpacity={0.6} stroke={st} strokeWidth={2} />
        : <path d={`M ${12 + lens} -14 L ${24 + lens} -22 L ${24 + lens} 22 L ${12 + lens} 14 Z`} fill="#27272a" stroke={st} strokeWidth={2} />}
      <rect x={-22} y={-bh / 2 - 14} width={22} height={12} rx={2} fill="#3f3f46" stroke="#71717a" strokeWidth={1.5} />
      <rect x={-20} y={-bh / 2 - 12} width={18} height={8} fill="#60a5fa" fillOpacity={0.5} />
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
const SURFACE_FILL: Record<string, string> = { white: "#f4f4f5", silver: "#a1a1aa", gold: "#d4a72c", black: "#09090b", sunfire: "#d9b15c", ultrabounce: "#fafafa", poly: "#e7e5e4" };

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
