"use client";

/** 2026-11-13, Lino: Live-Dubbing with language tabs — every language of a node has its OWN sections, script,
 * takes, ★ and exports. Shared helpers (flags + names, the same look as the Post-Production languages) and the
 * small «+ Sprache» popover (optionally copying the section times of another language, script empty). */
import { useState } from "react";
import type { DubbingElement, DubbingSection } from "@/lib/board";
import { Menu } from "../ui/Menu";
import { LANGUAGE_LIST } from "../PostproLanguages";

// 2026-11-13, Lino: the same language list as the Post-Production page (name + flag come together, no flag picker)
export const DUB_LANGS: [string, string, string][] = LANGUAGE_LIST.map((l) => [l.code, l.name, l.flag]);
export function dubLangName(code: string): string {
  return DUB_LANGS.find(([c]) => c === code)?.[1] ?? code.toUpperCase();
}
export function dubLangFlag(code: string, el?: Pick<DubbingElement, "language_flags">): string {
  return el?.language_flags?.[code] || DUB_LANGS.find(([c]) => c === code)?.[2] || "🏳️";
}
/** the sections of one language (sections from before the tabs count for the first language) */
export function sectionsFor(el: Pick<DubbingElement, "sections" | "languages">, lang: string): DubbingSection[] {
  const first = el.languages[0] ?? "";
  return el.sections.filter((s) => (s.lang ?? first) === lang);
}
/** replace one language's sections, keep the others */
export function mergeSections(el: Pick<DubbingElement, "sections" | "languages">, lang: string, next: DubbingSection[]): DubbingSection[] {
  const first = el.languages[0] ?? "";
  const others = el.sections.filter((s) => (s.lang ?? first) !== lang);
  return [...others, ...next.map((s) => ({ ...s, lang }))].sort((a, b) => a.start - b.start);
}
const newId = () => Math.random().toString(36).slice(2, 10);

/** a new language (+ optionally the section times of an existing one, script empty) */
export function addLanguage(el: Pick<DubbingElement, "sections" | "languages">, code: string, copyFrom: string | null): { languages: string[]; sections: DubbingSection[] } {
  const copies = copyFrom ? sectionsFor(el, copyFrom).map((s) => ({ id: newId(), start: s.start, end: s.end, label: s.label ?? "", scripts: {}, lang: code })) : [];
  return { languages: [...el.languages, code], sections: [...el.sections, ...copies].sort((a, b) => a.start - b.start) };
}

export function DubLangPills({
  el,
  lang,
  onLang,
  onAdd,
  onDelete,
  only,
  size = "sm",
}: {
  el: DubbingElement;
  lang: string;
  onLang: (code: string) => void;
  /** team only: «+» */
  onAdd?: (code: string, copyFrom: string | null) => void;
  /** team only (studio): delete a language, after a confirm */
  onDelete?: (code: string) => void;
  /** a speaker link fixed to one language */
  only?: string | null;
  size?: "sm" | "md";
}) {
  const langs = only ? el.languages.filter((l) => l === only) : el.languages;
  const pill = (active: boolean) =>
    `group relative inline-flex items-center gap-1.5 rounded-full font-semibold transition-colors ${size === "md" ? "px-3 py-1.5 text-sm" : "px-2 py-0.5 text-[11px]"} ${
      active ? "bg-white text-black" : "bg-white/10 text-white/70 hover:bg-white/15 hover:text-white"
    }`;
  return (
    <div data-dub-langs className="flex flex-wrap items-center gap-1.5">
      {langs.map((l) => (
        <span key={l} className="relative inline-flex">
          <button type="button" data-dub-lang={l} onClick={() => onLang(l)} className={pill(l === lang)} title={dubLangName(l)}>
            <span className={size === "md" ? "text-base leading-none" : "text-[13px] leading-none"}>{dubLangFlag(l, el)}</span>
            {size === "md" ? dubLangName(l) : l.toUpperCase()}
            {onDelete && el.languages.length > 1 && (
              <span
                role="button"
                data-dub-lang-delete={l}
                title="Sprache löschen"
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm(`Sprache «${dubLangName(l)}» löschen? Alle Abschnitte und Takes dieser Sprache werden gelöscht.`)) onDelete(l);
                }}
                className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full bg-[#2c2c2e] text-[10px] text-white/70 ring-1 ring-white/15 hover:bg-red-500 hover:text-white group-hover:flex"
              >
                ✕
              </span>
            )}
          </button>
        </span>
      ))}
      {onAdd && !only && <AddLang el={el} onAdd={onAdd} size={size} />}
    </div>
  );
}

function AddLang({ el, onAdd, size }: { el: DubbingElement; onAdd: (code: string, copyFrom: string | null) => void; size: "sm" | "md" }) {
  const [copyFrom, setCopyFrom] = useState<string>(el.languages[0] ?? "");
  const free = DUB_LANGS.filter(([c]) => !el.languages.includes(c));
  const hasSections = el.sections.length > 0;
  return (
    <Menu
      portal
      align="start"
      trigger={
        <span data-dub-lang-add className={`inline-flex cursor-pointer items-center rounded-full border border-dashed border-white/25 text-white/60 hover:text-white hover:border-white/50 ${size === "md" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-[11px]"}`}>
          {size === "md" ? "+ Sprache" : "+"}
        </span>
      }
    >
      {(close) => (
        // the menu lives in a portal: React events still bubble to the canvas tile (which grabs the pointer for dragging)
        <div data-dub-lang-menu data-no-drag className="w-64 max-h-[70vh] overflow-auto p-1 text-sm" onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          {free.map(([c, name, flag]) => (
            <button
              key={c}
              type="button"
              data-dub-lang-option={c}
              onClick={() => {
                onAdd(c, hasSections && copyFrom ? copyFrom : null);
                close();
              }}
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left hover:bg-white/10"
            >
              <span className="w-5 text-center text-base leading-none">{flag}</span>
              <span className="flex-1">{name}</span>
            </button>
          ))}
          {hasSections && (
            <>
              <div className="my-1 h-px bg-white/10" />
              <label className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-white/60">
                Abschnitte übernehmen aus
                <select data-dub-lang-copy value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} className="flex-1 rounded-md bg-white/10 px-1.5 py-1 text-white outline-none">
                  <option value="">– keine –</option>
                  {el.languages.map((l) => (
                    <option key={l} value={l}>
                      {dubLangFlag(l, el)} {dubLangName(l)}
                    </option>
                  ))}
                </select>
              </label>
              <p className="px-2.5 pb-1 text-[11px] text-white/40">Nur die Zeiten werden übernommen, der Text bleibt leer.</p>
            </>
          )}
        </div>
      )}
    </Menu>
  );
}
