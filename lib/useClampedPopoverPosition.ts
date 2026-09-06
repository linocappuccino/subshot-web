"use client";

import { useLayoutEffect, useState } from "react";

/** 2026-08-07, Lino: "das Datumfeld geht über den Browserrand... man kann
 * es nicht einstellen" — a `position: fixed` popover positioned purely
 * from its trigger's own `getBoundingClientRect()` (the pattern every
 * custom dropdown in this app uses to escape ancestor `overflow:hidden`
 * clipping, see DateTimePicker/LocationPicker's own doc comments) has no
 * idea where the actual BROWSER VIEWPORT ends — a trigger near the bottom
 * or right edge of the screen (e.g. a Postproduction video tile in the
 * last row) renders the popover partly or fully off-screen, unreachable.
 *
 * `Menu.tsx`'s `portal` mode already solved exactly this for its own
 * dropdown (vertical only) — this hook generalizes that same
 * measure-after-mount-then-clamp approach (not a static estimate: content
 * height/width can vary) so every other custom popover in the app can
 * share it instead of re-deriving the same fix. Runs in a
 * `useLayoutEffect` (before paint, no visible jump) using `offsetWidth`/
 * `offsetHeight` (the real CSS layout box) rather than
 * `getBoundingClientRect()`, which under-reports size while a
 * scale-in enter animation is still mid-transform right after mount.
 *
 * Pass `null` for `naturalLeft` if the popover's width is already matched
 * to its trigger's width (as LocationPicker's is) — a same-width popover
 * anchored at the same left edge as an on-screen trigger can never overflow
 * horizontally, so there's nothing to clamp. */
export function useClampedPopoverPosition(
  open: boolean,
  natural: { top: number; left: number | null } | null,
  elementRef: React.RefObject<HTMLElement | null>,
  margin = 8
): { top: number; left: number | null } | null {
  const [clamped, setClamped] = useState<{ top: number; left: number | null } | null>(null);

  useLayoutEffect(() => {
    if (!open || !natural) {
      setClamped(null);
      return;
    }
    const el = elementRef.current;
    if (!el) return;
    const maxTop = window.innerHeight - el.offsetHeight - margin;
    const top = natural.top > maxTop ? Math.max(margin, maxTop) : natural.top;
    let left = natural.left;
    if (left != null) {
      const maxLeft = window.innerWidth - el.offsetWidth - margin;
      left = left > maxLeft ? Math.max(margin, maxLeft) : left;
    }
    setClamped({ top, left });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, natural?.top, natural?.left, margin]);

  return clamped;
}
