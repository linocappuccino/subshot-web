"use client";

import { createPortal } from "react-dom";
import { useLanguage } from "@/lib/i18n";

/** Replaces window.confirm() everywhere — a native confirm blocks the whole
 * tab, can't be styled, and reads as a browser warning rather than part of
 * the app (same reasoning the iOS app's showConfirm/showError dialogs were
 * built for, see feedback_no_native_popups).
 *
 * 2026-07-21 — `title`/`message` still come from each call site (dozens of
 * them across the app, delete-project/idea/video/scene/etc — translating
 * ALL of those individually is a much bigger follow-up pass), but the two
 * BUTTON labels are used almost everywhere unchanged, so translating just
 * their defaults here covers most real call sites for free. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = true,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const resolvedConfirmLabel = confirmLabel ?? t("common.delete");
  const resolvedCancelLabel = cancelLabel ?? t("common.cancel");

  if (typeof document === "undefined" || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-sm bg-[#1c1c1e] border border-white/10 rounded-2xl shadow-2xl p-5">
        <h3 className="font-semibold mb-1.5">{title}</h3>
        <p className="text-sm text-white/60 mb-5">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white/70 hover:bg-white/5 transition-colors"
          >
            {resolvedCancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              danger ? "bg-red-600 hover:bg-red-500 text-white" : "bg-blue-600 hover:bg-blue-500 text-white"
            }`}
          >
            {resolvedConfirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
