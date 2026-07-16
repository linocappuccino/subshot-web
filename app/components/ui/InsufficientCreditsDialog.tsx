"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

/** Listens for the "subshot:insufficient-credits" event dispatched by
 * lib/api.ts whenever an AI-image-generation request comes back 402 (0
 * Credits, see generate_scene_image_endpoint) and shows ONE centered
 * dialog for it — same pattern as TrialExpiredDialog (not a native
 * alert(), not a toast per attempt), just for the separate AI-Credits
 * balance instead of the Team-trial gate. `shownRef` makes this a true
 * one-shot per page load, same reasoning as TrialExpiredDialog's own. */
export function InsufficientCreditsDialog() {
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

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={{ type: "spring", stiffness: 420, damping: 28 }}
            className="relative w-full max-w-sm bg-[#1c1c1e] border border-white/10 rounded-2xl shadow-2xl p-5"
          >
            <h3 className="font-semibold mb-1.5">Keine Credits mehr</h3>
            <p className="text-sm text-white/60 mb-5">
              Du hast keine AI Credits mehr übrig, um ein Bild zu generieren. Lade Credits nach, um weiterzumachen.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white/70 hover:bg-white/5 transition-colors"
              >
                Später
              </button>
              <button
                onClick={() => {
                  setOpen(false);
                  router.push("/credits");
                }}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors"
              >
                Credits kaufen
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
