"use client";

/** 2026-11-23, Lino: «reinklicken und das fungiert direkt als Emoji-Suche … ohne Eingabe durch alle Emojis scrollen».
 * A built-in emoji picker: search (German + English words), all emojis by category when nothing is typed, recently
 * used ones on top. No system emoji keyboard needed, works with touch. The emoji list (lib/emojiIndex.json, built by
 * scripts/build_emoji_index.mjs from emojibase-data) is a separate chunk, loaded only when the picker opens. */

import { useEffect, useMemo, useRef, useState } from "react";
import { useLanguage } from "@/lib/i18n";

import { searchEmojis, type EmojiRow as Row } from "@/lib/emojiSearch";

const GROUPS: { id: number; icon: string; de: string; en: string }[] = [
  { id: 0, icon: "😀", de: "Smileys", en: "Smileys" },
  { id: 1, icon: "🧑", de: "Personen", en: "People" },
  { id: 3, icon: "🐶", de: "Tiere & Natur", en: "Animals & nature" },
  { id: 4, icon: "🍔", de: "Essen", en: "Food" },
  { id: 5, icon: "✈️", de: "Reisen & Orte", en: "Travel & places" },
  { id: 6, icon: "⚽", de: "Aktivitäten", en: "Activities" },
  { id: 7, icon: "💡", de: "Objekte", en: "Objects" },
  { id: 8, icon: "❤️", de: "Symbole", en: "Symbols" },
  { id: 9, icon: "🏳️", de: "Flaggen", en: "Flags" },
];
const RECENT_KEY = "subshot:recentEmojis";

let cache: Row[] | null = null;
export async function loadEmojiIndex(): Promise<Row[]> {
  if (!cache) cache = (await import("@/lib/emojiIndex.json")).default as unknown as Row[];
  return cache;
}

function readRecent(): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 24) : [];
  } catch {
    return [];
  }
}
function pushRecent(e: string) {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify([e, ...readRecent().filter((x) => x !== e)].slice(0, 24)));
  } catch {
    /* private mode */
  }
}

export function EmojiPicker({ current, onPick }: { current?: string; onPick: (emoji: string) => void }) {
  const { language, t } = useLanguage();
  const [rows, setRows] = useState<Row[] | null>(cache);
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    void loadEmojiIndex().then((r) => alive && setRows(r));
    setRecent(readRecent());
    return () => {
      alive = false;
    };
  }, []);
  const found = useMemo(() => (rows && query.trim() ? searchEmojis(rows, query) : null), [rows, query]);
  const byGroup = useMemo(() => {
    const m = new Map<number, Row[]>();
    for (const r of rows ?? []) {
      const list = m.get(r[1]) ?? [];
      list.push(r);
      m.set(r[1], list);
    }
    return m;
  }, [rows]);
  const pick = (e: string) => {
    pushRecent(e);
    setRecent(readRecent());
    onPick(e);
  };
  const cell = (e: string, key: string) => (
    <button
      key={key}
      type="button"
      data-emoji={e}
      onClick={() => pick(e)}
      className={`h-9 w-9 rounded-lg text-[22px] leading-none flex items-center justify-center hover:bg-white/10 active:bg-white/15 ${e === current ? "bg-white/15 ring-2 ring-blue-500" : ""}`}
    >
      {e}
    </button>
  );
  return (
    <div data-emoji-picker className="mt-1">
      <input
        data-emoji-search
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && found?.length) pick(found[0][0]);
        }}
        placeholder={t("ideaBoard.page.emojiSearch")}
        className="w-full h-9 rounded-lg bg-white/5 border border-white/10 px-2.5 text-[14px] outline-none focus:border-blue-500 select-text"
      />
      {!found && (
        <div className="flex gap-0.5 mt-1.5 overflow-x-auto [scrollbar-width:none]">
          {GROUPS.map((g) => (
            <button
              key={g.id}
              type="button"
              data-emoji-tab={g.id}
              title={language === "en" ? g.en : g.de}
              onClick={() => listRef.current?.querySelector(`[data-emoji-group="${g.id}"]`)?.scrollIntoView({ block: "start" })}
              className="h-8 w-8 shrink-0 rounded-lg text-[17px] flex items-center justify-center hover:bg-white/10"
            >
              {g.icon}
            </button>
          ))}
        </div>
      )}
      <div ref={listRef} data-emoji-list className="mt-1.5 h-[220px] overflow-y-auto overscroll-contain pr-1" style={{ WebkitOverflowScrolling: "touch" }}>
        {!rows ? (
          <div className="h-full flex items-center justify-center text-[12px] text-white/40">…</div>
        ) : found ? (
          found.length ? (
            <div className="flex flex-wrap gap-0.5">{found.slice(0, 400).map((r) => cell(r[0], r[0]))}</div>
          ) : (
            <div className="py-6 text-center text-[12px] text-white/40">{t("ideaBoard.page.emojiNone")}</div>
          )
        ) : (
          <>
            {recent.length > 0 && (
              <section data-emoji-group="recent">
                <div className="sticky top-0 z-[1] bg-[#1c1c1e] text-[11px] font-semibold text-white/45 py-1">{t("ideaBoard.page.emojiRecent")}</div>
                <div className="flex flex-wrap gap-0.5">{recent.map((e) => cell(e, `r-${e}`))}</div>
              </section>
            )}
            {GROUPS.map((g) => (
              <section key={g.id} data-emoji-group={g.id}>
                <div className="sticky top-0 z-[1] bg-[#1c1c1e] text-[11px] font-semibold text-white/45 py-1">{language === "en" ? g.en : g.de}</div>
                <div className="flex flex-wrap gap-0.5">{(byGroup.get(g.id) ?? []).map((r) => cell(r[0], r[0]))}</div>
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
