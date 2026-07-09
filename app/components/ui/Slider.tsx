"use client";

import { cn } from "@/lib/cn";

/** Filled-track range input — same 1..N "drag to pick a quantity, price
 * updates live" shape as SUBLI's seat/minute sliders (invest.html), just
 * rebuilt as a React component for this codebase. */
export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  className,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  className?: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className={cn("w-full h-2 rounded-full appearance-none cursor-pointer accent-blue-500", className)}
      style={{
        background: `linear-gradient(to right, #3b82f6 ${pct}%, rgba(255,255,255,0.1) ${pct}%)`,
      }}
    />
  );
}
