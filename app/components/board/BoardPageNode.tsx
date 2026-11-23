"use client";

/** 2026-11-23, Lino: «Seite» — a node that opens its own board (double click / double tap). The tile shows
 * the title, a small map of what is on the page and how many items / sub-pages it holds. Plain DOM + SVG
 * (no WebGL), so it renders on every device. */

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { BoardElement, PageElement } from "@/lib/board";
import { useLanguage } from "@/lib/i18n";

export type BoardPagesInfo = {
  /** nodes directly on a page */
  childrenOf: (pageId: string) => BoardElement[];
  /** everything inside a page (sub-pages counted with their contents) */
  totalOf: (pageId: string) => number;
};

export const BoardPagesContext = createContext<BoardPagesInfo | null>(null);

const TYPE_FILL: Partial<Record<BoardElement["type"], string>> = {
  image: "#60a5fa", video: "#60a5fa", moodboard: "#60a5fa", scene: "#f59e0b", sticky: "#fde68a", text: "#e5e7eb",
  page: "#a78bfa", group: "transparent", todo: "#34d399", link: "#93c5fd", light_plot: "#facc15", timetable: "#f472b6",
};

function MiniMap({ items }: { items: BoardElement[] }) {
  const shown = items.filter((e) => e.type !== "drawing").slice(0, 200);
  if (!shown.length) return null;
  const x0 = Math.min(...shown.map((e) => e.x));
  const y0 = Math.min(...shown.map((e) => e.y));
  const x1 = Math.max(...shown.map((e) => e.x + e.w));
  const y1 = Math.max(...shown.map((e) => e.y + e.h));
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  return (
    <svg viewBox={`${x0 - w * 0.04} ${y0 - h * 0.04} ${w * 1.08} ${h * 1.08}`} preserveAspectRatio="xMidYMid meet" className="w-full h-full" aria-hidden>
      {shown
        .sort((a, b) => a.z - b.z)
        .map((e) =>
          e.type === "group" ? (
            <rect key={e.id} x={e.x} y={e.y} width={e.w} height={e.h} rx={Math.min(e.w, e.h) * 0.04} fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.25)" strokeWidth={Math.max(w, h) / 200} />
          ) : (
            <rect key={e.id} x={e.x} y={e.y} width={e.w} height={e.h} rx={Math.min(e.w, e.h) * 0.08} fill={TYPE_FILL[e.type] ?? "#9ca3af"} opacity={0.75} />
          ),
        )}
    </svg>
  );
}

export function PageNode({ el, editing, editable, onCommitTitle }: { el: PageElement; editing: boolean; editable: boolean; onCommitTitle: (title: string) => void }) {
  const { t } = useLanguage();
  const info = useContext(BoardPagesContext);
  const items = info?.childrenOf(el.id) ?? [];
  const total = info?.totalOf(el.id) ?? items.length;
  const subpages = items.filter((e) => e.type === "page").length;
  const [draft, setDraft] = useState(el.title);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) {
      setDraft(el.title);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing, el.title]);
  const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  const title = el.title || t("ideaBoard.page.untitled");
  return (
    <div data-page-node={el.id} className="w-full h-full rounded-2xl bg-[#1f1f23] border border-white/12 shadow-lg overflow-hidden flex flex-col text-white">
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-2 shrink-0">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5" />
          <path d="M9 13h6M9 17h4" />
        </svg>
        {editing && editable ? (
          <input
            ref={inputRef}
            data-page-title-input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") onCommitTitle(draft.trim());
              if (e.key === "Escape") onCommitTitle(el.title);
            }}
            onBlur={() => onCommitTitle(draft.trim())}
            placeholder={t("ideaBoard.page.untitled")}
            className="flex-1 min-w-0 bg-white/5 border border-white/15 rounded-md px-2 py-0.5 text-[15px] font-semibold outline-none focus:border-blue-500 select-text"
          />
        ) : (
          <span data-page-title className="flex-1 min-w-0 truncate text-[15px] font-semibold">{title}</span>
        )}
      </div>
      <div className="flex-1 min-h-0 mx-3 rounded-xl bg-black/30 border border-white/5 overflow-hidden flex items-center justify-center p-2">
        {items.length ? <MiniMap items={items} /> : <span className="text-[12px] text-white/35">{t("ideaBoard.page.empty")}</span>}
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2 text-[11px] text-white/55 shrink-0">
        <span data-page-count={total}>
          {total === 1 ? t("ideaBoard.page.node") : t("ideaBoard.page.nodes", { count: total })}
          {subpages > 0 && ` · ${subpages === 1 ? t("ideaBoard.page.subpage") : t("ideaBoard.page.subpages", { count: subpages })}`}
        </span>
        <span className="truncate text-white/35">{coarse ? t("ideaBoard.page.openTap") : t("ideaBoard.page.open")}</span>
      </div>
    </div>
  );
}

/** the navigation top left while a page is open: ← Back · Board / Page A / Page B */
export function PageBreadcrumb({ path, onGo, left }: { path: PageElement[]; onGo: (page: string | null) => void; left: number }) {
  const { t } = useLanguage();
  if (!path.length) return null;
  const parent = path.length > 1 ? path[path.length - 2].id : null;
  return (
    <div data-board-ui data-page-breadcrumb className="absolute z-30 top-3 flex items-center gap-1 p-1 rounded-xl bg-[#1c1c1e]/95 border border-white/10 shadow-xl backdrop-blur text-white/85 text-[13px]" style={{ left, maxWidth: `calc(100% - ${left + 72}px)` }}>
      <button data-page-back onClick={() => onGo(parent)} className="h-8 px-2.5 rounded-lg bg-white/10 hover:bg-white/15 font-semibold flex items-center gap-1 shrink-0" title={t("ideaBoard.page.back")}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 18l-6-6 6-6" /></svg>
        {t("ideaBoard.page.back")}
      </button>
      <div className="flex items-center min-w-0 overflow-x-auto [scrollbar-width:none]">
        <button data-page-crumb="" onClick={() => onGo(null)} className="h-8 px-2 rounded-lg hover:bg-white/10 shrink-0 text-white/60">{t("ideaBoard.page.board")}</button>
        {path.map((p, i) => (
          <span key={p.id} className="flex items-center min-w-0 shrink-0">
            <span className="text-white/30 px-0.5">/</span>
            {i === path.length - 1 ? (
              <span data-page-crumb-current={p.id} className="h-8 px-2 flex items-center font-semibold max-w-[180px] truncate">{p.title || t("ideaBoard.page.untitled")}</span>
            ) : (
              <button data-page-crumb={p.id} onClick={() => onGo(p.id)} className="h-8 px-2 rounded-lg hover:bg-white/10 text-white/60 max-w-[140px] truncate">{p.title || t("ideaBoard.page.untitled")}</button>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
