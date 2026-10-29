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

// 2026-10-29, Lino: "kein Text über den Frame der Node hinaus" — the flexible columns may
// shrink to 0 (minmax(0, …fr)), so the table always fits the node's width; long words wrap,
// long texts are clamped (full text on hover / «+ N weitere»).
const COL_WIDTH: Record<TimetableColumn, string> = {
  number: "44px",
  title: "minmax(0, 1.2fr)",
  group: "minmax(0, 1fr)",
  start: "60px",
  end: "64px",
  duration: "64px",
  location: "minmax(0, 1.1fr)",
  description: "minmax(0, 1.8fr)",
  dialogue: "minmax(0, 2.3fr)",
  priority: "minmax(0, 0.7fr)",
  tags: "minmax(0, 0.9fr)",
  image: "minmax(0, 1fr)",
};

/** below this width per column set the table becomes a list of compact cards (no squeezed columns) */
const COL_MIN: Record<TimetableColumn, number> = {
  number: 44, title: 120, group: 100, start: 60, end: 64, duration: 64, location: 110,
  description: 140, dialogue: 170, priority: 70, tags: 80, image: 90,
};

/** dialogue lines shown before «+ N weitere» */
const DIALOGUE_LINES = 3;

/** "Oma: «Was schreisch so ume?»" → {speaker: "Oma", text: "Was schreisch so ume?"} */
export function splitDialogue(line: string): { speaker: string | null; text: string } {
  const m = /^\s*([^:«»"„“\n]{1,32}?)\s*:\s*([\s\S]+)$/.exec(line);
  const speaker = m ? m[1].trim() : null;
  let text = (m ? m[2] : line).trim();
  const pairs: [string, string][] = [["«", "»"], ["„", "“"], ["\"", "\""], ["“", "”"], ["‹", "›"]];
  for (let changed = true; changed; ) {
    changed = false;
    for (const [a, b] of pairs) {
      if (text.length > 1 && text.startsWith(a) && text.endsWith(b)) {
        text = text.slice(a.length, -b.length).trim();
        changed = true;
      }
    }
  }
  return { speaker, text };
}

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
  const [width, setWidth] = useState(el.w);
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
      setWidth(node.offsetWidth);
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
  // too narrow for the chosen columns → compact cards instead of squeezed columns
  const compact = width < columns.reduce((sum, c) => sum + COL_MIN[c] + 12, 32);

  function toggleColumn(c: TimetableColumn) {
    const next = columns.includes(c) ? columns.filter((x) => x !== c) : TIMETABLE_COLUMNS.filter((x) => x === c || columns.includes(x));
    if (next.length) onCommit({ columns: next });
  }

  return (
    <div ref={cardRef} className="rounded-xl bg-[#1d1d1f] border border-white/10 shadow-[0_2px_14px_rgba(0,0,0,0.4)] text-white">
      {/* header */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 px-4 pt-3.5 pb-3 border-b border-white/10">
        <div className="shrink-0 h-8 w-8 rounded-lg bg-blue-500/15 text-blue-300 flex items-center justify-center">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="17" rx="2" />
            <path d="M3 9h18M8 4v17M16 2v4M8 2v4" />
          </svg>
        </div>
        <div className="min-w-[140px] flex-1">
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
          <div className="relative flex flex-wrap items-center gap-1.5 ml-auto">
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
      ) : compact ? (
        <div className="px-2 pb-2 overflow-hidden">
          {rows.map((r, i) => (
            <CompactRow
              key={r.id}
              row={r}
              columns={columns}
              striped={i % 2 === 1}
              placeColor={placeColorOf?.(r.location) ?? null}
              onGoTo={onGoTo}
              goToLabel={t("ideaBoard.timetable.goTo")}
              priorityLabel={r.priority ? t(`priority.${r.priority}` as TranslationKey) : ""}
            />
          ))}
        </div>
      ) : (
        <div className="px-2 pb-2 overflow-hidden">
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
      return <div title={row.title || undefined} className={`${base} pt-1 font-semibold text-white/95 line-clamp-4`}>{row.title}</div>;
    case "group":
      return <div title={row.group || undefined} className={`${base} pt-1 text-white/70 line-clamp-4`}>{row.group}</div>;
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
              title={row.location}
              className="inline-flex max-w-full items-start gap-1.5 text-white/85 hover:text-white"
            >
              <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full" style={{ background: placeColor ?? "rgba(255,255,255,0.4)" }} />
              <span className="min-w-0 line-clamp-3">{row.location}</span>
            </a>
          )}
        </div>
      );
    case "description":
      return (
        <div title={row.description || undefined} className={`${base} pt-1 text-white/65 whitespace-pre-line line-clamp-6`}>
          {row.description}
        </div>
      );
    case "dialogue":
      return <DialogueCell lines={row.dialogue} />;
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

/** 2026-10-29, Lino: "Dialoge übersichtlicher — man kann die einzelnen Dialoge gar nicht
 * auseinanderhalten": one block per line, the speaker as a small label, the text upright,
 * a thin line on the left; after DIALOGUE_LINES lines «+ N weitere». */
function DialogueCell({ lines }: { lines: string[] }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  if (!lines.length) return <div className="min-w-0" />;
  const shown = open ? lines : lines.slice(0, DIALOGUE_LINES);
  const rest = lines.length - shown.length;
  return (
    <div className="min-w-0 pt-0.5 flex flex-col gap-1.5">
      {shown.map((line, i) => {
        const { speaker, text } = splitDialogue(line);
        return (
          <div key={i} title={line} className="min-w-0 border-l-2 border-white/15 pl-2">
            {speaker && (
              <div className="truncate text-[10px] font-bold uppercase tracking-wider text-blue-300/90 leading-tight mb-0.5">{speaker}</div>
            )}
            <div className={`text-[13px] leading-snug text-white/85 break-words [overflow-wrap:anywhere] ${open ? "" : "line-clamp-4"}`}>{text}</div>
          </div>
        );
      })}
      {(rest > 0 || open) && lines.length > DIALOGUE_LINES && (
        <button
          data-no-drag
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="self-start rounded-md bg-white/[0.06] px-2 py-0.5 text-[11px] font-semibold text-white/60 hover:text-white"
        >
          {open ? t("ideaBoard.timetable.dialogueLess") : t("ideaBoard.timetable.dialogueMore", { count: rest })}
        </button>
      )}
    </div>
  );
}

/** narrow Timetable: one compact card per scene — number, title and time on top, then the
 * other chosen columns underneath at full width (2026-10-29) */
function CompactRow({
  row,
  columns,
  striped,
  placeColor,
  onGoTo,
  goToLabel,
  priorityLabel,
}: {
  row: TimetableRow;
  columns: TimetableColumn[];
  striped: boolean;
  placeColor: string | null;
  onGoTo?: (id: string) => void;
  goToLabel: string;
  priorityLabel: string;
}) {
  const has = (c: TimetableColumn) => columns.includes(c);
  const time = [has("start") && row.start, has("end") && row.end && `– ${row.end}${row.endNextDay ? " +1" : ""}`].filter(Boolean).join(" ");
  const duration = has("duration") ? formatDuration(row.duration) : "";
  return (
    <div className={`flex gap-3 rounded-lg px-2 py-2.5 border-t border-white/[0.06] first:border-t-0 ${striped ? "bg-white/[0.025]" : ""}`}>
      {has("number") && <Cell col="number" row={row} placeColor={placeColor} onGoTo={onGoTo} goToLabel={goToLabel} priorityLabel={priorityLabel} />}
      <div className="min-w-0 flex-1 flex flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 pt-1">
          {has("title") && row.title && <span className="min-w-0 text-[13px] font-semibold leading-snug text-white/95 break-words">{row.title}</span>}
          {(time || duration) && (
            <span className="text-[12px] tabular-nums text-white/60 whitespace-nowrap">
              {time && <span className="font-semibold text-white/85">{time}</span>}
              {time && duration && " · "}
              {duration}
            </span>
          )}
        </div>
        {(has("group") || has("location") || has("priority") || has("tags")) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-white/60">
            {has("group") && row.group && <span className="min-w-0 break-words">{row.group}</span>}
            {has("location") && row.location && <Cell col="location" row={row} placeColor={placeColor} goToLabel={goToLabel} priorityLabel={priorityLabel} />}
            {has("priority") && row.priority && <Cell col="priority" row={row} placeColor={placeColor} goToLabel={goToLabel} priorityLabel={priorityLabel} />}
            {has("tags") && row.tags.length > 0 && <Cell col="tags" row={row} placeColor={placeColor} goToLabel={goToLabel} priorityLabel={priorityLabel} />}
          </div>
        )}
        {has("description") && row.description && <Cell col="description" row={row} placeColor={placeColor} goToLabel={goToLabel} priorityLabel={priorityLabel} />}
        {has("dialogue") && row.dialogue.length > 0 && <DialogueCell lines={row.dialogue} />}
        {has("image") && row.image && (
          <div className="w-40 max-w-full">
            <Cell col="image" row={row} placeColor={placeColor} goToLabel={goToLabel} priorityLabel={priorityLabel} />
          </div>
        )}
      </div>
    </div>
  );
}
