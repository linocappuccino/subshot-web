"use client";

/**
 * 2026-11-12, Lino: «🎙️ Live-Dubbing»-Node — record dubbed voice-overs right on the canvas.
 *
 * In the node: the original video with a quick check (Original / Aufnahme / KI-Dubbing), the target languages,
 * the sections with their take status, the exports (one WAV per language over the full length, ZIP of takes)
 * and «Studio öffnen». The studio (full screen) is where sections and scripts are set and takes are recorded:
 * microphone choice with level meter, «Kopfhörer auf?», Bluetooth warning, 3-2-1 count-in with beeps, the
 * section plays with the original quietly as a guide while the script scrolls like karaoke; every take is
 * kept in IndexedDB first, then uploaded to R2 (lib/dubbingRecorder.ts).
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DubbingElement, DubbingSection, DubbingTake } from "@/lib/board";
import { backupTake, dropBackup, DubRecorder, listMics, pendingBackups, type MicInfo } from "@/lib/dubbingRecorder";

export interface BoardDubbingApi {
  takes: (nodeId: string) => Promise<DubbingTake[]>;
  uploadTake: (nodeId: string, wav: Blob, sectionId: string, lang: string, seconds: number) => Promise<DubbingTake[]>;
  best: (nodeId: string, takeId: string) => Promise<DubbingTake[]>;
  remove: (nodeId: string, takeId: string) => Promise<DubbingTake[]>;
  exportUrl: (nodeId: string, lang: string, kind: "wav" | "zip") => Promise<string>;
  uploadVideo: (file: File) => Promise<{ key: string; src: string; name: string; mime: string }>;
  /** phase 3: KI-Dubbing via the team's own ElevenLabs key (team only) */
  aiInfo?: (nodeId: string) => Promise<{ available: boolean; jobs: Record<string, { status: string; error?: string }> }>;
  startAi?: (nodeId: string, lang: string) => Promise<void>;
  /** phase 2: link for external speakers (team only) */
  shareLink?: (nodeId: string) => Promise<string>;
}
export const BoardDubbingContext = createContext<BoardDubbingApi | null>(null);

export type DubbingPatch = Partial<Pick<DubbingElement, "title" | "asset_key" | "src" | "name" | "mime" | "duration" | "languages" | "sections" | "video_ar" | "w">>;

/** 2026-11-12, Lino: the tile width that suits the video format (9:16 narrow, 16:9 wide) */
export function dubbingTileWidth(ar: number): number {
  if (ar < 0.7) return 360; // 9:16
  if (ar < 0.9) return 420; // 4:5
  if (ar < 1.2) return 480; // 1:1
  return 640; // 16:9
}

const LANG_NAMES: Record<string, string> = { de: "Deutsch", fr: "Französisch", it: "Italienisch", en: "Englisch", es: "Spanisch", pt: "Portugiesisch", nl: "Niederländisch", rm: "Rätoromanisch" };
const langName = (l: string) => LANG_NAMES[l] ?? l.toUpperCase();
const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const newId = () => Math.random().toString(36).slice(2, 10);

function chosen(takes: DubbingTake[], sectionId: string, lang: string): DubbingTake | null {
  const own = takes.filter((t) => t.section_id === sectionId && t.lang === lang);
  return own.find((t) => t.best) ?? own[own.length - 1] ?? null;
}

type MixPick = { take: DubbingTake; start: number } | "mute" | null;

/** 2026-11-13, Lino: the playback sound — «No sound» (nothing, takes neither) / «Split sound» (original where no
 * take, else only the take) / «Full audio» (original throughout). The node carries a default (sound_mode, also via
 * MCP); each person's own choice is remembered in the browser and wins. Not while recording («Videoton» rules). */
export type SoundMode = "none" | "split" | "full";
const SOUND_KEY = "subshot-dubbing-sound-mode";
const SOUND_EVENT = "subshot-dubbing-sound-mode";
function useSoundMode(nodeDefault?: SoundMode): [SoundMode, (m: SoundMode) => void] {
  const read = (): SoundMode | null => {
    try {
      const v = localStorage.getItem(SOUND_KEY);
      return v === "none" || v === "split" || v === "full" ? v : null;
    } catch {
      return null;
    }
  };
  const [own, setOwn] = useState<SoundMode | null>(read);
  useEffect(() => {
    // tile and studio stay in step
    const on = () => setOwn(read());
    window.addEventListener(SOUND_EVENT, on);
    return () => window.removeEventListener(SOUND_EVENT, on);
  }, []);
  const set = (m: SoundMode) => {
    try {
      localStorage.setItem(SOUND_KEY, m);
    } catch {
      // private mode
    }
    setOwn(m);
    window.dispatchEvent(new Event(SOUND_EVENT));
  };
  return [own ?? nodeDefault ?? "split", set];
}
function SoundModeSwitch({ value, onChange, small }: { value: SoundMode; onChange: (m: SoundMode) => void; small?: boolean }) {
  const opts: [SoundMode, string, string][] = [
    ["none", "🔇 No sound", "Kein Ton, auch keine Takes"],
    ["split", "🎙️ Split sound", "Originalton, wo nichts aufgenommen ist — sonst nur der Take"],
    ["full", "🔊 Full audio", "Originalton durchgehend, keine Takes"],
  ];
  return (
    <div data-sound-mode={value} className={`flex rounded-lg bg-black/30 p-0.5 font-semibold ${small ? "text-[11px]" : "text-xs"}`}>
      {opts.map(([m, label, title]) => (
        <button key={m} type="button" data-sound-option={m} title={title} onClick={() => onChange(m)} className={`px-2 py-1 rounded-md whitespace-nowrap ${value === m ? "bg-white text-black" : "text-white/60 hover:text-white"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** the take of the section under the playhead (★, else the newest) — null where nothing is recorded */
function sectionTake(sections: DubbingElement["sections"], takes: DubbingTake[], lang: string, t: number): MixPick {
  const sec = sections.find((s) => t >= s.start && t < s.end);
  const take = sec ? chosen(takes.filter((x) => x.source !== "ai"), sec.id, lang) : null;
  return sec && take ? { take, start: sec.start } : null;
}

/** 2026-11-13, Lino: playback mix for tile + studio — the original sound plays where `pick` gives nothing; with a
 * take the original fades out (~40 ms, no clicks) and only the take plays, in sync with the picture; "mute" =
 * original silent, no take. Checked every frame (section edges exact; scrub, jump, pause follow). While
 * `active` is false (recording, single-take preview) it keeps its hands off the video and stays silent. */
function useTakeMix(videoRef: React.RefObject<HTMLVideoElement | null>, pick: (t: number) => MixPick, active: boolean) {
  const pickRef = useRef(pick);
  const activeRef = useRef(active);
  useLayoutEffect(() => {
    pickRef.current = pick;
    activeRef.current = active;
  });
  useEffect(() => {
    const a = new Audio();
    a.preload = "auto";
    let level = NaN; // the last target — only a change fades (the player's own mute button stays usable)
    let fade = 0;
    const fadeTo = (v: HTMLVideoElement, target: number) => {
      if (level === target) return;
      level = target;
      cancelAnimationFrame(fade);
      if (target > 0) v.muted = false;
      const from = v.muted ? 0 : v.volume;
      const t0 = performance.now();
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / 40);
        try {
          v.volume = from + (target - from) * k;
        } catch {
          // iOS: volume is read-only — the mute below does it
        }
        if (k < 1) fade = requestAnimationFrame(step);
        else if (target === 0) v.muted = true;
      };
      fade = requestAnimationFrame(step);
    };
    const sync = () => {
      const v = videoRef.current;
      if (!v) return;
      if (!activeRef.current) {
        if (!a.paused) a.pause();
        cancelAnimationFrame(fade);
        level = NaN;
        return;
      }
      const p = pickRef.current(v.currentTime);
      fadeTo(v, p ? 0 : 1);
      if (!p || p === "mute" || v.paused || v.seeking) {
        if (!a.paused) a.pause();
        return;
      }
      if (a.dataset.take !== p.take.id) {
        a.src = p.take.url;
        a.dataset.take = p.take.id;
      }
      const want = v.currentTime - p.start;
      if (a.duration && want >= a.duration) {
        if (!a.paused) a.pause();
        return;
      }
      if (Math.abs(a.currentTime - want) > 0.08) a.currentTime = want;
      if (a.paused) void a.play().catch(() => {});
    };
    // what is audible right now (read by the browser tests: data-mix = take id, data-mix-at = take time)
    const mark = () => {
      const v = videoRef.current;
      if (!v) return;
      const on = !a.paused && a.dataset.take ? a.dataset.take : "";
      if (v.dataset.mix !== on) v.dataset.mix = on;
      if (on) v.dataset.mixAt = a.currentTime.toFixed(2);
    };
    let raf = 0;
    const loop = () => {
      sync();
      mark();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(fade);
      a.pause();
      a.removeAttribute("src");
    };
  }, [videoRef]);
}

export function DubbingNode({
  el,
  editable,
  onCommit,
  onMeasure,
}: {
  el: DubbingElement;
  editable: boolean;
  onCommit: (patch: DubbingPatch) => void;
  onMeasure: (h: number) => void;
}) {
  const api = useContext(BoardDubbingContext);
  const [takes, setTakes] = useState<DubbingTake[]>([]);
  const [studio, setStudio] = useState(false);
  const [mode, setMode] = useState<"original" | "take" | "ai">("original");
  const [ai, setAi] = useState<{ available: boolean; jobs: Record<string, { status: string; error?: string }> } | null>(null);
  const [lang, setLang] = useState(el.languages[0] ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [newLang, setNewLang] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // the card follows its content
  const cardRef = useRef<HTMLDivElement>(null);
  const hRef = useRef(el.h);
  const measure = useRef(onMeasure);
  useLayoutEffect(() => {
    hRef.current = el.h;
    measure.current = onMeasure;
  });
  useEffect(() => {
    const node = cardRef.current;
    if (!node) return;
    const check = () => {
      const h = node.offsetHeight;
      if (Math.abs(h - hRef.current) > 1) measure.current(h);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  const reload = useCallback(() => {
    if (!api) return;
    api.takes(el.id).then(setTakes).catch(() => {});
    api.aiInfo?.(el.id).then(setAi).catch(() => {});
  }, [api, el.id]);
  useEffect(() => {
    reload();
    const id = window.setInterval(() => document.visibilityState === "visible" && reload(), 15000);
    return () => window.clearInterval(id);
  }, [reload]);
  const curLang = el.languages.includes(lang) ? lang : el.languages[0] ?? "";

  // quick check «Aufnahme» (2026-11-13, Lino): original sound where nothing is recorded, only the take inside
  // sections with a take; «KI-Dubbing»: ONE full-length audio from 00:00, the original muted throughout
  const [soundMode, setSoundMode] = useSoundMode(el.sound_mode);
  useTakeMix(
    videoRef,
    (t) => {
      if (mode === "original") return null;
      if (mode === "take" && soundMode !== "split") return soundMode === "none" ? "mute" : null;
      if (mode === "ai") {
        const aiTake = takes.find((x) => x.source === "ai" && x.lang === curLang);
        return aiTake ? { take: aiTake, start: 0 } : "mute";
      }
      return sectionTake(el.sections, takes, curLang, t);
    },
    true,
  );

  if (!api) return null; // client share pages: not here (phase 2 brings the speaker link)

  async function pickVideo(file: File) {
    if (!api) return;
    setBusy("Video wird hochgeladen …");
    try {
      const v = await api.uploadVideo(file);
      onCommit({ asset_key: v.key, src: v.src, name: v.name, mime: v.mime });
    } finally {
      setBusy(null);
    }
  }
  async function download(l: string, kind: "wav" | "zip") {
    if (!api) return;
    setBusy(kind === "wav" ? `WAV ${l.toUpperCase()} wird erstellt …` : `ZIP ${l.toUpperCase()} wird erstellt …`);
    try {
      const url = await api.exportUrl(el.id, l, kind);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${el.title || "Live-Dubbing"} – ${l}.${kind}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } finally {
      setBusy(null);
    }
  }

  const done = (sid: string, l: string) => takes.filter((t) => t.section_id === sid && t.lang === l);
  return (
    <div ref={cardRef} data-dubbing-node className="w-full rounded-xl bg-[#1d1f26] border border-rose-400/30 shadow-[0_2px_10px_rgba(0,0,0,0.35)] text-white overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 bg-rose-500/10">
        <span className="text-base">🎙️</span>
        {/* 2026-11-12, Lino: right under «Live-Dubbing» the video's file name, big — so you know which video it is */}
        <span className="flex-1 min-w-0 flex flex-col">
          <span className="truncate text-xs font-semibold text-white/60">{el.title || "Live-Dubbing"}</span>
          <span data-video-name className="text-base font-bold leading-tight break-all" title={el.name || ""}>
            {el.name || (el.asset_key ? "Video ohne Namen" : "Noch kein Video")}
          </span>
        </span>
        {el.asset_key && (
          <button data-no-drag type="button" onClick={() => setStudio(true)} className="shrink-0 rounded-lg bg-rose-500 hover:bg-rose-400 px-2.5 py-1 text-xs font-semibold">
            🎙️ Studio öffnen
          </button>
        )}
      </div>
      {!el.asset_key ? (
        <label
          data-no-drag
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const f = [...e.dataTransfer.files].find((x) => x.type.startsWith("video/"));
            if (f && editable) void pickVideo(f);
          }}
          className="m-3 flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-white/20 py-8 text-sm text-white/60 cursor-pointer hover:bg-white/5"
        >
          <span>{busy ?? "Original-Video hierher ziehen oder wählen"}</span>
          <input type="file" accept="video/*" className="hidden" disabled={!editable} onChange={(e) => e.target.files?.[0] && void pickVideo(e.target.files[0])} />
        </label>
      ) : (
        // 2026-11-12, Lino: the video in its own format, edge to edge over the tile width (no bars left / right),
        // round corners; the tile width follows the format (dubbingTileWidth)
        <div data-no-drag className="relative px-3 pt-3">
          <video
            ref={videoRef}
            src={el.src ?? undefined}
            controls
            playsInline
            data-dubbing-video
            className="block w-full h-auto rounded-xl bg-black"
            style={el.video_ar ? { aspectRatio: String(el.video_ar) } : undefined}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              const d = Math.round(v.duration * 1000) / 1000;
              const patch: DubbingPatch = {};
              if (d && Math.abs(d - (el.duration ?? 0)) > 0.01) patch.duration = d;
              const ar = v.videoWidth && v.videoHeight ? Math.round((v.videoWidth / v.videoHeight) * 10000) / 10000 : 0;
              if (ar && Math.abs(ar - (el.video_ar ?? 0)) > 0.001) {
                patch.video_ar = ar;
                // first time the format is known: the tile takes the width that suits it — only ever narrower,
                // so it never grows over its neighbours (a manual resize later is kept)
                const want = dubbingTileWidth(ar);
                if (!el.video_ar && want < el.w) patch.w = want;
              }
              if (editable && Object.keys(patch).length) onCommit(patch);
            }}
          />
        </div>
      )}
      {el.asset_key && (
        <div data-no-drag className="px-3 pt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <div className="flex rounded-lg bg-black/30 p-0.5 font-semibold">
            {([["original", "Original"], ["take", "Aufnahme"]] as const).map(([m, label]) => (
              <button key={m} type="button" onClick={() => setMode(m)} className={`px-2 py-1 rounded-md ${mode === m ? "bg-rose-500 text-white" : "text-white/60 hover:text-white"}`}>
                {label}
              </button>
            ))}
            <button
              type="button"
              disabled={!takes.some((t) => t.source === "ai" && t.lang === curLang)}
              title={takes.some((t) => t.source === "ai" && t.lang === curLang) ? "KI-Dubbing von ElevenLabs" : "Noch kein KI-Dubbing für diese Sprache"}
              onClick={() => setMode("ai")}
              className={`px-2 py-1 rounded-md disabled:text-white/25 disabled:cursor-not-allowed ${mode === "ai" ? "bg-rose-500 text-white" : "text-white/60 hover:text-white"}`}
            >
              KI-Dubbing
            </button>
          </div>
          {el.languages.length > 0 && (
            <select value={curLang} onChange={(e) => setLang(e.target.value)} className="rounded-md bg-black/30 border border-white/10 px-1.5 py-1 outline-none">
              {el.languages.map((l) => (
                <option key={l} value={l}>
                  {langName(l)}
                </option>
              ))}
            </select>
          )}
          {mode === "take" && <SoundModeSwitch value={soundMode} onChange={setSoundMode} small />}
        </div>
      )}
      <div data-no-drag className="px-3 py-2 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-white/45">Sprachen:</span>
        {el.languages.map((l) => (
          <span key={l} className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5">
            {langName(l)}
            {editable && (
              <button type="button" title="Sprache entfernen" onClick={() => onCommit({ languages: el.languages.filter((x) => x !== l) })} className="text-white/40 hover:text-red-300">
                ✕
              </button>
            )}
          </span>
        ))}
        {editable && (
          <form
            className="inline-flex"
            onSubmit={(e) => {
              e.preventDefault();
              const l = newLang.trim().toLowerCase();
              if (/^[a-z]{2}$/.test(l) && !el.languages.includes(l)) onCommit({ languages: [...el.languages, l] });
              setNewLang("");
            }}
          >
            <input value={newLang} onChange={(e) => setNewLang(e.target.value)} placeholder="+ fr, it, en …" className="w-24 rounded-md bg-black/30 border border-white/10 px-1.5 py-0.5 outline-none focus:border-rose-400 select-text" />
          </form>
        )}
      </div>
      {el.sections.length > 0 && (
        <div data-no-drag className="px-3 pb-2 flex flex-col gap-1 text-xs">
          {el.sections.map((s, i) => (
            <div key={s.id} className="flex items-center gap-2 rounded-md bg-white/[0.04] px-2 py-1">
              <span className="text-white/40 tabular-nums w-24 shrink-0">
                {i + 1}. {fmt(s.start)}–{fmt(s.end)}
              </span>
              <span className="flex-1 min-w-0 truncate">{s.label || s.scripts[curLang] || "–"}</span>
              {(() => {
                // 2026-11-12, Lino: which take counts (quick check + export): the ★ one, else the newest
                const own = takes.filter((t) => t.section_id === s.id && t.lang === curLang && t.source !== "ai");
                const c = chosen(own, s.id, curLang);
                return c ? (
                  <span data-used-take className={`shrink-0 ${c.best ? "text-amber-300" : "text-white/55"}`} title="Dieser Take wird im Schnellcheck und im Export verwendet">
                    {c.best ? `★ Take ${c.number ?? own.indexOf(c) + 1}` : `Take ${c.number ?? own.length}, neuester`}
                  </span>
                ) : null;
              })()}
              {el.languages.map((l) => {
                const n = done(s.id, l);
                return (
                  <span key={l} title={`${langName(l)}: ${n.length} Takes`} className={`rounded px-1 font-semibold ${n.some((t) => t.best) ? "bg-emerald-500/25 text-emerald-200" : n.length ? "bg-amber-500/20 text-amber-200" : "bg-white/5 text-white/30"}`}>
                    {l.toUpperCase()}
                    {n.length ? ` ${n.length}` : ""}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      )}
      {el.languages.length > 0 && takes.length > 0 && (
        <div data-no-drag className="px-3 pb-3 flex flex-wrap gap-1.5 text-xs">
          {el.languages.map((l) => (
            <span key={l} className="inline-flex gap-1">
              <button type="button" onClick={() => void download(l, "wav")} className="rounded-md bg-white/10 hover:bg-white/15 px-2 py-1 font-semibold">⤓ {l.toUpperCase()} WAV</button>
              <button type="button" onClick={() => void download(l, "zip")} className="rounded-md bg-white/5 hover:bg-white/10 px-2 py-1">ZIP</button>
            </span>
          ))}
        </div>
      )}
      {editable && el.asset_key && el.languages.length > 0 && api.startAi && (
        <div data-no-drag data-ai-dubbing className="px-3 pb-3 flex flex-col gap-1 text-xs">
          <div className="flex flex-wrap gap-1.5">
            {el.languages.map((l) => {
              const job = ai?.jobs[l];
              return (
                <button
                  key={l}
                  type="button"
                  disabled={!ai?.available || job?.status === "läuft"}
                  onClick={() => void api.startAi!(el.id, l).then(reload).catch(() => reload())}
                  className="rounded-md bg-violet-500/20 hover:bg-violet-500/35 px-2 py-1 font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  🤖 KI-Dubbing {l.toUpperCase()}
                  {job?.status === "läuft" ? " · läuft …" : job?.status === "fertig" ? " ✓" : job?.status === "fehler" ? " ⚠︎" : ""}
                </button>
              );
            })}
          </div>
          {ai && !ai.available && <span className="text-white/45">Admin kann den ElevenLabs-Schlüssel in den Team-Einstellungen hinterlegen.</span>}
          {Object.entries(ai?.jobs ?? {}).filter(([, j]) => j.status === "fehler").map(([l, j]) => (
            <span key={l} className="text-red-300">{l.toUpperCase()}: {j.error}</span>
          ))}
        </div>
      )}
      {editable && api.shareLink && el.asset_key && el.sections.length > 0 && (
        <div data-no-drag className="px-3 pb-3 flex flex-col gap-1 text-xs">
          <button
            type="button"
            onClick={() =>
              void api.shareLink!(el.id).then((u) => {
                setLink(u);
                void navigator.clipboard?.writeText(u).catch(() => {});
              })
            }
            className="self-start rounded-md bg-white/10 hover:bg-white/15 px-2 py-1 font-semibold"
          >
            🔗 Sprecher-Link
          </button>
          {link && (
            <span data-speaker-link className="break-all text-white/55">
              {link} <span className="text-emerald-300">(kopiert – gilt 30 Tage, nur für diese Aufnahme)</span>
            </span>
          )}
        </div>
      )}
      {busy && el.asset_key && <div className="px-3 pb-2 text-xs text-white/50">{busy}</div>}
      {studio && el.asset_key && (
        <DubbingStudio
          el={el}
          editable={editable}
          takes={takes}
          setTakes={setTakes}
          initialLang={curLang}
          onCommit={onCommit}
          onClose={() => {
            setStudio(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

// ── the recording studio (full screen) ─────────────────────────────────────
// 2026-11-12, Lino: «so einfach wie möglich»: the sections live on a TIMELINE under the video (click = choose, the
// team drags the ends / drags in an empty spot for a new one); the list on the right only shows them. The video
// box always has the video's own aspect (9:16, 16:9, …), as big as fits, nothing cut, no bars, round corners.

const COLORS = ["#f43f5e", "#8b5cf6", "#0ea5e9", "#10b981", "#f59e0b", "#ec4899", "#14b8a6", "#6366f1"];

/** the biggest box of `aspect` that fits into the measured area */
function useFit(aspect: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const W = el.clientWidth;
      const H = el.clientHeight;
      if (!W || !H) return;
      const w = Math.min(W, H * aspect);
      setBox({ w: Math.floor(w), h: Math.floor(w / aspect) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect]);
  return { ref, box };
}

function Timeline({
  el,
  duration,
  time,
  selected,
  takes,
  lang,
  editable,
  disabled,
  onSelect,
  onSeek,
  onScrub,
  onChange,
  onCreate,
}: {
  el: DubbingElement;
  duration: number;
  time: number;
  selected: string | null;
  takes: DubbingTake[];
  lang: string;
  editable: boolean;
  disabled: boolean;
  onSelect: (id: string) => void;
  onSeek: (t: number) => void;
  /** live while dragging on the ruler / the playhead (no stopping of anything per move) */
  onScrub: (t: number) => void;
  onChange: (id: string, start: number, end: number) => void;
  onCreate: (start: number, end: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ a: number; b: number } | null>(null);
  const [live, setLive] = useState<{ id: string; start: number; end: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const D = Math.max(0.1, duration);
  const at = (clientX: number) => {
    const r = innerRef.current!.getBoundingClientRect();
    return Math.round(Math.max(0, Math.min(D, ((clientX - r.left) / r.width) * D)) * 10) / 10;
  };
  const pct = (t: number) => `${(t / D) * 100}%`;
  // the playhead stays in view while zoomed in
  useEffect(() => {
    const sc = scrollRef.current;
    const inner = innerRef.current;
    if (!sc || !inner || zoom === 1) return;
    const x = (time / D) * inner.offsetWidth;
    if (x < sc.scrollLeft || x > sc.scrollLeft + sc.clientWidth) sc.scrollLeft = x - sc.clientWidth / 3;
  }, [time, D, zoom]);

  function drag(e: React.PointerEvent, onMove: (t: number) => void, onUp: (t: number, moved: boolean) => void) {
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - sx) > 3) moved = true;
      onMove(at(ev.clientX));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      onUp(at(ev.clientX), moved);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  // ruler / playhead: press and drag = scrub through the video
  function scrub(e: React.PointerEvent) {
    if (disabled) return;
    onSeek(at(e.clientX));
    drag(e, (t) => onScrub(t), (t) => onScrub(t));
  }
  function edge(e: React.PointerEvent, s: DubbingSection, which: "start" | "end") {
    if (!editable || disabled) return;
    const calc = (t: number) => ({ start: which === "start" ? Math.min(t, s.end - 0.3) : s.start, end: which === "end" ? Math.max(t, s.start + 0.3) : s.end });
    drag(e, (t) => setLive({ id: s.id, ...calc(t) }), (t) => {
      setLive(null);
      const c = calc(t);
      onChange(s.id, c.start, c.end);
    });
  }
  // section track, empty spot: click = jump there, press-drag = a new section (team + speakers)
  function track(e: React.PointerEvent) {
    if (disabled) return;
    const a0 = at(e.clientX);
    drag(e, (t) => editable && setDraft({ a: a0, b: t }), (t, moved) => {
      setDraft(null);
      if (editable && moved && Math.abs(t - a0) >= 0.3) onCreate(Math.min(a0, t), Math.max(a0, t));
      else onSeek(a0);
    });
  }

  const ticks = Math.min(40, Math.max(4, Math.round(8 * zoom)));
  return (
    <div className="select-none">
      <div className="flex items-center gap-2 mb-1 text-[11px] text-white/40">
        <span className="flex-1 truncate">
          {editable ? "Oben ziehen = durchs Video spulen · unten in freier Stelle ziehen = neuer Abschnitt · Enden ziehen = anpassen" : "Oben ziehen = spulen · Abschnitt anklicken = auswählen"}
        </span>
        <button type="button" title="Timeline verkleinern" disabled={zoom <= 1} onClick={() => setZoom((z) => Math.max(1, z / 2))} className="h-6 w-6 rounded-md bg-white/10 hover:bg-white/20 disabled:opacity-30">−</button>
        <span className="tabular-nums w-8 text-center">{zoom}×</span>
        <button type="button" title="Timeline vergrössern" disabled={zoom >= 16} onClick={() => setZoom((z) => Math.min(16, z * 2))} className="h-6 w-6 rounded-md bg-white/10 hover:bg-white/20 disabled:opacity-30">+</button>
      </div>
      <div ref={scrollRef} data-timeline-scroll className="overflow-x-auto overflow-y-hidden rounded-xl border border-white/10 bg-white/[0.04]">
        <div ref={innerRef} className="relative" style={{ width: `${zoom * 100}%`, minWidth: "100%" }}>
          {/* ruler: scrub */}
          <div data-ruler onPointerDown={scrub} className={`relative h-6 border-b border-white/10 touch-none ${disabled ? "" : "cursor-ew-resize"}`}>
            {Array.from({ length: ticks + 1 }, (_, i) => (
              <span key={i} className="absolute top-0 h-full border-l border-white/10 text-[9px] text-white/35 pl-0.5 tabular-nums" style={{ left: `${(i / ticks) * 100}%` }}>
                {i < ticks ? fmt((i / ticks) * D) : ""}
              </span>
            ))}
          </div>
          {/* sections */}
          <div ref={undefined} data-timeline onPointerDown={track} className={`relative h-12 touch-none ${disabled ? "" : "cursor-crosshair"}`}>
            {el.sections.map((s, i) => {
              const v = live?.id === s.id ? live : s;
              const n = takes.filter((t) => t.section_id === s.id && t.lang === lang && t.source !== "ai");
              const sel = s.id === selected;
              return (
                <div
                  key={s.id}
                  data-tl-section={s.id}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    if (!disabled) onSelect(s.id);
                  }}
                  className={`absolute top-1.5 bottom-1.5 rounded-lg px-2 flex items-center gap-1 text-[11px] font-semibold text-white overflow-hidden cursor-pointer ${sel ? "ring-2 ring-white shadow-lg" : "opacity-80 hover:opacity-100"}`}
                  style={{ left: pct(v.start), width: `calc(${pct(v.end - v.start)} - 2px)`, background: COLORS[i % COLORS.length] }}
                  title={`${i + 1}. ${s.label || ""} ${fmt(v.start)}–${fmt(v.end)}`}
                >
                  <span className="truncate">{i + 1}{s.label ? ` ${s.label}` : ""}</span>
                  {n.length > 0 && <span className="ml-auto shrink-0">{n.some((t) => t.best) ? "★" : n.length}</span>}
                  {editable && sel && !disabled && (
                    <>
                      <span data-edge="start" onPointerDown={(e) => edge(e, s, "start")} className="absolute left-0 top-0 bottom-0 w-2.5 cursor-ew-resize bg-white/50 touch-none" />
                      <span data-edge="end" onPointerDown={(e) => edge(e, s, "end")} className="absolute right-0 top-0 bottom-0 w-2.5 cursor-ew-resize bg-white/50 touch-none" />
                    </>
                  )}
                </div>
              );
            })}
            {draft && <div className="absolute top-1.5 bottom-1.5 rounded-lg border-2 border-dashed border-white/70 bg-white/10" style={{ left: pct(Math.min(draft.a, draft.b)), width: pct(Math.abs(draft.b - draft.a)) }} />}
          </div>
          {/* playhead: also draggable */}
          <div className="absolute top-0 bottom-0 pointer-events-none" style={{ left: pct(Math.min(time, D)) }}>
            <div className="absolute top-0 bottom-0 w-0.5 -ml-px bg-white" />
            <div data-playhead onPointerDown={scrub} className="absolute -top-0.5 -ml-2 h-4 w-4 rounded-full bg-white shadow pointer-events-auto cursor-ew-resize touch-none" />
          </div>
        </div>
      </div>
      <div className="flex justify-between text-[10px] text-white/35 mt-1 tabular-nums">
        <span>{fmt(time)}</span>
        <span>{fmt(D)}</span>
      </div>
    </div>
  );
}

export function DubbingStudio({
  el,
  editable,
  takes,
  setTakes,
  initialLang,
  onCommit,
  onClose,
  canChoose = true,
  header,
}: {
  el: DubbingElement;
  editable: boolean;
  takes: DubbingTake[];
  setTakes: (t: DubbingTake[]) => void;
  initialLang: string;
  onCommit: (patch: DubbingPatch) => void;
  /** omitted on the speaker page (nothing to go back to) */
  onClose?: () => void;
  /** ★ best / ✕ delete — the team only (speakers just record) */
  canChoose?: boolean;
  header?: React.ReactNode;
}) {
  const api = useContext(BoardDubbingContext)!;
  const [shared, setShared] = useState<string | null>(null);
  const [lang, setLang] = useState(initialLang);
  const [secId, setSecId] = useState<string | null>(el.sections[0]?.id ?? null);
  const [mics, setMics] = useState<MicInfo[]>([]);
  const [mic, setMic] = useState<string>("");
  const [level, setLevel] = useState(0);
  const [phase, setPhase] = useState<"idle" | "count" | "rec" | "saving">("idle");
  const [count, setCount] = useState(0);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [uploads, setUploads] = useState(0);
  const [time, setTime] = useState(0);
  const [aspect, setAspect] = useState(16 / 9);
  const [vidDur, setVidDur] = useState(el.duration ?? 0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const recRef = useRef<DubRecorder | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const sec = el.sections.find((s) => s.id === secId) ?? null;
  const nodeKey = el.id;
  // 2026-11-12, Lino: «Text über Video» — the script big over the picture (remembered per person)
  // 2026-11-12, Lino: «Videoton an / aus» while recording (remembered per person; the count-in beeps stay audible)
  const [videoSound, setVideoSound] = useState(() => {
    try {
      return localStorage.getItem("subshot-dubbing-video-sound") !== "0";
    } catch {
      return true;
    }
  });
  function toggleVideoSound() {
    setVideoSound((on) => {
      try {
        localStorage.setItem("subshot-dubbing-video-sound", on ? "0" : "1");
      } catch {
        // private mode
      }
      return !on;
    });
  }
  const videoSoundRef = useRef(videoSound);
  useEffect(() => {
    videoSoundRef.current = videoSound;
    // switched while recording → takes effect right away
    if (phase === "rec" && videoRef.current) videoRef.current.muted = !videoSound;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on the switch itself
  }, [videoSound]);
  // 2026-11-12, Lino: «Deckkraft» of the text over the video (20–100 %, remembered per person)
  const [overlayOpacity, setOverlayOpacity] = useState(() => {
    try {
      const v = Number(localStorage.getItem("subshot-dubbing-overlay-opacity"));
      return v >= 0.2 && v <= 1 ? v : 1;
    } catch {
      return 1;
    }
  });
  function changeOverlayOpacity(v: number) {
    setOverlayOpacity(v);
    try {
      localStorage.setItem("subshot-dubbing-overlay-opacity", String(v));
    } catch {
      // private mode
    }
  }
  // 2026-11-13, Lino: the text column over the video narrower (40–100 %, per person)
  const [overlayWidth, setOverlayWidth] = useState(() => {
    try {
      const v = Number(localStorage.getItem("subshot-dubbing-overlay-width"));
      return v >= 0.4 && v <= 1 ? v : 1;
    } catch {
      return 1;
    }
  });
  function changeOverlayWidth(v: number) {
    setOverlayWidth(v);
    try {
      localStorage.setItem("subshot-dubbing-overlay-width", String(v));
    } catch {
      // private mode
    }
  }
  const [overlay, setOverlay] = useState(() => {
    try {
      return localStorage.getItem("subshot-dubbing-overlay") === "1";
    } catch {
      return false;
    }
  });
  function toggleOverlay() {
    setOverlay((o) => {
      try {
        localStorage.setItem("subshot-dubbing-overlay", o ? "0" : "1");
      } catch {
        // private mode
      }
      return !o;
    });
  }
  const areaRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setArea({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setArea({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const wide = area.w >= 700 || (aspect < 1 && area.w >= 420);
  // side by side: the video as high as the area allows, but leaving the script at least ~38 % of the width
  const stageW = wide ? Math.max(160, Math.min(area.w * 0.62, area.h * aspect)) : undefined;
  const { ref: stageRef, box } = useFit(aspect);
  // 2026-11-12, Lino: play a take → the picture runs along from the section start, muted (lip-sync check)
  const previewRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  function stopPreview() {
    const a = previewRef.current;
    if (a) {
      a.onpause = a.onended = a.ontimeupdate = null;
      a.pause();
    }
    previewRef.current = null;
    const v = videoRef.current;
    if (v) {
      v.pause();
      v.muted = false;
    }
    setPlaying(null);
  }
  // 2026-11-13, Lino: normal playback in the studio = the same mix as the tile («Aufnahme»): original sound where
  // nothing is recorded, only the take inside sections with a take. Not while recording (the «Videoton» switch
  // rules there, the section being recorded never plays along) and not during a single-take preview.
  const [soundMode, setSoundMode] = useSoundMode(el.sound_mode);
  useTakeMix(
    videoRef,
    (t) => (soundMode === "none" ? "mute" : soundMode === "full" ? null : sectionTake(el.sections, takes, lang, t)),
    phase === "idle" && playing === null,
  );
  async function playTake(t: DubbingTake, start: number) {
    const v = videoRef.current;
    if (!v) return;
    if (playing === t.id) return stopPreview();
    stopPreview();
    const a = new Audio(t.url);
    a.muted = soundMode === "none"; // «No sound»: nothing, takes neither
    previewRef.current = a;
    setPlaying(t.id);
    v.muted = true;
    v.currentTime = start;
    // the takes are already latency-compensated at recording: take time 0 = the picture at the section start
    a.ontimeupdate = () => {
      const want = start + a.currentTime;
      if (Math.abs(v.currentTime - want) > 0.08) v.currentTime = want;
    };
    a.onpause = a.onended = () => stopPreview();
    await Promise.all([v.play().catch(() => {}), a.play().catch(() => stopPreview())]);
  }
  useEffect(() => () => previewRef.current?.pause(), []);
  // the page behind never scrolls while the studio is open
  useEffect(() => {
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, []);
  const duration = vidDur || el.duration || Math.max(5, ...el.sections.map((s) => s.end));

  // microphones + level meter
  useEffect(() => {
    let alive = true;
    listMics()
      .then((m) => {
        if (!alive) return;
        setMics(m);
        setMic((cur) => cur || m[0]?.deviceId || "");
      })
      .catch(() => setError("Kein Zugriff aufs Mikrofon. Bitte im Browser erlauben."));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!mic) return;
    const rec = new DubRecorder();
    recRef.current = rec;
    let raf = 0;
    rec
      .open(mic)
      .then(() => {
        const tick = () => {
          setLevel(rec.level());
          raf = requestAnimationFrame(tick);
        };
        tick();
      })
      .catch(() => setError("Das Mikrofon lässt sich nicht öffnen."));
    return () => {
      cancelAnimationFrame(raf);
      rec.close();
    };
  }, [mic]);
  // takes that never reached the server (crash, network) are uploaded again
  useEffect(() => {
    void pendingBackups(nodeKey).then(async (list) => {
      for (const t of list) {
        try {
          setTakes(await api.uploadTake(el.id, t.wav, t.sectionId, t.lang, t.seconds));
          await dropBackup(t.id);
        } catch {
          // stays in the backup
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase === "idle") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, onClose]);

  const micInfo = mics.find((m) => m.deviceId === mic);

  function choose(id: string) {
    setSecId(id);
    const s = el.sections.find((x) => x.id === id);
    if (s && videoRef.current) videoRef.current.currentTime = s.start;
  }

  async function record() {
    const rec = recRef.current;
    const v = videoRef.current;
    if (!rec || !v || !sec) return;
    setError(null);
    setPhase("count");
    v.pause();
    v.currentTime = sec.start;
    await rec.countIn(setCount);
    setPhase("rec");
    rec.start();
    v.volume = 0.15; // the original quietly as a guide
    v.muted = !videoSoundRef.current; // «Videoton aus»: the picture runs silent
    v.addEventListener("playing", () => rec.mark(), { once: true });
    await v.play().catch(() => {});
    await new Promise<void>((resolve) => {
      let raf = 0;
      const loop = () => {
        setProgress(Math.max(0, Math.min(1, (v.currentTime - sec.start) / (sec.end - sec.start))));
        if (v.currentTime >= sec.end || v.paused) return resolve();
        raf = requestAnimationFrame(loop);
      };
      stopRef.current = () => {
        cancelAnimationFrame(raf);
        resolve();
      };
      loop();
    });
    stopRef.current = null;
    v.pause();
    v.volume = 1;
    v.muted = false;
    setPhase("saving");
    const { wav, seconds } = rec.stop(sec.end - sec.start);
    const id = newId();
    // eslint-disable-next-line react-hooks/purity -- inside an event handler, not during render
    await backupTake({ id, nodeKey, sectionId: sec.id, lang, seconds, wav, at: Date.now() });
    setUploads((n) => n + 1);
    setPhase("idle");
    setProgress(0);
    try {
      setTakes(await api.uploadTake(el.id, wav, sec.id, lang, seconds));
      await dropBackup(id);
    } catch {
      setError("Upload fehlgeschlagen — der Take ist lokal gesichert und wird beim nächsten Öffnen erneut hochgeladen.");
    } finally {
      setUploads((n) => n - 1);
    }
  }

  function setSections(next: DubbingSection[]) {
    onCommit({ sections: [...next].sort((a, b) => a.start - b.start) });
  }
  function patchSection(id: string, patch: Partial<DubbingSection>) {
    setSections(el.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  const own = sec ? takes.filter((t) => t.section_id === sec.id && t.lang === lang && t.source !== "ai") : [];

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-[#111214] text-white flex flex-col"
      data-dubbing-studio
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 border-b border-white/10 shrink-0">
        <span className="text-lg">🎙️</span>
        <span className="min-w-0 flex flex-col">
          <span className="text-xs text-white/50 truncate">{el.title || "Live-Dubbing"}</span>
          <span data-studio-video-name className="font-bold break-all leading-tight">{el.name || "Video ohne Namen"}</span>
        </span>
        <select value={lang} onChange={(e) => setLang(e.target.value)} className="ml-2 rounded-md bg-white/10 px-2 py-1 text-sm">
          {el.languages.map((l) => (
            <option key={l} value={l}>
              {langName(l)}
            </option>
          ))}
        </select>
        <SoundModeSwitch value={soundMode} onChange={setSoundMode} />
        {/* 2026-11-13, Lino: share from the studio — the speaker link opens only this studio (no board, no login) */}
        {canChoose && api.shareLink && el.asset_key && (
          <button
            type="button"
            data-studio-share
            onClick={() => {
              void api.shareLink!(el.id)
                .then((u) => {
                  setShared(u);
                  void navigator.clipboard?.writeText(u).catch(() => {});
                })
                .catch(() => setShared("error"));
            }}
            className="rounded-lg bg-rose-500 hover:bg-rose-400 px-3 py-1.5 text-sm font-semibold"
          >
            🔗 Teilen
          </button>
        )}
        {shared && (
          <span data-studio-share-link className="text-xs text-white/60 break-all max-w-[22rem]">
            {shared === "error" ? <span className="text-red-300">Link konnte nicht erstellt werden.</span> : <>
              <span className="text-emerald-300">Link kopiert</span> – öffnet nur dieses Studio, ohne Login (30 Tage): {shared}
            </>}
          </span>
        )}
        {uploads > 0 && <span className="text-xs text-amber-300">Lädt {uploads} Take{uploads > 1 ? "s" : ""} hoch …</span>}
        {header}
        {onClose && (
          <button type="button" onClick={onClose} disabled={phase !== "idle"} className="ml-auto rounded-lg bg-white/10 hover:bg-white/15 px-3 py-1.5 text-sm disabled:opacity-40">
            Schliessen
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 flex flex-col md:flex-row max-md:overflow-auto">
        {/* 2026-11-12, Lino: the script to read LEFT, the video RIGHT right next to it (same height), the timeline
            under both; on narrow screens (iPad portrait, phone) the script sits above the video */}
        <div className="flex-1 min-w-0 min-h-0 max-md:min-h-[calc(100dvh-56px)] flex flex-col p-3 md:p-4 gap-3">
          <div ref={areaRef} className={`flex-1 min-h-0 flex gap-3 ${wide ? "flex-row items-center" : "flex-col"}`}>
            <div className={wide ? "flex-1 min-w-0 flex flex-col justify-center gap-1.5" : "shrink-0 flex flex-col gap-1.5"} style={wide ? { height: box.h || undefined } : undefined}>
              <div className="flex justify-end items-center gap-3">
                {overlay && (
                  <label className="flex items-center gap-2 text-xs text-white/70" title="Deckkraft vom Text über dem Video">
                    Deckkraft
                    <input
                      type="range"
                      data-overlay-opacity
                      min={20}
                      max={100}
                      step={5}
                      value={Math.round(overlayOpacity * 100)}
                      onChange={(e) => changeOverlayOpacity(Number(e.target.value) / 100)}
                      className="w-24 accent-rose-500"
                    />
                    <span className="w-8 tabular-nums text-right">{Math.round(overlayOpacity * 100)} %</span>
                  </label>
                )}
                {overlay && (
                  <label className="flex items-center gap-2 text-xs text-white/70" title="Breite der Textspalte über dem Video">
                    Breite
                    <input
                      type="range"
                      data-overlay-width
                      min={40}
                      max={100}
                      step={5}
                      value={Math.round(overlayWidth * 100)}
                      onChange={(e) => changeOverlayWidth(Number(e.target.value) / 100)}
                      className="w-20 accent-rose-500"
                    />
                  </label>
                )}
                <button
                  type="button"
                  data-overlay-toggle
                  onClick={toggleOverlay}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${overlay ? "bg-rose-500 text-white" : "bg-white/10 text-white/70 hover:bg-white/15"}`}
                >
                  {overlay ? "✓ Text über Video" : "Text über Video"}
                </button>
              </div>
              <ScriptBox
                height={wide && box.h ? Math.max(80, box.h - 34) : undefined}
              key={`${secId ?? "none"}-${lang}`}
              text={sec?.scripts[lang] ?? ""}
              langLabel={langName(lang)}
              editable={editable && phase === "idle"}
              recording={phase === "rec"}
              progress={progress}
              hasSection={!!sec}
              onChange={(text) => {
                if (sec) patchSection(sec.id, { scripts: { ...sec.scripts, [lang]: text } });
                else {
                  // no section yet: the text belongs to one over the whole video
                  const s: DubbingSection = { id: newId(), start: 0, end: Math.round(duration * 10) / 10, label: "", scripts: { [lang]: text } };
                  setSections([...el.sections, s]);
                  setSecId(s.id);
                }
              }}
            />
            </div>
            <div ref={stageRef} data-stage className={wide ? "h-full flex items-center justify-end" : "flex-1 min-h-[160px] flex items-center justify-center"} style={wide ? { width: stageW } : undefined}>
            <div className="relative rounded-2xl overflow-hidden bg-black shadow-2xl" style={{ width: box.w || undefined, height: box.h || undefined }} data-video-box>
              <video
                ref={videoRef}
                src={el.src ?? undefined}
                controls={phase === "idle"}
                playsInline
                className="absolute inset-0 w-full h-full"
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  if (v.videoWidth && v.videoHeight) setAspect(v.videoWidth / v.videoHeight);
                  if (v.duration && Number.isFinite(v.duration)) setVidDur(v.duration);
                }}
                onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
              />
              {phase === "count" && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <span data-countin className="text-8xl font-bold">{count || "Los"}</span>
                </div>
              )}
              {phase === "rec" && <span className="absolute left-3 top-3 rounded-full bg-red-600 px-2.5 py-1 text-xs font-bold animate-pulse">● REC</span>}
              {overlay && sec && (sec.scripts[lang] ?? "").trim() && (
                <OverlayText text={sec.scripts[lang] ?? ""} recording={phase === "rec"} progress={progress} boxW={box.w} boxH={box.h} opacity={overlayOpacity} widthPct={overlayWidth} />
              )}
            </div>
            </div>
          </div>
          <div className="shrink-0">
            <Timeline
              el={el}
              duration={duration}
              time={time}
              selected={secId}
              takes={takes}
              lang={lang}
              editable={editable}
              disabled={phase !== "idle"}
              onSelect={(id) => {
                stopPreview();
                choose(id);
              }}
              onSeek={(t) => {
                stopPreview();
                if (videoRef.current) videoRef.current.currentTime = t;
                setTime(t);
              }}
              onScrub={(t) => {
                if (videoRef.current) videoRef.current.currentTime = t;
                setTime(t);
              }}
              onChange={(id, start, end) => patchSection(id, { start, end })}
              onCreate={(start, end) => {
                const s: DubbingSection = { id: newId(), start, end, label: "", scripts: {} };
                setSections([...el.sections, s]);
                setSecId(s.id);
              }}
            />
          </div>
        </div>
        {/* right: record + takes, the section list only shows */}
        <div className="w-full md:w-[340px] shrink-0 min-h-0 border-t md:border-t-0 md:border-l border-white/10 p-4 flex flex-col gap-4 overflow-auto">
          <div>
            <div className="text-xs uppercase tracking-wide text-white/40 mb-1.5">Mikrofon</div>
            <select data-mic-select value={mic} onChange={(e) => setMic(e.target.value)} className="w-full rounded-md bg-white/10 px-2 py-1.5 text-sm">
              {mics.map((m) => (
                <option key={m.deviceId} value={m.deviceId}>
                  {m.label}
                </option>
              ))}
            </select>
            <div className="mt-2 h-2 rounded-full bg-white/10 overflow-hidden">
              <div data-level className={`h-full ${level > 0.9 ? "bg-red-500" : level > 0.6 ? "bg-amber-400" : "bg-emerald-400"}`} style={{ width: `${Math.min(100, level * 100)}%` }} />
            </div>
            <p className="mt-2 text-xs text-white/55">🎧 Kopfhörer auf? Sonst nimmt das Mikrofon das Original mit auf.</p>
            {micInfo?.bluetooth && <p data-bt-warning className="mt-1 text-xs text-amber-300">⚠︎ Bluetooth-Gerät: Ton verzögert und schlechtere Qualität. Besser Kabel.</p>}
            {error && <p className="mt-1 text-xs text-red-300">{error}</p>}
          </div>
          {sec ? (
            <div className="flex flex-col gap-2">
              <div className="text-sm font-semibold">
                Abschnitt {el.sections.indexOf(sec) + 1}
                <span className="ml-2 font-normal text-white/45 tabular-nums">{fmt(sec.start)}–{fmt(sec.end)}</span>
              </div>
              <button
                type="button"
                data-video-sound
                aria-pressed={videoSound}
                onClick={toggleVideoSound}
                title="Videoton während der Aufnahme"
                className={`rounded-xl py-2 text-sm font-semibold border ${videoSound ? "border-white/15 bg-white/10 text-white" : "border-amber-300/40 bg-amber-300/15 text-amber-200"}`}
              >
                {videoSound ? "🔊 Videoton an" : "🔇 Videoton aus"}
              </button>
              {phase === "rec" ? (
                <button type="button" onClick={() => stopRef.current?.()} className="rounded-xl bg-white text-black py-3 font-bold">
                  ■ Stopp
                </button>
              ) : (
                <button type="button" data-record disabled={phase !== "idle" || !mic} onClick={() => { stopPreview(); void record(); }} className="rounded-xl bg-red-600 hover:bg-red-500 py-3 font-bold disabled:opacity-50">
                  {phase === "count" ? "…" : phase === "saving" ? "Speichert …" : "● Aufnehmen"}
                </button>
              )}
              {editable && (
                <>
                  <input value={sec.label ?? ""} placeholder="Bezeichnung (optional)" onChange={(e) => patchSection(sec.id, { label: e.target.value })} className="rounded-md bg-white/10 px-2 py-1.5 text-sm select-text" />
                  {canChoose && <button type="button" onClick={() => { setSections(el.sections.filter((s) => s.id !== sec.id)); setSecId(null); }} className="self-start text-xs text-white/40 hover:text-red-300">
                    Abschnitt löschen
                  </button>}
                </>
              )}
              <div className="text-xs uppercase tracking-wide text-white/40 mt-1">Takes ({langName(lang)})</div>
              {own.map((t, i) => (
                <div key={t.id} data-take className="flex items-center gap-2 rounded-lg bg-white/[0.05] px-2 py-1.5 text-sm">
                  <button
                    type="button"
                    data-take-play
                    onClick={() => void playTake(t, sec.start)}
                    title="Take mit dem Bild abspielen (Lippensynchronität prüfen)"
                    className={`h-8 w-8 shrink-0 rounded-full flex items-center justify-center ${playing === t.id ? "bg-white text-black" : "bg-white/10 hover:bg-white/20"}`}
                  >
                    {playing === t.id ? "■" : "▶"}
                  </button>
                  <span className="flex-1 min-w-0 text-white/70">
                    Take {t.number ?? i + 1}
                    <span className="ml-1.5 text-xs text-white/35">{t.duration ? `${t.duration.toFixed(1)} s` : ""}{t.speaker_name ? ` · ${t.speaker_name}` : ""}</span>
                  </span>
                  {t.download_url && (
                    <a href={t.download_url} download title="Take herunterladen (WAV)" data-take-download className="text-white/45 hover:text-white text-lg leading-none">
                      ⬇
                    </a>
                  )}
                  {canChoose ? (
                    <button type="button" title="Bester Take" onClick={() => void api.best(el.id, t.id).then(setTakes)} className={`text-lg ${t.best ? "text-amber-300" : "text-white/30 hover:text-white"}`}>
                      ★
                    </button>
                  ) : (
                    t.best && <span title="Vom Team als bester Take gewählt" className="text-lg text-amber-300">★</span>
                  )}
                  {editable && canChoose && (
                    <button type="button" title="Take löschen" onClick={() => void api.remove(el.id, t.id).then(setTakes)} className="text-white/30 hover:text-red-300">
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {own.length === 0 && <p className="text-xs text-white/40">Noch kein Take für diesen Abschnitt.</p>}
              {takes
                .filter((t) => t.source === "ai" && t.lang === lang)
                .map((t) => (
                  <div key={t.id} data-take-ai className="flex items-center gap-2 rounded-lg bg-violet-500/10 px-2 py-1.5 text-sm">
                    <button type="button" data-take-play onClick={() => void playTake(t, 0)} className={`h-8 w-8 shrink-0 rounded-full flex items-center justify-center ${playing === t.id ? "bg-white text-black" : "bg-white/10 hover:bg-white/20"}`}>
                      {playing === t.id ? "■" : "▶"}
                    </button>
                    <span className="flex-1 text-white/70">🤖 KI-Dubbing (ganzes Video)</span>
                    {t.download_url && (
                      <a href={t.download_url} download title="KI-Dubbing herunterladen" data-take-download className="text-white/45 hover:text-white text-lg leading-none">
                        ⬇
                      </a>
                    )}
                  </div>
                ))}
            </div>
          ) : (
            <p className="text-sm text-white/45">Wähle unten auf der Timeline einen Abschnitt.</p>
          )}
          {el.sections.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wide text-white/40 mb-1.5">Abschnitte</div>
              <div className="flex flex-col gap-1">
                {el.sections.map((s, i) => {
                  const n = takes.filter((t) => t.section_id === s.id && t.lang === lang && t.source !== "ai");
                  return (
                    <div key={s.id} data-section={s.id} className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm ${secId === s.id ? "bg-white/15 ring-1 ring-white/40" : "bg-white/[0.04]"}`}>
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                      <span className="text-white/45 tabular-nums text-xs w-[5.5rem] shrink-0">{fmt(s.start)}–{fmt(s.end)}</span>
                      <span className="flex-1 min-w-0 truncate">{s.label || s.scripts[lang] || "–"}</span>
                      <span className={`text-xs ${n.some((t) => t.best) ? "text-emerald-300" : n.length ? "text-amber-300" : "text-white/30"}`}>{n.length ? `${n.length}` : "–"}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** 2026-11-12, Lino: «eine Textbox, wo man den Text ablesen kann — gross dargestellt». The script of the chosen
 * section, big and high-contrast under the video: the team types / pastes straight into it (saved automatically),
 * speakers only read; while recording the words light up and long texts scroll along. */
function ScriptBox({
  text,
  langLabel,
  editable,
  recording,
  progress,
  hasSection,
  onChange,
  height,
}: {
  height?: number;
  text: string;
  langLabel: string;
  editable: boolean;
  recording: boolean;
  progress: number;
  hasSection: boolean;
  onChange: (text: string) => void;
}) {
  const [draft, setDraft] = useState(text);
  const [focused, setFocused] = useState(false);
  // 2026-11-13, Lino: the reading column narrower / wider by dragging the right edge (40–100 %, per person)
  const [width, setWidth] = useState(() => {
    try {
      const v = Number(localStorage.getItem("subshot-dubbing-script-width"));
      return v >= 0.4 && v <= 1 ? v : 1;
    } catch {
      return 1;
    }
  });
  const wrapRef = useRef<HTMLDivElement>(null);
  function dragWidth(e: React.PointerEvent<HTMLSpanElement>) {
    const wrap = wrapRef.current;
    if (!wrap) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = wrap.getBoundingClientRect();
    const move = (ev: PointerEvent) => setWidth(Math.max(0.4, Math.min(1, (ev.clientX - r.left) / r.width)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setWidth((w) => {
        try {
          localStorage.setItem("subshot-dubbing-script-width", String(Math.round(w * 100) / 100));
        } catch {
          // private mode
        }
        return w;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  const handle = (
    <span
      data-script-width-handle
      title="Textbreite ziehen"
      onPointerDown={dragWidth}
      className="absolute top-2 bottom-2 w-3 -ml-1.5 cursor-ew-resize touch-none flex items-center justify-center group"
      style={{ left: `${width * 100}%` }}
    >
      <span className="h-10 w-1.5 rounded-full bg-white/25 group-hover:bg-rose-400" />
    </span>
  );
  const timer = useRef<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const shown = focused ? draft : text;
  const style: React.CSSProperties = { fontSize: "clamp(20px, 1.4vw + 10px, 32px)", lineHeight: 1.5, ...(height ? { height, maxHeight: height } : {}) };
  const sized: React.CSSProperties = { ...style, width: `${width * 100}%` };

  function save(v: string) {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onChange(v), 600);
  }
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  // karaoke: words up to the progress light up, the current line stays in view
  const words = text.split(/(\s+)/);
  const lit = Math.round(progress * words.filter((w) => w.trim()).length);
  useEffect(() => {
    if (!recording) return;
    const box = boxRef.current;
    const cur = box?.querySelector<HTMLElement>("[data-lit-last]");
    if (box && cur) box.scrollTop = Math.max(0, cur.offsetTop - box.clientHeight / 3);
  }, [lit, recording]);

  const frame = `shrink-0 rounded-2xl bg-black/40 border border-white/15 px-5 py-4 text-white overflow-auto ${height ? "" : "max-h-[26vh] min-h-[5.5rem]"}`;
  if (recording || !editable) {
    let seen = 0;
    return (
      // 2026-11-13, Lino: line breaks of the script stay while recording (pre-wrap, like the textarea)
      <div ref={wrapRef} className="relative w-full shrink-0">
      <div ref={boxRef} data-karaoke data-script-box className={`${frame} whitespace-pre-wrap break-words`} style={sized}>
        {text.trim() ? (
          words.map((w, i) => {
            if (!w.trim()) return <span key={i}>{w}</span>;
            seen += 1;
            return (
              <span key={i} data-lit-last={recording && seen === Math.max(1, lit) ? "" : undefined} className="text-white">
                {w}
              </span>
            );
          })
        ) : (
          <span className="text-white/35">{hasSection ? `Noch kein Sprechtext (${langLabel}).` : "Wähle unten auf der Timeline einen Abschnitt."}</span>
        )}
      </div>
      {handle}
      </div>
    );
  }
  return (
    <div ref={wrapRef} className="relative w-full shrink-0">
    <textarea
      data-karaoke
      data-script-box
      value={shown}
      placeholder={`Sprechtext hier einfügen (${langLabel}) …`}
      onFocus={() => {
        setDraft(text);
        setFocused(true);
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        save(e.target.value);
      }}
      onBlur={() => {
        setFocused(false);
        if (timer.current) window.clearTimeout(timer.current);
        if (draft !== text) onChange(draft);
      }}
      className={`${frame} block resize-none outline-none focus:border-rose-400 placeholder:text-white/30 select-text`}
      style={sized}
    />
    {handle}
    </div>
  );
}

/** «Text über Video» (2026-11-12, Lino: «gross über das ganze Video, nur weisse Schrift mit schwarzer Schattierung,
 * linksbündig, vertikal zentriert»): the whole script over the whole picture — no box, no background; the font is
 * as big as fits (shrunk until the whole text fits; only below ~18 px it scrolls instead); spoken words turn a
 * soft yellow while recording. The video keeps its size. */
function OverlayText({ text, recording, progress, boxW, boxH, opacity = 1, widthPct = 1 }: { text: string; recording: boolean; progress: number; boxW: number; boxH: number; opacity?: number; widthPct?: number }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(32);
  const words = text.split(/(\s+)/);
  const lit = Math.round(progress * words.filter((w) => w.trim()).length);
  const nth = words.reduce<number[]>((acc, w) => [...acc, (acc[acc.length - 1] ?? 0) + (w.trim() ? 1 : 0)], []);
  const MIN = 18;
  // biggest font size at which the whole text fits the picture
  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const cs = getComputedStyle(o);
    const availH = o.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    let lo = MIN;
    let hi = Math.max(MIN, Math.min(96, boxH * 0.22, boxW * 0.12));
    for (let k = 0; k < 9; k++) {
      const mid = (lo + hi) / 2;
      i.style.fontSize = `${mid}px`;
      if (i.scrollHeight <= availH && i.scrollWidth <= i.clientWidth + 1) lo = mid;
      else hi = mid;
    }
    i.style.fontSize = `${lo}px`;
    setSize(Math.floor(lo));
  }, [text, boxW, boxH, widthPct]);
  useEffect(() => {
    if (!recording) return;
    const o = outer.current;
    const cur = o?.querySelector<HTMLElement>("[data-lit-last]");
    if (o && cur && o.scrollHeight > o.clientHeight) o.scrollTop = Math.max(0, cur.offsetTop - o.clientHeight / 3);
  }, [lit, recording]);
  return (
    <div
      ref={outer}
      data-overlay-text
      className="absolute left-0 right-0 top-0 bottom-12 px-[6%] py-[5%] overflow-auto pointer-events-none flex"
      style={{ opacity }}
    >
      <div
        ref={inner}
        className="my-auto text-left font-bold text-white whitespace-pre-wrap break-words"
        style={{
          width: `${widthPct * 100}%`,
          fontSize: size,
          lineHeight: 1.25,
          textShadow: "0 0 3px #000, 0 0 6px #000, 2px 2px 2px #000, -1px -1px 2px #000, 1px -1px 2px #000, -1px 1px 2px #000",
          WebkitTextStroke: "0.5px rgba(0,0,0,0.6)",
        }}
      >
        {words.map((w, i) => {
          if (!w.trim()) return <span key={i}>{w}</span>;
          return (
            <span key={i} data-lit-last={recording && nth[i] === Math.max(1, lit) ? "" : undefined} >
              {w}
            </span>
          );
        })}
      </div>
    </div>
  );
}
