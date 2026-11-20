"use client";

// 2026-11-20, Lino: «Lichtplan» node on the board — a static SVG preview (top-down plan, numbered lights) + a short
// fixture list. Deliberately cheap (iPhone / iPad must always open the board): one small SVG, no canvas, no WebGL,
// the floor-plan photo only as its thumbnail. «Bearbeiten» / «Ansehen» opens the full-screen editor.

import { activeLook, kelvinColor, lpLabels, plotBounds, plotOf, roleText } from "@/lib/lightPlot";
import type { LightPlotElement } from "@/lib/board";
import { useLanguage } from "@/lib/i18n";
import { LightPlotDrawing, PX } from "./LightPlotDrawing";

export function LightPlotNode({ el, editable, onOpen }: { el: LightPlotElement; editable?: boolean; onOpen?: () => void }) {
  const { language } = useLanguage();
  const L = lpLabels(language);
  const plot = plotOf(el);
  const look = activeLook(plot);
  const b = plotBounds(plot, 0.8);
  const listRows = Math.min(look.lights.length, 5);
  return (
    <div data-light-plot className="w-full h-full rounded-xl overflow-hidden bg-[#1c1c1e] border border-white/12 shadow-[0_2px_10px_rgba(0,0,0,0.35)] flex flex-col">
      <div className="flex items-center gap-2 px-3 h-9 border-b border-white/10 shrink-0">
        <span className="text-[13px]">💡</span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-white/90">{el.title || L.node}</span>
        <span className="shrink-0 text-[11px] text-white/45 truncate max-w-[40%]">{look.name}{plot.looks.length > 1 ? ` (+${plot.looks.length - 1})` : ""}</span>
        {onOpen && (
          <button
            data-no-drag
            data-light-plot-open
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onOpen(); }}
            className="shrink-0 h-6 px-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-semibold"
          >
            {editable ? L.edit : L.view}
          </button>
        )}
      </div>
      <div className="relative flex-1 min-h-0 bg-[#141416]">
        <svg viewBox={`${b.x * PX} ${b.y * PX} ${b.w * PX} ${b.h * PX}`} className="absolute inset-0 w-full h-full" preserveAspectRatio="xMidYMid meet">
          <LightPlotDrawing plot={plot} look={look} L={L} bgSrc={el.image_thumb_src ?? el.image_src} lite />
        </svg>
        {!look.lights.length && <div className="absolute inset-x-3 bottom-2 text-center text-[11px] text-white/40">{L.empty}</div>}
      </div>
      {listRows > 0 && (
        <div className="shrink-0 border-t border-white/10 px-3 py-1.5 space-y-0.5">
          {look.lights.slice(0, listRows).map((li, i) => (
            <div key={li.id} className="flex items-center gap-1.5 text-[11px] leading-4 text-white/75 min-w-0">
              <span className="w-4 h-4 shrink-0 rounded-full text-[10px] font-bold text-white flex items-center justify-center" style={{ background: "#18181b", boxShadow: `inset 0 0 0 1.5px ${kelvinColor(li.kelvin)}` }}>{i + 1}</span>
              <span className="truncate">{li.name}</span>
              <span className="ml-auto shrink-0 text-white/45">{roleText(L, li)} · {li.kelvin} K</span>
            </div>
          ))}
          {look.lights.length > listRows && <div className="text-[10px] text-white/40">+{look.lights.length - listRows} {L.lights}</div>}
        </div>
      )}
    </div>
  );
}
