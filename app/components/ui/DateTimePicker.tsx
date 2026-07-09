"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/cn";

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MONTHS = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

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
 * of this app's design) with no room for a nicer date-picking experience. */
export function DateTimePicker({ value, onChange }: { value: Date; onChange: (date: Date) => void }) {
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(startOfMonth(value));
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
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  function toggleOpen() {
    // Jump the calendar to whatever month the current value is in every
    // time it opens - done here (the actual user action that opens it)
    // rather than in an effect watching `open`, which was flagged as an
    // avoidable synchronous setState-in-effect.
    setViewMonth(startOfMonth(value));
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setCoords({ top: rect.bottom + 8, left: rect.left, width: rect.width });
    }
    setOpen((v) => !v);
  }

  const firstWeekday = (viewMonth.getDay() + 6) % 7; // Monday-first
  const totalDays = daysInMonth(viewMonth);
  const cells: (Date | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: totalDays }, (_, i) => new Date(viewMonth.getFullYear(), viewMonth.getMonth(), i + 1)),
  ];

  function pickDay(day: Date) {
    const next = new Date(day);
    next.setHours(value.getHours(), value.getMinutes());
    onChange(next);
  }

  function setHour(h: number) {
    const next = new Date(value);
    next.setHours(h);
    onChange(next);
  }
  function setMinute(m: number) {
    const next = new Date(value);
    next.setMinutes(m);
    onChange(next);
  }

  return (
    <div className="relative">
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
        <span className="font-medium">
          {value.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" })}
          {" · "}
          {value.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })}
        </span>
      </button>

      {typeof document !== "undefined" && coords &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.div
                ref={popoverRef}
                initial={{ opacity: 0, scale: 0.96, y: -6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: -6 }}
                transition={{ type: "spring", stiffness: 420, damping: 30 }}
                style={{ position: "fixed", top: coords.top, left: coords.left }}
                className="z-[60] w-[300px] bg-[#242426] border border-white/10 rounded-2xl shadow-2xl p-4"
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
                const selected = sameDay(day, value);
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
                value={value.getHours()}
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
                value={value.getMinutes() - (value.getMinutes() % 5)}
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
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </div>
  );
}
