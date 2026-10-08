"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { useLanguage } from "@/lib/i18n";

/** 2026-10-08, Lino: GIF maker — a video link (TikTok etc.; YouTube, Vimeo
 * and Instagram usually refuse server downloads) or an uploaded video, a
 * timeline to pick ≤ 3 s, and the result lands on the board as a GIF image.
 * The source video is deleted again (server side after rendering, or via
 * `discard` when the maker is closed without making a GIF). */

export type BoardGifApi = {
  /** load a link's video; resolves with the temporary source on R2 */
  fromLink: (url: string) => Promise<{ key: string; src: string; duration: number }>;
  /** upload a local video as the source */
  upload: (file: File, onProgress: (f: number) => void) => Promise<{ key: string; src: string }>;
  render: (key: string, start: number, duration: number) => Promise<{ key: string; src: string; w: number; h: number }>;
  discard: (key: string) => Promise<void>;
};

const MAX_LEN = 3;
const MIN_LEN = 0.3;

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(1).padStart(4, "0")}`;
}

export function BoardGifMaker({
  api,
  onClose,
  onDone,
}: {
  api: BoardGifApi;
  onClose: () => void;
  onDone: (gif: { key: string; src: string; w: number; h: number }) => void;
}) {
  const { t } = useLanguage();
  const tt = t as unknown as (k: string) => string;
  const [url, setUrl] = useState("");
  const [stage, setStage] = useState<"source" | "loading" | "edit" | "rendering">("source");
  const [error, setError] = useState<string | null>(null);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [len, setLen] = useState(2);
  const [now, setNow] = useState(0);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const sourceKey = useRef<string | null>(null);
  const uploadPromise = useRef<Promise<{ key: string; src: string }> | null>(null);
  const done = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const objectUrl = useRef<string | null>(null);

  // ⌘V in the maker: a copied link loads it, a copied video/GIF file uploads it
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (stage !== "source") return;
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("video/") || f.type === "image/gif");
      if (file) {
        e.preventDefault();
        pickFile(file);
        return;
      }
      const text = e.clipboardData?.getData("text/plain")?.trim() ?? "";
      if (/^https?:\/\//i.test(text) && (e.target as HTMLElement)?.tagName !== "INPUT") {
        e.preventDefault();
        setUrl(text);
        void loadLink(text);
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  // closing without a GIF: the source video goes away again
  useEffect(
    () => () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      if (done.current) return;
      if (sourceKey.current) void api.discard(sourceKey.current).catch(() => {});
      else uploadPromise.current?.then((r) => api.discard(r.key)).catch(() => {});
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  async function loadLink(link = url) {
    if (!link.trim()) return;
    setError(null);
    setStage("loading");
    try {
      const r = await api.fromLink(link.trim());
      sourceKey.current = r.key;
      setVideoSrc(r.src);
      setDuration(r.duration || 0);
      setStage("edit");
    } catch (e) {
      setError(e instanceof Error && e.message === "blocked" ? tt("ideaBoard.gif.blocked") : tt("ideaBoard.gif.linkFailed"));
      setStage("source");
    }
  }

  async function pickGif(file: File) {
    // a GIF can't play in the timeline's <video>: upload it, then let the
    // server turn it into a video exactly like a GIF link
    setError(null);
    setStage("loading");
    try {
      const up = await api.upload(file, () => {});
      try {
        const r = await api.fromLink(up.src);
        sourceKey.current = r.key;
        setVideoSrc(r.src);
        setDuration(r.duration || 0);
        setStage("edit");
      } finally {
        void api.discard(up.key).catch(() => {});
      }
    } catch {
      setError(tt("ideaBoard.gif.uploadFailed"));
      setStage("source");
    }
  }

  function pickFile(file: File) {
    if (file.type === "image/gif") return void pickGif(file);
    setError(null);
    objectUrl.current = URL.createObjectURL(file);
    setVideoSrc(objectUrl.current);
    setStage("edit");
    setUploadPct(0);
    // uploads while the part is being picked
    uploadPromise.current = api.upload(file, (f) => setUploadPct(Math.round(f * 100)));
    uploadPromise.current
      .then((r) => {
        sourceKey.current = r.key;
        setUploadPct(null);
      })
      .catch(() => {
        setUploadPct(null);
        setError(tt("ideaBoard.gif.uploadFailed"));
      });
  }

  // loop the chosen part as a live preview
  useEffect(() => {
    const v = videoRef.current;
    if (!v || stage !== "edit") return;
    v.currentTime = start;
    void v.play().catch(() => {});
  }, [start, stage]);
  function onTime() {
    const v = videoRef.current;
    if (!v) return;
    setNow(v.currentTime);
    if (v.currentTime >= start + len || v.currentTime < start - 0.25) v.currentTime = start;
  }

  // drag the selection window (or its edges) along the timeline
  function dragOn(e: React.PointerEvent, mode: "move" | "start" | "end") {
    e.preventDefault();
    e.stopPropagation();
    const track = trackRef.current;
    if (!track || !duration) return;
    const r = track.getBoundingClientRect();
    const sx = e.clientX;
    const s0 = start;
    const l0 = len;
    const move = (ev: PointerEvent) => {
      const dt = ((ev.clientX - sx) / r.width) * duration;
      if (mode === "move") setStart(Math.max(0, Math.min(duration - l0, s0 + dt)));
      else if (mode === "end") setLen(Math.max(MIN_LEN, Math.min(MAX_LEN, l0 + dt, duration - s0)));
      else {
        const ns = Math.max(0, Math.min(s0 + l0 - MIN_LEN, s0 + dt, s0 + l0));
        const nl = Math.min(MAX_LEN, s0 + l0 - ns);
        setStart(s0 + l0 - nl);
        setLen(nl);
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function clickTrack(e: React.PointerEvent) {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r || !duration) return;
    const at = ((e.clientX - r.left) / r.width) * duration;
    setStart(Math.max(0, Math.min(duration - len, at - len / 2)));
  }

  async function makeGif() {
    setError(null);
    setStage("rendering");
    try {
      const key = sourceKey.current ?? (await uploadPromise.current)?.key;
      if (!key) throw new Error("no source");
      const gif = await api.render(key, Math.round(start * 100) / 100, Math.round(len * 100) / 100);
      done.current = true; // the server already deleted the source
      onDone(gif);
    } catch {
      setError(tt("ideaBoard.gif.renderFailed"));
      setStage("edit");
    }
  }

  const pct = (s: number) => (duration ? (s / duration) * 100 : 0);

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={tt("ideaBoard.gif.title")}
      footer={
        stage === "edit" || stage === "rendering" ? (
          <div className="flex items-center justify-end gap-2">
            {uploadPct != null && <span className="mr-auto text-xs text-white/50">{tt("ideaBoard.gif.uploading").replace("{pct}", String(uploadPct))}</span>}
            <Button onClick={onClose}>{tt("common.cancel")}</Button>
            <Button variant="primary" disabled={stage === "rendering" || !duration} onClick={makeGif}>
              {stage === "rendering" ? tt("ideaBoard.gif.rendering") : tt("ideaBoard.gif.create")}
            </Button>
          </div>
        ) : undefined
      }
    >
      {error && <p className="mb-3 rounded-lg bg-red-500/15 border border-red-500/30 text-red-200 text-sm px-3 py-2">{error}</p>}
      {stage === "source" || stage === "loading" ? (
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-sm text-white/70 mb-2">{tt("ideaBoard.gif.linkLabel")}</p>
            <div className="flex gap-2">
              <input
                autoFocus
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onPaste={(e) => {
                  const text = e.clipboardData.getData("text/plain").trim();
                  if (/^https?:\/\//i.test(text) && !url.trim()) {
                    e.preventDefault();
                    setUrl(text);
                    void loadLink(text);
                  }
                }}
                onKeyDown={(e) => e.key === "Enter" && void loadLink()}
                placeholder="https://www.tiktok.com/…"
                disabled={stage === "loading"}
                className="flex-1 min-w-0 rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm outline-none focus:border-blue-500 select-text"
              />
              <Button variant="primary" disabled={stage === "loading" || !url.trim()} onClick={() => void loadLink()}>
                {stage === "loading" ? tt("ideaBoard.gif.loading") : tt("ideaBoard.gif.load")}
              </Button>
            </div>
            <p className="text-xs text-white/40 mt-1.5">{tt("ideaBoard.gif.linkHint")}</p>
          </div>
          <div className="flex items-center gap-3 text-xs text-white/35">
            <span className="h-px flex-1 bg-white/10" />
            {tt("ideaBoard.gif.or")}
            <span className="h-px flex-1 bg-white/10" />
          </div>
          <label
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = [...e.dataTransfer.files].find((x) => x.type.startsWith("video/") || x.type === "image/gif");
              if (f) pickFile(f);
            }}
            className={`flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 py-8 text-sm text-white/60 hover:text-white hover:border-white/40 cursor-pointer ${stage === "loading" ? "pointer-events-none opacity-50" : ""}`}
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4M7 9l5-5 5 5M4 20h16" /></svg>
            {tt("ideaBoard.gif.upload")}
            <input type="file" accept="video/*,image/gif,.mov,.mp4,.m4v,.webm,.gif" className="hidden" onChange={(e) => e.target.files?.[0] && pickFile(e.target.files[0])} />
          </label>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl overflow-hidden bg-black flex items-center justify-center max-h-[48vh]">
            {videoSrc && (
              <video
                ref={videoRef}
                src={videoSrc}
                muted
                playsInline
                preload="auto"
                className="max-h-[48vh] max-w-full"
                onLoadedMetadata={(e) => {
                  const d = e.currentTarget.duration;
                  if (isFinite(d) && d > 0) {
                    setDuration(d);
                    setLen((l) => Math.min(l, d));
                  }
                }}
                onTimeUpdate={onTime}
              />
            )}
          </div>
          {/* timeline */}
          <div ref={trackRef} onPointerDown={clickTrack} className="relative h-12 rounded-lg bg-white/[0.06] border border-white/10 select-none touch-none cursor-pointer">
            <div className="absolute top-0 bottom-0 w-px bg-white/70 pointer-events-none" style={{ left: `${pct(now)}%` }} />
            <div
              onPointerDown={(e) => dragOn(e, "move")}
              className="absolute top-0 bottom-0 rounded-md bg-blue-500/30 border-2 border-blue-400 cursor-grab active:cursor-grabbing"
              style={{ left: `${pct(start)}%`, width: `${pct(len)}%`, minWidth: 14 }}
            >
              <span onPointerDown={(e) => dragOn(e, "start")} className="absolute -left-1.5 top-0 bottom-0 w-3 cursor-ew-resize flex items-center justify-center">
                <span className="w-1 h-5 rounded-full bg-white" />
              </span>
              <span onPointerDown={(e) => dragOn(e, "end")} className="absolute -right-1.5 top-0 bottom-0 w-3 cursor-ew-resize flex items-center justify-center">
                <span className="w-1 h-5 rounded-full bg-white" />
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-white/60">
            <span className="tabular-nums">
              {fmt(start)} – {fmt(start + len)} · <b className="text-white">{len.toFixed(1)} s</b>
            </span>
            <span className="flex-1" />
            {[1, 2, 3].map((s) => (
              <button
                key={s}
                disabled={duration < s - 0.05}
                onClick={() => {
                  setLen(Math.min(s, duration));
                  setStart((st) => Math.max(0, Math.min(st, duration - s)));
                }}
                className={`rounded-md px-2 py-1 font-semibold disabled:opacity-30 ${Math.abs(len - s) < 0.05 ? "bg-blue-600 text-white" : "bg-white/10 hover:bg-white/15"}`}
              >
                {s} s
              </button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
