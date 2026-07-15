"use client";

import { useId } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/cn";

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; color?: string }[];
  onChange: (v: T) => void;
}) {
  // 2026-07-15, Lino: selecting an option in one SegmentedControl (e.g.
  // Priorität) made the active-highlight pill visibly fly over to whatever
  // was selected in a COMPLETELY UNRELATED SegmentedControl elsewhere on
  // the same page (e.g. Aufnahme-Art) — framer-motion's layoutId was a
  // hardcoded literal ("segmented-active"), shared by every instance of
  // this component globally, so it treated every SegmentedControl on the
  // page as the SAME logical element and animated one shared pill between
  // all of them. useId() gives each mounted instance its own stable,
  // unique id, scoping the layout animation to just that one control.
  const instanceId = useId();
  return (
    <div className="flex bg-white/5 rounded-xl p-1 gap-1">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className="relative flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors"
          >
            {active && (
              <motion.div
                layoutId={`segmented-active-${instanceId}`}
                transition={{ type: "spring", stiffness: 500, damping: 35 }}
                className="absolute inset-0 rounded-lg"
                style={{ backgroundColor: opt.color ?? "#3875bd" }}
              />
            )}
            <span className={cn("relative z-10", active ? "text-white" : "text-white/60")}>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
