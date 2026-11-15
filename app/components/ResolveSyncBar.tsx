"use client";

/* 2026-11-15, Lino (DaVinci-Thread): subtitles Resolve ↔ Subshot «so automatisch wie möglich» — the review panel shows
   which Resolve timeline / subtitle track / language a version belongs to (auto-linked by the plugin, correctable
   here) and per language whether Resolve has taken the latest revision. */

import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/lib/useApi";
import { useLanguage } from "@/lib/i18n";

type Track = { lang: string; kind: string; cues: number; rev: number; resolve_status: string | null; resolve_rev: number | null; resolve_at: string | null };
type Link = { timeline_id: string | null; timeline_name: string | null; resolve_project: string | null; lang: string | null; track_index: number | null; link_source: string | null };
type Info = { languages: Track[]; link: Link; also_linked: { lang: string | null; video_title: string }[]; feedback_locked: boolean };
type Seen = { resolve_project: string | null; timelines: { id: string; name: string }[] };

const T = {
  de: { tl: "Resolve-Timeline", none: "Keine Timeline verknüpft – das Resolve-Tool verknüpft sie automatisch, sobald die Timeline offen ist.", auto: "automatisch", manual: "manuell",
    track: "Spur", lang: "Sprache", also: "auch verknüpft mit", applied: (t: string) => `In Resolve übernommen um ${t}`, pending: "Wartet auf Resolve", conflict: "Konflikt in Resolve – dort auflösen",
    never: "Noch nicht in Resolve", choose: "Timeline wählen …", unlink: "Verknüpfung lösen", dl: "Herunterladen" },
  en: { tl: "Resolve timeline", none: "No timeline linked – the Resolve tool links it automatically once the timeline is open.", auto: "auto", manual: "manual",
    track: "track", lang: "language", also: "also linked with", applied: (t: string) => `Taken over in Resolve at ${t}`, pending: "Waiting for Resolve", conflict: "Conflict in Resolve – resolve it there",
    never: "Not in Resolve yet", choose: "Choose timeline …", unlink: "Unlink", dl: "Download" },
};

export function ResolveSyncBar({ versionId, canEdit }: { versionId: string; canEdit: boolean }) {
  const api = useApi();
  const { language } = useLanguage();
  const L = T[language === "en" ? "en" : "de"];
  const [info, setInfo] = useState<Info | null>(null);
  const [seen, setSeen] = useState<Seen | null>(null);

  const load = useCallback(() => {
    api.subtitleTracks(versionId).then(setInfo).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on open
    load();
    api.resolveTimelines().then(setSeen).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  if (!info) return null;
  const link = info.link;
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString(language === "en" ? "en-GB" : "de-CH", { hour: "2-digit", minute: "2-digit" }) : "");
  const choose = async (id: string) => {
    if (id === "__none") await api.setResolveLink(versionId, { timeline_id: null, timeline_name: null, resolve_project: null });
    else {
      const tl = seen?.timelines.find((x) => x.id === id);
      await api.setResolveLink(versionId, { timeline_id: id, timeline_name: tl?.name ?? null, resolve_project: seen?.resolve_project ?? null });
    }
    load();
  };
  const options = [...(seen?.timelines ?? [])];
  if (link.timeline_id && !options.some((o) => o.id === link.timeline_id)) options.unshift({ id: link.timeline_id, name: link.timeline_name || link.timeline_id });

  return (
    <div data-resolve-sync className="mb-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/70">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-white/85">🎬 {L.tl}</span>
        {link.timeline_id ? (
          <span className="text-white/80">
            «{link.timeline_name || link.timeline_id}»{link.track_index != null && ` · ${L.track} ${link.track_index}`}{link.lang && ` · ${link.lang.toUpperCase()}`}
            {link.link_source && <span className="ml-1 text-white/40">({link.link_source === "auto" ? L.auto : L.manual})</span>}
          </span>
        ) : (
          <span className="text-amber-200/90">{L.none}</span>
        )}
        {canEdit && options.length > 0 && (
          <select value={link.timeline_id ?? ""} onChange={(e) => choose(e.target.value)} className="ml-auto rounded-md bg-white/10 px-2 py-1 text-xs outline-none">
            <option value="" disabled>{L.choose}</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            {link.timeline_id && <option value="__none">{L.unlink}</option>}
          </select>
        )}
      </div>
      {info.also_linked.length > 0 && (
        <p className="mt-1 text-white/45">{L.also}: {info.also_linked.map((a) => (a.lang || "?").toUpperCase()).join(", ")}</p>
      )}
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
