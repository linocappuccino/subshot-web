"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

/** Listens for the "subshot:trial-expired" event dispatched by lib/api.ts
 * whenever a write request comes back 402 (trial over, no active Team seat)
 * and shows ONE centered dialog for it — not a native alert() (see
 * feedback_no_native_popups) and not a toast per failed request, since a
 * field like LocationPicker fires one request per keystroke and would
 * otherwise spam a new toast on every character typed. `shownRef` makes
 * this a true one-shot per page load: further 402s (e.g. still typing)
 * don't reopen it if the user dismissed it already. */
export function TrialExpiredDialog() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const shownRef = useRef(false);
  const router = useRouter();

  useEffect(() => {
    function onExpired(e: Event) {
      if (shownRef.current) return;
      shownRef.current = true;
      setMessage((e as CustomEvent<string>).detail || "Deine Gratiswoche ist abgelaufen.");
      setOpen(true);
    }
    window.addEventListener("subshot:trial-expired", onExpired);
    return () => window.removeEventListener("subshot:trial-expired", onExpired);
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
            <h3 className="font-semibold mb-1.5">Gratiswoche abgelaufen</h3>
            <p className="text-sm text-white/60 mb-5">{message}</p>
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
                  router.push("/team");
                }}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors"
              >
                Team-Abo abschliessen
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
