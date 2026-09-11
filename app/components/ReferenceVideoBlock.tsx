"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  DndContext, type DragEndEvent, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS as DndCSS } from "@dnd-kit/utilities";
import { ApiError } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { readVideoMetadata } from "@/lib/media";
import { useLanguage } from "@/lib/i18n";
import { useToast } from "@/app/components/ui/Toast";
import { ConfirmDialog } from "@/app/components/ui/ConfirmDialog";
import { Menu, MenuItem } from "@/app/components/ui/Menu";
import { IconButton } from "@/app/components/ui/Button";
import { AuthImage } from "@/app/components/AuthImage";
import type { ReferenceVideo, Section } from "@/lib/types";

const ALLOWED_REFERENCE_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];

type ReferenceVideoFields = Pick<Section, "reference_videos">;

/** 2026-09-08, Lino: "warum reloaded das video immer alle 5-10 sekunde" —
 * root cause, same as VideoReviewModal.tsx's own `resolveVideoSrc` (see its
 * doc comment): `reference_video_url`/`reference_video_thumbnail_url` are
 * presigned R2 URLs re-signed FRESH on every single API response
 * (SectionOut's `_presign_image` field_validator), while this page polls
 * `projectDetail` every 12s (projects/[id]/page.tsx). Handing a `<video>`/
 * `<img>` a changed `src` string on every poll — even though it's still the
 * exact same underlying file — forces the browser to restart it. Pins the
 * URL by its PATH (everything before "?", stable across re-signs — only the
 * query-string signature/expiry changes) so React never sees a changed
 * `src` prop for as long as it's genuinely still the same object; only a
 * real replace/delete (different path) is let through. */
export function usePinnedUrl(url: string | null | undefined): string | null {
  const ref = useRef<{ path: string; url: string } | null>(null);
  if (!url) {
    ref.current = null;
    return null;
  }
  const path = url.split("?")[0];
  if (ref.current?.path !== path) ref.current = { path, url };
  return ref.current.url;
}

/** 2026-09-08, Lino: "ganz oben in einer Shotlist soll man ein
 * Beispielvideo hochladen können, das man als Referenz abspielen lassen
 * kann" — shown inside the currently open Shotlist (projects/[id]/page.tsx).
 * 2026-09-10, Lino: "das scribble Video wird jetzt bei jeder shotlist
 * dargestellt im projekt.. jede shotlist hat aber ihr eigenes scribble
 * video!" — was one slot per PROJECT (every shotlist showed the same
 * video), then one slot per Section/Shotlist.
 * 2026-09-11, Lino: "man soll mehrere scribble videos hochladen können,
 * diese werden dann nebeneinander angezeigt.. das erste hochgeladene Video
 * wird mit V1 markiert, das zweite mit V2.. wenn die zeile mit videos
 * gefüllt ist wird unter den videos ein weiteres angezeigt" — a real list
 * now (`section.reference_videos`, see ReferenceVideo's own doc comment in
 * models.py), rendered as a `flex flex-wrap` grid of same-size tiles plus
 * a trailing "add" tile — wrapping to a new row once a row is full is just
 * what `flex-wrap` already does, no extra layout logic needed. "V1"/"V2"/
 * ... is each tile's 1-based position in the (upload-ordered) array, not a
 * stored field — deleting an earlier one naturally renumbers the rest.
 * There's no more per-tile "replace" action (that only made sense for a
 * single slot) — delete + upload a new one covers it, landing at the end
 * like any other upload. */
export function ReferenceVideoBlock({
  sectionId,
  section,
  onUpdate,
}: {
  sectionId: string;
  section: ReferenceVideoFields;
  onUpdate: (patch: Partial<Section>) => void;
}) {
  const { t } = useLanguage();
  const toast = useToast();
  const api = useApi();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadingVideoId, setUploadingVideoId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  // 2026-09-11 (bugfix) — ONE state object, set in a SINGLE setState call
  // from the tile's onClick, holding exactly the (already-pinned) url +
  // rect that click needs. Was two separate pieces of state
  // (`lightboxVideoId` + `lightboxOriginRect`, with the url re-derived via
  // `videos.find(...)` + a SECOND, independent `usePinnedUrl` call in a
  // wrapper component) — Lino: "jetzt kommt das video beim start der
  // animation irgendwo her... es muss doch daher kommen wo das video im
  // Browser ursprünglich ist". Splitting the open-rect across two state
  // slots (even though both were set back-to-back) plus re-resolving the
  // url in a completely different component left room for the lightbox to
  // mount against a stale/mismatched rect from a PREVIOUS click; a single
  // atomic object removes that entirely.
  const [lightbox, setLightbox] = useState<{ url: string; originRect: DOMRect } | null>(null);

  const videos = section.reference_videos;
  // Read via a ref (not the `videos` const above) inside the async upload
  // handler below — that const is a snapshot from the render that started
  // handlePick, but onUpdate(...) triggers a parent re-render with a fresh
  // array on every step of the multi-await upload flow; a second `await`
  // later in the SAME handler call would otherwise still be mutating the
  // stale array it closed over, silently dropping whatever onUpdate did in
  // between (same class of bug as #213's other stale-closure fixes).
  const videosRef = useRef(videos);
  videosRef.current = videos;

  function patchVideos(next: ReferenceVideo[]) {
    onUpdate({ reference_videos: next });
  }

  async function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!ALLOWED_REFERENCE_VIDEO_TYPES.includes(file.type)) {
      toast.showError(t("referenceVideo.unsupportedType"));
      return;
    }
    setUploadProgress(0);
    let videoId: string | null = null;
    try {
      const { id, upload_url } = await api.createReferenceVideo(sectionId, file);
      videoId = id;
      setUploadingVideoId(id);
      patchVideos([
        ...videosRef.current,
        {
          id, url: null, status: "uploading", original_filename: file.name,
          duration_seconds: null, thumbnail_url: null, thumbnail_focus_x: null, thumbnail_focus_y: null,
          created_at: new Date().toISOString(),
        },
      ]);
      await api.uploadVideoFile(upload_url, file, setUploadProgress);
      const meta = await readVideoMetadata(file);
      const updated = await api.completeReferenceVideo(id, meta.duration);
      patchVideos(videosRef.current.map((v) => (v.id === id ? updated : v)));
    } catch (err) {
      toast.showError(err instanceof ApiError ? err.message : t("referenceVideo.uploadFailed"));
      if (videoId) patchVideos(videosRef.current.filter((v) => v.id !== videoId));
    } finally {
      setUploadProgress(null);
      setUploadingVideoId(null);
    }
  }

  async function handleDelete() {
    const id = deleteTargetId;
    setDeleteTargetId(null);
    if (!id) return;
    try {
      await api.deleteReferenceVideo(id);
      patchVideos(videosRef.current.filter((v) => v.id !== id));
    } catch (err) {
      toast.showError(err instanceof ApiError ? err.message : t("referenceVideo.deleteFailed"));
    }
  }

  // 2026-09-11 (same day, Lino: "man muss aber die videos in der
  // reihenfolge verschieben können wenn man in der web app oder ios app
  // ist... von links nach rechts ist es aber immer V1, V2") — own small
  // self-contained DndContext (NOT the page's big shared one covering
  // scenes/sections, see projects/[id]/page.tsx's own doc comments on how
  // much cross-container logic that one already carries — this grid is a
  // fully independent drag domain with no reason to risk touching that).
  // Same dnd-kit shape as IdeaImageReorderGrid.tsx, but auto-saves on drop
  // instead of a separate "Reihenfolge speichern" button — these tiles are
  // always in the normal flow here, not a toggled-into reorder mode.
  const dragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } })
  );

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const current = videosRef.current;
    const fromIndex = current.findIndex((v) => v.id === active.id);
    const toIndex = current.findIndex((v) => v.id === over.id);
    if (fromIndex === -1 || toIndex === -1) return;
    const next = [...current];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    patchVideos(next);
    try {
      await api.reorderReferenceVideos(sectionId, next.map((v) => v.id));
    } catch (err) {
      toast.showError(err instanceof ApiError ? err.message : t("referenceVideo.reorderFailed"));
      patchVideos(current);
    }
  }

  return (
    <div className="mb-5">
      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_REFERENCE_VIDEO_TYPES.join(",")}
        className="hidden"
        onChange={handlePick}
      />
      <DndContext sensors={dragSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={videos.map((v) => v.id)} strategy={rectSortingStrategy}>
          {/* 2026-09-11, Lino: "es sollen 3 videos pro zeile sein, passe die
              grösse der videos genau so an, dass es die breite füllt von
              der contentbreite der seite" — CSS grid instead of flex-wrap
              fixed-width tiles: each column is an equal 1fr share of the
              full content width, so 3 tiles always fill it exactly (no
              leftover gap on the last one) instead of wrapping to however
              many 288px-wide tiles happen to fit. 1 column on mobile. */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {videos.map((video, index) => (
              <ReferenceVideoSortableTile
                key={video.id}
                video={video}
                label={`V${index + 1}`}
                uploadProgress={video.id === uploadingVideoId ? uploadProgress : null}
                onOpen={(rect, url) => setLightbox({ originRect: rect, url })}
                onDelete={() => setDeleteTargetId(video.id)}
              />
            ))}
            {/* Not part of SortableContext's `items` — always sits fixed
                at the end, never draggable. */}
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="w-full aspect-video flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 hover:border-white/30 bg-white/[0.02] hover:bg-white/[0.05] text-white/50 hover:text-white/80 transition-colors text-sm font-medium"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              {t("referenceVideo.upload")}
            </button>
          </div>
        </SortableContext>
      </DndContext>
      <ConfirmDialog
        open={deleteTargetId !== null}
        title={t("referenceVideo.deleteTitle")}
        message={t("referenceVideo.deleteMessage")}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTargetId(null)}
      />
      {lightbox && (
        <ReferenceVideoLightbox url={lightbox.url} originRect={lightbox.originRect} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}

/** Drag handle wrapper around ReferenceVideoTile (2026-09-11 — "man muss
 * aber die videos in der reihenfolge verschieben können"), same
 * useSortable-on-the-whole-tile shape as IdeaImageReorderGrid.tsx's own
 * ReorderTile. Listeners sit on this OUTER div, not on the tile's inner
 * play-button/menu — dnd-kit's PointerSensor activationConstraint
 * (distance: 4) means a plain tap-without-movement still reaches those
 * inner onClick handlers normally; only an actual drag gesture is
 * captured. */
function ReferenceVideoSortableTile(props: {
  video: ReferenceVideo;
  label: string;
  uploadProgress: number | null;
  onOpen: (originRect: DOMRect, url: string) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.video.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: DndCSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      {...attributes}
      {...listeners}
      className="w-full touch-none cursor-grab active:cursor-grabbing"
    >
      <ReferenceVideoTile {...props} />
    </div>
  );
}

/** One tile in the grid above — either the "uploading" progress state, the
 * "processing" (server-side compression) spinner state, or the ready
 * clickable thumbnail with its "V{n}" badge + delete menu. Split out of
 * ReferenceVideoBlock (rather than an inline .map() body) purely so each
 * tile can call the usePinnedUrl/useState hooks it needs without an
 * eslint-disable for hooks-in-a-loop. */
function ReferenceVideoTile({
  video,
  label,
  uploadProgress,
  onOpen,
  onDelete,
}: {
  video: ReferenceVideo;
  label: string;
  uploadProgress: number | null;
  onOpen: (originRect: DOMRect, url: string) => void;
  onDelete: () => void;
}) {
  const { t } = useLanguage();
  const thumbButtonRef = useRef<HTMLButtonElement>(null);
  const pinnedVideoUrl = usePinnedUrl(video.url);
  const pinnedThumbnailUrl = usePinnedUrl(video.thumbnail_url);
  const thumbnailObjectPosition =
    video.thumbnail_focus_x != null && video.thumbnail_focus_y != null
      ? `${(video.thumbnail_focus_x * 100).toFixed(1)}% ${(video.thumbnail_focus_y * 100).toFixed(1)}%`
      : undefined;

  if (uploadProgress !== null) {
    return (
      <div className="w-full aspect-video rounded-2xl bg-white/[0.04] border border-white/10 p-4 flex flex-col justify-center gap-2">
        <span className="text-sm font-medium text-white/70">
          {t("postproduction.uploading", { percent: Math.round(uploadProgress * 100) })}
        </span>
        <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-[width] duration-150"
            style={{ width: `${Math.round(uploadProgress * 100)}%` }}
          />
        </div>
      </div>
    );
  }

  if (video.status === "processing") {
    // 2026-09-10, Lino: "das scribble Video braucht extrem lange zu laden
    // wenn man es abspielt! wird es komprimiert?" — it wasn't; now it is
    // (see complete_reference_video/compress_for_web on the backend), and
    // this is the window while that background compression runs (client's
    // own upload already finished — no percent to show).
    return (
      <div className="w-full aspect-video rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-center gap-2.5">
        <svg className="animate-spin w-4 h-4 text-white/50" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span className="text-sm font-medium text-white/70">{t("referenceVideo.processing")}</span>
      </div>
    );
  }

  if (video.status !== "ready" || !pinnedVideoUrl) return null;

  return (
    <div className="relative w-full rounded-2xl bg-black overflow-hidden border border-white/10">
      {/* 2026-09-08, Lino: "es soll ein thumbnail dargestellt werden und
       * wenn man darauf klickt, soll sich das video in einer lightbox
       * öffnen" — Lino, same session: "das video thumbnail soll dann auch
       * immer ein zentriertes gesicht sein" — the real thumbnail
       * (face-priority frame + detect_face_focus object-position, same
       * AuthImage/background_image_focus_x/y convention projects/page.tsx
       * already uses for folder covers) is generated by a backend
       * background task shortly after upload; while it's still null,
       * falls back to a muted <video preload="metadata"> showing its own
       * first frame, same "browser renders it like an <img> poster" trick. */}
      <button
        ref={thumbButtonRef}
        type="button"
        onClick={() => {
          const rect = thumbButtonRef.current?.getBoundingClientRect();
          if (rect) onOpen(rect, pinnedVideoUrl);
        }}
        className="group relative block w-full aspect-video"
        aria-label={t("referenceVideo.play")}
      >
        {pinnedThumbnailUrl ? (
          <AuthImage
            path={pinnedThumbnailUrl}
            alt=""
            className="w-full h-full object-cover"
            objectPosition={thumbnailObjectPosition}
          />
        ) : (
          // eslint-disable-next-line jsx-a11y/media-has-caption -- reference footage, no track available
          <video src={pinnedVideoUrl} muted preload="metadata" playsInline className="w-full h-full object-cover" />
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/10 group-hover:bg-black/30 transition-colors">
          <div className="w-11 h-11 rounded-full bg-white/90 flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#000" className="translate-x-[1px]"><path d="M8 5v14l11-7z" /></svg>
          </div>
        </div>
      </button>
      <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/50 backdrop-blur-sm text-[11px] font-semibold text-white/90 tabular-nums pointer-events-none">
        {label}
      </div>
      <div className="absolute top-2 right-2">
        <Menu
          trigger={
            <IconButton size={28} className="bg-black/50 backdrop-blur-sm text-white/70 hover:text-white hover:bg-black/70">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="5" cy="12" r="1.8" />
                <circle cx="12" cy="12" r="1.8" />
                <circle cx="19" cy="12" r="1.8" />
              </svg>
            </IconButton>
          }
        >
          {(close) => (
            <MenuItem
              danger
              onClick={() => {
                onDelete();
                close();
              }}
            >
              {t("common.delete")}
            </MenuItem>
          )}
        </Menu>
      </div>
    </div>
  );
}

// 2026-09-10, Lino: "wie die videos auf der linocappuccino webseite, quasi
// in einem lightbox player mit der gleichen open animation" — a manual FLIP
// (First-Last-Invert-Play) transition, ported from that site's own
// VideoLightbox.tsx (same timing/easing constants) rather than pulling in
// framer-motion for one transition: the box's transform jumps instantly
// (no transition) to make it LOOK like it's still sitting at the clicked
// thumbnail's exact position/size, then animates to identity on the next
// frame. Close reverses the same computation back toward that origin rect.
const OPEN_TRANSITION = "transform 480ms cubic-bezier(0.16, 1, 0.3, 1)";
const CLOSE_TRANSITION = "transform 380ms cubic-bezier(0.4, 0, 1, 1)";
const CLOSE_DURATION = 380;

function flipTransform(from: DOMRect, to: DOMRect): string {
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  const sx = from.width / to.width;
  const sy = from.height / to.height;
  return `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
}

/** 2026-09-08 — fullscreen video-only lightbox for the Scribble Video
 * thumbnail above. Deliberately NOT VideoReviewModal (comments/subtitles/
 * versions — none of that applies to a single unversioned reference file)
 * nor PublicIdeaLightbox (idea-feedback-specific) — just the shared
 * backdrop/close-button/Escape convention those two already use.
 *
 * 2026-09-10 — two changes, both explicit Lino asks: (1) the FLIP open/
 * close animation above (was an instant mount/unmount, no animation at
 * all); (2) native `<video controls>` replaced with a small custom chrome
 * (tap-to-toggle-play + an explicit fullscreen button, `requestFullscreen`
 * on the video element itself) matching the minimal custom-controls style
 * of that reference site's own player — which, same as this one now, has
 * no seek bar either.
 *
 * 2026-09-10, same day, Lino: "bitte eine timeline leiste einbauen, man
 * muss durch das video scrubben können" — a real, if unwelcome, gap from
 * dropping native `<video controls>` right above: this now grows its own
 * click/drag scrub bar, same click-to-seek + window-level drag + smooth
 * per-animation-frame progress pattern VideoReviewModal.tsx's own timeline
 * already established (see that file's own doc comments on WHY each of
 * those exists — jerky/inaccurate dragging otherwise), just without any of
 * that file's comment-marker machinery this single-file player has no use
 * for. */
export function ReferenceVideoLightbox({ url, originRect, onClose }: { url: string; originRect: DOMRect | null; onClose: () => void }) {
  const { t } = useLanguage();
  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const [closing, setClosing] = useState(false);
  const [paused, setPaused] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  function requestClose() {
    if (closing) return;
    const box = boxRef.current;
    if (box && originRect) {
      const finalRect = box.getBoundingClientRect();
      box.style.transition = CLOSE_TRANSITION;
      box.style.transform = flipTransform(originRect, finalRect);
    }
    setClosing(true);
    setTimeout(onClose, originRect ? CLOSE_DURATION : 0);
  }

  // Runs the open half of the FLIP: measure where the box NATURALLY landed
  // (centered, full size) BEFORE paint, jump it to look like the thumbnail
  // instead, then let the very next frame animate that back to identity.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || !originRect) return;
    const finalRect = box.getBoundingClientRect();
    box.style.transformOrigin = "top left";
    box.style.transition = "none";
    box.style.transform = flipTransform(originRect, finalRect);
    // Force a reflow so the browser commits the jump above before the
    // transition below is allowed to animate anything.
    void box.offsetHeight;
    requestAnimationFrame(() => {
      box.style.transition = OPEN_TRANSITION;
      box.style.transform = "translate(0, 0) scale(1, 1)";
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") requestClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === videoRef.current);
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  function toggleFullscreen(e: React.MouseEvent) {
    e.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      video.requestFullscreen?.().catch(() => {});
    }
  }

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }

  function fractionFromClientX(clientX: number): number {
    if (!timelineRef.current) return 0;
    const rect = timelineRef.current.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }

  function seekToFraction(fraction: number) {
    setCurrentTime(fraction * duration);
    const video = videoRef.current;
    if (video && duration > 0) video.currentTime = fraction * duration;
  }

  // Same "seek immediately on mousedown (feels dead otherwise), then keep
  // following the mouse via a window-level listener so the drag survives
  // leaving this thin bar" pattern as VideoReviewModal.tsx's own timeline.
  function handleTimelinePointerDown(e: React.MouseEvent<HTMLDivElement>) {
    e.stopPropagation();
    if (duration <= 0) return;
    isDraggingRef.current = true;
    setIsDragging(true);
    seekToFraction(fractionFromClientX(e.clientX));
  }

  useEffect(() => {
    if (!isDragging) return;
    function onMove(e: MouseEvent) {
      seekToFraction(fractionFromClientX(e.clientX));
    }
    function onUp() {
      isDraggingRef.current = false;
      setIsDragging(false);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging, duration]);

  // Same fix as VideoReviewModal.tsx's own progress bar (see its doc
  // comment) — native `timeupdate` alone only fires ~4x/sec, which reads as
  // visible little jumps rather than a smooth sweep. Polls every animation
  // frame while actually playing instead; skipped during a manual drag,
  // which already drives currentTime directly above.
  useEffect(() => {
    if (paused) return;
    let raf: number;
    function tick() {
      if (!isDraggingRef.current && videoRef.current) setCurrentTime(videoRef.current.currentTime);
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paused]);

  function formatTime(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, "0")}`;
  }

  const progressPct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className={`absolute inset-0 bg-black/80 backdrop-blur-xl cursor-pointer transition-opacity duration-300 ${closing ? "opacity-0" : "opacity-100"}`}
        onClick={requestClose}
      />
      <button
        onClick={requestClose}
        aria-label={t("modal.closeAria")}
        className="absolute top-5 right-5 z-20 w-10 h-10 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
      <div
        ref={boxRef}
        className="relative z-10 max-w-[92vw] max-h-[88vh] rounded-2xl overflow-hidden bg-black shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- reference footage, no track available */}
        <video
          ref={videoRef}
          src={url}
          autoPlay
          playsInline
          preload="metadata"
          onClick={togglePlay}
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
          onTimeUpdate={(e) => {
            if (!isDraggingRef.current) setCurrentTime(e.currentTarget.currentTime);
          }}
          className="block max-w-[92vw] max-h-[88vh] cursor-pointer"
        />
        {paused && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-14 h-14 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff" className="translate-x-[1px]"><path d="M8 5v14l11-7z" /></svg>
            </div>
          </div>
        )}
        {/* 2026-09-10 — scrub bar, bottom control strip. Gradient scrim
            behind it keeps the time labels/fullscreen icon legible over
            bright footage without needing a solid bar. */}
        <div
          className="absolute inset-x-0 bottom-0 pt-8 pb-2.5 px-3 bg-gradient-to-t from-black/70 to-transparent"
          onClick={(e) => e.stopPropagation()}
        >
          <div
            ref={timelineRef}
            onMouseDown={handleTimelinePointerDown}
            className="group/timeline relative w-full h-1.5 rounded-full bg-white/25 cursor-pointer mb-2"
          >
            <div className="absolute inset-y-0 left-0 rounded-full bg-white" style={{ width: `${progressPct}%` }} />
            <div
              className="absolute top-1/2 w-3 h-3 rounded-full bg-white shadow -translate-y-1/2 -translate-x-1/2 opacity-0 group-hover/timeline:opacity-100 transition-opacity"
              style={{ left: `${progressPct}%`, opacity: isDragging ? 1 : undefined }}
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-white/80 tabular-nums">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label={t(isFullscreen ? "referenceVideo.exitFullscreen" : "referenceVideo.fullscreen")}
              className="w-8 h-8 -mr-1 rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 transition-colors"
            >
              {isFullscreen ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 3v3a2 2 0 0 1-2 2H4M15 3v3a2 2 0 0 0 2 2h3M9 21v-3a2 2 0 0 0-2-2H4M15 21v-3a2 2 0 0 1 2-2h3" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
