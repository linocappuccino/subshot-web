"use client";

import { useEffect, useRef, useState } from "react";
import type { MoodboardElement, MoodboardItem } from "@/lib/board";

/** 2026-10-08, Lino: moodboard card (bloom.site style) — images on a grid
 * with `cols` columns. While the card is selected (and editable): drag an
 * image's corner to make it span more/fewer columns and rows (the others
 * flow around it, `grid-auto-flow: dense`), drag an image onto another to
 * change the order, × removes it, "+" adds more. */

const PAD = 10;
const GAP = 6;
const MAX_ROWS = 8;

export function MoodboardNode({
  el,
  active,
  emptyLabel,
  addLabel,
  headerLabel,
  onMeasure,
  onChange,
  onAdd,
}: {
  el: MoodboardElement;
  /** selected alone + editable: images can be resized / reordered / removed */
  active: boolean;
  emptyLabel: string;
  addLabel: string;
  headerLabel: string;
  onMeasure: (h: number) => void;
  onChange?: (items: MoodboardItem[]) => void;
  onAdd?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<MoodboardItem[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const items = draft ?? el.items;
  const cols = Math.max(1, el.cols || 3);
  const cell = Math.max(24, (el.w - PAD * 2 - GAP * (cols - 1)) / cols);

  // the card's height follows its content (both ways)
  const heightRef = useRef(el.h);
  heightRef.current = el.h;
  const measureRef = useRef(onMeasure);
  measureRef.current = onMeasure;
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const check = () => {
      const h = node.offsetHeight;
      if (Math.abs(h - heightRef.current) > 1) measureRef.current(h);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  /** screen px per board px (the board is scaled) */
  const screenScale = () => {
    const r = ref.current?.getBoundingClientRect();
    return r && el.w ? r.width / el.w : 1;
  };

  function track(onMove: (e: PointerEvent) => void, onUp: (e: PointerEvent) => void) {
    const move = (e: PointerEvent) => {
      e.preventDefault();
      onMove(e);
    };
    const up = (e: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      onUp(e);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  function startResize(e: React.PointerEvent, it: MoodboardItem) {
    e.stopPropagation();
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const k = screenScale();
    const base = el.items;
    let latest = base;
    track(
      (ev) => {
        const dw = Math.round((ev.clientX - sx) / k / (cell + GAP));
        const dh = Math.round((ev.clientY - sy) / k / (cell + GAP));
        const w = Math.min(cols, Math.max(1, Math.min(it.w, cols) + dw));
        const h = Math.min(MAX_ROWS, Math.max(1, it.h + dh));
        latest = base.map((x) => (x.id === it.id ? { ...x, w, h } : x));
        setDraft(latest);
      },
      () => {
        setDraft(null);
        if (latest !== base) onChange?.(latest);
      },
    );
  }

  function startDrag(e: React.PointerEvent, it: MoodboardItem) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const base = el.items;
    let latest = base;
    let moved = false;
    track(
      (ev) => {
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
        if (!moved) {
          moved = true;
          setDragId(it.id);
        }
        // the image under the pointer takes the dragged one's place
        const hit = document
          .elementsFromPoint(ev.clientX, ev.clientY)
          .map((n) => (n as HTMLElement).closest?.("[data-mb-item]") as HTMLElement | null)
          .find((n) => n && n.dataset.mbItem !== it.id && ref.current?.contains(n));
        const targetId = hit?.dataset.mbItem;
        if (!targetId) return;
        const from = latest.findIndex((x) => x.id === it.id);
        const to = latest.findIndex((x) => x.id === targetId);
        if (from < 0 || to < 0 || from === to) return;
        const next = [...latest];
        next.splice(from, 1);
        next.splice(to, 0, it);
        latest = next;
        setDraft(next);
      },
      () => {
        setDragId(null);
        setDraft(null);
        if (moved && latest !== base) onChange?.(latest);
      },
    );
  }

  return (
    <div ref={ref} className="rounded-lg bg-[#232325] border border-white/10 shadow-[0_2px_10px_rgba(0,0,0,0.35)]" style={{ padding: PAD }}>
      {/* also the handle to move the card while its images are interactive */}
      <div className="flex items-center gap-1.5 h-5 mb-1.5 px-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/40">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></svg>
        {el.title || headerLabel}
        <span className="ml-auto tabular-nums text-white/25">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <button
          data-no-drag={onAdd ? "" : undefined}
          onClick={() => onAdd?.()}
          className="w-full aspect-[16/9] rounded-md border border-dashed border-white/20 text-white/45 hover:text-white/80 hover:border-white/40 text-sm flex flex-col items-center justify-center gap-2"
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></svg>
          {emptyLabel}
        </button>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: cell, gap: GAP, gridAutoFlow: "row dense" }}>
          {items.map((it) => (
            <div
              key={it.id}
              data-mb-item={it.id}
              onPointerDown={active ? (e) => startDrag(e, it) : undefined}
              className={`relative group/mb rounded-md overflow-hidden bg-white/5 ${active ? "cursor-grab active:cursor-grabbing" : ""} ${dragId === it.id ? "opacity-40 ring-2 ring-blue-500" : ""}`}
              style={{ gridColumn: `span ${Math.min(it.w, cols)}`, gridRow: `span ${it.h}` }}
            >
              {it.src && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.src} alt="" draggable={false} className="w-full h-full object-cover pointer-events-none select-none" />
              )}
              {active && (
                <>
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onChange?.(el.items.filter((x) => x.id !== it.id));
                    }}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white text-sm leading-none opacity-0 group-hover/mb:opacity-100 hover:bg-red-600 transition-opacity"
                    aria-label="×"
                  >
                    ×
                  </button>
                  <span
                    onPointerDown={(e) => startResize(e, it)}
                    className="absolute right-0 bottom-0 w-5 h-5 cursor-nwse-resize flex items-end justify-end p-1"
                  >
                    <span className="block w-2.5 h-2.5 border-r-2 border-b-2 border-white rounded-br-sm drop-shadow" />
                  </span>
                </>
              )}
            </div>
          ))}
          {active && onAdd && (
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={onAdd}
              title={addLabel}
              className="rounded-md border border-dashed border-white/20 text-white/45 hover:text-white/80 hover:border-white/40 text-2xl flex items-center justify-center"
            >
              +
            </button>
          )}
        </div>
      )}
    </div>
  );
}
