import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/cn";

const fieldBase =
  "w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm placeholder:text-white/30 " +
  "focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(fieldBase, props.className)} />;
}

/** 2026-07-30, Lino (Projektinfos-Textfeld auf der Ideenseite): "hier wäre
 * es noch cool wenn sich das Textfenster dem Text anpassen würde, so das
 * man immer den ganzen Text sieht" — opt-in via `autoResize` so every OTHER
 * Textarea caller keeps its normal fixed-`rows` behavior. Height is reset
 * to "auto" before reading scrollHeight on every value change (otherwise a
 * shrinking value would never shrink the box back down, scrollHeight only
 * ever grows against the box's current height). useLayoutEffect (not
 * useEffect) so the resize happens before paint — avoids a visible one-frame
 * flash of the old, wrong height on first mount with existing text. */
export function Textarea({ autoResize, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { autoResize?: boolean }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    if (!autoResize || !ref.current) return;
    ref.current.style.height = "auto";
    ref.current.style.height = `${ref.current.scrollHeight}px`;
  }, [autoResize, props.value]);
  return (
    <textarea
      {...props}
      ref={ref}
      className={cn(fieldBase, "resize-none", autoResize && "overflow-hidden", props.className)}
    />
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-semibold text-white/50 uppercase tracking-wide mb-1.5">{children}</label>;
}

export function FieldGroup({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mb-4", className)}>{children}</div>;
}
