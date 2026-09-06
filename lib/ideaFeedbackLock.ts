import type { IdeaPreview } from "./types";

/** 2026-07-26, Todoist #327 (Lino, verbatim): "Drückt man den Feedback
 * senden Button und bestätigt den Dialog, kann man danach KEINE KOMMENTARE
 * mehr auf dieser Ideenkacheln mehr hinterlassen, das kommentarfeld wird
 * dann ausgeblendet. man kann dann auch keine kommentare mehr löschen...
 * Diese logik soll überall gleich sein, über die ganze seite verteilt!"
 *
 * Before this, PublicIdeaLightbox.tsx computed this gate ONCE for the plain
 * IdeaFeedback compose form (`roundClosed`) but the highlight-comment
 * compose form was deliberately kept OUTSIDE it (2026-07-22 unification
 * doc comment: "Textmarker ist IMMER aktiv") — that carve-out is exactly
 * the inconsistency Lino is reporting now that the spec is explicit: NO
 * comment of either kind after send, no exceptions. This is the ONE place
 * that decision lives now, imported by both PublicIdeaLightbox (compose/
 * delete visibility) and preview-ideas/[token]/page.tsx (whether text-
 * selection capture — the entry point INTO a highlight comment — is armed
 * at all), so the two can't drift apart again.
 *
 * Mirrors `_idea_feedback_locked` in /opt/subshot/app/main.py — keep both
 * in sync if either changes (the backend copy additionally guards the
 * create/delete-annotation endpoints against a direct API call bypassing
 * this, since this file only ever governs the UI). */
export function isIdeaFeedbackLocked(
  idea: Pick<IdeaPreview, "status" | "feedback" | "feedback_round" | "round_advance_pending">
): boolean {
  if (idea.status === "approved" || idea.status === "rejected") return true;
  if (idea.round_advance_pending) return false;
  return idea.feedback.some((f) => f.status === "sent" && f.round === idea.feedback_round);
}
