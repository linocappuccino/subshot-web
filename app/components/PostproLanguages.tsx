"use client";

/** 2026-11-13, Lino: languages on the Post-Production page — tabs «Alle» / per language (flag + name + count) /
 * «Nicht zugeordnet»; «+ Sprache» with a flag that suits the name (changeable), rename / delete (videos then
 * become «Nicht zugeordnet»). The client's preview link shows the same tabs read-only. */
import { useEffect, useState } from "react";
import { Menu } from "./ui/Menu";

export interface ProjectLanguage {
  id: string;
  name: string;
  flag: string;
  sort_order: number;
  count: number;
}
export interface LanguagesOverview {
  languages: ProjectLanguage[];
  assignments: Record<string, string>;
  unassigned: number;
  /** video id → «9:16» / «16:9» / … (real size, rounded) */
  formats?: Record<string, string>;
}
/** "all" | "none" | language id */
export type LanguageTab = string;

const SUGGEST: [string, string][] = [
  ["Deutsch", "🇩🇪"],
  ["Schweizerdeutsch", "🇨🇭"],
  ["Französisch", "🇫🇷"],
  ["Italienisch", "🇮🇹"],
  ["Englisch", "🇬🇧"],
  ["Rätoromanisch", "🇨🇭"],
  ["Spanisch", "🇪🇸"],
  ["Portugiesisch", "🇵🇹"],
];
const FLAGS = ["🇨🇭", "🇩🇪", "🇦🇹", "🇫🇷", "🇮🇹", "🇬🇧", "🇺🇸", "🇪🇸", "🇵🇹", "🇳🇱", "🇵🇱", "🇹🇷", "🇦🇱", "🇭🇷", "🇷🇸", "🇺🇦", "🏳️"];

export function suggestFlag(name: string): string {
  const n = name.trim().toLowerCase();
  const hit = SUGGEST.find(([s]) => s.toLowerCase() === n);
  if (hit) return hit[1];
  if (/^(english|englisch)/.test(n)) return "🇬🇧";
  if (/^(french|franz)/.test(n)) return "🇫🇷";
  if (/^(ital)/.test(n)) return "🇮🇹";
  if (/^(german|deutsch|hochdeutsch)/.test(n)) return "🇩🇪";
  if (/(schweiz|swiss|mundart|romanisch|rumantsch)/.test(n)) return "🇨🇭";
  return "🏳️";
}

/** tabs + (for the team) «+ Sprache» and editing */
export function LanguageTabs({
  data,
  tab,
  onTab,
  total,
  editable,
  onCreate,
  onUpdate,
  onDelete,
  hideEmptyUnassigned,
  newRequest,
  onDropVideos,
}: {
  data: LanguagesOverview;
  tab: LanguageTab;
  onTab: (t: LanguageTab) => void;
  total: number;
  editable?: boolean;
  onCreate?: (name: string, flag: string) => Promise<void>;
  onUpdate?: (id: string, name: string, flag: string) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  hideEmptyUnassigned?: boolean;
  /** bump to open «+ Sprache» from elsewhere (the video badge's «Neue Sprache») */
  newRequest?: number;
  /** a video dragged onto a tab (language id, or null = «Nicht zugeordnet») */
  onDropVideos?: (languageId: string | null, videoIds: string[]) => void;
}) {
  const [form, setForm] = useState<{ id: string | null; name: string; flag: string; flagTouched: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dropOn, setDropOn] = useState<string | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- opening the form on request
    if (newRequest) setForm({ id: null, name: "", flag: "🏳️", flagTouched: false });
  }, [newRequest]);
  const pill = (active: boolean, key?: string) =>
    `inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium transition-all ${
      dropOn !== null && dropOn === key ? "ring-2 ring-blue-400 bg-blue-500/20 text-white scale-105" : active ? "bg-white text-black shadow-sm" : "bg-white/[0.06] text-white/75 hover:bg-white/10 hover:text-white"
    }`;
  const count = (n: number, active: boolean) => (
    <span className={`min-w-[1.25rem] rounded-full px-1.5 text-center text-[11px] font-semibold tabular-nums ${active ? "bg-black/10 text-black/70" : "bg-white/10 text-white/60"}`}>{n}</span>
  );
  const drop = (key: string, languageId: string | null) =>
    onDropVideos
      ? {
          onDragOver: (e: React.DragEvent) => {
            if (![...e.dataTransfer.types].includes("application/x-subshot-videos")) return;
            e.preventDefault();
            setDropOn(key);
          },
          onDragLeave: () => setDropOn(null),
          onDrop: (e: React.DragEvent) => {
            const raw = e.dataTransfer.getData("application/x-subshot-videos");
            setDropOn(null);
            if (!raw) return;
            e.preventDefault();
            onDropVideos(languageId, JSON.parse(raw) as string[]);
          },
        }
      : {};
  async function save() {
    if (!form || !form.name.trim()) return;
    setBusy(true);
    try {
      if (form.id) await onUpdate?.(form.id, form.name.trim(), form.flag);
      else await onCreate?.(form.name.trim(), form.flag);
      setForm(null);
    } finally {
      setBusy(false);
    }
  }
  if (!editable && data.languages.length === 0) return null;
  return (
    <div data-language-tabs className="mb-4 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" data-lang-tab="all" onClick={() => onTab("all")} className={pill(tab === "all")}>
          Alle {count(total, tab === "all")}
        </button>
        {data.languages.map((l) => (
          <span key={l.id} className="group relative inline-flex">
            <button type="button" data-lang-tab={l.id} onClick={() => onTab(l.id)} className={pill(tab === l.id, l.id)} {...drop(l.id, l.id)}>
              <span className="text-base leading-none">{l.flag}</span> {l.name} {count(l.count, tab === l.id)}
            </button>
            {editable && (
              <button
                type="button"
                title="Sprache bearbeiten"
                data-lang-edit={l.id}
                onClick={() => setForm({ id: l.id, name: l.name, flag: l.flag, flagTouched: true })}
                className="absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full bg-[#2c2c2e] text-[10px] text-white/70 ring-1 ring-white/15 hover:text-white group-hover:flex"
              >
                ✎
              </button>
            )}
          </span>
        ))}
        {(!hideEmptyUnassigned || data.unassigned > 0) && data.languages.length > 0 && (
          <button type="button" data-lang-tab="none" onClick={() => onTab("none")} className={pill(tab === "none", "none")} {...drop("none", null)}>
            Nicht zugeordnet {count(data.unassigned, tab === "none")}
          </button>
        )}
        {editable && (
          <button type="button" data-lang-add onClick={() => setForm({ id: null, name: "", flag: "🏳️", flagTouched: false })} className="rounded-full border border-dashed border-white/20 px-3 py-1.5 text-sm text-white/60 hover:text-white hover:border-white/40">
            + Sprache
          </button>
        )}
      </div>
      {editable && form && (
        <div data-lang-form className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm">
          <input
            autoFocus
            list="subshot-language-names"
            value={form.name}
            placeholder="Sprache, z. B. Französisch"
            onChange={(e) => setForm((f) => (f ? { ...f, name: e.target.value, flag: f.flagTouched ? f.flag : suggestFlag(e.target.value) } : f))}
            onKeyDown={(e) => e.key === "Enter" && void save()}
            className="w-52 rounded-md bg-white/10 px-2 py-1.5 outline-none focus:ring-1 focus:ring-blue-400"
          />
          <datalist id="subshot-language-names">
            {SUGGEST.map(([n]) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <span className="text-white/45">Flagge:</span>
          <input
            data-lang-flag
            value={form.flag}
            onChange={(e) => setForm((f) => (f ? { ...f, flag: e.target.value, flagTouched: true } : f))}
            className="w-14 rounded-md bg-white/10 px-2 py-1.5 text-center outline-none"
          />
          <span className="flex flex-wrap gap-0.5">
            {FLAGS.map((fl) => (
              <button key={fl} type="button" onClick={() => setForm((f) => (f ? { ...f, flag: fl, flagTouched: true } : f))} className={`rounded px-1 text-base ${form.flag === fl ? "bg-white/20" : "hover:bg-white/10"}`}>
                {fl}
              </button>
            ))}
          </span>
          <span className="flex-1" />
          {form.id && (
            <button
              type="button"
              data-lang-delete
              disabled={busy}
              onClick={() => {
                if (!form.id || !window.confirm(`Sprache «${form.name}» löschen? Die Videos bleiben und werden «Nicht zugeordnet».`)) return;
                setBusy(true);
                void onDelete?.(form.id).finally(() => {
                  setBusy(false);
                  setForm(null);
                });
              }}
              className="text-red-300 hover:text-red-200"
            >
              Löschen
            </button>
          )}
          <button type="button" onClick={() => setForm(null)} className="text-white/50 hover:text-white">
            Abbrechen
          </button>
          <button type="button" data-lang-save disabled={busy || !form.name.trim()} onClick={() => void save()} className="rounded-md bg-blue-500 hover:bg-blue-400 px-3 py-1.5 font-semibold text-white disabled:opacity-40">
            {form.id ? "Speichern" : "Hinzufügen"}
          </button>
        </div>
      )}
    </div>
  );
}

export function matchesTab(videoId: string, tab: LanguageTab, assignments: Record<string, string>): boolean {
  if (tab === "all") return true;
  if (tab === "none") return !assignments[videoId];
  return assignments[videoId] === tab;
}

const CODES: Record<string, string> = {
  deutsch: "DE", hochdeutsch: "DE", german: "DE", schweizerdeutsch: "CH", mundart: "CH", "swiss german": "CH", "französisch": "FR", franzoesisch: "FR",
  french: "FR", italienisch: "IT", italian: "IT", englisch: "EN", english: "EN", "rätoromanisch": "RM", romanisch: "RM", spanisch: "ES", portugiesisch: "PT",
  "niederländisch": "NL", polnisch: "PL", "türkisch": "TR", albanisch: "SQ", kroatisch: "HR", serbisch: "SR", ukrainisch: "UK", russisch: "RU",
};
/** «🇩🇪 DE» — the short code of a language name */
export function langCode(name: string): string {
  const n = name.trim().toLowerCase();
  return CODES[n] ?? n.replace(/[^a-zäöü]/g, "").slice(0, 2).toUpperCase();
}

/** 2026-11-13, Lino: «muss schöner sein» — the language as a small badge with a popover (flag + name, ✓ at the
 * current one, «Keine Sprache», «+ Neue Sprache»); no browser select. Read-only (preview) without onChange. */
export function LanguageBadge({
  current,
  languages,
  onChange,
  onNew,
  revealOnHover,
}: {
  current: { id: string; name: string; flag: string } | null;
  languages: { id: string; name: string; flag: string }[];
  onChange?: (id: string | null) => void;
  onNew?: () => void;
  /** «+ Sprache» only shows clearly on hover (tile hover group «thumb») */
  revealOnHover?: boolean;
}) {
  const badge = current ? (
    <span data-lang-badge={current.id} title={current.name} className="inline-flex items-center gap-1 rounded-full bg-black/60 backdrop-blur-sm px-2 py-0.5 text-[11px] font-semibold text-white ring-1 ring-white/15 shadow-sm">
      <span className="text-[13px] leading-none">{current.flag}</span>
      {langCode(current.name)}
    </span>
  ) : (
    <span
      data-lang-badge=""
      className={`inline-flex items-center gap-1 rounded-full bg-black/50 backdrop-blur-sm px-2 py-0.5 text-[11px] font-medium text-white/80 ring-1 ring-dashed ring-white/25 transition-opacity ${revealOnHover ? "opacity-0 group-hover/thumb:opacity-100" : ""}`}
    >
      ＋ Sprache
    </span>
  );
  if (!onChange) return current ? badge : null;
  return (
    <span onClick={(e) => e.stopPropagation()} className="inline-flex">
      <Menu portal align="start" trigger={<span className="cursor-pointer hover:brightness-125">{badge}</span>}>
        {(close) => <LanguageMenuItems current={current?.id ?? null} languages={languages} onPick={(id) => { onChange(id); close(); }} onNew={onNew ? () => { onNew(); close(); } : undefined} />}
      </Menu>
    </span>
  );
}

export function LanguageMenuItems({
  current,
  languages,
  onPick,
  onNew,
}: {
  current: string | null | undefined;
  languages: { id: string; name: string; flag: string }[];
  onPick: (id: string | null) => void;
  onNew?: () => void;
}) {
  const row = "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-white/10";
  return (
    <div data-lang-menu className="min-w-[13rem] p-1">
      {languages.map((l) => (
        <button key={l.id} type="button" data-lang-option={l.id} onClick={() => onPick(l.id)} className={row}>
          <span className="w-5 text-center text-base leading-none">{l.flag}</span>
          <span className="flex-1">{l.name}</span>
          {current === l.id && <span className="text-blue-400">✓</span>}
        </button>
      ))}
      <button type="button" data-lang-option="" onClick={() => onPick(null)} className={`${row} text-white/60`}>
        <span className="w-5 text-center">–</span>
        <span className="flex-1">Keine Sprache</span>
        {current === null && <span className="text-blue-400">✓</span>}
      </button>
      {onNew && (
        <>
          <div className="my-1 h-px bg-white/10" />
          <button type="button" data-lang-new onClick={onNew} className={`${row} text-blue-300`}>
            <span className="w-5 text-center">＋</span>
            <span className="flex-1">Neue Sprache</span>
          </button>
        </>
      )}
    </div>
  );
}

// ── formats (2026-11-13, Lino): second filter row, combinable with the language ──
export const FORMAT_ORDER = ["9:16", "16:9", "1:1", "4:5", "5:4"] as const;
/** "all" | "9:16" | … | "other" */
export type FormatTab = string;
export function formatKey(f: string | undefined): string {
  return f && (FORMAT_ORDER as readonly string[]).includes(f) ? f : "other";
}
export function matchesFormat(videoId: string, tab: FormatTab, formats: Record<string, string>): boolean {
  return tab === "all" || formatKey(formats[videoId]) === tab;
}

export function FormatTabs({ videoIds, formats, tab, onTab }: { videoIds: string[]; formats: Record<string, string>; tab: FormatTab; onTab: (t: FormatTab) => void }) {
  const counts: Record<string, number> = {};
  for (const id of videoIds) {
    const k = formatKey(formats[id]);
    counts[k] = (counts[k] ?? 0) + 1;
  }
  const keys = [...FORMAT_ORDER.filter((f) => counts[f]), ...(counts.other ? ["other"] : [])];
  // 2026-11-13, Lino «wo ist der Formatfilter?»: always shown as soon as there are videos (also with one format only)
  if (videoIds.length === 0 && tab === "all") return null;
  const pill = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${active ? "bg-white text-black" : "bg-white/[0.06] text-white/70 hover:bg-white/10 hover:text-white"}`;
  return (
    <div data-format-tabs className="mb-4 -mt-1 flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs text-white/40">Format</span>
      <button type="button" data-format-tab="all" onClick={() => onTab("all")} className={pill(tab === "all")}>
        Alle
      </button>
      {keys.map((k) => (
        <button key={k} type="button" data-format-tab={k} onClick={() => onTab(k)} className={pill(tab === k)}>
          <FormatIcon f={k} /> {k === "other" ? "Andere" : k} <span className={`tabular-nums ${tab === k ? "text-black/50" : "text-white/40"}`}>{counts[k] ?? 0}</span>
        </button>
      ))}
    </div>
  );
}

/** a tiny frame in the format's shape */
export function FormatIcon({ f }: { f: string }) {
  const [w, h] = f === "9:16" ? [7, 12] : f === "16:9" ? [13, 7.5] : f === "1:1" ? [10, 10] : f === "4:5" ? [8.5, 10.5] : f === "5:4" ? [10.5, 8.5] : [12, 6];
  return <span aria-hidden className="inline-block rounded-[2px] border-[1.5px] border-current opacity-70" style={{ width: w, height: h }} />;
}

export function FormatBadge({ f }: { f?: string }) {
  if (!f) return null;
  return (
    <span data-format-badge={f} className="inline-flex items-center gap-1 rounded-full bg-black/60 backdrop-blur-sm px-2 py-0.5 text-[11px] font-semibold text-white/90 ring-1 ring-white/15 shadow-sm">
      {formatKey(f) === "other" ? f : f}
    </span>
  );
}
