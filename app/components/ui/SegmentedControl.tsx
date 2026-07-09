"use client";

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
                layoutId="segmented-active"
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
