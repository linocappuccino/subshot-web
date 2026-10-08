"use client";

import { useEffect, useRef, useState } from "react";
import { MOODBOARD_UNITS, moodboardItems, type MoodboardElement, type MoodboardItem } from "@/lib/board";

/** 2026-10-08, Lino: moodboard card (bloom.site style). Every image keeps
 * its own aspect ratio and can be dragged to any size — no fixed column
 * widths: its width is stored in 24ths of the card (fine enough to feel
 * continuous), its height follows from the aspect ratio. The images pack
 * themselves masonry-style (CSS grid with 4 px rows + dense flow), so the
 * others flow around whatever you resize. While the card is selected (and
 * editable): drag an image's corner to resize, drag an image onto another
 * to change the order, × removes it, "+" adds more. */

const PAD = 10;
const GAP = 6;
const ROW = 4; // px per grid row — fine, so heights are (almost) exact

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
  const [resizingId, setResizingId] = useState<string | null>(null);
  // aspect ratios learned from the loaded images (older items had none)
  const [seenAr, setSeenAr] = useState<Record<string, number>>({});
  const base = moodboardItems(el);
  const items = (draft ?? base).map((it) => ({ ...it, ar: it.ar ?? seenAr[it.id] ?? 1 }));
  const inner = Math.max(60, el.w - PAD * 2);
  const unit = (inner - GAP * (MOODBOARD_UNITS - 1)) / MOODBOARD_UNITS;
  const widthOf = (w: number) => w * unit + (w - 1) * GAP;
  const rowsOf = (it: MoodboardItem) => Math.max(1, Math.round((widthOf(it.w) / (it.ar || 1) + GAP) / (ROW + GAP)));

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

  /** what gets saved: the free-size format, aspect ratios included */
  const finalize = (list: MoodboardItem[]) => list.map((it) => ({ ...it, ar: it.ar ?? seenAr[it.id] ?? 1 }));

  const screenScale = () => {
    const r = ref.current?.getBoundingClientRect();
    return r && el.w ? r.width / el.w : 1;
  };

  function track(onMove: (e: PointerEvent) => void, onUp: () => void) {
    const move = (e: PointerEvent) => {
      e.preventDefault();
      onMove(e);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      onUp();
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
    const start = items;
    const w0 = widthOf(it.w);
    const ar = it.ar || 1;
    let latest = start;
    setResizingId(it.id);
    track(
      (ev) => {
        // the corner follows the pointer; with the ratio locked, whichever
        // direction was dragged further decides the new width
        const dx = (ev.clientX - sx) / k;
        const dy = ((ev.clientY - sy) / k) * ar;
        const px = w0 + (Math.abs(dx) > Math.abs(dy) ? dx : dy);
        const w = Math.max(3, Math.min(MOODBOARD_UNITS, Math.round((px + GAP) / (unit + GAP))));
        latest = start.map((x) => (x.id === it.id ? { ...x, w } : x));
        setDraft(latest);
      },
      () => {
        setResizingId(null);
        setDraft(null);
        if (latest !== start) onChange?.(finalize(latest));
      },
    );
  }

  function startDrag(e: React.PointerEvent, it: MoodboardItem) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const start = items;
    let latest = start;
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
        const [moving] = next.splice(from, 1);
        next.splice(to, 0, moving);
        latest = next;
        setDraft(next);
      },
      () => {
        setDragId(null);
        setDraft(null);
        if (moved && latest !== start) onChange?.(finalize(latest));
      },
    );
  }

  const addSize = Math.round(MOODBOARD_UNITS / Math.max(1, el.cols || 3));

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
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${MOODBOARD_UNITS}, minmax(0, 1fr))`,
            gridAutoRows: ROW,
            columnGap: GAP,
            rowGap: GAP,
            gridAutoFlow: "row dense",
          }}
        >
          {items.map((it) => (
            <div
              key={it.id}
              data-mb-item={it.id}
              onPointerDown={active ? (e) => startDrag(e, it) : undefined}
              className={`relative group/mb rounded-md overflow-hidden bg-white/5 ${active ? "cursor-grab active:cursor-grabbing" : ""} ${
                dragId === it.id ? "opacity-40 ring-2 ring-blue-500" : resizingId === it.id ? "ring-2 ring-blue-500" : ""
              }`}
              style={{ gridColumn: `span ${it.w}`, gridRow: `span ${rowsOf(it)}` }}
            >
              {it.src && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={it.src}
                  alt=""
                  draggable={false}
                  onLoad={(e) => {
                    const { naturalWidth: nw, naturalHeight: nh } = e.currentTarget;
                    if (!it.ar && nw && nh && !seenAr[it.id]) setSeenAr((m) => ({ ...m, [it.id]: nw / nh }));
                  }}
                  className="w-full h-full object-cover pointer-events-none select-none"
                />
              )}
              {active && (
                <>
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onChange?.(finalize(items.filter((x) => x.id !== it.id)));
                    }}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white text-sm leading-none opacity-0 group-hover/mb:opacity-100 hover:bg-red-600 transition-opacity"
                    aria-label="×"
                  >
                    ×
                  </button>
                  <span onPointerDown={(e) => startResize(e, it)} className="absolute right-0 bottom-0 w-6 h-6 cursor-nwse-resize flex items-end justify-end p-1">
                    <span className="block w-3 h-3 border-r-2 border-b-2 border-white rounded-br-sm drop-shadow-[0_0_2px_rgba(0,0,0,0.8)]" />
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
              style={{ gridColumn: `span ${addSize}`, gridRow: `span ${Math.round((widthOf(addSize) * 0.75 + GAP) / (ROW + GAP))}` }}
            >
              +
            </button>
          )}
        </div>
      )}
    </div>
  );
}
