import { cn } from "@/lib/cn";

export function Pill({
  icon,
  children,
  tone = "default",
  className,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  tone?: "default" | "good" | "danger";
  className?: string;
}) {
  const tones = {
    default: "bg-white/8 text-white/70",
    good: "bg-emerald-500/15 text-emerald-400",
    danger: "bg-red-500/15 text-red-400",
  };
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap", tones[tone], className)}>
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
