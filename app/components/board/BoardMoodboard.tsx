"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { clampMoodboardScale, fitMoodboard, fitMoodboardAt, moodboardItems, type MoodboardElement, type MoodboardItem } from "@/lib/board";

/** 2026-10-08, Lino: moodboard card. Images keep their aspect ratio and sit
 * in justified rows (see layoutMoodboard) — every row fills the full width,
 * so resizing never leaves holes ("es dürfen keine Lücken entstehen").
 * While the card is selected (and editable): hover an image's edge for the
 * resize indicator and drag it (the image's size factor changes, its row
 * reflows), drag an image onto another to change the order, × removes it,
 * "+" adds more. Positions animate, so the reflow is easy to follow. */

const PAD = 10;
const GAP = 6;
const HEADER = 26; // header row (20) + its margin (6)
const ADD_ID = "__add";

type Edge = "l" | "r" | "t" | "b";
const EDGE_ZONE: Record<Edge, string> = {
  l: "left-0 top-0 bottom-0 w-3 cursor-ew-resize justify-start pl-1 items-center",
  r: "right-0 top-0 bottom-0 w-3 cursor-ew-resize justify-end pr-1 items-center",
  t: "top-0 left-0 right-0 h-3 cursor-ns-resize items-start pt-1 justify-center",
  b: "bottom-0 left-0 right-0 h-3 cursor-ns-resize items-end pb-1 justify-center",
};
const MOVE = "left .22s ease, top .22s ease, width .22s ease, height .22s ease";

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
  const [resizing, setResizing] = useState<{ id: string; edge: Edge } | null>(null);
  // aspect ratios learned from the loaded images (older items had none)
  const [seenAr, setSeenAr] = useState<Record<string, number>>({});
  const items = useMemo(
    () => (draft ?? moodboardItems(el)).map((it) => ({ ...it, ar: it.ar ?? seenAr[it.id] ?? 1 })),
    [draft, el, seenAr],
  );
  const inner = Math.max(60, el.w - PAD * 2 - 2); // minus the 1 px border on each side
  // 2026-10-08, Lino: the card is sized with its corner handle and the
  // images always fill it — wider or taller, the layout follows its shape
  const innerH = Math.max(40, el.h - PAD * 2 - 2 - HEADER);
  const showAdd = active && !!onAdd;
  // the "+" tile rides along at the end as a smallish square
  const withAdd = (list: MoodboardItem[]) => (showAdd ? [...list, { id: ADD_ID, asset_key: "", name: "", mime: "", w: 1, h: 1, ar: 1, s: 0.8 }] : list);
  // the density (row height) is chosen by a full fit only when the card's
  // size or the set/order of images changes; resizing one image keeps it,
  // so what you see while dragging is exactly what stays
  const fitKey = `${Math.round(inner)}x${Math.round(innerH)}|${items.map((it) => it.id).join(",")}|${showAdd}`;
  const density = useMemo(
    () => fitMoodboard(withAdd(moodboardItems(el).map((it) => ({ ...it, ar: it.ar ?? seenAr[it.id] ?? 1 }))), inner, innerH, GAP).baseH,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fitKey],
  );
  const layout = useMemo(
    () => fitMoodboardAt(withAdd(items), inner, innerH, GAP, density),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, inner, innerH, showAdd, density],
  );
  const boxOf = useMemo(() => new Map(layout.boxes.map((b) => [b.id, b])), [layout]);


  const finalize = (list: MoodboardItem[]) => list.map((it) => ({ ...it, ar: it.ar ?? seenAr[it.id] ?? 1, s: it.s ?? 1 }));

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

  function startResize(e: React.PointerEvent, it: MoodboardItem, edge: Edge) {
    e.stopPropagation();
    e.preventDefault();
    const box = boxOf.get(it.id);
    if (!box) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const k = screenScale();
    const start = items;
    // the dragged edge should end up under the pointer: for every move, try
    // a range of size factors and keep the one whose resulting width/height
    // (after the rows reflow) comes closest — the image follows the pointer
    // directly, even when its row splits or merges on the way
    const candidates = Array.from({ length: 72 }, (_, i) => clampMoodboardScale(0.25 * Math.pow(16, i / 71)));
    const horizontal = edge === "l" || edge === "r";
    let latest = start;
    setResizing({ id: it.id, edge });
    track(
      (ev) => {
        const dx = (ev.clientX - sx) / k;
        const dy = (ev.clientY - sy) / k;
        const want = edge === "r" ? box.w + dx : edge === "l" ? box.w - dx : edge === "b" ? box.h + dy : box.h - dy;
        let best = it.s ?? 1;
        let bestErr = Infinity;
        for (const s of candidates) {
          const trial = start.map((x) => (x.id === it.id ? { ...x, s } : x));
          const b = fitMoodboardAt(withAdd(trial), inner, innerH, GAP, density).boxes.find((x) => x.id === it.id);
          if (!b) continue;
          const err = Math.abs((horizontal ? b.w : b.h) - want);
          if (err < bestErr - 0.01) {
            bestErr = err;
            best = s;
          }
        }
        latest = start.map((x) => (x.id === it.id ? { ...x, s: best } : x));
        setDraft(latest);
      },
      () => {
        setResizing(null);
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

  const addBox = boxOf.get(ADD_ID);

  return (
    <div ref={ref} className="rounded-lg bg-[#232325] border border-white/10 shadow-[0_2px_10px_rgba(0,0,0,0.35)] overflow-hidden" style={{ padding: PAD, height: el.h }}>
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
          {addBox && (
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={onAdd}
              title={addLabel}
              className="absolute rounded-md border border-dashed border-white/20 text-white/45 hover:text-white/80 hover:border-white/40 text-2xl flex items-center justify-center"
              style={{ left: addBox.x, top: addBox.y, width: addBox.w, height: addBox.h, transition: MOVE }}
            >
              +
            </button>
          )}
        </div>
      )}
    </div>
  );
}
