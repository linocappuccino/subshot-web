"use client";

/* 2026-11-15, Lino: «wenn man oben auf die GB-used-Speicherzeile klickt kommt eine Auflistung mit Balken,
   welches Projekt wie viel Speicher benötigt, dort kann man auch direkt ein ganzes Projekt löschen und/oder
   archivieren … super übersichtlich … ein grosses Pop-up-Window». */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useApi } from "@/lib/useApi";
import { useLanguage } from "@/lib/i18n";
import { STORAGE_TIERS_GB } from "@/lib/seats";

type Parts = { videos: number; images: number; audio: number; canvas: number; other: number };
type Row = {
  id: string; name: string; client_name: string | null; emoji: string | null; color: string | null;
  archived: boolean; bytes: number; parts: Parts; role: string; can_archive: boolean; can_delete: boolean;
};
export type StorageOverview = { scope: "team" | "personal"; team_name: string | null; used_bytes: number; limit_bytes: number; account_files_bytes?: number; projects: Row[]; tier_gb?: number | null; can_buy?: boolean };

const PART_COLORS: Record<keyof Parts, string> = { videos: "#3b82f6", images: "#f59e0b", audio: "#22c55e", canvas: "#a855f7", other: "#94a3b8" };

const TXT = {
  de: {
    title: "Speicher", of: "von", used: "belegt", free: "frei", refresh: "Neu messen", measuring: "Wird gemessen …",
    videos: "Videos", images: "Bilder", audio: "Audio / Live-Dubbing", canvas: "Canvas-Dateien", other: "Sonstiges", accountFiles: "Team-Dateien (Logos)", active: "Aktive Projekte", archivedH: "Archiv",
    archive: "Archivieren", restore: "Wiederherstellen", del: "Löschen", empty: "Noch keine Projekte.", loading: "Speicher wird berechnet …",
    archiveNote: "Archivierte Projekte verschwinden aus der aktiven Liste, bleiben aber vollständig erhalten und zählen weiter zum Speicher. Speicher frei wird nur durch Löschen.",
    teamScope: (n: string) => `Team «${n}»`, personal: "Deine Projekte (Testphase)",
    delTitle: "Projekt endgültig löschen?", delText: (n: string, gb: string) => `«${n}» wird mit allen Ideen, Canvas, Shotlisten, Videos und Dateien gelöscht. ${gb} werden frei. Das kann nicht rückgängig gemacht werden.`,
    delType: "Tippe den Projektnamen zur Bestätigung:", cancel: "Abbrechen", delNow: "Endgültig löschen", deleting: "Wird gelöscht …",
    tipArchive: "Aus der aktiven Liste nehmen (bleibt erhalten)", noRight: "Nur der Besitzer kann löschen", failed: "Das hat nicht geklappt.",
    share: "des Speichers", buy: "Mehr Speicher kaufen", buyNext: (gb: string) => `Nächster Plan: ${gb}`, buyTeam: "Team mit mehr Speicher erstellen", askOwner: "Mehr Speicher kann nur der Besitzer des Teams kaufen.", almostFull: "Speicher fast voll – hol dir mehr Platz, bevor Uploads blockiert werden.", fullMsg: "Speicher voll – neue Uploads sind blockiert.", maxPlan: "Du hast den grössten Plan. Für mehr Speicher melde dich bei uns.",
  },
  en: {
    title: "Storage", of: "of", used: "used", free: "free", refresh: "Measure again", measuring: "Measuring …",
    videos: "Videos", images: "Images", audio: "Audio / Live-Dubbing", canvas: "Canvas files", other: "Other", accountFiles: "Team files (logos)", active: "Active projects", archivedH: "Archive",
    archive: "Archive", restore: "Restore", del: "Delete", empty: "No projects yet.", loading: "Calculating storage …",
    archiveNote: "Archived projects leave the active list but stay complete and still count toward storage. Only deleting frees space.",
    teamScope: (n: string) => `Team «${n}»`, personal: "Your projects (trial)",
    delTitle: "Delete project permanently?", delText: (n: string, gb: string) => `«${n}» will be deleted with all ideas, canvases, shot lists, videos and files. This frees ${gb}. This can't be undone.`,
    delType: "Type the project name to confirm:", cancel: "Cancel", delNow: "Delete permanently", deleting: "Deleting …",
    tipArchive: "Move out of the active list (nothing is deleted)", noRight: "Only the owner can delete", failed: "That didn't work.",
    share: "of storage", buy: "Buy more storage", buyNext: (gb: string) => `Next plan: ${gb}`, buyTeam: "Create a team with more storage", askOwner: "Only the team owner can buy more storage.", almostFull: "Storage almost full – get more space before uploads are blocked.", fullMsg: "Storage full – new uploads are blocked.", maxPlan: "You have the largest plan. Contact us for more storage.",
  },
};

export function fmtBytes(b: number) {
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(b >= 10 * 1024 ** 3 ? 0 : 1).replace(/\.0$/, "")} GB`;
  if (b >= 1024 ** 2) return `${Math.round(b / 1024 ** 2)} MB`;
  if (b > 0) return `${Math.max(1, Math.round(b / 1024))} KB`;
  return "0 MB";
}

export function StorageOverviewModal({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged?: () => void }) {
  const { language } = useLanguage();
  const api = useApi();
  const L = TXT[language === "en" ? "en" : "de"];
  const [data, setData] = useState<StorageOverview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [del, setDel] = useState<Row | null>(null);
  const [typed, setTyped] = useState("");

  const load = useCallback((refresh = false) => {
    if (refresh) setMeasuring(true);
    setError(null);
    return api.storageOverview(refresh).then(setData).catch(() => setError(L.failed)).finally(() => setMeasuring(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [L.failed]);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on open
    load();
  }, [open, load]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (del ? setDel(null) : onClose());
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open, onClose, del]);

  const active = useMemo(() => (data?.projects ?? []).filter((p) => !p.archived), [data]);
  const archived = useMemo(() => (data?.projects ?? []).filter((p) => p.archived), [data]);
  const max = useMemo(() => Math.max(1, ...(data?.projects ?? []).map((p) => p.bytes)), [data]);
  const totals = useMemo(() => {
    const t: Parts = { videos: 0, images: 0, audio: 0, canvas: 0, other: data?.account_files_bytes ?? 0 };
    for (const p of data?.projects ?? []) for (const k of Object.keys(t) as (keyof Parts)[]) t[k] += p.parts[k] ?? 0;
    return t;
  }, [data]);

  const setArchived = async (p: Row, value: boolean) => {
    setBusy(p.id);
    try {
      await api.setProjectArchived(p.id, value);
      setData((d) => d && { ...d, projects: d.projects.map((x) => (x.id === p.id ? { ...x, archived: value } : x)) });
      onChanged?.();
    } catch { setError(L.failed); } finally { setBusy(null); }
  };
  const doDelete = async () => {
    if (!del || typed.trim() !== del.name.trim()) return;
    setBusy(del.id);
    try {
      await api.deleteProject(del.id);
      setData((d) => d && { ...d, used_bytes: Math.max(0, d.used_bytes - del.bytes), projects: d.projects.filter((x) => x.id !== del.id) });
      setDel(null); setTyped("");
      onChanged?.();
    } catch { setError(L.failed); } finally { setBusy(null); }
  };

  if (!open || typeof document === "undefined") return null;
  const pct = data ? Math.min(100, (data.used_bytes / Math.max(1, data.limit_bytes)) * 100) : 0;
  const full = pct >= 100, warn = pct >= 90;

  const RowView = ({ p }: { p: Row }) => {
    const w = (p.bytes / max) * 100;
    const share = data && data.used_bytes > 0 ? Math.round((p.bytes / data.used_bytes) * 100) : 0;
    return (
      <li className={`group rounded-2xl px-3 sm:px-4 py-3 hover:bg-white/[0.04] transition-colors ${p.archived ? "opacity-70" : ""}`}>
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 shrink-0 rounded-xl grid place-items-center text-lg" style={{ background: `${p.color || "#3875bd"}33` }}>{p.emoji || "🎬"}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="truncate font-semibold text-[15px]">{p.name}</span>
              {p.client_name && <span className="truncate text-xs text-white/40 hidden sm:inline">{p.client_name}</span>}
            </div>
            <div className="mt-1.5 flex items-center gap-3">
              <div className="h-2.5 flex-1 rounded-full bg-white/[0.06] overflow-hidden" title={(Object.keys(PART_COLORS) as (keyof Parts)[]).filter((k) => (p.parts[k] ?? 0) > 0).map((k) => `${L[k]} ${fmtBytes(p.parts[k])}`).join(" · ")}>
                <div className="h-full flex" style={{ width: `${Math.max(p.bytes > 0 ? 1.5 : 0, w)}%` }}>
                  {(Object.keys(PART_COLORS) as (keyof Parts)[]).map((k) =>
                    (p.parts[k] ?? 0) > 0 ? <div key={k} style={{ width: `${(p.parts[k] / Math.max(1, p.bytes)) * 100}%`, background: PART_COLORS[k] }} /> : null
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="w-[76px] sm:w-[92px] text-right shrink-0">
            <div className="text-[15px] font-semibold tabular-nums">{fmtBytes(p.bytes)}</div>
            <div className="text-[11px] text-white/35 tabular-nums">{share} %</div>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-end gap-1.5 sm:pl-[52px]">
          {p.can_archive && (
            <button type="button" disabled={busy === p.id} onClick={() => setArchived(p, !p.archived)} title={p.archived ? undefined : L.tipArchive}
              className="rounded-full px-3 py-1 text-xs font-medium bg-white/[0.06] text-white/75 hover:bg-white/[0.12] disabled:opacity-40">
              {p.archived ? `↺ ${L.restore}` : `🗄 ${L.archive}`}
            </button>
          )}
          <button type="button" disabled={!p.can_delete || busy === p.id} onClick={() => { setDel(p); setTyped(""); }} title={p.can_delete ? undefined : L.noRight}
            className="rounded-full px-3 py-1 text-xs font-medium bg-red-500/10 text-red-300 hover:bg-red-500/20 disabled:opacity-30 disabled:hover:bg-red-500/10">
            {L.del}
          </button>
        </div>
      </li>
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center" data-storage-overview>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:w-[min(92vw,860px)] bg-[#1c1c1e] border border-white/10 shadow-2xl rounded-t-3xl sm:rounded-3xl h-[92vh] sm:h-auto sm:max-h-[88vh] flex flex-col">
        <div className="flex items-center justify-between px-5 sm:px-7 pt-5 pb-3 shrink-0">
          <div>
            <h2 className="text-xl font-bold">{L.title}</h2>
            {data && <p className="text-xs text-white/40 mt-0.5">{data.scope === "team" ? L.teamScope(data.team_name || "") : L.personal}</p>}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => load(true)} disabled={measuring} className="rounded-full px-3 py-1.5 text-xs text-white/60 bg-white/[0.06] hover:bg-white/[0.12] disabled:opacity-50">
              {measuring ? L.measuring : `↻ ${L.refresh}`}
            </button>
            <button onClick={onClose} className="rounded-full p-1.5 text-white/50 hover:text-white hover:bg-white/10" aria-label="×">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        {data && (
          <div className="px-5 sm:px-7 pb-4 shrink-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-3xl font-bold tabular-nums">{fmtBytes(data.used_bytes)}</span>
              <span className="text-white/45">{L.of} {fmtBytes(data.limit_bytes)} {L.used}</span>
              <span className={`ml-auto text-sm tabular-nums ${full ? "text-red-300" : warn ? "text-amber-200" : "text-white/45"}`}>
                {fmtBytes(Math.max(0, data.limit_bytes - data.used_bytes))} {L.free}
              </span>
            </div>
            <div className="mt-3 h-3 rounded-full bg-white/[0.06] overflow-hidden flex">
              {(Object.keys(PART_COLORS) as (keyof Parts)[]).map((k) => (
                <div key={k} style={{ width: `${(totals[k] / Math.max(1, data.limit_bytes)) * 100}%`, background: PART_COLORS[k] }} />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/55">
              {(Object.keys(PART_COLORS) as (keyof Parts)[]).filter((k) => totals[k] > 0 || k === "videos" || k === "images").map((k) => (
                <span key={k} className="inline-flex items-center gap-1.5">
                  <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: PART_COLORS[k] }} />
                  {L[k]} <b className="font-semibold text-white/80 tabular-nums">{fmtBytes(totals[k])}</b>
                </span>
              ))}
              <span className="ml-auto text-white/35 tabular-nums">{Math.round(pct)} %</span>
            </div>
            {/* 2026-11-15, Lino: «ein grosser Button: Buy more storage, der direkt zum Kauf-Screen der Speichergrösse bringt» */}
            {(() => {
              const cur = data.tier_gb ?? 0;
              const next = STORAGE_TIERS_GB.find((g) => g > cur);
              const label = (g: number) => (g >= 1000 ? `${g / 1000} TB` : `${g} GB`);
              const hot = pct >= 80;
              if (data.can_buy === false) return <p className="mt-4 rounded-xl bg-white/[0.04] px-4 py-3 text-sm text-white/55">{L.askOwner}</p>;
              if (data.scope === "team" && !next) return <p className="mt-4 rounded-xl bg-white/[0.04] px-4 py-3 text-sm text-white/55">{L.maxPlan}</p>;
              const href = data.scope === "team" ? `/team?upgrade=${next}#storage` : `/team?plan=${STORAGE_TIERS_GB[0]}`;
              return (
                <div className="mt-4">
                  {hot && <p className={`mb-2 text-sm ${full ? "text-red-300" : "text-amber-200"}`}>{full ? L.fullMsg : L.almostFull}</p>}
                  <a href={href} data-buy-storage
                    className={`flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-3.5 text-[15px] font-semibold text-white transition-colors ${hot ? "bg-[#ff3b30] hover:bg-[#ff5a4f] shadow-[0_0_0_4px_rgba(255,59,48,.18)]" : "bg-[#1f6feb] hover:bg-[#3a82f0]"}`}>
                    ＋ {data.scope === "team" ? L.buy : L.buyTeam}
                    {data.scope === "team" && next && <span className="font-normal text-white/75">· {L.buyNext(label(next))}</span>}
                  </a>
                </div>
              );
            })()}
          </div>
        )}

        <div className="overflow-y-auto px-2 sm:px-3 pb-5 flex-1 border-t border-white/8">
          {error && <p className="mx-3 mt-3 rounded-xl bg-red-500/10 text-red-200 text-sm px-3 py-2">{error}</p>}
          {!data && !error && <p className="px-4 py-10 text-center text-white/45 text-sm">{L.loading}</p>}
          {data && (
            <>
              <h3 className="px-4 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider text-white/40">{L.active} · {active.length}</h3>
              {active.length === 0 ? <p className="px-4 py-3 text-sm text-white/40">{L.empty}</p> : <ul>{active.map((p) => <RowView key={p.id} p={p} />)}</ul>}
              <h3 className="px-4 pt-5 pb-1 text-xs font-semibold uppercase tracking-wider text-white/40">🗄 {L.archivedH} · {archived.length}</h3>
              <p className="px-4 pb-2 text-xs text-white/40 max-w-[60ch]">{L.archiveNote}</p>
              {(data.account_files_bytes ?? 0) > 0 && (
                <p className="px-4 pt-3 text-xs text-white/45">{L.accountFiles}: <b className="text-white/70 tabular-nums">{fmtBytes(data.account_files_bytes ?? 0)}</b></p>
              )}
              {archived.length > 0 && <ul>{archived.map((p) => <RowView key={p.id} p={p} />)}</ul>}
            </>
          )}
        </div>
      </div>

      {del && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDel(null)} />
          <div className="relative w-full max-w-md rounded-3xl bg-[#232326] border border-white/10 p-6 shadow-2xl">
            <h3 className="text-lg font-bold">{L.delTitle}</h3>
            <p className="mt-2 text-sm text-white/65">{L.delText(del.name, fmtBytes(del.bytes))}</p>
            <label className="block mt-4 text-xs text-white/50">{L.delType} <b className="text-white/85">{del.name}</b></label>
            <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doDelete()}
              className="mt-1.5 w-full rounded-xl bg-white/[0.06] border border-white/10 px-3 py-2 text-sm outline-none focus:border-red-400/60" placeholder={del.name} />
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setDel(null)} className="rounded-full px-4 py-2 text-sm bg-white/[0.06] hover:bg-white/[0.12]">{L.cancel}</button>
              <button type="button" onClick={doDelete} disabled={typed.trim() !== del.name.trim() || busy === del.id}
                className="rounded-full px-4 py-2 text-sm font-semibold bg-red-600 text-white hover:bg-red-500 disabled:opacity-35">
                {busy === del.id ? L.deleting : L.delNow}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
