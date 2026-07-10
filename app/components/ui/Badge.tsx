import { cn } from "@/lib/cn";

export function Pill({
  icon,
  children,
  tone = "default",
  wrap = false,
  className,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  tone?: "default" | "good" | "danger";
  /** Long unbreakable content (e.g. a street address) would otherwise stay
   * on one line and overflow past the card's right padding — set this to
   * let it wrap onto multiple lines instead, same as any other text. */
  wrap?: boolean;
  className?: string;
}) {
  const tones = {
    default: "bg-white/8 text-white/70",
    good: "bg-emerald-500/15 text-emerald-400",
    danger: "bg-red-500/15 text-red-400",
  };
  return (
    <span
      className={cn(
        "inline-flex gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium max-w-full",
        wrap ? "items-start whitespace-normal break-words" : "items-center whitespace-nowrap",
        tones[tone],
        className
      )}
    >
      {icon}
      {children}
    </span>
  );
}

export function ColorBadge({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold text-white whitespace-nowrap"
      style={{ backgroundColor: color }}
    >
      {label}
    </span>
  );
}
