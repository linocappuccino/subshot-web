"use client";

/** 2026-10-09, Lino: comments clients leave on the preview pages are at
 * most 100 characters. Same number in the API (CLIENT_COMMENT_MAX). */
export const CLIENT_COMMENT_MAX = 100;

/** "73/100" under a client comment field — shows up once it gets close */
export function CommentLimit({ value, className = "" }: { value: string; className?: string }) {
  const n = value.length;
  if (n < CLIENT_COMMENT_MAX * 0.6) return null;
  return (
    <span className={`block text-right text-[10px] tabular-nums ${n >= CLIENT_COMMENT_MAX ? "text-amber-300" : "text-white/40"} ${className}`}>
      {n}/{CLIENT_COMMENT_MAX}
    </span>
  );
}
