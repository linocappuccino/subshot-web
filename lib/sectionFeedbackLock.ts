import type { Section } from "./types";

/** 2026-08-31, Todoist #96 — Section counterpart of isSceneFeedbackLocked
 * (sceneFeedbackLock.ts), same "no comment past send-until-PL-resolves-
 * everything" mechanic, ported to the storyboard preview's new per-section
 * comment thread (see Section.feedback_round's own doc comment in
 * models.py). A Section has no approved/rejected terminal status either —
 * it stays commentable for its whole life, so this only ever gates on the
 * round-lock itself.
 *
 * Mirrors `_section_feedback_locked` in /opt/subshot/app/main.py — keep
 * both in sync if either changes. */
export function isSectionFeedbackLocked(
  section: Pick<Section, "feedback_round" | "round_advance_pending">,
  comments: { status: string; round: number | null }[]
): boolean {
  if (section.round_advance_pending) return false;
  return comments.some((c) => c.status === "open" && c.round === section.feedback_round);
}
