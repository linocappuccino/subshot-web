/* 2026-11-17, Lino (100-%-Regel) — twin of the server's app/comment_rules.py: «open feedback» = a ROOT comment (not a
   reply) WITH a timecode that is not resolved. The tile's 💬 bubble, the plugin's open_comments and its comment list
   all count exactly this (tests/test_comment_counts.py checks server ⇄ web on every video). */
export type CommentLike = { parent_comment_id?: string | null; timestamp_seconds?: number | null; status?: string | null };

export function isFeedback(c: CommentLike): boolean {
  return !c.parent_comment_id && c.timestamp_seconds !== null && c.timestamp_seconds !== undefined;
}

export function isOpenFeedback(c: CommentLike): boolean {
  return isFeedback(c) && (c.status ?? "open") !== "resolved";
}

export function openFeedbackCount(comments: CommentLike[] | null | undefined): number {
  return (comments ?? []).filter(isOpenFeedback).length;
}
