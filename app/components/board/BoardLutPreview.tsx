"use client";

import { useContext, useRef, useState } from "react";
import { BoardZoomContext, SharpImg } from "./BoardDownload";
import { imageSources, type LutPreviewElement } from "@/lib/board";

/** 2026-10-11, Lino: "LUT Preview" node — a LOG image + a .cube LUT (the graded version is rendered
 * once in the browser and stored as a normal board image, see IdeaBoard addLutFiles), or two
 * images; a wipe slider in the middle compares them (left = LOG / first image, right = LUT /
 * second image). The handle always works (also read-only, e.g. for clients); while the node is
 * selected alone, a press anywhere on the image moves the wipe too. */

export const LUT_PAD = 6;
export const LUT_HEADER = 26;

export type LutPreviewLabels = {
  header: string;
  empty: string;
  pick: string;
  needLut: string;
  log: string;
  lut: string;
};

export function LutPreviewNode({
  el,
  active,
  busy,
  labels,
  onPick,
}: {
  el: LutPreviewElement;
  /** selected alone: a press anywhere on the image moves the wipe */
  active: boolean;
  /** what is happening right now (rendering / uploading), shown over the image */
  busy?: string | null;
  labels: LutPreviewLabels;
  /** editable: open the file picker */
  onPick?: () => void;
}) {
  const zoom = useContext(BoardZoomContext);
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(50);
  const [dragging, setDragging] = useState(false);
  const ar = el.ar && el.ar > 0 ? el.ar : 16 / 9;
  const innerW = el.w - LUT_PAD * 2;
  const a = el.src ? imageSources(el.src, el.thumb_src, ar, innerW * zoom, el.srcset) : null;
  const b = el.image_src ? imageSources(el.image_src, el.image_thumb_src, ar, innerW * zoom, el.image_srcset) : null;
  const leftLabel = el.mode === "compare" ? el.a_name || "1" : labels.log;
  const rightLabel = el.mode === "compare" ? el.b_name || "2" : el.lut_name || labels.lut;

  function move(clientX: number) {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return;
    setPos(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)));
  }
  function start(e: React.PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
    move(e.clientX);
  }
  const wipe = {
    onPointerMove: (e: React.PointerEvent) => dragging && move(e.clientX),
    onPointerUp: () => setDragging(false),
    onPointerCancel: () => setDragging(false),
  };

  return (
    <div
      className="rounded-lg bg-[#232325] border border-white/10 shadow-[0_2px_10px_rgba(0,0,0,0.35)] overflow-hidden flex flex-col"
      style={{ padding: LUT_PAD, height: el.h }}
    >
      <div className="flex items-center gap-1.5 shrink-0 px-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/40" style={{ height: LUT_HEADER - LUT_PAD }}>
        <span className="truncate">{el.title || labels.header}</span>
        {el.mode === "lut" && el.lut_name ? <span className="ml-auto truncate normal-case tracking-normal font-medium text-white/35">{el.lut_name}</span> : null}
      </div>
      {!a && !b ? (
        <button
          type="button"
          data-no-drag={onPick ? "" : undefined}
          onClick={() => onPick?.()}
          className="flex-1 w-full rounded-md border border-dashed border-white/20 text-white/45 hover:text-white/80 hover:border-white/40 text-sm flex flex-col items-center justify-center gap-2 px-4 text-center"
        >
          <span className="text-2xl leading-none">◐</span>
          <span>{busy || labels.empty}</span>
          {onPick ? <span className="text-xs text-white/35">{labels.pick}</span> : null}
          {el.lut_name ? <span className="text-xs text-white/55">LUT: {el.lut_name}</span> : null}
        </button>
      ) : (
        <div ref={boxRef} className="relative flex-1 rounded-md overflow-hidden bg-black select-none" {...(active && b ? { "data-no-drag": "", onPointerDown: start, ...wipe, style: { cursor: "ew-resize" } } : {})}>
          {b ? <SharpImg {...b} alt={rightLabel} draggable={false} className="object-contain pointer-events-none" /> : null}
          {a ? (
            <SharpImg
              {...a}
              alt={leftLabel}
              draggable={false}
              className="object-contain pointer-events-none"
              style={b ? { clipPath: `inset(0 ${100 - pos}% 0 0)` } : undefined}
            />
          ) : null}
          {a && b ? (
            <div className="absolute inset-y-0 pointer-events-none" style={{ left: `${pos}%` }}>
              <div className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_6px_rgba(0,0,0,0.6)]" />
              <div
                data-no-drag
                data-board-ui
                role="slider"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(pos)}
                aria-label={`${leftLabel} / ${rightLabel}`}
                onPointerDown={start}
                {...wipe}
                className="pointer-events-auto absolute top-1/2 left-0 w-9 h-9 rounded-full bg-white text-black shadow-lg flex items-center justify-center cursor-ew-resize"
                style={{ transform: `translate(-50%, -50%) scale(${1 / Math.max(zoom, 0.35)})` }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M9 6l-6 6 6 6" />
                  <path d="M15 6l6 6-6 6" />
                </svg>
              </div>
            </div>
          ) : null}
          {a && b ? (
            <>
              <span className="pointer-events-none absolute bottom-2 left-2 max-w-[45%] truncate rounded bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white">{leftLabel}</span>
              <span className="pointer-events-none absolute bottom-2 right-2 max-w-[45%] truncate rounded bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white">{rightLabel}</span>
            </>
          ) : a && el.mode === "lut" && !busy ? (
            <span className="pointer-events-none absolute inset-x-3 bottom-3 text-center rounded bg-black/65 px-2 py-1 text-xs text-white/85">{labels.needLut}</span>
          ) : null}
          {busy ? (
            <div className="absolute inset-0 flex items-center justify-center bg-black/45 pointer-events-none">
              <span className="rounded-full bg-black/70 px-3 py-1 text-xs font-semibold text-white animate-pulse">{busy}</span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
