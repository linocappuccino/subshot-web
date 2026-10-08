"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { useLanguage } from "@/lib/i18n";
import { boundsOf, tagColor, type BoardElement } from "@/lib/board";
import { boardHtmlToPlain } from "./BoardElementView";

/** 2026-10-08, Lino: "Tags, Navigation und Suche" for the idea board —
 * search panel (full text over every node + tag filter, an outline of the
 * board when nothing is typed), minimap and the tag editor. */

type View = { x: number; y: number; scale: number };

/** everything a node can be found by */
export function elementSearchText(el: BoardElement, withTags = true): string {
  const parts: string[] = [];
  switch (el.type) {
    case "text":
    case "sticky":
      parts.push(boardHtmlToPlain(el.html));
      break;
    case "scene":
      parts.push(`#${el.number}`, el.title, boardHtmlToPlain(el.html), ...(el.dialogues ?? []));
      break;
    case "link":
      parts.push(el.title, el.description, el.site_name, el.url);
      break;
    case "image":
    case "video":
    case "audio":
    case "pdf":
    case "file":
      parts.push(el.name);
      break;
    case "group":
    case "todo":
    case "palette":
      parts.push(el.title);
      if (el.type === "palette") parts.push(...el.colors);
      break;
    case "location":
      parts.push(el.title, el.address);
      break;
    case "color":
      parts.push(el.hex, el.name ?? "");
      break;
    case "moodboard":
      parts.push(el.title, ...el.items.map((it) => it.name));
      break;
  }
  if (withTags) parts.push(...(el.tags ?? []));
  return parts.filter(Boolean).join(" \n ");
}

const TYPE_ICON: Record<BoardElement["type"], string> = {
  text: "📝", sticky: "🗒️", scene: "🎬", link: "🔗", image: "🖼️", video: "🎞️", audio: "🎵", pdf: "📄", file: "📎",
  drawing: "✏️", group: "🗂️", todo: "☑️", palette: "🎨", location: "📍", color: "🟥", moodboard: "🖼️",
};

export function elementLabel(el: BoardElement, t: (k: never) => string): string {
  const tt = t as unknown as (k: string) => string;
  switch (el.type) {
    case "scene":
      return `${tt("ideaBoard.scene")} ${el.number}${el.title ? ` – ${el.title}` : ""}`;
    case "text":
    case "sticky":
      return boardHtmlToPlain(el.html).split("\n")[0].slice(0, 80) || tt(el.type === "text" ? "ideaBoard.search.typeText" : "ideaBoard.menu.sticky");
    case "group":
      return el.title || tt("ideaBoard.group");
    case "link":
      return el.title || el.url;
    case "location":
      return el.title || el.address || tt("ideaBoard.location.label");
    case "palette":
      return el.title || tt("ideaBoard.palette.label");
    case "color":
      return el.name ? `${el.name} (${el.hex.toUpperCase()})` : el.hex.toUpperCase();
    case "todo":
      return el.title;
    case "drawing":
      return tt("ideaBoard.search.typeDrawing");
    case "moodboard":
      return el.title || `${tt("ideaBoard.moodboard.label")} (${el.items.length})`;
    default:
      return el.name;
  }
}

function snippet(text: string, q: string): string {
  if (!q) return "";
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return "";
  const s = Math.max(0, i - 30);
  return (s > 0 ? "…" : "") + text.slice(s, i + q.length + 50).replace(/\s+/g, " ").trim();
}

export function TagChip({ tag, active, onClick, count }: { tag: string; active?: boolean; onClick?: () => void; count?: number }) {
  const c = tagColor(tag);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap transition-shadow ${active ? "ring-2 ring-white/80" : ""}`}
      style={{ background: c.bg, color: c.fg }}
    >
      #{tag}
      {count != null && <span className="opacity-60">{count}</span>}
    </button>
  );
}

export function BoardSearchPanel({
  elements,
  query,
  onQuery,
  tagFilter,
  onTagFilter,
  matches,
  onPick,
  onClose,
}: {
  elements: BoardElement[];
  query: string;
  onQuery: (q: string) => void;
  tagFilter: string[];
  onTagFilter: (tags: string[]) => void;
  /** ids matching query + tags (null = no filter active) */
  matches: Set<string> | null;
  onPick: (el: BoardElement) => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const tt = t as unknown as (k: string) => string;
  const inputRef = useRef<HTMLInputElement>(null);
  const [cursor, setCursor] = useState(0);
  useEffect(() => inputRef.current?.focus(), []);

  const allTags = useMemo(() => {
    const counts = new Map<string, { tag: string; n: number }>();
    for (const el of elements) for (const tg of el.tags ?? []) {
      const k = tg.toLowerCase();
      counts.set(k, { tag: counts.get(k)?.tag ?? tg, n: (counts.get(k)?.n ?? 0) + 1 });
    }
    return [...counts.values()].sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag));
  }, [elements]);

  const results = useMemo(() => {
    if (!matches) return [];
    return elements.filter((el) => matches.has(el.id) && el.type !== "drawing").slice(0, 200);
  }, [elements, matches]);

  // nothing typed/filtered: an outline of the board to jump around in
  const outline = useMemo(() => {
    if (matches) return [];
    const sections: { title: string; items: BoardElement[] }[] = [
      { title: tt("ideaBoard.search.groups"), items: elements.filter((e) => e.type === "group") },
      { title: tt("ideaBoard.search.scenes"), items: elements.filter((e) => e.type === "scene").sort((a, b) => (a.type === "scene" && b.type === "scene" ? a.number - b.number : 0)) },
      { title: tt("ideaBoard.search.locations"), items: elements.filter((e) => e.type === "location") },
      { title: tt("ideaBoard.search.notes"), items: elements.filter((e) => e.type === "sticky" || e.type === "todo") },
      { title: tt("ideaBoard.search.colors"), items: elements.filter((e) => e.type === "palette" || e.type === "color") },
    ];
    return sections.filter((s) => s.items.length);
  }, [elements, matches, tt]);

  const flat = matches ? results : outline.flatMap((s) => s.items);
  useEffect(() => setCursor(0), [query, tagFilter.join("|")]);

  return (
    <div
      data-board-ui
      className="absolute z-40 top-3 right-3 w-[min(340px,calc(100%-24px))] max-h-[calc(100%-24px)] flex flex-col rounded-xl bg-[#1c1c1e]/97 border border-white/10 shadow-2xl backdrop-blur"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onClose();
        else if (e.key === "ArrowDown") setCursor((c) => Math.min(flat.length - 1, c + 1));
        else if (e.key === "ArrowUp") setCursor((c) => Math.max(0, c - 1));
        else if (e.key === "Enter" && flat[cursor]) onPick(flat[cursor]);
        else return;
        e.preventDefault();
      }}
    >
      <div className="flex items-center gap-2 p-2 border-b border-white/10">
        <span className="pl-1 text-white/40">🔍</span>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={tt("ideaBoard.search.placeholder")}
          className="flex-1 min-w-0 bg-transparent text-sm text-white outline-none select-text"
        />
        <button onClick={onClose} aria-label={tt("ideaFocusView.close")} className="w-7 h-7 rounded-md text-white/50 hover:text-white hover:bg-white/10">
          ×
        </button>
      </div>
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 p-2 border-b border-white/10 max-h-24 overflow-y-auto">
          {allTags.map(({ tag, n }) => {
            const on = tagFilter.some((x) => x.toLowerCase() === tag.toLowerCase());
            return (
              <TagChip
                key={tag}
                tag={tag}
                count={n}
                active={on}
                onClick={() => onTagFilter(on ? tagFilter.filter((x) => x.toLowerCase() !== tag.toLowerCase()) : [...tagFilter, tag])}
              />
            );
          })}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto p-1.5">
        {matches ? (
          results.length ? (
            <>
              <div className="px-2 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/35">
                {tt("ideaBoard.search.results").replace("{count}", String(results.length))}
              </div>
              {results.map((el, i) => (
                <ResultRow key={el.id} el={el} active={i === cursor} sub={snippet(elementSearchText(el, false), query)} onPick={() => onPick(el)} />
              ))}
            </>
          ) : (
            <p className="px-2 py-3 text-sm text-white/40">{tt("ideaBoard.search.none")}</p>
          )
        ) : outline.length ? (
          outline.map((s) => (
            <div key={s.title} className="mb-1.5">
              <div className="px-2 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-white/35">{s.title}</div>
              {s.items.map((el) => (
                <ResultRow key={el.id} el={el} active={flat[cursor]?.id === el.id} onPick={() => onPick(el)} />
              ))}
            </div>
          ))
        ) : (
          <p className="px-2 py-3 text-sm text-white/40">{tt("ideaBoard.search.empty")}</p>
        )}
      </div>
    </div>
  );
}

function ResultRow({ el, active, sub, onPick }: { el: BoardElement; active: boolean; sub?: string; onPick: () => void }) {
  const { t } = useLanguage();
  return (
    <button
      onClick={onPick}
      className={`w-full flex items-start gap-2 rounded-lg px-2 py-1.5 text-left ${active ? "bg-white/10" : "hover:bg-white/[0.06]"}`}
    >
      <span className="shrink-0 w-5 text-center text-sm">{TYPE_ICON[el.type]}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-white/90 truncate">{elementLabel(el, t as never)}</span>
        {sub && <span className="block text-xs text-white/45 truncate">{sub}</span>}
        {(el.tags ?? []).length > 0 && (
          <span className="flex flex-wrap gap-1 mt-0.5">
            {(el.tags ?? []).map((tg) => (
              <span key={tg} className="text-[10px] font-semibold" style={{ color: tagColor(tg).fg }}>
                #{tg}
              </span>
            ))}
          </span>
        )}
      </span>
    </button>
  );
}

/** overview of the whole board with the visible area; click/drag to move */
export function BoardMinimap({
  elements,
  view,
  size,
  dimmed,
  onNavigate,
  bottom = 12,
}: {
  elements: BoardElement[];
  view: View;
  size: { w: number; h: number };
  /** px from the board's bottom edge (stacks above the zoom/storyboard bars) */
  bottom?: number;
  dimmed: Set<string> | null;
  onNavigate: (worldX: number, worldY: number) => void;
}) {
  const W = 200;
  const H = 128;
  const visible = { x: -view.x / view.scale, y: -view.y / view.scale, w: size.w / view.scale, h: size.h / view.scale };
  const content = boundsOf(elements.filter((e) => e.type !== "drawing")) ?? visible;
  const pad = 40;
  const b = {
    x: Math.min(content.x, visible.x) - pad,
    y: Math.min(content.y, visible.y) - pad,
    x2: Math.max(content.x + content.w, visible.x + visible.w) + pad,
    y2: Math.max(content.y + content.h, visible.y + visible.h) + pad,
  };
  const k = Math.min(W / (b.x2 - b.x), H / (b.y2 - b.y));
  const ox = (W - (b.x2 - b.x) * k) / 2;
  const oy = (H - (b.y2 - b.y) * k) / 2;
  const toMini = (x: number, y: number) => ({ x: ox + (x - b.x) * k, y: oy + (y - b.y) * k });
  const dragging = useRef(false);

  function go(e: React.PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    onNavigate(b.x + (mx - ox) / k, b.y + (my - oy) / k);
  }

  const vis = toMini(visible.x, visible.y);
  return (
    <div data-board-ui className="absolute z-30 right-3 rounded-xl bg-[#1c1c1e]/90 border border-white/10 shadow-xl backdrop-blur p-1 hidden sm:block" style={{ bottom }}>
      <svg
        width={W}
        height={H}
        className="block cursor-pointer touch-none"
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          go(e);
        }}
        onPointerMove={(e) => dragging.current && go(e)}
        onPointerUp={() => (dragging.current = false)}
      >
        {elements.map((el) => {
          if (el.type === "drawing") return null;
          const p = toMini(el.x, el.y);
          const isGroup = el.type === "group" && !el.collapsed;
          return (
            <rect
              key={el.id}
              x={p.x}
              y={p.y}
              width={Math.max(1.5, el.w * k)}
              height={Math.max(1.5, el.h * k)}
              rx={1.5}
              fill={isGroup ? "none" : el.type === "scene" ? "#3b82f6" : el.type === "sticky" ? "#f3e35e" : "rgba(255,255,255,0.45)"}
              stroke={isGroup ? "rgba(255,255,255,0.3)" : "none"}
              opacity={dimmed && !dimmed.has(el.id) ? 0.2 : 0.9}
            />
          );
        })}
        <rect x={vis.x} y={vis.y} width={visible.w * k} height={visible.h * k} fill="rgba(59,130,246,0.12)" stroke="#3b82f6" strokeWidth={1.2} rx={2} />
      </svg>
    </div>
  );
}

/** tags of one or several nodes; returns what to add/remove */
export function TagEditor({
  open,
  current,
  allTags,
  onClose,
  onSave,
}: {
  open: boolean;
  current: string[];
  allTags: string[];
  onClose: () => void;
  onSave: (add: string[], remove: string[]) => void;
}) {
  const { t } = useLanguage();
  const tt = t as unknown as (k: string) => string;
  const [tags, setTags] = useState<string[]>(current);
  const [input, setInput] = useState("");
  useEffect(() => {
    if (open) {
      setTags(current);
      setInput("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const has = (tg: string) => tags.some((x) => x.toLowerCase() === tg.toLowerCase());
  function add(raw: string) {
    const tg = raw.replace(/^#/, "").split(/\s+/).join(" ").trim().slice(0, 30);
    if (tg && !has(tg) && tags.length < 10) setTags([...tags, tg]);
    setInput("");
  }
  const suggestions = allTags.filter((tg) => !has(tg) && (!input || tg.toLowerCase().includes(input.toLowerCase()))).slice(0, 12);
  const lower = (xs: string[]) => xs.map((x) => x.toLowerCase());

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tt("ideaBoard.tags.title")}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{tt("common.cancel")}</Button>
          <Button
            variant="primary"
            onClick={() => {
              const final = input.trim() ? [...tags, input.trim()] : tags;
              onSave(
                final.filter((x) => !lower(current).includes(x.toLowerCase())),
                current.filter((x) => !lower(final).includes(x.toLowerCase())),
              );
            }}
          >
            {tt("common.save")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-white/5 border border-white/10 p-2 min-h-11">
        {tags.map((tg) => (
          <span key={tg} className="inline-flex items-center gap-1 rounded-full pl-2 pr-1 py-0.5 text-xs font-semibold" style={{ background: tagColor(tg).bg, color: tagColor(tg).fg }}>
            #{tg}
            <button onClick={() => setTags(tags.filter((x) => x !== tg))} className="w-4 h-4 rounded-full hover:bg-white/20 leading-none">
              ×
            </button>
          </span>
        ))}
        <input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "," || e.key === "Tab") {
              if (input.trim()) {
                e.preventDefault();
                add(input);
              }
            } else if (e.key === "Backspace" && !input && tags.length) {
              setTags(tags.slice(0, -1));
            }
          }}
          placeholder={tags.length ? "" : tt("ideaBoard.tags.placeholder")}
          className="flex-1 min-w-24 bg-transparent text-sm outline-none select-text"
        />
      </div>
      {suggestions.length > 0 && (
        <div className="mt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-white/35 mb-1.5">{tt("ideaBoard.tags.existing")}</div>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((tg) => (
              <TagChip key={tg} tag={tg} onClick={() => add(tg)} />
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
