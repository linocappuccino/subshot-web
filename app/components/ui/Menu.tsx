"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/** Lightweight dropdown menu (tile context menus, "..." actions) — closes on
 * outside click or Escape, positions itself under the trigger. */
export function Menu({
  trigger,
  children,
  align = "end",
  direction = "down",
}: {
  trigger: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: "start" | "end";
  /** "up" opens the dropdown above the trigger instead of below — for a
   * trigger fixed near the bottom of the viewport (see the floating "+
   * Hinzufügen" button), where there's no room to open downward. */
  direction?: "down" | "up";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <div
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {trigger}
      </div>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: direction === "up" ? 4 : -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: direction === "up" ? 4 : -4 }}
            transition={{ duration: 0.12 }}
            className={cn(
              "absolute z-30 min-w-[160px] rounded-xl bg-[#242426] border border-white/10 shadow-xl py-1 overflow-hidden",
              direction === "up" ? "bottom-full mb-1.5" : "mt-1.5",
              align === "end" ? "right-0" : "left-0"
            )}
          >
            {children(() => setOpen(false))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "w-full text-left px-3.5 py-2 text-sm flex items-center gap-2 transition-colors",
        danger ? "text-red-400 hover:bg-red-500/10" : "text-white/85 hover:bg-white/8"
      )}
    >
      {children}
    </button>
  );
}
