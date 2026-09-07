"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

/** Lightweight dropdown menu (tile context menus, "..." actions) — closes on
 * outside click or Escape, positions itself under the trigger. */
export function Menu({
  trigger,
  children,
  align = "end",
  direction = "down",
  portal = false,
}: {
  trigger: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: "start" | "end";
  /** "up" opens the dropdown above the trigger instead of below — for a
   * trigger fixed near the bottom of the viewport (see the floating "+
   * Hinzufügen" button), where there's no room to open downward. */
  direction?: "down" | "up";
  /** 2026-07-17 (Lino: "beim Emoji auswählen wird das Scrollfenster
   * abgeschnitten") — the dropdown below is plain `position: absolute`
   * inside a `position: relative` wrapper, so any scrollable ancestor
   * (e.g. Modal.tsx's own `overflow-y-auto` body) clips it once it grows
   * past that ancestor's bounds, no matter the z-index. `portal` renders
   * the dropdown into `document.body` instead (`position: fixed`, placed
   * from the trigger's own `getBoundingClientRect()`), escaping any
   * ancestor's overflow — opt-in and defaulted off since most existing
   * Menu triggers (small context-menus) never grow tall enough to hit
   * this, and portaling unconditionally would mean tracking scroll/resize
   * everywhere for no benefit. */
  portal?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  // Clamped top (portal mode only) — rect.bottom + 6 alone can still push a
  // tall dropdown past the bottom of the actual browser viewport (distinct
  // from the original ancestor-overflow clipping bug this whole `portal`
  // path exists to fix — this is just the viewport's own edge). Measured
  // after the dropdown has a real height to clamp against, not guessed.
  const [clampedTop, setClampedTop] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    // 2026-09-07 fix, Lino: in `portal` mode the dropdown renders into
    // document.body (see the createPortal call below), a completely
    // separate DOM subtree from `ref` (which only wraps the trigger). This
    // check used to only look at `ref.current`, so it treated every click
    // INSIDE the portaled dropdown itself as an "outside" click — the
    // dropdown started closing on the very same mousedown that was
    // supposed to pick an option, before the option's own onClick ever got
    // a chance to fire (real symptom: EmojiField's grid, and any other
    // `portal` Menu's MenuItem list, silently doing nothing on click).
    function onClick(e: MouseEvent) {
      const target = e.target as Node;
      const insideTrigger = ref.current?.contains(target) ?? false;
      const insideDropdown = portal && (dropdownRef.current?.contains(target) ?? false);
      if (!insideTrigger && !insideDropdown) setOpen(false);
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

  useEffect(() => {
    if (!open || !portal) return;
    function updateRect() {
      if (ref.current) setRect(ref.current.getBoundingClientRect());
    }
    updateRect();
    window.addEventListener("scroll", updateRect, true);
    window.addEventListener("resize", updateRect);
    return () => {
      window.removeEventListener("scroll", updateRect, true);
      window.removeEventListener("resize", updateRect);
    };
  }, [open, portal]);

  // Runs after the dropdown has actually rendered (with a real height) at
  // its initial rect.bottom + 6 guess — clamps it upward just enough to
  // stay fully inside the viewport if that guess would run it off the
  // bottom edge. useLayoutEffect (not useEffect) so this happens before
  // the browser paints, no visible jump.
  useLayoutEffect(() => {
    if (!open || !portal || !rect || direction === "up") {
      setClampedTop(null);
      return;
    }
    const el = dropdownRef.current;
    if (!el) return;
    // offsetHeight (the CSS layout box), not getBoundingClientRect().height
    // — the dropdown's enter animation is still mid-transform (scale 0.95→1)
    // when this runs (useLayoutEffect fires before paint, right after the
    // initial mount), and getBoundingClientRect() reports the CSS
    // transform's current (shrunk) visual size, undershooting the real
    // height this needs to clamp against.
    const height = el.offsetHeight;
    const naturalTop = rect.bottom + 6;
    const maxTop = window.innerHeight - height - 8;
    setClampedTop(naturalTop > maxTop ? Math.max(8, maxTop) : naturalTop);
  }, [open, portal, rect, direction]);

  const dropdown = (
    <div
      ref={portal ? dropdownRef : undefined}
      style={
        portal && rect
          ? {
              position: "fixed",
              top: direction === "up" ? undefined : (clampedTop ?? rect.bottom + 6),
              bottom: direction === "up" ? window.innerHeight - rect.top + 6 : undefined,
              left: align === "start" ? rect.left : undefined,
              right: align === "end" ? window.innerWidth - rect.right : undefined,
            }
          : undefined
      }
      className={cn(
        "min-w-[160px] rounded-xl bg-[#242426] border border-white/10 shadow-xl py-1 overflow-hidden",
        // 2026-07-17 (Lino: "verschwinden die emoji kachel nun hinter der
        // kachel wo man den projektnamen eingibt") — portal mode moves this
        // to a DIRECT document.body child, sharing the ROOT stacking context
        // with Modal.tsx's own overlay (also a document.body child, at
        // z-50). z-30 loses to that regardless of DOM order once both are
        // fixed-position siblings under body — bump well above every known
        // overlay z-index in this app (Modal z-50, IdeaFocusView z-[70]).
        // Non-portal menus keep z-30 (nested inside whatever they trigger
        // from, never siblings-with-a-modal the same way).
        portal ? cn("fixed", "z-[100]") : cn("z-30 absolute", direction === "up" ? "bottom-full mb-1.5" : "mt-1.5", align === "end" ? "right-0" : "left-0")
      )}
    >
      {children(() => setOpen(false))}
    </div>
  );

  const animated = open && dropdown;

  return (
    // 2026-08-08, real bug Lino spotted: a Menu trigger sitting next to
    // plain <Button>s in a stretch-flex toolbar row (e.g. "PDF" beside
    // "Kommentare"/"Good Takes"/"Teilen" on the Scenes page) rendered 4px
    // SHORTER than its siblings — these two wrapper divs were plain block
    // elements, so while the OUTER one still got stretched to match the
    // row (being the actual flex item), its nested trigger never inherited
    // that height back down to the real <button>, which just sat at its
    // own natural content height inside extra invisible space. `flex`
    // added at both levels (each has exactly one child) lets the standard
    // align-items:stretch default propagate the height all the way down
    // to the trigger itself — harmless for non-stretch-flex Menu usages
    // (icon-only "..." triggers elsewhere), since a block-level flex
    // container's own outer sizing is unchanged, only its child's cross-
    // axis fill behavior is.
    <div className={portal ? "flex" : "relative flex"} ref={ref}>
      <div
        className="flex"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {trigger}
      </div>
      {portal ? (typeof document !== "undefined" ? createPortal(animated, document.body) : null) : animated}
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
