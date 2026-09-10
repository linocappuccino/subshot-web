"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ApiError } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { readVideoMetadata } from "@/lib/media";
import { useLanguage } from "@/lib/i18n";
import { useToast } from "@/app/components/ui/Toast";
import { ConfirmDialog } from "@/app/components/ui/ConfirmDialog";
import { Menu, MenuItem } from "@/app/components/ui/Menu";
import { IconButton } from "@/app/components/ui/Button";
import { AuthImage } from "@/app/components/AuthImage";
import type { Section } from "@/lib/types";

const ALLOWED_REFERENCE_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];

type ReferenceVideoFields = Pick<
  Section,
  | "reference_video_url"
  | "reference_video_status"
  | "reference_video_original_filename"
  | "reference_video_duration_seconds"
  | "reference_video_thumbnail_url"
  | "reference_video_thumbnail_focus_x"
  | "reference_video_thumbnail_focus_y"
>;

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
 * video), now one slot per Section/Shotlist, same presign-then-complete
 * upload flow the postproduction page's video versions already use (see
 * createReferenceVideo/completeReferenceVideo in lib/api.ts), deliberately
 * without versioning/comments/watermark — a single replaceable file is
 * enough here. */
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
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [showLightbox, setShowLightbox] = useState(false);

  async function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!ALLOWED_REFERENCE_VIDEO_TYPES.includes(file.type)) {
      toast.showError(t("referenceVideo.unsupportedType"));
      return;
    }
    setUploadProgress(0);
    try {
      const { upload_url } = await api.createReferenceVideo(sectionId, file);
      onUpdate({ reference_video_status: "uploading", reference_video_original_filename: file.name });
      await api.uploadVideoFile(upload_url, file, setUploadProgress);
      const meta = await readVideoMetadata(file);
      const updated = await api.completeReferenceVideo(sectionId, meta.duration);
      onUpdate(updated);
    } catch (err) {
      toast.showError(err instanceof ApiError ? err.message : t("referenceVideo.uploadFailed"));
      onUpdate({ reference_video_status: null, reference_video_url: null, reference_video_original_filename: null });
    } finally {
      setUploadProgress(null);
    }
  }

  async function handleDelete() {
    setConfirmingDelete(false);
    try {
      await api.deleteReferenceVideo(sectionId);
      onUpdate({
        reference_video_url: null,
        reference_video_status: null,
        reference_video_original_filename: null,
        reference_video_duration_seconds: null,
      });
    } catch (err) {
      toast.showError(err instanceof ApiError ? err.message : t("referenceVideo.deleteFailed"));
    }
  }

  const hasVideo = section.reference_video_status === "ready" && !!section.reference_video_url;
  const pinnedVideoUrl = usePinnedUrl(section.reference_video_url);
  const pinnedThumbnailUrl = usePinnedUrl(section.reference_video_thumbnail_url);
  const thumbnailObjectPosition =
    section.reference_video_thumbnail_focus_x != null && section.reference_video_thumbnail_focus_y != null
      ? `${(section.reference_video_thumbnail_focus_x * 100).toFixed(1)}% ${(section.reference_video_thumbnail_focus_y * 100).toFixed(1)}%`
      : undefined;
  // 2026-09-10, Lino: "wie die videos auf der linocappuccino webseite,
  // quasi in einem lightbox player mit der gleichen open animation" — the
  // lightbox grows FROM this exact thumbnail's on-screen position/size
  // (see flipTransform in ReferenceVideoLightbox below), so the trigger
  // needs to capture that rect at the moment of the click, before the
  // lightbox even mounts.
  const thumbButtonRef = useRef<HTMLButtonElement>(null);
  const [lightboxOriginRect, setLightboxOriginRect] = useState<DOMRect | null>(null);

  return (
    <div className="mb-5">
      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_REFERENCE_VIDEO_TYPES.join(",")}
        className="hidden"
        onChange={handlePick}
      />
      {uploadProgress !== null ? (
        <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-4 flex flex-col gap-2">
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
      ) : section.reference_video_status === "processing" ? (
        // 2026-09-10, Lino: "das scribble Video braucht extrem lange zu
        // laden wenn man es abspielt! wird es komprimiert?" — it wasn't;
        // now it is (see complete_reference_video/compress_for_web on the
        // backend), and this is the window while that background
        // compression runs (client's own upload already finished — no
        // percent to show, unlike the branch above). Same shape as
        // AnnotationsPanel-adjacent "please wait" states elsewhere in this
        // app, indeterminate spinner instead of a progress bar.
        <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-4 flex items-center gap-2.5">
          <svg className="animate-spin w-4 h-4 text-white/50" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm font-medium text-white/70">{t("referenceVideo.processing")}</span>
        </div>
      ) : hasVideo ? (
        <div className="relative w-full sm:w-72 rounded-2xl bg-black overflow-hidden border border-white/10">
          {/* 2026-09-08, Lino: "es soll ein thumbnail dargestellt werden und
           * wenn man darauf klickt, soll sich das video in einer lightbox
           * öffnen" — was a full-width inline <video controls>; now a
           * compact clickable thumbnail that opens ReferenceVideoLightbox
           * below on click. Lino, same session: "das video thumbnail soll
           * dann auch immer ein zentriertes gesicht sein" — the real
           * thumbnail (reference_video_thumbnail_url, face-priority frame +
           * detect_face_focus object-position, same AuthImage/
           * background_image_focus_x/y convention projects/page.tsx already
           * uses for folder covers) is generated by a backend background
           * task shortly after upload and arrives on this same object via
           * the page's existing 12s poll — while it's still null (the
           * ~seconds-long window right after a fresh upload), falls back to
           * a muted <video preload="metadata"> showing its own first frame,
           * same "browser renders it like an <img> poster" trick as before. */}
          <button
            ref={thumbButtonRef}
            type="button"
            onClick={() => {
              setLightboxOriginRect(thumbButtonRef.current?.getBoundingClientRect() ?? null);
              setShowLightbox(true);
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
              <video src={pinnedVideoUrl ?? undefined} muted preload="metadata" playsInline className="w-full h-full object-cover" />
            )}
            <div className="absolute inset-0 flex items-center justify-center bg-black/10 group-hover:bg-black/30 transition-colors">
              <div className="w-11 h-11 rounded-full bg-white/90 flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="#000" className="translate-x-[1px]"><path d="M8 5v14l11-7z" /></svg>
              </div>
            </div>
          </button>
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
                <>
                  <MenuItem
                    onClick={() => {
                      inputRef.current?.click();
                      close();
                    }}
                  >
                    {t("referenceVideo.replace")}
                  </MenuItem>
                  <MenuItem
                    danger
                    onClick={() => {
                      setConfirmingDelete(true);
                      close();
                    }}
                  >
                    {t("common.delete")}
                  </MenuItem>
                </>
              )}
            </Menu>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full flex items-center gap-2 justify-center rounded-2xl border border-dashed border-white/15 hover:border-white/30 bg-white/[0.02] hover:bg-white/[0.05] text-white/50 hover:text-white/80 py-5 transition-colors text-sm font-medium"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          {t("referenceVideo.upload")}
        </button>
      )}
      <ConfirmDialog
        open={confirmingDelete}
        title={t("referenceVideo.deleteTitle")}
        message={t("referenceVideo.deleteMessage")}
        onConfirm={handleDelete}
        onCancel={() => setConfirmingDelete(false)}
      />
      {showLightbox && hasVideo && pinnedVideoUrl && (
        <ReferenceVideoLightbox url={pinnedVideoUrl} originRect={lightboxOriginRect} onClose={() => setShowLightbox(false)} />
      )}
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
 * no seek bar either. */
export function ReferenceVideoLightbox({ url, originRect, onClose }: { url: string; originRect: DOMRect | null; onClose: () => void }) {
  const { t } = useLanguage();
  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [closing, setClosing] = useState(false);
  const [paused, setPaused] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

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
          className="block max-w-[92vw] max-h-[88vh] cursor-pointer"
        />
        {paused && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-14 h-14 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff" className="translate-x-[1px]"><path d="M8 5v14l11-7z" /></svg>
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={toggleFullscreen}
          aria-label={t(isFullscreen ? "referenceVideo.exitFullscreen" : "referenceVideo.fullscreen")}
          className="absolute bottom-3 right-3 w-9 h-9 rounded-full bg-black/50 backdrop-blur-sm hover:bg-black/70 flex items-center justify-center text-white transition-colors"
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
    </div>,
    document.body
  );
}
