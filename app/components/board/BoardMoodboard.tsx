"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useContext } from "react";
import { BoardScaleContext, BoardZoomContext, DownloadButton, SharpImg } from "./BoardDownload";
import {
  imageSources,
  fitMosaicRowH,
  layoutMosaic,
  mbCardH,
  mbInnerH,
  mbInnerW,
  mbLevel,
  moodboardItems,
  mosaicBoxes,
  MB_PAD,
  type MoodboardBox,
  type MoodboardElement,
  type MoodboardItem,
} from "@/lib/board";

/** 2026-10-08, Lino: moodboard card. Images keep their aspect ratio and fill
 * the card without holes ("es dürfen keine Lücken entstehen").
 * 2026-10-09 (Lino: "man zieht eines gross, aber dann wird nicht das Bild
 * gross, welches man grosszieht, sondern das Bild daneben … smooth und
 * logisch"): mosaic with size LEVELS (lib/board.ts layoutMosaic). While the
 * card is selected (and editable): hover an image's edge and drag it — the
 * image snaps to the level (normal, 2, 3, 4 rows tall) closest to the
 * pointer, a dashed frame shows where you're pulling, only levels where the
 * dragged image clearly grows the most are offered (nobody else "steals" the
 * enlargement), and the card's height follows. Drag an image onto another
 * to change the order, × removes it. Positions animate. */

type Edge = "l" | "r" | "t" | "b";
const EDGE_ZONE: Record<Edge, string> = {
  l: "left-0 top-0 bottom-0 w-3 cursor-ew-resize justify-start pl-1 items-center",
  r: "right-0 top-0 bottom-0 w-3 cursor-ew-resize justify-end pr-1 items-center",
  t: "top-0 left-0 right-0 h-3 cursor-ns-resize items-start pt-1 justify-center",
  b: "bottom-0 left-0 right-0 h-3 cursor-ns-resize items-end pb-1 justify-center",
};
const MOVE = "left .22s ease, top .22s ease, width .22s ease, height .22s ease";
const area = (b: MoodboardBox) => b.w * b.h;

export function MoodboardNode({
  el,
  active,
  emptyLabel,
  headerLabel,
  downloadLabel,
  onChange,
  onAdd,
}: {
  el: MoodboardElement;
  /** selected alone + editable: images can be resized / reordered / removed */
  active: boolean;
  emptyLabel: string;
  addLabel: string;
  headerLabel: string;
  downloadLabel: string;
  onMeasure?: (h: number) => void;
  onChange?: (items: MoodboardItem[]) => void;
  onAdd?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const zoom = useContext(BoardZoomContext);
  // while an image is dragged: the items as they'd be + the pointer's frame
  const [draft, setDraft] = useState<{ items: MoodboardItem[]; ghost?: MoodboardBox } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [resizing, setResizing] = useState<{ id: string; edge: Edge } | null>(null);
  // aspect ratios learned from the loaded images (older items had none)
  const [seenAr, setSeenAr] = useState<Record<string, number>>({});
  const baseItems = useMemo(() => moodboardItems(el).map((it) => ({ ...it, ar: it.ar ?? seenAr[it.id] ?? 1 })), [el, seenAr]);
  const items = draft?.items ?? baseItems;
  const inner = mbInnerW(el.w);
  const innerH = mbInnerH(el.h);
  // the row height is fixed per card (set when the card is resized at its
  // corner); cards from before get one that fits their current size
  const rowH = useMemo(() => el.row_h ?? fitMosaicRowH(baseItems, inner, innerH), [el.row_h, baseItems, inner, innerH]);
  // while dragging, and for cards from before (no row height yet): the
  // layout at its natural height — the card takes that height; otherwise
  // fitted to the card (only differs while its corner is being dragged)
  const natural = !!draft || !el.row_h;
  const layout = useMemo(
    () => (natural ? layoutMosaic(items, inner, rowH) : mosaicBoxes(items, inner, innerH, rowH)),
    [natural, items, inner, innerH, rowH],
  );
  const boxOf = useMemo(() => new Map(layout.boxes.map((b) => [b.id, b])), [layout]);
  const cardH = natural && items.length ? mbCardH(layout.height) : el.h;
  // a card from before: once, it gets its row height (fitted to the size it
  // had) and its content's height — stored together, so nothing drifts
  const migrated = useRef(false);
  useEffect(() => {
    if (migrated.current || draft || el.row_h || !items.length || !onChange) return;
    migrated.current = true;
    onChange(finalize(baseItems));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el.row_h, draft, items.length]);

  // every image's level as a whole number (older cards stored free factors)
  const finalize = (list: MoodboardItem[]) => list.map((it) => ({ ...it, ar: it.ar ?? seenAr[it.id] ?? 1, s: mbLevel(it) }));

  const boardScale = useContext(BoardScaleContext);
  const screenScale = () => boardScale.current;

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

  function startResize(e: React.PointerEvent, it: MoodboardItem, edge: Edge) {
    e.stopPropagation();
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const k = screenScale();
    const start = baseItems;
    const L0 = mbLevel(it);
    const base = layoutMosaic(start, inner, rowH);
    const b0 = base.boxes.find((b) => b.id === it.id);
    if (!b0) return;
    const baseOf = new Map(base.boxes.map((b) => [b.id, b]));
    // every level once: what it does to this image and to the others. A
    // bigger level counts only if THIS image clearly grows the most.
    // the edge you pull moves, the opposite one stays: pulled at the right
    // edge, a big image sits on the left (and vice versa); pulled up/down it
    // stays on the half of the card it's on
    const side: "l" | "r" = edge === "r" ? "l" : edge === "l" ? "r" : b0.x + b0.w / 2 < inner / 2 ? "l" : "r";
    const options = [1, 2, 3, 4].map((L) => {
      const list = L === L0 ? start : start.map((x) => (x.id === it.id ? { ...x, s: L, side } : x));
      const lay = L === L0 ? base : layoutMosaic(list, inner, rowH);
      const box = lay.boxes.find((b) => b.id === it.id)!;
      const own = area(box) / area(b0);
      let other = 0;
      for (const b of lay.boxes) if (b.id !== it.id) other = Math.max(other, area(b) / area(baseOf.get(b.id) ?? b));
      const ok = L === L0 || (L > L0 ? own > 1.3 && other <= Math.min(2.5, own / 1.2) : own < 0.87);
      return { L, list, box, ok };
    });
    const horizontal = edge === "l" || edge === "r";
    let chosen = options.find((o) => o.L === L0)!;
    setResizing({ id: it.id, edge });
    setDraft({ items: start });
    track(
      (ev) => {
        const dx = (ev.clientX - sx) / k;
        const dy = (ev.clientY - sy) / k;
        const delta = edge === "r" ? dx : edge === "l" ? -dx : edge === "b" ? dy : -dy;
        const want = (horizontal ? b0.w : b0.h) + delta;
        // only levels in the direction of the pull; the one whose size is
        // closest to where the pointer is wins (snaps half-way between)
        let best = chosen;
        let bestErr = Infinity;
        for (const o of options) {
          if (!o.ok || (delta > 0 ? o.L < L0 : o.L > L0)) continue;
          const err = Math.abs((horizontal ? o.box.w : o.box.h) - want);
          if (err < bestErr) {
            bestErr = err;
            best = o;
          }
        }
        chosen = best;
        // the frame hangs on the image as it is now: its pulled edge is
        // where the pointer is
        const b = best.box;
        const size = Math.max(16, want);
        const ghost: MoodboardBox =
          edge === "r" ? { ...b, w: size }
          : edge === "l" ? { ...b, x: b.x + b.w - size, w: size }
          : edge === "b" ? { ...b, h: size }
          : { ...b, y: b.y + b.h - size, h: size };
        setDraft({ items: best.list, ghost });
      },
      () => {
        setResizing(null);
        setDraft(null);
        if (chosen.L !== L0) onChange?.(finalize(chosen.list));
      },
    );
  }

  function startDrag(e: React.PointerEvent, it: MoodboardItem) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const start = baseItems;
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
        setDraft({ items: next });
      },
      () => {
        setDragId(null);
        setDraft(null);
        if (moved && latest !== start) onChange?.(finalize(latest));
      },
    );
  }

  return (
    <div ref={ref} className="rounded-lg bg-[#232325] border border-white/10 shadow-[0_2px_10px_rgba(0,0,0,0.35)] overflow-hidden" style={{ padding: MB_PAD, height: cardH }}>
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
          style={{ height: innerH }}
          className="w-full rounded-md border border-dashed border-white/20 text-white/45 hover:text-white/80 hover:border-white/40 text-sm flex flex-col items-center justify-center gap-2"
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></svg>
          {emptyLabel}
        </button>
      ) : (
        <div className="relative" style={{ height: layout.height }}>
          {items.map((it) => {
            const b = boxOf.get(it.id);
            if (!b) return null;
            return (
              <div
                key={it.id}
                data-mb-item={it.id}
                onPointerDown={active ? (e) => startDrag(e, it) : undefined}
                className={`absolute group/mb rounded-md overflow-hidden bg-white/5 ${active ? "cursor-grab active:cursor-grabbing" : ""} ${
                  dragId === it.id ? "opacity-40 ring-2 ring-blue-500" : resizing?.id === it.id ? "ring-2 ring-blue-500 z-[1]" : ""
                }`}
                style={{ left: b.x, top: b.y, width: b.w, height: b.h, transition: MOVE }}
              >
                {it.src && (
                  <SharpImg
                    {...imageSources(it.src, it.thumb_src, it.ar ?? 1, b.w * zoom, it.srcset)}
                    alt=""
                    draggable={false}
                    onLoad={(e) => {
                      const { naturalWidth: nw, naturalHeight: nh } = e.currentTarget;
                      if (!it.ar && nw && nh && !seenAr[it.id]) setSeenAr((m) => ({ ...m, [it.id]: nw / nh }));
                    }}
                    className="object-cover pointer-events-none select-none"
                  />
                )}
                <DownloadButton fileKey={it.asset_key} name={it.name || it.asset_key.split("/").pop() || "bild"} title={downloadLabel} className={active ? "right-9 top-1.5" : "right-1.5 top-1.5"} />
                {active && (
                  <>
                    <button
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        onChange?.(finalize(items.filter((x) => x.id !== it.id)));
                      }}
                      className="absolute z-20 top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-white text-sm leading-none opacity-0 group-hover/mb:opacity-100 hover:bg-red-600 transition-opacity"
                      aria-label="×"
                    >
                      ×
                    </button>
                    {(["l", "r", "t", "b"] as const).map((edge) => {
                      const on = resizing?.id === it.id && resizing.edge === edge;
                      return (
                        <span key={edge} onPointerDown={(e) => startResize(e, it, edge)} className={`absolute z-10 flex group/edge ${EDGE_ZONE[edge]}`}>
                          <span
                            className={`block rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.35),0_1px_4px_rgba(0,0,0,0.6)] transition-opacity ${
                              edge === "l" || edge === "r" ? "w-1 h-8 max-h-[60%]" : "h-1 w-8 max-w-[60%]"
                            } ${on ? "opacity-100" : "opacity-0 group-hover/edge:opacity-100 [@media(hover:none)]:opacity-50"}`}
                          />
                        </span>
                      );
                    })}
                  </>
                )}
              </div>
            );
          })}
          {draft?.ghost && (
            // where the pointer is pulling the edge to
            <div
              className="absolute rounded-md border-2 border-dashed border-blue-400/90 pointer-events-none z-30"
              style={{ left: draft.ghost.x, top: draft.ghost.y, width: draft.ghost.w, height: draft.ghost.h }}
            />
          )}
        </div>
      )}
    </div>
  );
}
