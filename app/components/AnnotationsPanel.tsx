"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Pill } from "./ui/Badge";
import { useApi } from "@/lib/useApi";
import { ApiError } from "@/lib/api";
import { useToast } from "./ui/Toast";
import type { Annotation, Scene } from "@/lib/types";

const STATUS_LABELS: Record<Annotation["status"], string> = {
  open: "Offen",
  resolved: "Erledigt",
  rejected: "Abgelehnt",
};
const STATUS_TONES: Record<Annotation["status"], "default" | "good" | "danger"> = {
  open: "default",
  resolved: "good",
  rejected: "danger",
};

function sceneLabel(scene: Scene | undefined): string {
  if (!scene) return "";
  return `Szene ${scene.number}${scene.letter || ""}`;
}

/** Reviewer comments/markups (2026-07-13 on the public preview page, now
 * also here in the logged-in app — 2026-07-14, Lino: "soll rechts am
 * browserrand die leiste mit den kommentaren sein... die markierungen
 * sollen auf der seite gezeigt werden... klickt man auf eine kommentar in
 * der leiste wird die markierung auf der seite gehighlighted"). A
 * right-docked panel rather than a centered Modal — no backdrop, since the
 * whole point is to keep interacting with the page (clicking a markup
 * directly) WHILE this is open, not block it. Only closes via its own ×
 * or re-toggling the "Kommentare" button, never click-outside (that would
 * fire on every markup click). */
export function AnnotationsPanel({
  open,
  onClose,
  annotations,
  onChange,
  scenes,
  highlightedAnnotationId,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  /** Owned by the project page (fetched alongside project/members, kept
   * fresh by the same 12s poll) — this panel is a view + status-mutator
   * over that shared state, not its own data source, so the toolbar
   * badge count and the panel's list never disagree. */
  annotations: Annotation[];
  onChange: (updater: (annotations: Annotation[]) => Annotation[]) => void;
  scenes: Scene[];
  highlightedAnnotationId?: string | null;
  /** Pulses the matching markup on the page and scrolls it into view —
   * see page.tsx's handleAnnotationSelect. */
  onSelect?: (annotation: Annotation) => void;
}) {
  const api = useApi();
  const toast = useToast();
  const [filter, setFilter] = useState<"open" | "all">("open");

  async function setStatus(annotation: Annotation, status: Annotation["status"]) {
    try {
      const updated = await api.patchAnnotation(annotation.id, status);
      onChange((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Status konnte nicht geändert werden.");
    }
  }

  const sorted = [...annotations].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  const shown = filter === "open" ? sorted.filter((a) => a.status === "open") : sorted;
  const openCount = annotations.filter((a) => a.status === "open").length;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          // Widened 320px -> 380px (2026-07-15, Lino: "kann ein wenig
          // breiter sein, dann kann man das ganze ein bisschen besser
          // lesen") — the slide-in/out x offset has to match the width,
          // or the panel would sit partially on-screen at its "closed"
          // starting position instead of fully off the right edge.
          initial={{ x: 380, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 380, opacity: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 34 }}
          className="fixed right-0 top-0 bottom-0 z-40 w-[380px] max-w-[90vw] bg-[#1c1c1e] border-l border-white/10 shadow-2xl flex flex-col"
        >
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/8 shrink-0">
            <h2 className="text-sm font-semibold">Kommentare</h2>
            <button
              onClick={onClose}
              className="rounded-full p-1.5 text-white/50 hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Schließen"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex gap-2 px-4 pt-3">
            <button
              onClick={() => setFilter("open")}
              className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                filter === "open" ? "bg-white/15 text-white" : "text-white/40 hover:text-white/70"
              }`}
            >
              Offen ({openCount})
            </button>
            <button
              onClick={() => setFilter("all")}
              className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                filter === "all" ? "bg-white/15 text-white" : "text-white/40 hover:text-white/70"
              }`}
            >
              Alle ({annotations.length})
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {shown.length === 0 && (
              <p className="text-sm text-white/40">
                {filter === "open" ? "Keine offenen Kommentare." : "Noch keine Kommentare vorhanden."}
              </p>
            )}
            {shown.map((a) => {
              const scene = scenes.find((s) => s.id === a.scene_id);
              return (
                <div
                  key={a.id}
                  onClick={() => onSelect?.(a)}
                  className={`rounded-2xl bg-white/5 border p-3.5 cursor-pointer transition-colors hover:bg-white/[0.08] ${
                    highlightedAnnotationId === a.id ? "border-blue-500/60 bg-blue-500/[0.08]" : "border-white/10"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <span className="text-sm font-medium truncate">{a.author_name}</span>
                      <Pill tone="default">{a.kind === "pen" ? "✏️ Skizze" : "„ “ Textmarkierung"}</Pill>
                      {scene && <Pill tone="default">{sceneLabel(scene)}</Pill>}
                      <Pill tone={STATUS_TONES[a.status]}>{STATUS_LABELS[a.status]}</Pill>
                    </div>
                    <span className="text-[11px] text-white/30 shrink-0">
                      {new Date(a.created_at).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                    </span>
                  </div>
                  {a.text && <p className="text-xs text-white/50 italic mb-1 break-words">„{a.text}“</p>}
                  {a.comment && <p className="text-sm text-white/85 break-words">{a.comment}</p>}
                  <div className="flex gap-2 mt-2.5" onClick={(e) => e.stopPropagation()}>
                    {a.status !== "resolved" && (
                      <button
                        onClick={() => setStatus(a, "resolved")}
                        className="text-xs font-medium text-emerald-400 hover:text-emerald-300 transition-colors"
                      >
                        Erledigt
                      </button>
                    )}
                    {a.status !== "rejected" && (
                      <button
                        onClick={() => setStatus(a, "rejected")}
                        className="text-xs font-medium text-red-400/80 hover:text-red-400 transition-colors"
                      >
                        Ablehnen
                      </button>
                    )}
                    {a.status !== "open" && (
                      <button
                        onClick={() => setStatus(a, "open")}
                        className="text-xs font-medium text-white/40 hover:text-white/70 transition-colors"
                      >
                        Wieder öffnen
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
