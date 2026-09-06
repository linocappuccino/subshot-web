import type { Scene } from "./types";

/** 2026-07-27 — Scene counterpart of isIdeaFeedbackLocked (ideaFeedbackLock.ts),
 * same "no comment of either kind past send-until-PL-resolves-everything"
 * mechanic ported to the storyboard preview (see Scene.feedback_round's own
 * doc comment in models.py). Unlike an Idea, a Scene has no approved/
 * rejected terminal status — it stays commentable for its whole life, so
 * this only ever gates on the round-lock itself.
 *
 * Mirrors `_scene_feedback_locked` in /opt/subshot/app/main.py — keep both
 * in sync if either changes. */
export function isSceneFeedbackLocked(
  scene: Pick<Scene, "feedback_round" | "round_advance_pending">,
  comments: { status: string; round: number | null }[]
): boolean {
  if (scene.round_advance_pending) return false;
  return comments.some((c) => c.status === "open" && c.round === scene.feedback_round);
}
