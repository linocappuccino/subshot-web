"use client";

// 2026-11-20, Lino: «Lichtplan» — the plan as plain SVG (1 m = PX units). Used by the board node (static, cheap:
// no canvas, no WebGL, no images except the optional floor-plan photo) and by the full-screen editor (which adds
// data-lp-id / data-lp-part handles for dragging). Pure render, no state.

import { useId } from "react";
import { cameraFov, kelvinColor, roleText, type LightPlotData, type LpLabels, type LpLight, type LpLook } from "@/lib/lightPlot";
import { CameraSymbol, ItemSymbol, LightSymbol, ModSymbol, TalentSymbol } from "./LightPlotSymbols";

export const PX = 100;
const BLUE = "#3b82f6";
const deg = (d: number) => (d * Math.PI) / 180;

function conePath(x: number, y: number, rot: number, beam: number, len: number) {
  if (beam >= 180) return `M ${x - len} ${y} a ${len} ${len} 0 1 0 ${2 * len} 0 a ${len} ${len} 0 1 0 ${-2 * len} 0`;
  const a1 = deg(rot - beam / 2), a2 = deg(rot + beam / 2);
  return `M ${x} ${y} L ${x + len * Math.cos(a1)} ${y + len * Math.sin(a1)} A ${len} ${len} 0 0 1 ${x + len * Math.cos(a2)} ${y + len * Math.sin(a2)} Z`;
}

export function beamLength(li: LpLight, spill: number) {
  return (1.4 + 4 * (li.intensity / 100)) * (0.5 + spill / 100) * PX;
}

export function LightPlotDrawing({
  plot,
  look,
  L,
  bgSrc,
  selected,
  editable = false,
  lite = false,
}: {
  plot: LightPlotData;
  look: LpLook;
  L: LpLabels;
  bgSrc?: string | null;
  selected?: Set<string>;
  editable?: boolean;
  /** board node preview: no handles, thinner details */
  lite?: boolean;
}) {
  const uid = useId().replace(/:/g, "");
  const sel = (id: string) => !!selected?.has(id);
  const { view } = plot;
  const h = (id: string, part: string, x: number, y: number, r = 9) =>
    editable && sel(id) ? <circle key={part} data-lp-id={id} data-lp-part={part} cx={x} cy={y} r={r} fill="#fff" stroke={BLUE} strokeWidth={3} style={{ cursor: "grab" }} /> : null;
  const rotKnob = (id: string, x: number, y: number, rot: number, dist = 55) =>
    editable && sel(id) ? (
      <g key="rot">
        <line x1={x} y1={y} x2={x + dist * Math.cos(deg(rot))} y2={y + dist * Math.sin(deg(rot))} stroke={BLUE} strokeWidth={2} strokeDasharray="4 4" />
        {h(id, "rot", x + dist * Math.cos(deg(rot)), y + dist * Math.sin(deg(rot)), 8)}
      </g>
    ) : null;
  const font = lite ? 22 : 18;

  return (
    <g>
      <defs>
        {look.lights.map((li) => (
          <radialGradient key={li.id} id={`${uid}-g-${li.id}`} gradientUnits="userSpaceOnUse" cx={li.x * PX} cy={li.y * PX} r={beamLength(li, view.spill)}>
            <stop offset="0%" stopColor={kelvinColor(li.kelvin)} stopOpacity={0.55 * (0.35 + li.intensity / 154)} />
            <stop offset="100%" stopColor={kelvinColor(li.kelvin)} stopOpacity={0} />
          </radialGradient>
        ))}
      </defs>
      {plot.room.bg && bgSrc && (
        // eslint-disable-next-line jsx-a11y/alt-text
        <image href={bgSrc} x={plot.room.bg.x * PX} y={plot.room.bg.y * PX} width={plot.room.bg.w * PX} height={plot.room.bg.h * PX} opacity={plot.room.bg.opacity} preserveAspectRatio="none" />
      )}
      {/* beams under everything that stands in the room */}
      {view.beams && look.lights.map((li) => (
        <path key={li.id} d={conePath(li.x * PX, li.y * PX, li.rot, li.beam, beamLength(li, view.spill))} fill={`url(#${uid}-g-${li.id})`} pointerEvents="none" />
      ))}
      {plot.room.items.map((it) => {
        const w = it.w * PX, hh = it.h * PX;
        return (
          <g key={it.id} transform={`translate(${it.x * PX} ${it.y * PX}) rotate(${it.rot})`}>
            <g data-lp-id={it.id} data-lp-part="body" style={editable ? { cursor: "move" } : undefined}>
              <ItemSymbol kind={it.kind} w={w} h={hh} sel={sel(it.id)} />
            </g>
            {view.labels && (it.label || !lite) && (
              <text y={5} textAnchor="middle" fontSize={font * 0.9} fill="rgba(255,255,255,0.75)" pointerEvents="none" transform={`rotate(${-it.rot})`}>{it.label || L[it.kind]}</text>
            )}
            {rotKnob(it.id, 0, 0, 0, Math.max(w, hh) / 2 + 30)}
          </g>
        );
      })}
      {plot.room.walls.map((w) => {
        const x1 = w.x1 * PX, y1 = w.y1 * PX, x2 = w.x2 * PX, y2 = w.y2 * PX;
        const len = Math.hypot(x2 - x1, y2 - y1) || 1;
        const nx = -(y2 - y1) / len, ny = (x2 - x1) / len;
        const s = sel(w.id);
        let shape;
        if (w.kind === "curve") {
          const b = (w.bend ?? 0.25) * len;
          const cx = (x1 + x2) / 2 + nx * b * 2, cy = (y1 + y2) / 2 + ny * b * 2;
          shape = <path d={`M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`} fill="none" stroke={s ? BLUE : "#d4d4d8"} strokeWidth={12} strokeLinecap="round" />;
        } else if (w.kind === "window") {
          shape = (
            <g>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={s ? BLUE : "#7dd3fc"} strokeWidth={12} strokeLinecap="butt" opacity={0.35} />
              <line x1={x1 + nx * 4} y1={y1 + ny * 4} x2={x2 + nx * 4} y2={y2 + ny * 4} stroke={s ? BLUE : "#7dd3fc"} strokeWidth={2} />
              <line x1={x1 - nx * 4} y1={y1 - ny * 4} x2={x2 - nx * 4} y2={y2 - ny * 4} stroke={s ? BLUE : "#7dd3fc"} strokeWidth={2} />
            </g>
          );
        } else if (w.kind === "door") {
          shape = (
            <g>
              <line x1={x1} y1={y1} x2={x1 + nx * len} y2={y1 + ny * len} stroke={s ? BLUE : "#d4d4d8"} strokeWidth={4} />
              <path d={`M ${x1 + nx * len} ${y1 + ny * len} A ${len} ${len} 0 0 0 ${x2} ${y2}`} fill="none" stroke={s ? BLUE : "#a1a1aa"} strokeWidth={2} strokeDasharray="6 5" />
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={14} />
            </g>
          );
        } else if (w.kind === "opening") {
          shape = <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={s ? BLUE : "#a1a1aa"} strokeWidth={3} strokeDasharray="10 8" />;
        } else {
          shape = <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={s ? BLUE : "#d4d4d8"} strokeWidth={12} strokeLinecap="round" />;
        }
        return (
          <g key={w.id}>
            <g data-lp-id={w.id} data-lp-part="body" style={editable ? { cursor: "move" } : undefined}>
              {shape}
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={22} />
            </g>
            {h(w.id, "p1", x1, y1)}
            {h(w.id, "p2", x2, y2)}
          </g>
        );
      })}
      {look.mods.map((m) => {
        const x1 = m.x1 * PX, y1 = m.y1 * PX, x2 = m.x2 * PX, y2 = m.y2 * PX;
        return (
          <g key={m.id}>
            <g data-lp-id={m.id} data-lp-part="body" style={editable ? { cursor: "move" } : undefined}>
              <ModSymbol kind={m.kind} x1={x1} y1={y1} x2={x2} y2={y2} sel={sel(m.id)} />
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={22} />
            </g>
            {view.labels && <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 14} textAnchor="middle" fontSize={font * 0.8} fill="rgba(255,255,255,0.65)" pointerEvents="none">{m.label || L[m.kind]}</text>}
            {h(m.id, "p1", x1, y1)}
            {h(m.id, "p2", x2, y2)}
          </g>
        );
      })}
      {plot.room.labels.map((t) => (
        <g key={t.id}>
          <text data-lp-id={t.id} data-lp-part="body" x={t.x * PX} y={t.y * PX} textAnchor="middle" fontSize={font * 1.1} fontWeight={600} fill={sel(t.id) ? BLUE : "rgba(255,255,255,0.8)"} style={editable ? { cursor: "move" } : undefined}>{t.text}</text>
        </g>
      ))}
      {plot.people.map((p) => {
        const x = p.x * PX, y = p.y * PX, s = sel(p.id);
        if (p.kind === "camera") {
          const fov = cameraFov(p.lens_mm, p.sensor);
          const len = 5.5 * PX;
          const a1 = deg(p.rot - fov / 2), a2 = deg(p.rot + fov / 2);
          return (
            <g key={p.id}>
              <path d={`M ${x} ${y} L ${x + len * Math.cos(a1)} ${y + len * Math.sin(a1)} M ${x} ${y} L ${x + len * Math.cos(a2)} ${y + len * Math.sin(a2)}`} stroke="rgba(250,204,21,0.55)" strokeWidth={2} strokeDasharray="10 7" pointerEvents="none" />
              <g data-lp-id={p.id} data-lp-part="body" transform={`translate(${x} ${y}) rotate(${p.rot})`} style={editable ? { cursor: "move" } : undefined}>
                <CameraSymbol p={p} sel={s} />
              </g>
              {view.labels && (
                <text x={x} y={y + 64} textAnchor="middle" fontSize={font * 0.85} fill="#fde68a" pointerEvents="none">
                  {[p.name || L.camera, p.lens_mm ? `${p.lens_mm} mm` : "", p.kelvin ? `${p.kelvin} K` : ""].filter(Boolean).join(" · ")}
                </text>
              )}
              {rotKnob(p.id, x, y, p.rot, 90)}
            </g>
          );
        }
        return (
          <g key={p.id}>
            <g data-lp-id={p.id} data-lp-part="body" transform={`translate(${x} ${y}) rotate(${p.rot})`} style={editable ? { cursor: "move" } : undefined}>
              <TalentSymbol p={p} sel={s} />
            </g>
            {view.labels && <text x={x} y={y + 50} textAnchor="middle" fontSize={font * 0.85} fill="#fbcfe8" pointerEvents="none">{p.name || L.talent}</text>}
            {rotKnob(p.id, x, y, p.rot, 64)}
          </g>
        );
      })}
      {look.lights.map((li, i) => {
        const x = li.x * PX, y = li.y * PX, s = sel(li.id);
        const c = kelvinColor(li.kelvin);
        return (
          <g key={li.id}>
            <g data-lp-id={li.id} data-lp-part="body" style={editable ? { cursor: "move" } : undefined} transform={`translate(${x} ${y}) rotate(${li.rot})`}>
              <LightSymbol li={li} sel={s} />
            </g>
            <circle cx={x - 30} cy={y - 30} r={13} fill="#18181b" stroke={c} strokeWidth={2.5} pointerEvents="none" />
            <text x={x - 30} y={y - 25} textAnchor="middle" fontSize={15} fontWeight={700} fill="#fff" pointerEvents="none">{i + 1}</text>
            {view.labels && !lite && (
              <text x={x} y={y + 54} textAnchor="middle" fontSize={font * 0.8} fill="rgba(255,255,255,0.75)" pointerEvents="none">
                {`${roleText(L, li)} · ${li.kelvin} K · ${li.intensity}%`}
              </text>
            )}
            {rotKnob(li.id, x, y, li.rot, 80)}
          </g>
        );
      })}
    </g>
  );
}
