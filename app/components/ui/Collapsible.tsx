"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

/** Smooth expand/collapse via the CSS grid-rows 0fr/1fr trick (animates a
 * height that's naturally "auto" without ever measuring pixels in JS) —
 * matches the same technique used on the public share page, and the
 * Reminders-style disclosure sections in the iOS app. */
export function Collapsible({
  title,
  subtitle,
  icon,
  defaultOpen = true,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 py-1.5 text-left group"
      >
        <span
          className="text-white/40 group-hover:text-white/70 transition-transform duration-200 shrink-0"
          style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </span>
        {icon}
        <span className="text-xs font-semibold text-white/50 group-hover:text-white/80 uppercase tracking-wide transition-colors">{title}</span>
        {subtitle && <span className="text-xs text-white/30">{subtitle}</span>}
      </button>
      <div
        className={cn("grid transition-[grid-template-rows] duration-300 ease-out", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}
      >
        <div className="overflow-hidden min-h-0">
          <div className="pt-2 pb-1">{children}</div>
        </div>
      </div>
    </div>
  );
}
