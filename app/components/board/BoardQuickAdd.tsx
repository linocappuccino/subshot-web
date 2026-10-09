"use client";

/* 2026-10-09, Lino: "Shift + Space → ein Suchfeld im Zentrum, wo man direkt
 * losschreiben kann, dort kann man die Nodes suchen und per Enter oder
 * Pfeiltaste auswählen — und sie wird dann direkt platziert". A quick-add
 * palette: type to filter the node types (German + English words and
 * synonyms), ↑/↓ to move, Enter or click places the node where the mouse
 * pointer is (centre of the screen without one), Esc closes. */

import { useEffect, useMemo, useRef, useState } from "react";

export type QuickAddItem = { id: string; label: string; icon: string; hint?: string; keywords: string };

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss");

export function BoardQuickAdd({ items, placeholder, emptyLabel, onPick, onClose }: { items: QuickAddItem[]; placeholder: string; emptyLabel: string; onPick: (id: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const results = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    if (!words.length) return items;
    return items
      .map((it) => {
        const label = norm(it.label);
        const all = `${label} ${norm(it.keywords)}`;
        if (!words.every((w) => all.includes(w))) return null;
        // the name itself beats a synonym; its start beats its middle
        const score = label.startsWith(words[0]) ? 0 : label.includes(words[0]) ? 1 : all.split(/\s+/).some((k) => k.startsWith(words[0])) ? 2 : 3;
        return { it, score };
      })
      .filter((x): x is { it: QuickAddItem; score: number } => !!x)
      .sort((a, b) => a.score - b.score)
      .map((x) => x.it);
  }, [items, q]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-qa-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div
      data-board-ui
      className="absolute inset-0 z-[60] flex items-start justify-center pt-[18vh] bg-black/25"
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="w-[min(440px,calc(100%-32px))] rounded-2xl bg-[#1c1c1e]/98 border border-white/12 shadow-2xl backdrop-blur overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 h-14 border-b border-white/10">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-white/45 shrink-0">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              // the board's own shortcuts must not see these keys
              e.stopPropagation();
              if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
                e.preventDefault();
                setActive((a) => Math.min(results.length - 1, a + 1));
              } else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const it = results[active];
                if (it) onPick(it.id);
              } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
            placeholder={placeholder}
            className="flex-1 bg-transparent text-[15px] text-white placeholder:text-white/35 outline-none"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="text-[10px] text-white/35 border border-white/15 rounded px-1.5 py-0.5">esc</kbd>
        </div>
        <div ref={listRef} className="max-h-[min(360px,50vh)] overflow-y-auto p-1.5">
          {results.length === 0 && <div className="px-3 py-6 text-center text-sm text-white/40">{emptyLabel}</div>}
          {results.map((it, i) => (
            <button
              key={it.id}
              data-qa-index={i}
              onPointerEnter={() => setActive(i)}
              onClick={() => onPick(it.id)}
              className={`w-full flex items-center gap-3 px-3 h-10 rounded-lg text-left text-sm ${i === active ? "bg-blue-600 text-white" : "text-white/85"}`}
            >
              <span className="w-6 text-center text-base leading-none">{it.icon}</span>
              <span className="flex-1 truncate">{it.label}</span>
              {it.hint && <kbd className={`text-[10px] rounded px-1.5 py-0.5 border ${i === active ? "border-white/40 text-white/80" : "border-white/15 text-white/35"}`}>{it.hint}</kbd>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
