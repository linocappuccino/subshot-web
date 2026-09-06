"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { useLanguage } from "@/lib/i18n";

/** Same role as SceneEditSheet/FolderEditSheet's .sheet(...) on iOS — a
 * modal that slides up from the bottom on narrow screens (reads like a
 * native sheet) and centers as a card on wider ones. One shared component
 * so every editor in the app opens/closes with the same motion instead of
 * each screen inventing its own. */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  const { t } = useLanguage();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  if (!open) return null;

  // z-[80] (2026-07-17, bumped from z-50) — a Modal opened from WITHIN
  // another full-screen overlay (e.g. ImageGeneratePopup on top of
  // IdeaFocusView's z-[70]) needs to render above it, not behind it — a
  // dialog opened from inside another overlay should always win the
  // stacking order. Still comfortably below the portal-mode Menu dropdown's
  // z-[100] (EmojiField etc.), which must stay clickable even when opened
  // from inside a Modal.
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className={cn(
          "relative w-full sm:max-w-lg bg-[#1c1c1e] border border-white/10 shadow-2xl",
          "rounded-t-3xl sm:rounded-3xl max-h-[92vh] sm:max-h-[85vh] flex flex-col",
          wide && "sm:max-w-2xl"
        )}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/8 shrink-0">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-white/50 hover:text-white hover:bg-white/10 transition-colors"
            aria-label={t("modal.closeAria")}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4 flex-1">{children}</div>
        {footer && <div className="px-5 py-4 border-t border-white/8 shrink-0">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
