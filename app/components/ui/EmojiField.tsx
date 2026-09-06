"use client";

import { useMemo, useState } from "react";
import { Menu } from "./Menu";
import { useLanguage, type TranslationKey } from "@/lib/i18n";
import rawEmojiData from "@/lib/emojiData.json";

/** There's no cross-browser API to open the OS emoji keyboard
 * programmatically, and the earlier version of this component relied on
 * that (focus a hidden input, hope the person knows their OS emoji
 * shortcut) — from the outside that just looked like "the plus button does
 * nothing" since focusing an empty input has no visible effect on desktop.
 * An actual in-app grid is the only reliable fix.
 *
 * 2026-07-19, Lino: "es soll ALLE Apple emojis geben" + a Mac-style search
 * field — the old hand-picked ~800-emoji set (mirrored from the iOS app's
 * EmojiPickerField.swift) was missing a lot and had no name data to search
 * by. First pass used `unicode-emoji-json` (English names only) — Lino
 * then searched "Zahn" for 🦷, found nothing, and correctly called that
 * out as still-missing emojis even though 🦷 WAS in the dataset (the
 * search just couldn't find it, an English-only limitation flagged but
 * wrongly accepted at the time). Replaced with `emojibase-data`'s German
 * locale (see scripts/generate-emoji-data.mjs, run manually to regenerate
 * lib/emojiData.json) — real German names AND keyword tags per emoji
 * (🦷's tags include "zahnarzt"/"zähne"/"perlweiß"), source data trimmed
 * from ~800KB to ~230KB (drops the skins/hexcode/emoticon fields this app
 * doesn't use). Same 1914-entry base-only scope as before (component-swatch
 * and bare-regional-indicator entries excluded in the generator, no
 * skin-tone/gender variants — Lino's explicit choice). The old hand-curated
 * "Film & Projekt" quick-access row is kept pinned at the top since those
 * are Lino's actual most-used picks for this app. */
type EmojiEntry = { emoji: string; name: string; tags: string[] };
type RawEmoji = { emoji: string; name: string; tags: string[]; group: number };
const RAW_EMOJIS = rawEmojiData as RawEmoji[];

const GROUP_LABEL_KEYS: Record<number, TranslationKey> = {
  0: "emojiField.groupSmileys",
  1: "emojiField.groupPeople",
  3: "emojiField.groupNature",
  4: "emojiField.groupFood",
  5: "emojiField.groupTravel",
  6: "emojiField.groupActivity",
  7: "emojiField.groupObjects",
  8: "emojiField.groupSymbols",
  9: "emojiField.groupFlags",
};
const GROUP_ORDER = [0, 1, 3, 4, 5, 6, 7, 8, 9];

const FILM_PROJEKT_EMOJIS = [
  "🎬", "🎥", "📹", "🎞️", "📽️", "🎙️", "🎧", "🎵", "🎶", "📝", "📋",
  "📌", "📍", "🗓️", "📅", "⏰", "⏱️", "⭐️", "🔥", "💡", "🎯", "✅",
  "🚀", "🏆", "🎉", "✨", "🎭", "🖼️", "📸", "📷", "🎨", "🎤", "📺",
  "💻", "🖥️", "🎮", "📀", "💾", "🔊", "🔦", "🎇", "🎆",
];

const ALL_EMOJIS: EmojiEntry[] = RAW_EMOJIS.map((e) => ({ emoji: e.emoji, name: e.name, tags: e.tags }));
const BY_CHAR = new Map(ALL_EMOJIS.map((e) => [e.emoji, e]));

function buildEmojiCategories(t: (key: TranslationKey) => string): { name: string; emojis: EmojiEntry[] }[] {
  const fallback = (e: string): EmojiEntry => BY_CHAR.get(e) ?? { emoji: e, name: e, tags: [] };
  const categories: { name: string; emojis: EmojiEntry[] }[] = [
    { name: t("emojiField.filmProject"), emojis: FILM_PROJEKT_EMOJIS.map(fallback) },
  ];
  for (const group of GROUP_ORDER) {
    const emojis = RAW_EMOJIS.filter((e) => e.group === group).map((e) => ({ emoji: e.emoji, name: e.name, tags: e.tags }));
    categories.push({ name: t(GROUP_LABEL_KEYS[group]), emojis });
  }
  return categories;
}

/** Same one-emoji convention as the iOS FolderEditSheet/ProjectEditSheet.
 * Round tile — dashed "+" when empty, the emoji itself once set, with a
 * small "x" badge to clear it. Clicking opens a small in-app grid (via the
 * shared Menu component — reused for its click-outside/positioning, not for
 * its usual MenuItem list styling) instead of relying on an invisible
 * focused input. */
export function EmojiField({ value, onChange }: { value: string; onChange: (emoji: string) => void }) {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const EMOJI_CATEGORIES = useMemo(() => buildEmojiCategories(t), [t]);
  const q = query.trim().toLowerCase();
  const searchResults = useMemo(() => {
    if (!q) return null;
    return ALL_EMOJIS.filter((e) => e.name.toLowerCase().includes(q) || e.tags.some((t) => t.toLowerCase().includes(q)));
  }, [q]);

  return (
    <div className="relative inline-block w-12 h-12">
      <Menu
        align="start"
        portal
        trigger={
          <button
            type="button"
            aria-label={t("emojiField.selectAria")}
            className="w-12 h-12 rounded-full border-2 border-dashed border-white/20 bg-white/5 flex items-center justify-center text-2xl leading-none hover:border-white/40 transition-colors"
          >
            {value || (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/40">
                <path d="M12 5v14M5 12h14" />
              </svg>
            )}
          </button>
        }
      >
        {(close) => (
          // Vertically scrolling, grouped by category (Lino: "einfach wenn
          // sich die Emoji auswahl öffnet nach unten scrollen können") —
          // capped height so the popover itself never grows off-screen. A
          // search input up top (2026-07-19, "wie beim mac") switches to a
          // flat filtered grid instead of the grouped view while non-empty.
          <div className="w-[280px] p-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("emojiField.searchPlaceholder")}
              autoFocus
              className="w-full mb-2 px-2.5 py-1.5 rounded-lg bg-white/10 text-sm text-white placeholder:text-white/30 border border-white/10 focus:outline-none focus:border-white/30 transition-colors"
            />
            <div className="max-h-[280px] overflow-y-auto">
              {searchResults ? (
                searchResults.length > 0 ? (
                  <div className="grid grid-cols-8 gap-0.5">
                    {searchResults.map((entry, i) => (
                      <EmojiButton key={`${entry.emoji}-${i}`} entry={entry} onPick={() => { onChange(entry.emoji); close(); }} />
                    ))}
                  </div>
                ) : (
                  <div className="py-6 text-center text-xs text-white/30">{t("emojiField.noResults")}</div>
                )
              ) : (
                EMOJI_CATEGORIES.map((category) => (
                  <div key={category.name} className="mb-2 last:mb-0">
                    <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-white/30">{category.name}</div>
                    <div className="grid grid-cols-8 gap-0.5">
                      {category.emojis.map((entry, i) => (
                        <EmojiButton key={`${entry.emoji}-${i}`} entry={entry} onPick={() => { onChange(entry.emoji); close(); }} />
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </Menu>
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={t("emojiField.removeAria")}
          className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-black/70 text-white text-xs leading-none flex items-center justify-center hover:bg-red-500 transition-colors"
        >
          ×
        </button>
      )}
    </div>
  );
}

function EmojiButton({ entry, onPick }: { entry: EmojiEntry; onPick: () => void }) {
  return (
    <button
      type="button"
      title={entry.name}
      onClick={onPick}
      className="w-8 h-8 rounded-lg text-lg flex items-center justify-center hover:bg-white/10 transition-colors"
    >
      {entry.emoji}
    </button>
  );
}
