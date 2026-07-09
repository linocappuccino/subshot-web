import { cn } from "@/lib/cn";

/** Same fallback rule as the iOS app's MemberAvatar: real profile photo if
 * Clerk/Google/Apple gave us one, otherwise colored initials (deterministic
 * per-name hash) so every person still reads as visually distinct. */
function stableColor(seed: string): string {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 42%)`;
}

export function Avatar({
  name,
  email,
  avatarUrl,
  size = 28,
  className,
}: {
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const label = name || email || "?";
  const initials = label
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={label}
        style={{ width: size, height: size }}
        className={cn("rounded-full object-cover shrink-0", className)}
      />
    );
  }

  return (
    <div
      style={{ width: size, height: size, background: stableColor(label), fontSize: size * 0.4 }}
      className={cn("rounded-full flex items-center justify-center font-bold text-white shrink-0", className)}
    >
      {initials}
    </div>
  );
}
