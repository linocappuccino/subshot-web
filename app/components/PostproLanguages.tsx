"use client";

/** 2026-11-13, Lino: languages on the Post-Production page — tabs «Alle» / per language (flag + name + count) /
 * «Nicht zugeordnet»; «+ Sprache» with a flag that suits the name (changeable), rename / delete (videos then
 * become «Nicht zugeordnet»). The client's preview link shows the same tabs read-only. */
import { useState } from "react";

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
}) {
  const [form, setForm] = useState<{ id: string | null; name: string; flag: string; flagTouched: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const pill = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${active ? "bg-white text-black" : "bg-white/[0.06] text-white/75 hover:bg-white/10"}`;
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
          Alle <span className="opacity-60 tabular-nums">{total}</span>
        </button>
        {data.languages.map((l) => (
          <span key={l.id} className="group relative inline-flex">
            <button type="button" data-lang-tab={l.id} onClick={() => onTab(l.id)} className={pill(tab === l.id)}>
              <span>{l.flag}</span> {l.name} <span className="opacity-60 tabular-nums">{l.count}</span>
            </button>
            {editable && (
              <button
                type="button"
                title="Sprache bearbeiten"
                data-lang-edit={l.id}
                onClick={() => setForm({ id: l.id, name: l.name, flag: l.flag, flagTouched: true })}
                className="ml-0.5 rounded-full px-1.5 text-xs text-white/35 hover:text-white"
              >
                ✎
              </button>
            )}
          </span>
        ))}
        {(!hideEmptyUnassigned || data.unassigned > 0) && data.languages.length > 0 && (
          <button type="button" data-lang-tab="none" onClick={() => onTab("none")} className={pill(tab === "none")}>
            Nicht zugeordnet <span className="opacity-60 tabular-nums">{data.unassigned}</span>
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
