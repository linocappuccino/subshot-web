"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/app/components/AppShell";
import { Button } from "@/app/components/ui/Button";
import { Textarea } from "@/app/components/ui/Field";
import { Pill } from "@/app/components/ui/Badge";
import { ConfirmDialog } from "@/app/components/ui/ConfirmDialog";
import { useToast } from "@/app/components/ui/Toast";
import { useApi } from "@/lib/useApi";
import { ApiError } from "@/lib/api";
import type { Feedback, FeedbackAdmin, FeedbackStatus } from "@/lib/types";

// Same idea as SUBLI's feedback board (submit, vote, admin approve/status,
// Todoist-backed backlog — see app/main.py's Feedback endpoints) but
// rendered as a plain list here (Lino, 2026-07-14: "nicht so wie bei
// SUBLI"), one unified page instead of a separate admin page — the admin
// controls just appear inline for whoever's email matches ADMIN_EMAIL on
// the backend (any request from someone else gets a 403, so hiding them
// client-side is purely cosmetic, not the actual gate).
const STATUS_LABELS: Record<FeedbackStatus, string> = {
  open: "Offen",
  todo: "Geplant",
  in_progress: "In Arbeit",
  implemented: "Umgesetzt",
  duplicate: "Duplikat",
};

const STATUS_TONE: Record<FeedbackStatus, "default" | "good" | "danger"> = {
  open: "default",
  todo: "default",
  in_progress: "default",
  implemented: "good",
  duplicate: "danger",
};

export default function FeedbackPage() {
  const api = useApi();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [items, setItems] = useState<Feedback[]>([]);
  const [adminItems, setAdminItems] = useState<FeedbackAdmin[]>([]);
  const [showAdmin, setShowAdmin] = useState(false);

  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [blockTarget, setBlockTarget] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    try {
      const list = await api.feedback();
      setItems(list);
      try {
        const pending = await api.feedbackPending();
        setAdminItems(pending);
        setIsAdmin(true);
      } catch {
        setIsAdmin(false);
      }
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Laden fehlgeschlagen.");
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    const value = text.trim();
    if (value.length < 5) {
      toast.showError("Bitte etwas ausführlicher beschreiben (mind. 5 Zeichen).");
      return;
    }
    setSubmitting(true);
    try {
      await api.createFeedback(value);
      setText("");
      toast.showSuccess("Danke für dein Feedback!");
      load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast.showError("Ähnliches Feedback existiert schon — schau in der Liste nach.");
      } else if (e instanceof ApiError && e.status === 429) {
        toast.showError(e.message);
      } else {
        toast.showError(e instanceof ApiError ? e.message : "Senden fehlgeschlagen.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function vote(id: string) {
    // Optimistic — feels instant, and a failed vote is cheap to just re-load on.
    setItems((prev) =>
      prev.map((f) => (f.id === id ? { ...f, user_voted: !f.user_voted, vote_count: f.vote_count + (f.user_voted ? -1 : 1) } : f))
    );
    try {
      await api.voteFeedback(id);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Abstimmen fehlgeschlagen.");
      load();
    }
  }

  async function approve(id: string) {
    try {
      await api.approveFeedback(id);
      load();
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Fehlgeschlagen.");
    }
  }

  async function setStatus(id: string, status: "open" | "todo" | "in_progress" | "implemented" | "reopen") {
    try {
      await api.setFeedbackStatus(id, status);
      load();
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Fehlgeschlagen.");
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await api.deleteFeedback(deleteTarget);
      load();
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Fehlgeschlagen.");
    } finally {
      setDeleteTarget(null);
    }
  }

  async function confirmBlock() {
    if (!blockTarget) return;
    try {
      await api.blockFeedbackUser(blockTarget);
      toast.showSuccess("Nutzer gesperrt.");
      load();
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Fehlgeschlagen.");
    } finally {
      setBlockTarget(null);
    }
  }

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto w-full px-4 sm:px-6 py-8">
        <h1 className="text-xl font-bold mb-1">Feedback</h1>
        <p className="text-sm text-white/50 mb-6">
          Wünsche, Ideen, Bugs — was auch immer Subshot besser machen würde.
        </p>

        <div className="bg-white/[0.035] border border-white/8 rounded-2xl p-4 mb-8">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Was fehlt dir? Was nervt? Was wäre cool?"
            rows={3}
          />
          <div className="flex justify-end mt-3">
            <Button variant="primary" onClick={submit} disabled={submitting || text.trim().length < 5}>
              Absenden
            </Button>
          </div>
        </div>

        {isAdmin && (
          <div className="mb-6">
            <Button variant="ghost" size="sm" onClick={() => setShowAdmin((v) => !v)}>
              {showAdmin ? "Admin-Ansicht ausblenden" : `Admin-Ansicht (${adminItems.filter((f) => !f.approved).length} ungeprüft)`}
            </Button>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-white/40">Lädt…</p>
        ) : showAdmin ? (
          <div className="space-y-3">
            {adminItems.length === 0 && <p className="text-sm text-white/40">Kein Feedback vorhanden.</p>}
            {adminItems.map((f) => (
              <div key={f.id} className="bg-white/[0.035] border border-white/8 rounded-2xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm flex-1">{f.text}</p>
                  <Pill tone={STATUS_TONE[f.status]}>{STATUS_LABELS[f.status]}</Pill>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap mt-3">
                  {!f.approved && (
                    <Button size="sm" variant="primary" onClick={() => approve(f.id)}>
                      Freigeben
                    </Button>
                  )}
                  {(["open", "todo", "in_progress", "implemented"] as const).map((s) => (
                    <Button
                      key={s}
                      size="sm"
                      variant={f.status === s ? "secondary" : "ghost"}
                      onClick={() => setStatus(f.id, s)}
                    >
                      {STATUS_LABELS[s]}
                    </Button>
                  ))}
                  <Button size="sm" variant="ghost" onClick={() => setBlockTarget(f.user_id)}>
                    Nutzer sperren
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setDeleteTarget(f.id)}>
                    Löschen
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {items.length === 0 && <p className="text-sm text-white/40">Noch kein Feedback — sei der Erste!</p>}
            {items.map((f) => (
              <div key={f.id} className="bg-white/[0.035] border border-white/8 rounded-2xl p-4 flex items-start gap-3">
                <button
                  onClick={() => vote(f.id)}
                  className={`shrink-0 flex flex-col items-center justify-center w-12 h-12 rounded-xl border transition-colors ${
                    f.user_voted
                      ? "bg-blue-600/20 border-blue-500/40 text-blue-400"
                      : "bg-white/5 border-white/10 text-white/50 hover:text-white hover:border-white/20"
                  }`}
                  aria-label="Abstimmen"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4l8 9h-5v7H9v-7H4z" /></svg>
                  <span className="text-xs font-semibold mt-0.5">{f.vote_count}</span>
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm">{f.text}</p>
                  {f.status !== "open" && (
                    <div className="mt-2">
                      <Pill tone={STATUS_TONE[f.status]}>{STATUS_LABELS[f.status]}</Pill>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Feedback löschen?"
        message="Das kann nicht rückgängig gemacht werden."
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
      <ConfirmDialog
        open={Boolean(blockTarget)}
        title="Nutzer sperren?"
        message="Dieser Nutzer kann dann kein Feedback mehr einreichen, sein bisheriges Feedback wird ausgeblendet."
        onConfirm={confirmBlock}
        onCancel={() => setBlockTarget(null)}
      />
    </AppShell>
  );
}
