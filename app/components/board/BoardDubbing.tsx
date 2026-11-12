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

export type DubbingPatch = Partial<Pick<DubbingElement, "title" | "asset_key" | "src" | "name" | "mime" | "duration" | "languages" | "sections">>;

const LANG_NAMES: Record<string, string> = { de: "Deutsch", fr: "Französisch", it: "Italienisch", en: "Englisch", es: "Spanisch", pt: "Portugiesisch", nl: "Niederländisch", rm: "Rätoromanisch" };
const langName = (l: string) => LANG_NAMES[l] ?? l.toUpperCase();
const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const newId = () => Math.random().toString(36).slice(2, 10);

function chosen(takes: DubbingTake[], sectionId: string, lang: string): DubbingTake | null {
  const own = takes.filter((t) => t.section_id === sectionId && t.lang === lang);
  return own.find((t) => t.best) ?? own[own.length - 1] ?? null;
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
  const audioRef = useRef<HTMLAudioElement>(null);

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

  // quick check «Aufnahme»: the picture muted, the chosen take of the section under the playhead
  function syncTake() {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v || !a || mode === "original") return;
    // «KI-Dubbing»: ONE full-length audio from 00:00; «Aufnahme»: the chosen take of the section under the playhead
    const aiTake = mode === "ai" ? takes.find((t) => t.source === "ai" && t.lang === curLang) ?? null : null;
    const sec = mode === "ai" ? (aiTake ? { id: "__full__", start: 0, end: Number.MAX_VALUE } : undefined) : el.sections.find((s) => v.currentTime >= s.start && v.currentTime < s.end);
    const take = mode === "ai" ? aiTake : sec ? chosen(takes.filter((t) => t.source !== "ai"), sec.id, curLang) : null;
    if (!sec || !take || v.paused) {
      if (!a.paused) a.pause();
      return;
    }
    if (a.dataset.take !== take.id) {
      a.src = take.url;
      a.dataset.take = take.id;
    }
    const want = v.currentTime - sec.start;
    if (Math.abs(a.currentTime - want) > 0.15) a.currentTime = want;
    if (a.paused) void a.play().catch(() => {});
  }

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
        <span className="flex-1 min-w-0 truncate text-sm font-semibold">{el.title || "Live-Dubbing"}</span>
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
        <div data-no-drag className="relative bg-black">
          <video
            ref={videoRef}
            src={el.src ?? undefined}
            controls
            playsInline
            muted={mode !== "original"}
            className="w-full max-h-[260px] bg-black"
            onLoadedMetadata={(e) => {
              const d = Math.round(e.currentTarget.duration * 1000) / 1000;
              if (editable && d && Math.abs(d - (el.duration ?? 0)) > 0.01) onCommit({ duration: d });
            }}
            onTimeUpdate={syncTake}
            onPlay={syncTake}
            onPause={() => audioRef.current?.pause()}
            onSeeked={syncTake}
          />
          <audio ref={audioRef} className="hidden" />
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const recRef = useRef<DubRecorder | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const sec = el.sections.find((s) => s.id === secId) ?? null;
  const nodeKey = el.id;

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
  // Esc closes (not while recording)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase === "idle") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, onClose]);

  const micInfo = mics.find((m) => m.deviceId === mic);

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
    v.muted = false;
    const onPlaying = () => rec.mark();
    v.addEventListener("playing", onPlaying, { once: true });
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
  function addSection() {
    const v = videoRef.current;
    const t = v ? Math.round(v.currentTime * 10) / 10 : 0;
    const end = Math.min(el.duration || t + 5, t + 5);
    const s: DubbingSection = { id: newId(), start: t, end: end > t ? end : t + 5, label: "", scripts: {} };
    setSections([...el.sections, s]);
    setSecId(s.id);
  }
  function patchSection(id: string, patch: Partial<DubbingSection>) {
    setSections(el.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  const own = sec ? takes.filter((t) => t.section_id === sec.id && t.lang === lang) : [];
  const words = (sec?.scripts[lang] ?? "").split(/(\s+)/);
  const lit = Math.round(progress * words.filter((w) => w.trim()).length);
  let seen = 0;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-[#111214] text-white flex flex-col"
      data-dubbing-studio
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
        <span className="text-lg">🎙️</span>
        <span className="font-semibold">{el.title || "Live-Dubbing"} · Studio</span>
        <select value={lang} onChange={(e) => setLang(e.target.value)} className="ml-4 rounded-md bg-white/10 px-2 py-1 text-sm">
          {el.languages.map((l) => (
            <option key={l} value={l}>
              {langName(l)}
            </option>
          ))}
        </select>
        {uploads > 0 && <span className="text-xs text-amber-300">Lädt {uploads} Take{uploads > 1 ? "s" : ""} hoch …</span>}
        {header}
        {onClose && (
          <button type="button" onClick={onClose} disabled={phase !== "idle"} className="ml-auto rounded-lg bg-white/10 hover:bg-white/15 px-3 py-1.5 text-sm disabled:opacity-40">
            Schliessen
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        <div className="flex-1 min-w-0 min-h-0 flex flex-col p-4 gap-3 overflow-auto">
          <div className="relative bg-black rounded-xl overflow-hidden">
            <video ref={videoRef} src={el.src ?? undefined} controls={phase === "idle"} playsInline className="w-full max-h-[50vh] bg-black" />
            {phase === "count" && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <span data-countin className="text-8xl font-bold">{count || "Los"}</span>
              </div>
            )}
            {phase === "rec" && <span className="absolute left-3 top-3 rounded-full bg-red-600 px-2.5 py-1 text-xs font-bold animate-pulse">● REC</span>}
          </div>
          {/* karaoke script */}
          <div data-karaoke className="rounded-xl bg-white/[0.04] border border-white/10 p-4 text-2xl leading-relaxed min-h-[6rem]">
            {sec && (sec.scripts[lang] ?? "").trim() ? (
              words.map((w, i) => {
                if (!w.trim()) return <span key={i}>{w}</span>;
                seen += 1;
                const on = phase === "rec" && seen <= lit;
                return (
                  <span key={i} className={on ? "text-rose-300" : phase === "rec" ? "text-white/45" : "text-white"}>
                    {w}
                  </span>
                );
              })
            ) : (
              <span className="text-base text-white/40">{sec ? "Für diese Sprache gibt es noch kein Skript." : "Wähle rechts einen Abschnitt."}</span>
            )}
          </div>
          {editable && sec && (
            <div className="grid grid-cols-[auto_auto_1fr] gap-2 items-center text-sm">
              <label className="flex items-center gap-1.5">Start <input type="number" step="0.1" min={0} value={sec.start} onChange={(e) => patchSection(sec.id, { start: Number(e.target.value) })} className="w-20 rounded-md bg-white/10 px-2 py-1" /></label>
              <label className="flex items-center gap-1.5">Ende <input type="number" step="0.1" min={0} value={sec.end} onChange={(e) => patchSection(sec.id, { end: Number(e.target.value) })} className="w-20 rounded-md bg-white/10 px-2 py-1" /></label>
              <input value={sec.label ?? ""} placeholder="Bezeichnung (optional)" onChange={(e) => patchSection(sec.id, { label: e.target.value })} className="rounded-md bg-white/10 px-2 py-1" />
              <textarea
                value={sec.scripts[lang] ?? ""}
                placeholder={`Skript ${langName(lang)} …`}
                onChange={(e) => patchSection(sec.id, { scripts: { ...sec.scripts, [lang]: e.target.value } })}
                rows={3}
                className="col-span-3 rounded-md bg-white/10 px-2 py-1.5 select-text"
              />
            </div>
          )}
        </div>
        <div className="w-full lg:w-[380px] shrink-0 border-t lg:border-t-0 lg:border-l border-white/10 p-4 flex flex-col gap-4 overflow-auto">
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
            {micInfo?.bluetooth && <p data-bt-warning className="mt-1 text-xs text-amber-300">⚠︎ Bluetooth-Gerät: Ton verzögert und schlechtere Qualität. Besser ein Kabel-Mikrofon und Kabel-Kopfhörer.</p>}
            {error && <p className="mt-1 text-xs text-red-300">{error}</p>}
          </div>
          <div>
            <div className="flex items-center mb-1.5">
              <span className="text-xs uppercase tracking-wide text-white/40">Abschnitte</span>
              {editable && (
                <button type="button" onClick={addSection} className="ml-auto rounded-md bg-white/10 hover:bg-white/15 px-2 py-0.5 text-xs">
                  ＋ ab aktueller Zeit
                </button>
              )}
            </div>
            <div className="flex flex-col gap-1">
              {el.sections.map((s, i) => {
                const n = takes.filter((t) => t.section_id === s.id && t.lang === lang);
                return (
                  <button
                    key={s.id}
                    type="button"
                    data-section={s.id}
                    onClick={() => {
                      setSecId(s.id);
                      if (videoRef.current) videoRef.current.currentTime = s.start;
                    }}
                    className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm ${secId === s.id ? "bg-rose-500/25 ring-1 ring-rose-400/60" : "bg-white/[0.05] hover:bg-white/10"}`}
                  >
                    <span className="text-white/45 tabular-nums text-xs w-[5.5rem] shrink-0">{i + 1}. {fmt(s.start)}–{fmt(s.end)}</span>
                    <span className="flex-1 min-w-0 truncate">{s.label || s.scripts[lang] || "–"}</span>
                    <span className={`text-xs ${n.some((t) => t.best) ? "text-emerald-300" : n.length ? "text-amber-300" : "text-white/30"}`}>{n.length ? `${n.length} Take${n.length > 1 ? "s" : ""}` : "–"}</span>
                  </button>
                );
              })}
              {el.sections.length === 0 && <p className="text-xs text-white/40">Noch keine Abschnitte. Video an die Stelle spulen und «＋ ab aktueller Zeit».</p>}
            </div>
          </div>
          {sec && (
            <div className="flex flex-col gap-2">
              {phase === "rec" ? (
                <button type="button" onClick={() => stopRef.current?.()} className="rounded-xl bg-white text-black py-3 font-bold">
                  ■ Stopp
                </button>
              ) : (
                <button type="button" data-record disabled={phase !== "idle" || !mic} onClick={() => void record()} className="rounded-xl bg-red-600 hover:bg-red-500 py-3 font-bold disabled:opacity-50">
                  {phase === "count" ? "…" : phase === "saving" ? "Speichert …" : "● Aufnehmen"}
                </button>
              )}
              <div className="text-xs uppercase tracking-wide text-white/40 mt-2">Takes ({langName(lang)})</div>
              {own.map((t, i) => (
                <div key={t.id} data-take className="flex items-center gap-2 rounded-lg bg-white/[0.05] px-2 py-1.5 text-sm">
                  <span className="text-white/50 w-14 shrink-0">Take {i + 1}</span>
                  <audio src={t.url} controls className="h-8 flex-1 min-w-0" />
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
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
