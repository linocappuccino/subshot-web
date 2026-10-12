"use client";

import { cn } from "@/lib/cn";
import { shortPlace } from "@/lib/shotlistPlaces";

// 2026-10-12, Lino: a scene's place "ausgeschrieben", in the place's own colour, "braucht auch irgend
// ein symbol wie 📍" — a pin tinted in that colour. Used on the scene cards and in the Drehorte window.
// Same day: "die location mit der ganzen adresse anzeigen ... wenn man auf die adresse klickt sich
// google maps mit der adresse öffnet ... aber irgendwie muss man dann auch die adresse noch ändern
// können" — `full` shows the whole address, `href` makes it a Google Maps link, `trailing` is the
// separate "change" control at the end of the pill.

export function PinGlyph({ color, size = 13 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <path d="M12 2.5c-4.1 0-7.25 3.1-7.25 7.1 0 5.1 6.2 11.2 6.47 11.46a1.1 1.1 0 0 0 1.56 0c.27-.26 6.47-6.36 6.47-11.46 0-4-3.15-7.1-7.25-7.1Z" fill={color} />
      <circle cx="12" cy="9.6" r="2.6" fill="rgba(0,0,0,0.45)" />
    </svg>
  );
}

export function mapsUrlForAddress(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

export function PlacePill({
  address,
  color,
  emptyLabel,
  muted,
  size = "sm",
  full,
  href,
  trailing,
}: {
  address: string | null;
  color: string | null;
  emptyLabel?: string;
  /** the scene follows the shotlist's default place (no own location) */
  muted?: boolean;
  size?: "xs" | "sm" | "md";
  /** the whole address (wraps at commas) instead of just its first part */
  full?: boolean;
  /** the address becomes a link (Google Maps), opened in a new tab */
  href?: string;
  /** a separate control at the end of the pill (e.g. the "change place" menu) */
  trailing?: React.ReactNode;
}) {
  const c = address && color ? color : "rgba(255,255,255,0.35)";
  const text = address ? (full ? address : shortPlace(address)) : emptyLabel;
  const pad = size === "md" ? "py-1.5 pl-2.5 text-[14px]" : size === "sm" ? "py-1 pl-2 text-[13px]" : "py-[3px] pl-1.5 text-[11px]";
  const padR = trailing ? "pr-1.5" : size === "md" ? "pr-3.5" : size === "sm" ? "pr-3" : "pr-2.5";
  const label = (
    <>
      <PinGlyph color={c} size={size === "xs" ? 11 : 13} />
      <span className={cn(full ? "min-w-0 break-words [overflow-wrap:anywhere]" : "max-w-[220px] truncate", muted && "opacity-75")}>
        {full && address
          ? address.split(",").map((part, i, all) => (
              <span key={i}>
                {part}
                {i < all.length - 1 && (
                  <>
                    ,<wbr />
                  </>
                )}
              </span>
            ))
          : text}
      </span>
    </>
  );
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 font-medium tracking-[-0.01em]",
        full ? "rounded-xl text-left" : "whitespace-nowrap rounded-full",
        pad,
        padR,
        address ? "text-white" : "text-white/45"
      )}
      style={address && color ? { background: `${color}24`, boxShadow: `inset 0 0 0 1px ${color}55` } : { background: "rgba(255,255,255,0.06)" }}
    >
      {href && address ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          title={`${address} – Google Maps`}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className="flex min-w-0 items-center gap-1.5 hover:underline decoration-white/40 underline-offset-2"
        >
          {label}
        </a>
      ) : (
        <span className="flex min-w-0 items-center gap-1.5">{label}</span>
      )}
      {trailing && (
        <span className="ml-0.5 flex shrink-0 items-center border-l border-white/15 pl-1" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
          {trailing}
        </span>
      )}
    </span>
  );
}

/** the small "change" chevron used as `trailing` */
export function PlaceChangeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
