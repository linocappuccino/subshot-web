"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { useLanguage } from "@/lib/i18n";
import { useClampedPopoverPosition } from "@/lib/useClampedPopoverPosition";

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function daysInMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Custom calendar + time popover, replacing the plain native
 * `<input type="datetime-local">` - that rendered as a bare, inconsistently
 * styled OS control (looks different per browser, jarring against the rest
 * of this app's design) with no room for a nicer date-picking experience.
 *
 * 2026-07-19, real bug found (not a sorting bug, see postproduction's own
 * deadline-sort investigation): `value` used to be required `Date`, so
 * every caller with an optional underlying field (deadline/shoot_date not
 * yet set) passed `new Date()` as a stand-in just to satisfy the type —
 * which this component then happily DISPLAYED as if it were a real,
 * already-set value ("19.07.2026 · 09:37" on a tile with NO deadline at
 * all). Lino kept reporting "the sort order is wrong" when the real issue
 * was that a null deadline LOOKED like a concrete one. `value` is now
 * `Date | null`; `null` shows `placeholder` text instead, and every
 * internal read of `value` falls back to `new Date()` only for CALENDAR
 * NAVIGATION / as the base to build a new picked date from — never for
 * display. */
export function DateTimePicker({
  value, onChange, placeholder, compact,
}: {
  value: Date | null; onChange: (date: Date) => void; placeholder?: string;
  /** 2026-07-22 — renders the trigger as a small icon-only button (clock
   * glyph, tinted blue once a value is set) instead of the default
   * full-width bar. Same popover/calendar underneath either way — for
   * compact contexts like a single todo-item row where the full bar would
   * never fit next to the checkbox/text/assignee icons already there. */
  compact?: boolean;
}) {
  const { t } = useLanguage();
  const resolvedPlaceholder = placeholder ?? t("dateTimePicker.placeholder");
  const WEEKDAYS = [
    t("dateTimePicker.weekdayMon"), t("dateTimePicker.weekdayTue"), t("dateTimePicker.weekdayWed"),
    t("dateTimePicker.weekdayThu"), t("dateTimePicker.weekdayFri"), t("dateTimePicker.weekdaySat"), t("dateTimePicker.weekdaySun"),
  ];
  const MONTHS = [
    t("dateTimePicker.monthJanuary"), t("dateTimePicker.monthFebruary"), t("dateTimePicker.monthMarch"),
    t("dateTimePicker.monthApril"), t("dateTimePicker.monthMay"), t("dateTimePicker.monthJune"),
    t("dateTimePicker.monthJuly"), t("dateTimePicker.monthAugust"), t("dateTimePicker.monthSeptember"),
    t("dateTimePicker.monthOctober"), t("dateTimePicker.monthNovember"), t("dateTimePicker.monthDecember"),
  ];
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(startOfMonth(value ?? new Date()));
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // The popover is portaled straight to <body> (see render below) so it
    // can't get clipped by an ancestor's overflow:hidden - the "Projektinfos"
    // Collapsible section uses exactly that for its expand/collapse
    // animation, which used to crop off the hour/minute row at the bottom
    // of this popover, making it look like time couldn't be set at all.
    // Because of the portal, a click inside the popover no longer lands
    // inside `buttonRef`'s subtree, so outside-click detection has to check
    // both refs, not just the trigger's.
    function onClick(e: MouseEvent) {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    // Capture phase + stopPropagation (2026-07-14, QA-Agent-Fund: Escape
    // schloss das GANZE Szenen-Formular statt nur diesen Kalender-Popover) —
    // Modal.tsx's own Escape handler is a plain bubble-phase document
    // listener with no idea this popover exists. Capture-phase listeners
    // always run before bubble-phase ones on the same target regardless of
    // attach order, so this intercepts Escape and stops it from ever
    // reaching Modal's handler, closing only the popover.
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  function toggleOpen() {
    // Jump the calendar to whatever month the current value is in every
    // time it opens - done here (the actual user action that opens it)
    // rather than in an effect watching `open`, which was flagged as an
    // avoidable synchronous setState-in-effect.
    setViewMonth(startOfMonth(value ?? new Date()));
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setCoords({ top: rect.bottom + 8, left: rect.left, width: rect.width });
    }
    setOpen((v) => !v);
  }

  // 2026-08-07, Lino: "das Datumfeld geht über den Browserrand... man kann
  // es nicht einstellen" — a trigger near the bottom (or right edge, this
  // popover's fixed 300px width can be wider than a `compact` icon
  // trigger) of the viewport used to always open `rect.bottom + 8` down/
  // `rect.left` right with zero regard for where the actual browser window
  // ends. See useClampedPopoverPosition's own doc comment for the fix.
  const clamped = useClampedPopoverPosition(
    open,
    coords ? { top: coords.top, left: coords.left } : null,
    popoverRef
  );

  const firstWeekday = (viewMonth.getDay() + 6) % 7; // Monday-first
  const totalDays = daysInMonth(viewMonth);
  const cells: (Date | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: totalDays }, (_, i) => new Date(viewMonth.getFullYear(), viewMonth.getMonth(), i + 1)),
  ];

  function pickDay(day: Date) {
    const base = value ?? new Date();
    const next = new Date(day);
    next.setHours(base.getHours(), base.getMinutes());
    onChange(next);
  }

  function setHour(h: number) {
    const next = new Date(value ?? new Date());
    next.setHours(h);
    onChange(next);
  }
  function setMinute(m: number) {
    const next = new Date(value ?? new Date());
    next.setMinutes(m);
    onChange(next);
  }

  return (
    <div className="relative">
      {compact ? (
        <button
          ref={buttonRef}
          type="button"
          onClick={toggleOpen}
          title={value ? `${value.toLocaleDateString("de-CH")} · ${value.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })}` : resolvedPlaceholder}
          className={`shrink-0 transition-colors ${value ? "text-blue-400 hover:text-blue-300" : "text-white/25 hover:text-white/60"}`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 3" />
          </svg>
        </button>
      ) : (
        <button
          ref={buttonRef}
          type="button"
          onClick={toggleOpen}
          className="w-full flex items-center gap-2.5 bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm hover:bg-white/8 transition-colors text-left"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-white/40">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
          {value ? (
            <span className="font-medium">
              {value.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" })}
              {" · "}
              {value.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })}
            </span>
          ) : (
            <span className="font-medium text-white/40">{resolvedPlaceholder}</span>
          )}
        </button>
      )}

      {typeof document !== "undefined" && coords && open &&
        createPortal(
          <div
            ref={popoverRef}
            style={{ position: "fixed", top: clamped?.top ?? coords.top, left: clamped?.left ?? coords.left }}
            // 2026-09-07 fix, Lino: "die Datum und Zeit Auswahl liegt nun
            // hinter der Kachel" — Modal.tsx wurde am 2026-07-17 von z-50
            // auf z-[80] angehoben (ein Modal, das aus einem anderen
            // Overlay heraus geöffnet wird, muss darüber gewinnen), dieses
            // hier per z-[60] genutzte Popover aber nie mit angepasst.
            // Jedes Mal, wenn dieser Picker aus dem SceneEditModal (oder
            // jedem anderen Modal) geöffnet wird, rendert er seither
            // unsichtbar/unklickbar HINTER dessen z-[80]-Karte.
            className="z-[90] w-[300px] bg-[#242426] border border-white/10 rounded-2xl shadow-2xl p-4"
          >
            <div className="flex items-center justify-between mb-3">
              <button
                type="button"
                onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}
                className="p-1 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </button>
              <span className="text-sm font-semibold">
                {MONTHS[viewMonth.getMonth()]} {viewMonth.getFullYear()}
              </span>
              <button
                type="button"
                onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}
                className="p-1 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 mb-1">
              {WEEKDAYS.map((w) => (
                <div key={w} className="text-center text-[10px] font-bold text-white/30 py-1">
                  {w}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1 mb-3">
              {cells.map((day, i) => {
                if (!day) return <div key={i} />;
                const selected = value ? sameDay(day, value) : false;
                const today = sameDay(day, new Date());
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => pickDay(day)}
                    className={cn(
                      "aspect-square rounded-lg text-xs font-medium flex items-center justify-center transition-colors relative",
                      selected ? "bg-blue-600 text-white" : today ? "text-blue-400 hover:bg-white/10" : "text-white/75 hover:bg-white/10"
                    )}
                  >
                    {day.getDate()}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2 pt-3 border-t border-white/8">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/40">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 3" />
              </svg>
              <select
                value={(value ?? new Date()).getHours()}
                onChange={(e) => setHour(Number(e.target.value))}
                className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}
                  </option>
                ))}
              </select>
              <span className="text-white/30">:</span>
              <select
                value={(value ?? new Date()).getMinutes() - ((value ?? new Date()).getMinutes() % 5)}
                onChange={(e) => setMinute(Number(e.target.value))}
                className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              >
                {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => (
                  <option key={m} value={m}>
                    {String(m).padStart(2, "0")}
                  </option>
                ))}
              </select>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
