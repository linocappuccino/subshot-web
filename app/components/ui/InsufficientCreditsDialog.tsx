"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/lib/i18n";

/** Listens for the "subshot:insufficient-credits" event dispatched by
 * lib/api.ts whenever an AI-image-generation request comes back 402 (0
 * Credits, see generate_scene_image_endpoint) and shows ONE centered
 * dialog for it — same pattern as TrialExpiredDialog (not a native
 * alert(), not a toast per attempt), just for the separate AI-Credits
 * balance instead of the Team-trial gate. `shownRef` makes this a true
 * one-shot per page load, same reasoning as TrialExpiredDialog's own. */
export function InsufficientCreditsDialog() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const shownRef = useRef(false);
  const router = useRouter();

  useEffect(() => {
    function onInsufficientCredits() {
      if (shownRef.current) return;
      shownRef.current = true;
      setOpen(true);
    }
    window.addEventListener("subshot:insufficient-credits", onInsufficientCredits);
    return () => window.removeEventListener("subshot:insufficient-credits", onInsufficientCredits);
  }, []);

  if (typeof document === "undefined" || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-sm bg-[#1c1c1e] border border-white/10 rounded-2xl shadow-2xl p-5">
        <h3 className="font-semibold mb-1.5">{t("insufficientCreditsDialog.title")}</h3>
        <p className="text-sm text-white/60 mb-5">
          {t("insufficientCreditsDialog.message")}
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => setOpen(false)}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white/70 hover:bg-white/5 transition-colors"
          >
            {t("insufficientCreditsDialog.later")}
          </button>
          <button
            onClick={() => {
              setOpen(false);
              router.push("/credits");
            }}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors"
          >
            {t("insufficientCreditsDialog.buyCredits")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
