"use client";

/* 2026-10-29, Lino: "Timetable" — a node on the idea board that shows a
 * clean Drehplan for the day: every scene card of the board as one row
 * (Nr., Szene, Zeit, Location, Beschreibung, Dialog). The node stores only
 * its title, sort and column choice; the rows are derived from the scene
 * cards on every render (lib/timetable.ts), so any change on a card — also a
 * live one from another person — shows up here at once, with exactly the
 * card's number. Empty fields stay empty cells. */

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLanguage, type TranslationKey } from "@/lib/i18n";
import { PRIORITY_COLORS } from "@/lib/types";
import { TIMETABLE_COLUMNS, type BoardElement, type TimetableColumn, type TimetableElement } from "@/lib/board";
import { formatDuration, timetableColumns, timetableRows, type TimetableRow } from "@/lib/timetable";
import { mapsUrlForAddress } from "../PlacePill";

export const BoardTimetableContext = createContext<{
  elements: BoardElement[];
  /** colour of a Drehort on this board (same as on the scene cards) */
  placeColorOf?: (address: string | undefined) => string | null;
  /** fly to + select the scene card */
  onGoTo?: (id: string) => void;
}>({ elements: [] });

const COL_WIDTH: Record<TimetableColumn, string> = {
  number: "52px",
  title: "minmax(120px, 1.3fr)",
  group: "minmax(100px, 1fr)",
  start: "64px",
  end: "72px",
  duration: "72px",
  location: "minmax(130px, 1.3fr)",
  description: "minmax(150px, 2fr)",
  dialogue: "minmax(150px, 2fr)",
  priority: "minmax(80px, 0.6fr)",
  tags: "minmax(90px, 0.9fr)",
  image: "92px",
};

export function TimetableNode({
  el,
  editing,
  editable,
  onCommit,
  onMeasure,
}: {
  el: TimetableElement;
  editing: boolean;
  editable: boolean;
  onCommit: (patch: Partial<Pick<TimetableElement, "title" | "sort" | "columns" | "chain">>) => void;
  onMeasure: (h: number) => void;
}) {
  const { t } = useLanguage();
  const { elements, placeColorOf, onGoTo } = useContext(BoardTimetableContext);
  const rows = useMemo(() => timetableRows(elements, el.sort ?? "time"), [elements, el.sort]);
  const columns = timetableColumns(el, rows);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  // the card follows its content both ways (rows come and go)
  const cardRef = useRef<HTMLDivElement>(null);
  const hRef = useRef(el.h);
  const measure = useRef(onMeasure);
  useLayoutEffect(() => {
    hRef.current = el.h;
    measure.current = onMeasure;
  });
  useEffect(() => {
    const node = cardRef.current;
    if (!node) return;
    const check = () => {
      const h = node.offsetHeight;
      if (Math.abs(h - hRef.current) > 1) measure.current(h);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (editing && titleRef.current) {
      titleRef.current.focus({ preventScroll: true });
      titleRef.current.select();
    }
  }, [editing]);

  const colLabel = (c: TimetableColumn) => t(`ideaBoard.timetable.col.${c}` as TranslationKey);
  const sort = el.sort ?? "time";
  const grid = { gridTemplateColumns: columns.map((c) => COL_WIDTH[c]).join(" ") };

  function toggleColumn(c: TimetableColumn) {
    const next = columns.includes(c) ? columns.filter((x) => x !== c) : TIMETABLE_COLUMNS.filter((x) => x === c || columns.includes(x));
    if (next.length) onCommit({ columns: next });
  }

  return (
    <div ref={cardRef} className="rounded-xl bg-[#1d1d1f] border border-white/10 shadow-[0_2px_14px_rgba(0,0,0,0.4)] text-white">
      {/* header */}
      <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-3 border-b border-white/10">
        <div className="shrink-0 h-8 w-8 rounded-lg bg-blue-500/15 text-blue-300 flex items-center justify-center">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="17" rx="2" />
            <path d="M3 9h18M8 4v17M16 2v4M8 2v4" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              ref={titleRef}
              defaultValue={el.title}
              placeholder={t("ideaBoard.timetable.titlePlaceholder")}
              onBlur={(e) => {
                const v = e.currentTarget.value.trim();
                if (v !== el.title) onCommit({ title: v });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              className="w-full bg-transparent text-[17px] font-semibold text-white/95 outline-none placeholder:text-white/30 select-text"
            />
          ) : (
            <div className="text-[17px] font-semibold truncate text-white/95">{el.title || t("ideaBoard.timetable.label")}</div>
          )}
          <div className="text-[11px] font-medium text-white/40 leading-tight">
            {rows.length === 1 ? t("ideaBoard.timetable.countOne") : t("ideaBoard.timetable.count", { count: rows.length })}
          </div>
        </div>
        {editable && (
          <div className="relative flex items-center gap-1.5 shrink-0">
            <button
              data-no-drag
              type="button"
              role="switch"
              aria-checked={el.chain !== false}
              title={t("ideaBoard.timetable.chainHint")}
              onClick={() => onCommit({ chain: el.chain === false })}
              className="flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-2 py-1.5 text-[11px] font-semibold text-white/70 hover:text-white"
            >
              <span className={`relative h-3.5 w-6 rounded-full transition-colors ${el.chain !== false ? "bg-blue-500" : "bg-white/20"}`}>
                <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-all ${el.chain !== false ? "left-3" : "left-0.5"}`} />
              </span>
              {t("ideaBoard.timetable.chain")}
            </button>
            <div className="flex rounded-lg bg-white/[0.06] p-0.5 text-[11px] font-semibold">
              {(["time", "number"] as const).map((s) => (
                <button
                  key={s}
                  data-no-drag
                  type="button"
                  onClick={() => s !== sort && onCommit({ sort: s })}
                  className={`rounded-md px-2 py-1 transition-colors ${sort === s ? "bg-white/15 text-white" : "text-white/45 hover:text-white/80"}`}
                >
                  {s === "time" ? t("ideaBoard.timetable.sortTime") : t("ideaBoard.timetable.sortNumber")}
                </button>
              ))}
            </div>
            <button
              data-no-drag
              type="button"
              onClick={() => setColumnsOpen((v) => !v)}
              className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${columnsOpen ? "bg-white/15 text-white" : "bg-white/[0.06] text-white/60 hover:text-white"}`}
            >
              {t("ideaBoard.timetable.columns")}
            </button>
            {columnsOpen && (
              <div data-no-drag className="absolute right-0 top-full mt-1.5 z-20 w-48 rounded-xl bg-[#2a2a2c] border border-white/10 shadow-xl p-1.5">
                {TIMETABLE_COLUMNS.map((c) => (
                  <label key={c} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-white/85 hover:bg-white/10 cursor-pointer">
                    <input type="checkbox" checked={columns.includes(c)} onChange={() => toggleColumn(c)} className="accent-blue-500" />
                    {colLabel(c)}
                  </label>
                ))}
                {el.columns && (
                  <button
                    type="button"
                    onClick={() => onCommit({ columns: undefined })}
                    className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-[12px] font-semibold text-blue-300 hover:bg-white/10"
                  >
                    {t("ideaBoard.timetable.resetColumns")}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="px-5 py-8 text-center text-[13px] text-white/40">{t("ideaBoard.timetable.empty")}</div>
      ) : (
        <div className="px-2 pb-2">
          {/* column heads */}
          <div className="grid gap-x-3 px-2 pt-2.5 pb-2 text-[10px] font-semibold uppercase tracking-wider text-white/40" style={grid}>
            {columns.map((c) => (
              <div key={c} className="truncate">
                {colLabel(c)}
              </div>
            ))}
          </div>
          {rows.map((r, i) => (
            <div
              key={r.id}
              className={`grid gap-x-3 items-start rounded-lg px-2 py-2.5 ${i % 2 ? "bg-white/[0.025]" : ""} border-t border-white/[0.06] first:border-t-0`}
              style={grid}
            >
              {columns.map((c) => (
                <Cell key={c} col={c} row={r} placeColor={placeColorOf?.(r.location) ?? null} onGoTo={onGoTo} goToLabel={t("ideaBoard.timetable.goTo")} priorityLabel={r.priority ? t(`priority.${r.priority}` as TranslationKey) : ""} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Cell({
  col,
  row,
  placeColor,
  onGoTo,
  goToLabel,
  priorityLabel,
}: {
  col: TimetableColumn;
  row: TimetableRow;
  placeColor: string | null;
  onGoTo?: (id: string) => void;
  goToLabel: string;
  priorityLabel: string;
}) {
  const base = "min-w-0 text-[13px] leading-snug break-words [overflow-wrap:anywhere]";
  switch (col) {
    case "number":
      return (
        <div className="min-w-0">
          <button
            data-no-drag
            type="button"
            title={goToLabel}
            onClick={() => onGoTo?.(row.id)}
            className="h-7 min-w-7 px-2 rounded-md text-white text-sm font-bold flex items-center justify-center tabular-nums hover:brightness-125"
            style={{ background: PRIORITY_COLORS[row.priority ?? "none"] }}
          >
            {row.number}
          </button>
        </div>
      );
    case "title":
      return <div className={`${base} pt-1 font-semibold text-white/95`}>{row.title}</div>;
    case "group":
      return <div className={`${base} pt-1 text-white/70`}>{row.group}</div>;
    case "start":
      return (
        <div className={`${base} pt-1 font-semibold tabular-nums text-white/95 whitespace-nowrap flex items-center gap-1`}>
          {row.start}
          {row.fixed && row.start && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="text-amber-300 shrink-0">
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
          )}
        </div>
      );
    case "end":
      return (
        <div className={`${base} pt-1 tabular-nums text-white/75 whitespace-nowrap`}>
          {row.end}
          {row.end && row.endNextDay && <span className="ml-0.5 text-[10px] text-amber-300">+1</span>}
        </div>
      );
    case "duration":
      return <div className={`${base} pt-1 tabular-nums text-white/60 whitespace-nowrap`}>{formatDuration(row.duration)}</div>;
    case "location":
      return (
        <div className={`${base} pt-1`}>
          {row.location && (
            <a
              data-no-drag
              href={mapsUrlForAddress(row.location)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-start gap-1.5 text-white/85 hover:text-white"
            >
              <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full" style={{ background: placeColor ?? "rgba(255,255,255,0.4)" }} />
              <span className="min-w-0">{row.location}</span>
            </a>
          )}
        </div>
      );
    case "description":
      return <div className={`${base} pt-1 text-white/65 whitespace-pre-line line-clamp-6`}>{row.description}</div>;
    case "dialogue":
      return (
        <div className={`${base} pt-1 flex flex-col gap-1`}>
          {row.dialogue.map((d, i) => (
            <div key={i} className="italic text-white/80">
              „{d}“
            </div>
          ))}
        </div>
      );
    case "priority":
      return (
        <div className={`${base} pt-1 font-semibold`} style={{ color: row.priority ? PRIORITY_COLORS[row.priority] : undefined }}>
          {priorityLabel}
        </div>
      );
    case "tags":
      return (
        <div className={`${base} pt-0.5 flex flex-wrap gap-1`}>
          {row.tags.map((tag) => (
            <span key={tag} className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/75">
              {tag}
            </span>
          ))}
        </div>
      );
    case "image":
      return (
        <div className="min-w-0">
          {row.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={row.image} alt="" draggable={false} className="w-full aspect-video object-cover rounded-md pointer-events-none select-none" />
          )}
        </div>
      );
  }
}
