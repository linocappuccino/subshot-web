"use client";

import { Input } from "./Field";

/** Same one-emoji convention as the iOS FolderEditSheet/ProjectEditSheet:
 * trims to the first (extended) grapheme so pasting a run of emoji still
 * only keeps one. `Array.from` splits on Unicode code points, which is
 * enough for the vast majority of single emoji (including most that are
 * multi-code-point, like flags/skin-tone variants, since those combine into
 * one surrogate-pair-aware code point sequence JS treats as connected
 * graphemes in practice for this use case). */
export function EmojiField({ value, onChange }: { value: string; onChange: (emoji: string) => void }) {
  return (
    <Input
      value={value}
      onChange={(e) => {
        const chars = Array.from(e.target.value);
        onChange(chars.length ? chars[chars.length - 1] : "");
      }}
      placeholder="Optional, z.B. 🎬"
      className="text-2xl text-center w-16 py-2"
      maxLength={4}
    />
  );
}
