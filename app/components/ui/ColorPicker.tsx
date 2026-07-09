"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/cn";
import { PALETTE } from "@/lib/types";

export function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2.5">
      {PALETTE.map((hex) => {
        const selected = value === hex;
        return (
          <motion.button
            key={hex}
            type="button"
            whileTap={{ scale: 0.88 }}
            onClick={() => onChange(hex)}
            style={{ backgroundColor: hex }}
            className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center ring-2 ring-offset-2 ring-offset-[#1c1c1e] transition-all",
              selected ? "ring-white/60" : "ring-transparent"
            )}
            aria-label={hex}
          >
            {selected && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            )}
          </motion.button>
        );
      })}
    </div>
  );
}
