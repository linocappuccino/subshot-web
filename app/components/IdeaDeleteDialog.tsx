"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useApi } from "@/lib/useApi";
import { useLanguage } from "@/lib/i18n";

/** 2026-10-29, Lino: deleting an idea also deleted its shot-list section with every scene in it
 * («Drehplan Drehtag» vanished that way). The dialog now says how many scenes go with it and offers
 * «Idee löschen, Szenen behalten» (the section stays as it is). Cancel has the focus. Same look as
 * ConfirmDialog. `onConfirm(keepScenes)` does the actual delete at the call site. */
export function IdeaDeleteDialog({
  open,
  ideaId,
  title,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  ideaId: string | null;
  title: string;
  onConfirm: (keepScenes: boolean) => void;
  onCancel: () => void;
}) {
  const api = useApi();
  const { t } = useLanguage();
  const [scenes, setScenes] = useState<number | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open || !ideaId) return;
    let alive = true;
    setScenes(null);
    api
      .ideaDeleteInfo(ideaId)
      .then((r) => alive && setScenes(r.scenes))
      .catch(() => alive && setScenes(-1));
    return () => {
      alive = false;
    };
  }, [open, ideaId, api]);

  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  if (typeof document === "undefined" || !open) return null;
  const message =
    scenes === null
      ? t("ideaDelete.loading")
      : scenes < 0
        ? t("ideaDelete.messageUnknown", { title })
        : t(scenes === 1 ? "ideaDelete.messageOne" : "ideaDelete.message", { title, count: scenes });

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" onKeyDown={(e) => e.key === "Escape" && onCancel()}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-md bg-[#1c1c1e] border border-white/10 rounded-2xl shadow-2xl p-5" role="alertdialog" aria-modal="true">
        <h3 className="font-semibold mb-1.5">{t("ideaGrid.deleteTitle")}</h3>
        <p className="text-sm text-white/60 mb-5">{message}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white/80 bg-white/10 hover:bg-white/15 transition-colors focus:outline-none focus:ring-2 focus:ring-white/40"
          >
            {t("common.cancel")}
          </button>
          {scenes !== null && scenes > 0 && (
            <button
              onClick={() => onConfirm(true)}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-white/10 hover:bg-white/15 transition-colors"
            >
              {t("ideaDelete.keepScenes")}
            </button>
          )}
          <button
            onClick={() => onConfirm(false)}
            disabled={scenes === null}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-500 transition-colors disabled:opacity-50"
          >
            {t("common.delete")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
