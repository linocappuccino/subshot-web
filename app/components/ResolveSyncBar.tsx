"use client";

/* 2026-11-15, Lino (DaVinci-Thread): subtitles Resolve ↔ Subshot «so automatisch wie möglich» — the review panel shows
   which Resolve timeline / subtitle track / language a version belongs to (auto-linked by the plugin, correctable
   here) and per language whether Resolve has taken the latest revision. */

import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "@/lib/useApi";
import { useLanguage } from "@/lib/i18n";
import { subscribeToChanges } from "@/lib/realtime";

type Track = { lang: string; kind: string; cues: number; rev: number; resolve_status: string | null; resolve_rev: number | null; resolve_at: string | null };
type Link = { timeline_id: string | null; timeline_name: string | null; resolve_project: string | null; lang: string | null; track_index: number | null; track_name?: string | null; link_source: string | null; lang_confirmed?: boolean;
  resolve_reason?: string | null; resolve_timeline_name?: string | null };
type Info = { languages: Track[]; link: Link; also_linked: { lang: string | null; video_title: string }[]; feedback_locked: boolean;
  video_lang?: string | null; video_lang_name?: string | null; link_lang_name?: string | null; lang_mismatch?: boolean; lang_options?: { code: string; name: string }[];
  resolve_online?: boolean | null };
type SeenTrack = { index: number; name: string | null };
type Seen = { resolve_project: string | null; timelines: { id: string; name: string; subtitle_tracks?: SeenTrack[] }[] };
const trackLabel = (index: number, name: string | null | undefined) => `ST${index}${name ? ` · ${name}` : ""}`;

const T = {
  de: { tl: "Resolve-Timeline", none: "Keine Timeline verknüpft – das Resolve-Tool verknüpft sie automatisch, sobald die Timeline offen ist.", auto: "automatisch", manual: "manuell",
    track: "Spur", lang: "Sprache", also: "auch verknüpft mit", applied: (t: string) => `In Resolve übernommen um ${t}`, pending: "Wartet auf Resolve", conflict: "Konflikt in Resolve – dort auflösen",
    never: "Noch nicht in Resolve", choose: "Timeline wählen …", unlink: "Verknüpfung lösen", dl: "Herunterladen",
    openResolve: "Öffne das Projekt in Resolve, während SUBSHOT läuft – dann erscheinen die Timelines hier.", typeName: "oder Timeline-Name eingeben", set: "Setzen",
    subLang: "Untertitelsprache", mismatch: (a: string, b: string) => `Untertitelsprache ${a} ≠ Videosprache ${b}`, confirm: "Bestätigen", change: "Ändern",
    waiting: "Warte auf DaVinci …", noAnswer: "DaVinci antwortet nicht – Plugin aktualisieren oder Resolve öffnen.", offline: "DaVinci ist nicht verbunden – öffne das Projekt in Resolve mit SUBSHOT.",
    reason: (r: string, tl: string | null, n: number | null) => r === "timeline_not_open" ? `Timeline «${tl ?? "?"}» in Resolve öffnen` : r === "project_not_open" ? "Projekt in Resolve öffnen" : r === "track_missing" ? `Spur ST${n ?? "?"} fehlt in der Timeline` : r === "track_empty" ? `Spur ST${n ?? "?"} ist leer` : r,
    noTracks: "Keine Untertitelspuren gemeldet – in Resolve eine Untertitelspur anlegen und das Projekt mit laufendem SUBSHOT öffnen.", trackNone: "Spur wählen …", failed: "Konnte nicht geladen werden.", retry: "Erneut versuchen" },
  en: { tl: "Resolve timeline", none: "No timeline linked – the Resolve tool links it automatically once the timeline is open.", auto: "auto", manual: "manual",
    track: "track", lang: "language", also: "also linked with", applied: (t: string) => `Taken over in Resolve at ${t}`, pending: "Waiting for Resolve", conflict: "Conflict in Resolve – resolve it there",
    never: "Not in Resolve yet", choose: "Choose timeline …", unlink: "Unlink", dl: "Download",
    openResolve: "Open the project in Resolve with SUBSHOT running – its timelines then show up here.", typeName: "or type the timeline name", set: "Set",
    subLang: "Subtitle language", mismatch: (a: string, b: string) => `Subtitle language ${a} ≠ video language ${b}`, confirm: "Confirm", change: "Change",
    waiting: "Waiting for DaVinci …", noAnswer: "DaVinci isn't answering – update the plugin or open Resolve.", offline: "DaVinci isn't connected – open the project in Resolve with SUBSHOT running.",
    reason: (r: string, tl: string | null, n: number | null) => r === "timeline_not_open" ? `Open the timeline «${tl ?? "?"}» in Resolve` : r === "project_not_open" ? "Open the project in Resolve" : r === "track_missing" ? `Track ST${n ?? "?"} is missing in the timeline` : r === "track_empty" ? `Track ST${n ?? "?"} is empty` : r,
    noTracks: "No subtitle tracks reported – add a subtitle track in Resolve and open the project with SUBSHOT running.", trackNone: "Choose track …", failed: "Couldn't be loaded.", retry: "Try again" },
};

export function ResolveSyncBar({ versionId, videoId, canEdit, onTracksChanged }: { versionId: string; videoId?: string; canEdit: boolean; onTracksChanged?: () => void }) {
  const api = useApi();
  const { language } = useLanguage();
  const L = T[language === "en" ? "en" : "de"];
  const [info, setInfo] = useState<Info | null>(null);
  const [seen, setSeen] = useState<Seen | null>(null);
  const [typed, setTyped] = useState("");
  const [changing, setChanging] = useState(false);
  const [failed, setFailed] = useState(false);
  // 2026-11-16 (v1.8) — after picking a timeline / track the plugin uploads at once; wait ~20 s, then say so
  const [waitSince, setWaitSince] = useState<number | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (waitSince == null) return;
    const iv = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, [waitSince]);
  const revKey = useRef<string | null>(null);

  // 2026-11-16 — never hide the bar: errors show a retry; polls every 15 s so plugin uploads show up without reload
  const load = useCallback(() => {
    api.subtitleTracks(versionId).then((d: Info) => {
      setInfo(d); setFailed(false);
      const key = d.languages.map((t) => `${t.lang}:${t.rev}`).sort().join(",");
      if (revKey.current !== null && revKey.current !== key) onTracksChanged?.();
      revKey.current = key;
    }).catch(() => setFailed(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId]);
  useEffect(() => {
    revKey.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on open
    load();
    api.resolveTimelines().then(setSeen).catch(() => {});
    // 2026-11-16 — instant via Pusher (video-<id> «changed»: subtitle revisions, «taken over in Resolve», links);
    // the 60 s poll is only the fallback when Pusher is unavailable
    const unsub = videoId ? subscribeToChanges("video", videoId, () => { load(); api.resolveTimelines().then(setSeen).catch(() => {}); }) : () => {};
    const iv = setInterval(() => { if (document.visibilityState === "visible") load(); }, 60000);
    return () => { clearInterval(iv); unsub(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  if (!info) {
    return (
      <div data-resolve-sync className="mb-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/70">
        <span className="font-semibold text-white/85">🎬 {L.tl}</span>
        {failed ? (
          <span className="ml-2 text-amber-200/90">{L.failed} <button type="button" onClick={load} className="ml-1 underline">{L.retry}</button></span>
        ) : (
          <span className="ml-2 text-white/40">…</span>
        )}
      </div>
    );
  }
  const link = info.link;
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString(language === "en" ? "en-GB" : "de-CH", { hour: "2-digit", minute: "2-digit" }) : "");
  const choose = async (id: string) => {
    if (id === "__none") await api.setResolveLink(versionId, { timeline_id: null, timeline_name: null, resolve_project: null });
    else {
      const tl = seen?.timelines.find((x) => x.id === id);
      await api.setResolveLink(versionId, { timeline_id: id, timeline_name: tl?.name ?? null, resolve_project: seen?.resolve_project ?? null });
      setWaitSince(Date.now());
    }
    load();
  };
  const save = async (body: Record<string, unknown>) => { await api.setResolveLink(versionId, body); setChanging(false); setWaitSince(Date.now()); load(); };
  const options = [...(seen?.timelines ?? [])];
  // 2026-11-16 — only the subtitle tracks the plugin reported for THIS timeline, labelled with Resolve's track name
  const tracks: SeenTrack[] = [...((link.timeline_id && seen?.timelines.find((x) => x.id === link.timeline_id)?.subtitle_tracks) || [])].sort((a, b) => a.index - b.index);
  if (link.track_index != null && !tracks.some((t) => t.index === link.track_index)) tracks.unshift({ index: link.track_index, name: link.track_name ?? null });
  if (link.timeline_id && !options.some((o) => o.id === link.timeline_id)) options.unshift({ id: link.timeline_id, name: link.timeline_name || link.timeline_id });

  return (
    <div data-resolve-sync className="mb-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/70">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-white/85">🎬 {L.tl}</span>
        {link.timeline_id ? (
          <span className="text-white/80">
            «{link.timeline_name || link.timeline_id}»{link.track_index != null && ` · ${trackLabel(link.track_index, link.track_name)}`}{link.lang && ` · ${link.lang.toUpperCase()}`}
            {link.link_source && <span className="ml-1 text-white/40">({link.link_source === "auto" ? L.auto : L.manual})</span>}
          </span>
        ) : (
          <span className="text-amber-200/90">{L.none}</span>
        )}
      </div>
      {canEdit && (
        <div className="mt-2 flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <select value={link.timeline_id ?? ""} disabled={options.length === 0} onChange={(e) => choose(e.target.value)}
              className="min-w-0 flex-1 rounded-md bg-white/10 px-2 py-1 text-xs outline-none disabled:opacity-50" data-timeline-select>
              <option value="" disabled>{L.choose}</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              {link.timeline_id && <option value="__none">{L.unlink}</option>}
            </select>
            <select value={link.track_index ?? ""} disabled={tracks.length === 0} data-track-select
              onChange={(e) => { const n = e.target.value === "" ? null : Number(e.target.value); save({ track_index: n, track_name: tracks.find((t) => t.index === n)?.name ?? null }); }}
              className="rounded-md bg-white/10 px-2 py-1 text-xs outline-none disabled:opacity-50" title={L.track}>
              <option value="">{tracks.length ? L.trackNone : `${L.track} –`}</option>
              {tracks.map((t) => <option key={t.index} value={t.index}>{trackLabel(t.index, t.name)}</option>)}
            </select>
          </div>
          {link.timeline_id && tracks.length === 0 && <p className="text-white/45" data-no-tracks>{L.noTracks}</p>}
          {options.length === 0 && <p className="text-white/45">{L.openResolve}</p>}
          <div className="flex items-center gap-1.5">
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={L.typeName}
              className="min-w-0 flex-1 rounded-md bg-white/[0.06] border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30" />
            <button type="button" disabled={!typed.trim()} onClick={() => { save({ timeline_name: typed.trim(), timeline_id: null }); setTyped(""); }}
              className="rounded-md bg-[#1f6feb] px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-40">{L.set}</button>
          </div>
        </div>
      )}
      {info.lang_mismatch && !changing && (
        <div className="mt-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-amber-100" data-lang-mismatch>
          <p className="font-semibold">⚠ {L.mismatch(info.link_lang_name || link.lang || "?", info.video_lang_name || info.video_lang || "?")}</p>
          {canEdit && (
            <div className="mt-1.5 flex gap-1.5">
              <button type="button" onClick={() => save({ lang_confirmed: true })} className="rounded-md bg-amber-300/20 px-2.5 py-1 text-xs font-semibold hover:bg-amber-300/30">{L.confirm}</button>
              <button type="button" onClick={() => setChanging(true)} className="rounded-md bg-white/10 px-2.5 py-1 text-xs hover:bg-white/15">{L.change}</button>
            </div>
          )}
        </div>
      )}
      {canEdit && (changing || !link.lang) && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-white/55">{L.subLang}</span>
          <select value={link.lang ?? ""} onChange={(e) => save({ lang: e.target.value })} className="rounded-md bg-white/10 px-2 py-1 text-xs outline-none" data-lang-select>
            <option value="" disabled>–</option>
            {(info.lang_options ?? []).map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
          </select>
        </div>
      )}
      {info.also_linked.length > 0 && (
        <p className="mt-1 text-white/45">{L.also}: {info.also_linked.map((a) => `${a.video_title}${a.lang ? ` (${a.lang.toUpperCase()})` : ""}`).join(", ")}</p>
      )}
      {(() => {
        const linked = !!(link.timeline_id || link.timeline_name);
        if (!linked) return null;
        if (link.resolve_reason) {
          return <p data-resolve-reason className="mt-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-amber-100">⚠ {L.reason(link.resolve_reason, link.resolve_timeline_name ?? link.timeline_name, link.track_index)}</p>;
        }
        if (info.languages.length > 0) return null;
        if (info.resolve_online === false) return <p data-resolve-offline className="mt-2 text-amber-200/90">{L.offline}</p>;
        const waited = waitSince != null ? Date.now() - waitSince : null;
        if (waited != null && waited < 20000) return <p data-resolve-waiting className="mt-2 flex items-center gap-2 text-white/70"><span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />{L.waiting}</p>;
        if (waited != null) return <p data-resolve-noanswer className="mt-2 text-amber-200/90">{L.noAnswer}</p>;
        return null;
      })()}
      {info.languages.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {info.languages.map((t) => {
            const st = t.resolve_status;
            const label = st === "applied" ? L.applied(fmt(t.resolve_at)) : st === "conflict" ? L.conflict : st === "pending" ? L.pending : L.never;
            const color = st === "applied" ? "text-emerald-300" : st === "conflict" ? "text-orange-300" : st === "pending" ? "text-amber-200" : "text-white/40";
            return (
              <div key={t.lang} className="flex items-center gap-2">
                <span className="w-8 font-semibold text-white/80">{t.lang.toUpperCase()}</span>
                <span className={color}>● {label}</span>
                <span className="ml-auto flex gap-1.5">
                  {(["srt", "vtt"] as const).map((f) => (
                    <a key={f} href="#" onClick={(e) => { e.preventDefault(); api.downloadSubtitleTrack(versionId, t.lang, f); }}
                      className="rounded-md bg-white/[0.06] px-2 py-0.5 text-white/70 hover:bg-white/[0.12]" title={L.dl}>{f.toUpperCase()}</a>
                  ))}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
