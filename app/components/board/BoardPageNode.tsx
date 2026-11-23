"use client";

/** 2026-11-23, Lino: «Seite» — a node that opens its own board (double click / double tap). The tile shows
 * the title, a small map of what is on the page and how many items / sub-pages it holds. Plain DOM + SVG
 * (no WebGL), so it renders on every device. 2026-11-23: big selectable icon instead of the mini map. */

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

/** 2026-11-23, Lino: the tile shows a big, selectable icon instead of the mini map (keys stored in el.icon; any
 *  other short text there is shown as an emoji). One line style (24 px grid, 2 px stroke). */
export const PAGE_ICONS: Record<string, string> = {
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  document: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4",
  camera: "M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
  film: "M4 4h16v16H4zM8 4v16M16 4v16M4 9h4M4 15h4M16 9h4M16 15h4",
  light: "M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z",
  pin: "M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  person: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  people: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2 20a7 7 0 0 1 14 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 13.5a6 6 0 0 1 4 6.5",
  costume: "M8 3 4 6l2 4 2-1v12h8V9l2 1 2-4-4-3a4 4 0 0 1-8 0z",
  prop: "M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
  sound: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3",
  music: "M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  cut: "M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.1 7.6 20 20M8.1 16.4 20 4",
  storyboard: "M3 4h8v7H3zM13 4h8v7h-8zM3 13h8v7H3zM13 13h8v7h-8z",
  image: "M4 4h16v16H4zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM20 15l-5-5L4 20",
  calendar: "M4 6h16v15H4zM4 10h16M8 3v5M16 3v5",
  car: "M5 16h14M3 16v-4l2-5h14l2 5v4h-2a2 2 0 0 1-4 0H9a2 2 0 0 1-4 0zM6.5 12h11",
  home: "M3 11 12 4l9 7M5 10v10h14V10M10 20v-6h4v6",
  star: "M12 3l2.8 5.8 6.2.9-4.5 4.4 1 6.2L12 17.4 6.5 20.3l1-6.2L3 9.7l6.2-.9z",
  heart: "M12 20s-7-4.5-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.5-9 9-9 9z",
  flag: "M5 21V4M5 4h11l-2 4 2 4H5",
  idea: "M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3zM9 21h6",
};
export const PAGE_COLORS = ["#8b5cf6", "#3b82f6", "#10b981", "#eab308", "#f97316", "#ef4444", "#ec4899", "#71717a"];
export const DEFAULT_PAGE_ICON = "folder";
export const DEFAULT_PAGE_COLOR = "#8b5cf6";

export function PageIcon({ icon, color, size }: { icon?: string; color?: string; size: number }) {
  const key = icon || DEFAULT_PAGE_ICON;
  const path = PAGE_ICONS[key];
  const c = color || DEFAULT_PAGE_COLOR;
  if (!path) return <span data-page-icon={key} style={{ fontSize: size * 0.8, lineHeight: 1 }}>{key}</span>;
  return (
    <svg data-page-icon={key} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={path} />
    </svg>
  );
}

/** icon + colour picker (screen space, works with touch) */
export function PageIconPicker({ icon, color, onPick, onClose }: { icon?: string; color?: string; onPick: (p: { icon?: string; color?: string }) => void; onClose: () => void }) {
  const { t } = useLanguage();
  const [emoji, setEmoji] = useState(icon && !PAGE_ICONS[icon] ? icon : "");
  const c = color || DEFAULT_PAGE_COLOR;
  return (
    <div data-board-ui data-page-icon-picker className="absolute inset-0 z-50 flex items-center justify-center bg-black/40" onPointerDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-[min(380px,calc(100%-24px))] rounded-2xl bg-[#1c1c1e] border border-white/10 shadow-2xl p-4 text-white" onPointerDown={(e) => e.stopPropagation()}>
        <div className="text-[15px] font-semibold mb-3">{t("ideaBoard.page.iconTitle")}</div>
        <div className="grid grid-cols-6 gap-1.5">
          {Object.keys(PAGE_ICONS).map((k) => (
            <button key={k} data-pick-icon={k} onClick={() => onPick({ icon: k })} className={`h-11 rounded-xl flex items-center justify-center ${k === (icon || DEFAULT_PAGE_ICON) ? "bg-white/15 ring-2 ring-blue-500" : "bg-white/5 hover:bg-white/10"}`}>
              <PageIcon icon={k} color={c} size={22} />
            </button>
          ))}
        </div>
        <label className="block text-[12px] text-white/55 mt-3">{t("ideaBoard.page.emoji")}
          <input
            data-pick-emoji
            value={emoji}
            onChange={(e) => setEmoji(e.target.value)}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && emoji.trim()) onPick({ icon: [...emoji.trim()].slice(0, 2).join("") }); }}
            onBlur={() => { if (emoji.trim() && emoji.trim() !== icon) onPick({ icon: [...emoji.trim()].slice(0, 2).join("") }); }}
            placeholder="🎬"
            className="mt-1 w-full h-9 rounded-lg bg-white/5 border border-white/10 px-2 text-[18px] outline-none focus:border-blue-500 select-text"
          />
        </label>
        <div className="text-[12px] text-white/55 mt-3 mb-1">{t("ideaBoard.page.color")}</div>
        <div className="flex gap-2">
          {PAGE_COLORS.map((col) => (
            <button key={col} data-pick-color={col} onClick={() => onPick({ color: col })} aria-label={col} className={`w-8 h-8 rounded-full ${col === c ? "ring-2 ring-white ring-offset-2 ring-offset-[#1c1c1e]" : ""}`} style={{ background: col }} />
          ))}
        </div>
        <div className="flex justify-end mt-4">
          <button data-pick-done onClick={onClose} className="h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-semibold">{t("ideaBoard.page.done")}</button>
        </div>
      </div>
    </div>
  );
}

export function PageNode({ el, editing, editable, onCommitTitle, onPickIcon }: { el: PageElement; editing: boolean; editable: boolean; onCommitTitle: (title: string) => void; onPickIcon?: () => void }) {
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
        <PageIcon icon={el.icon} color={el.color} size={18} />
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
      <div className="flex-1 min-h-0 mx-3 rounded-xl overflow-hidden flex items-center justify-center p-2" style={{ background: `${el.color || DEFAULT_PAGE_COLOR}1f` }}>
        <button
          type="button"
          data-page-icon-button
          aria-disabled={!editable || !onPickIcon}
          tabIndex={onPickIcon ? 0 : -1}
          // a single click on the icon of the SELECTED tile opens the picker; a double click still opens the page
          className={`rounded-2xl p-2 ${onPickIcon ? "hover:bg-white/5 cursor-pointer" : "cursor-default"}`}
          title={editable ? t("ideaBoard.page.icon") : undefined}
        >
          <PageIcon icon={el.icon} color={el.color} size={Math.max(40, Math.min(el.w, el.h) * 0.42)} />
        </button>
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
  // narrow screens: the crumbs scroll, the open page (the end) stays in view
  const crumbsRef = useRef<HTMLDivElement>(null);
  const key = path.map((p) => p.id).join("/");
  useEffect(() => {
    const el = crumbsRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [key]);
  if (!path.length) return null;
  const parent = path.length > 1 ? path[path.length - 2].id : null;
  return (
    <div data-board-ui data-page-breadcrumb className="absolute z-30 top-3 flex items-center gap-1 p-1 rounded-xl bg-[#1c1c1e]/95 border border-white/10 shadow-xl backdrop-blur text-white/85 text-[13px]" style={{ left, maxWidth: `calc(100% - ${left + 72}px)` }}>
      <button data-page-back onClick={() => onGo(parent)} className="h-8 px-2.5 rounded-lg bg-white/10 hover:bg-white/15 font-semibold flex items-center gap-1 shrink-0" title={t("ideaBoard.page.back")}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 18l-6-6 6-6" /></svg>
        {t("ideaBoard.page.back")}
      </button>
      <div ref={crumbsRef} className="flex items-center min-w-0 overflow-x-auto [scrollbar-width:none]">
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
