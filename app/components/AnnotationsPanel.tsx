"use client";

import { useState } from "react";
import { Modal } from "./ui/Modal";
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

/** Reviewer comments/markups left on the public preview page (2026-07-13),
 * see share_view.py's annotation toolbar for how they're created. This
 * panel is the only place status (open/resolved/rejected) can actually be
 * changed — the preview page itself is read/create-only for annotations,
 * same split as everywhere else reviewers vs. the team have different
 * capabilities on this data. */
export function AnnotationsPanel({
  open,
  onClose,
  annotations,
  onChange,
  scenes,
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
    <Modal open={open} onClose={onClose} title="Kommentare" wide>
      <div className="flex gap-2 mb-3">
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

      {shown.length === 0 && (
        <p className="text-sm text-white/40">
          {filter === "open" ? "Keine offenen Kommentare." : "Noch keine Kommentare vorhanden."}
        </p>
      )}

      <div className="space-y-2">
        {shown.map((a) => {
          const scene = scenes.find((s) => s.id === a.scene_id);
          return (
            <div key={a.id} className="rounded-2xl bg-white/5 border border-white/10 p-3.5">
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
              <div className="flex gap-2 mt-2.5">
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
    </Modal>
  );
}
