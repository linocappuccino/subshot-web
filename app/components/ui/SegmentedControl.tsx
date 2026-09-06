"use client";

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
  // 2026-08-26 — used to fly the active-highlight pill between options via
  // framer-motion's layoutId; removed with the rest of the app's transition
  // animations, the active pill now just appears instantly.
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
              <div
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
