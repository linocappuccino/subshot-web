"use client";
// 2026-11-17, Lino: a «Liste» view (one row per video) next to the tiles — the SAME filtered videos as the tiles
// (lib/postproFilter filterVideos / listGroups ⇄ app/postpro_filter.py, checked by tests/test_postpro_filter.py).
import { useEffect, useState } from "react";
import type { Member, PostproductionStatus, Video, VideoQc } from "@/lib/types";
import { formatVersionLabel } from "@/lib/types";
import { openFeedbackCount } from "@/lib/commentRules";
import { platformsOf } from "@/lib/postproFilter";
import { STATUS_GLOW_COLOR } from "./VideoTile";
import { useLanguage } from "@/lib/i18n";
import type { ProjectLanguage } from "./PostproLanguages";

// 2026-11-18, Lino: «die matrix ansicht brauchen wir nicht» — only tiles + list (an old ?view=matrix falls back to tiles)
export type PostproView = "tiles" | "list";
const VIEWS: PostproView[] = ["tiles", "list"];
const STORE = "subshot:postpro-view";

/** view from ?view= (reload keeps it), else the person's last choice (this browser), else tiles */
export function usePostproView(): [PostproView, (v: PostproView) => void] {
  const [view, setView] = useState<PostproView>("tiles");
  useEffect(() => {
    let v: string | null = null;
    try { v = new URL(window.location.href).searchParams.get("view"); } catch { /* */ }
    if (!v) { try { v = localStorage.getItem(STORE); } catch { /* storage off */ } }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from URL / storage after mount
    if (v && (VIEWS as string[]).includes(v)) setView(v as PostproView);
  }, []);
  const change = (v: PostproView) => {
    setView(v);
    try { localStorage.setItem(STORE, v); } catch { /* */ }
    try {
      const u = new URL(window.location.href);
      if (v === "tiles") u.searchParams.delete("view"); else u.searchParams.set("view", v);
      window.history.replaceState(window.history.state, "", u.toString());
    } catch { /* */ }
  };
  return [view, change];
}

export function ViewSwitch({ view, onView }: { view: PostproView; onView: (v: PostproView) => void }) {
  const { t } = useLanguage();
  const label: Record<PostproView, string> = { tiles: t("postproViews.tiles"), list: t("postproViews.list") };
  const icon: Record<PostproView, React.ReactNode> = {
    tiles: <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />,
    list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  };
  return (
    <div data-view-switch className="inline-flex rounded-full bg-white/[0.06] p-0.5">
      {VIEWS.map((v) => (
        <button key={v} type="button" data-view={v} title={label[v]} aria-pressed={view === v} onClick={() => onView(v)}
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${view === v ? "bg-white text-black" : "text-white/60 hover:text-white"}`}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{icon[v]}</svg>
          <span className="hidden sm:inline">{label[v]}</span>
        </button>
      ))}
    </div>
  );
}

type Group = { id: string; name: string; status: PostproductionStatus | null; videos: Video[] };
type Common = {
  languages: ProjectLanguage[];
  assignments: Record<string, string>;
  formats: Record<string, string>;
  onOpen: (v: Video) => void;
  statusLabel: (s: PostproductionStatus) => string;
};

function newest(v: Video) {
  const r = v.versions.filter((x) => x.status === "ready");
  return r[r.length - 1];
}
function lastChange(v: Video): string {
  const ts = [v.created_at, ...v.versions.map((x) => x.created_at), ...v.versions.flatMap((x) => (x.comments ?? []).map((c) => c.created_at))].filter(Boolean) as string[];
  return ts.sort().pop() ?? v.created_at;
}
function StatusDot({ s }: { s: PostproductionStatus | null }) {
  return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: STATUS_GLOW_COLOR[s ?? "wartend"] }} />;
}
function FeedbackCount({ n }: { n: number }) {
  return n > 0 ? <span className="inline-flex min-w-5 justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold leading-5 text-white tabular-nums">{n}</span> : <span className="text-white/25">–</span>;
}
function Lang({ id, languages }: { id?: string; languages: ProjectLanguage[] }) {
  const l = languages.find((x) => x.id === id);
  return l ? <span className="whitespace-nowrap">{l.flag} <span className="text-white/70">{l.name.slice(0, 2).toUpperCase()}</span></span> : <span className="text-white/25">–</span>;
}

type SortKey = "title" | "lang" | "format" | "version" | "status" | "feedback" | "qc" | "editor" | "changed";

export function PostproListView({
  groups, languages, assignments, formats, onOpen, statusLabel, qc, members, picked, onTogglePick, onDropVersion, readOnly,
}: Common & {
  groups: Group[];
  qc?: Record<string, VideoQc>;
  members?: Member[];
  picked?: Set<string>;
  onTogglePick?: (id: string) => void;
  onDropVersion?: (v: Video, file: File) => void;
  readOnly?: boolean;
}) {
  const { t, language } = useLanguage();
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 } | null>(null);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [dropOn, setDropOn] = useState<string | null>(null);
  const editorOf = (v: Video) => members?.find((m) => m.user_id === v.assignee_id);
  const statusRank: Record<string, number> = { wartend: 0, in_bearbeitung: 1, wartet_auf_feedback: 2, abgeschlossen: 3, abgelehnt: 4 };
  const val = (v: Video, g: Group, k: SortKey): string | number => {
    switch (k) {
      case "title": return v.title.toLowerCase();
      case "lang": return languages.findIndex((l) => l.id === assignments[v.id]) + 1 || 999;
      case "format": return formats[v.id] ?? "~";
      case "version": return newest(v)?.version_number ?? 0;
      case "status": return statusRank[g.status ?? "wartend"];
      case "feedback": return openFeedbackCount(newest(v)?.comments);
      case "qc": { const q = qc?.[newest(v)?.id ?? ""]; return q ? (q.status === "done" ? (q.failed ? 1 : 2) : 0) : -1; }
      case "editor": return (editorOf(v)?.name ?? "~").toLowerCase();
      case "changed": return lastChange(v);
    }
  };
  const fmtDate = (s: string) => new Date(s).toLocaleDateString(language === "en" ? "en-GB" : "de-CH", { day: "2-digit", month: "2-digit", year: "2-digit" });
  const th = (k: SortKey, label: string, cls = "") => (
    <th className={`px-2 py-2 text-left font-medium ${cls}`}>
      <button type="button" data-sort={k} onClick={() => setSort((s) => (s?.k === k ? { k, dir: s.dir === 1 ? -1 : 1 } : { k, dir: 1 }))}
        className={`inline-flex items-center gap-1 hover:text-white ${sort?.k === k ? "text-white" : ""}`}>
        {label}{sort?.k === k && <span>{sort.dir === 1 ? "▲" : "▼"}</span>}
      </button>
    </th>
  );
  return (
    <div data-pp-list className="overflow-x-auto rounded-2xl border border-white/[0.06]">
      <table className="w-full text-sm">
        <thead className="text-xs text-white/40">
          <tr className="border-b border-white/[0.06]">
            {onTogglePick && !readOnly && <th className="w-8" />}
            <th className="w-16 px-2" />
            {th("title", t("postproViews.colTitle"))}
            {th("lang", t("postproViews.colLanguage"))}
            {th("format", t("postproViews.colFormat"), "hidden sm:table-cell")}
            {th("version", t("postproViews.colVersion"), "hidden sm:table-cell")}
            {th("status", t("postproViews.colStatus"))}
            {th("feedback", t("postproViews.colFeedback"))}
            {!readOnly && th("qc", "QC", "hidden md:table-cell")}
            {!readOnly && th("editor", t("postproViews.colEditor"), "hidden md:table-cell")}
            <th className="hidden px-2 py-2 text-left font-medium lg:table-cell">{t("postproViews.colPlatforms")}</th>
            {th("changed", t("postproViews.colChanged"), "hidden lg:table-cell")}
          </tr>
        </thead>
        {groups.map((g) => {
          const isClosed = closed.has(g.id);
          const vids = sort ? [...g.videos].sort((a, b) => { const x = val(a, g, sort.k), y = val(b, g, sort.k); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; }) : g.videos;
          return (
            <tbody key={g.id} data-pp-group={g.id}>
              <tr className="bg-white/[0.03]">
                <td colSpan={20} className="px-2 py-1.5">
                  <button type="button" data-group-toggle onClick={() => setClosed((c) => { const n = new Set(c); if (n.has(g.id)) n.delete(g.id); else n.add(g.id); return n; })}
                    className="inline-flex items-center gap-2 text-xs font-semibold text-white/70 hover:text-white">
                    <span className={`transition-transform ${isClosed ? "-rotate-90" : ""}`}>▾</span>
                    <StatusDot s={g.status} /> {g.name}
                    <span data-count className="rounded-full bg-white/10 px-1.5 text-[11px] tabular-nums text-white/60">{g.videos.length}</span>
                  </button>
                </td>
              </tr>
              {!isClosed && vids.map((v) => {
                const nv = newest(v);
                const q = qc?.[nv?.id ?? ""];
                const ed = editorOf(v);
                const on = picked?.has(v.id);
                return (
                  <tr key={v.id} data-pp-row={v.id} data-video-lang={assignments[v.id] ?? ""}
                    onClick={() => onOpen(v)}
                    onDragOver={onDropVersion ? (e) => { if ([...e.dataTransfer.types].includes("Files")) { e.preventDefault(); e.stopPropagation(); setDropOn(v.id); } } : undefined}
                    onDragLeave={onDropVersion ? () => setDropOn((d) => (d === v.id ? null : d)) : undefined}
                    onDrop={onDropVersion ? (e) => { const f = e.dataTransfer.files?.[0]; if (!f) return; e.preventDefault(); e.stopPropagation(); setDropOn(null); onDropVersion(v, f); } : undefined}
                    className={`cursor-pointer border-b border-white/[0.04] transition-colors hover:bg-white/[0.04] ${on ? "bg-blue-500/10" : ""} ${dropOn === v.id ? "outline outline-2 -outline-offset-2 outline-blue-500" : ""}`}>
                    {onTogglePick && !readOnly && (
                      <td className="px-2" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" data-pick={v.id} checked={!!on} onChange={() => onTogglePick(v.id)} className="h-4 w-4 accent-blue-500" />
                      </td>
                    )}
                    <td className="px-2 py-1.5">
                      <div className="h-9 w-16 overflow-hidden rounded bg-white/[0.06]">
                        {/* eslint-disable-next-line @next/next/no-img-element -- presigned R2 thumbnail */}
                        {nv?.thumbnail_url && <img src={nv.thumbnail_url} alt="" className="h-full w-full object-cover" loading="lazy" />}
                      </div>
                    </td>
                    <td className="max-w-[18rem] truncate px-2 font-medium text-white">{v.title}</td>
                    <td className="px-2"><Lang id={assignments[v.id]} languages={languages} /></td>
                    <td className="hidden px-2 text-white/70 sm:table-cell">{formats[v.id] ?? "–"}</td>
                    <td className="hidden px-2 tabular-nums text-white/70 sm:table-cell">{nv ? formatVersionLabel(nv) : "–"}</td>
                    <td className="whitespace-nowrap px-2"><span className="inline-flex items-center gap-1.5 text-white/80"><StatusDot s={g.status} />{statusLabel(g.status ?? "wartend")}</span></td>
                    <td className="px-2"><FeedbackCount n={openFeedbackCount(nv?.comments)} /></td>
                    {!readOnly && (
                      <td className="hidden px-2 md:table-cell">
                        {!q || q.status === "none" ? <span className="text-white/25">–</span> : q.status === "done" ? (q.failed ? <span className="text-amber-400">⚠ {q.failed}</span> : <span className="text-emerald-400">✓</span>) : <span className="text-white/40">…</span>}
                      </td>
                    )}
                    {!readOnly && <td className="hidden max-w-[10rem] truncate px-2 text-white/70 md:table-cell">{ed ? (ed.name || ed.email) : <span className="text-white/25">–</span>}</td>}
                    <td className="hidden px-2 lg:table-cell">
                      <span className="flex items-center gap-1">
                        {/* eslint-disable-next-line @next/next/no-img-element -- static icon */}
                        {platformsOf(v).map((p) => <img key={p} src={`/platforms/${p}.png`} alt={p} className="h-4 w-4 object-contain" />)}
                      </span>
                    </td>
                    <td className="hidden whitespace-nowrap px-2 tabular-nums text-white/50 lg:table-cell">{fmtDate(lastChange(v))}</td>
                  </tr>
                );
              })}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}
