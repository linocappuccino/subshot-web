"use client";

import { useRef, useState } from "react";
import { AuthImage } from "@/app/components/AuthImage";
import { usePinnedUrl, ReferenceVideoLightbox } from "@/app/components/ReferenceVideoBlock";
import { useLanguage } from "@/lib/i18n";

/** 2026-09-08, Lino: "auf der Preview page muss das scribble video auch
 * dargestellt werden" — read-only counterpart to ReferenceVideoBlock.tsx
 * for the public Skript-/Szenen-Preview (preview-scenes/[token]/page.tsx),
 * same thumbnail+lightbox UI, no upload/replace/delete affordances (no
 * "…" menu at all) and no `hasVideo` upload-status branch — the server
 * only ever sends these fields once reference_video_status is "ready"
 * (see get_scenes_preview's own gate in main.py), so a null url here
 * simply means "no scribble video for this project", not "still
 * uploading". Reuses usePinnedUrl/ReferenceVideoLightbox from the
 * authenticated component rather than duplicating either. */
export function PublicReferenceVideoBlock({
  url,
  thumbnailUrl,
  thumbnailFocusX,
  thumbnailFocusY,
}: {
  url: string | null;
  thumbnailUrl: string | null;
  thumbnailFocusX: number | null;
  thumbnailFocusY: number | null;
}) {
  const { t } = useLanguage();
  const [showLightbox, setShowLightbox] = useState(false);
  // 2026-09-10 — see ReferenceVideoBlock.tsx's identical thumbButtonRef/
  // lightboxOriginRect for why: the lightbox's FLIP open animation grows
  // from this exact thumbnail's on-screen rect, captured at click time.
  const thumbButtonRef = useRef<HTMLButtonElement>(null);
  const [lightboxOriginRect, setLightboxOriginRect] = useState<DOMRect | null>(null);
  const pinnedVideoUrl = usePinnedUrl(url);
  const pinnedThumbnailUrl = usePinnedUrl(thumbnailUrl);
  const thumbnailObjectPosition =
    thumbnailFocusX != null && thumbnailFocusY != null
      ? `${(thumbnailFocusX * 100).toFixed(1)}% ${(thumbnailFocusY * 100).toFixed(1)}%`
      : undefined;

  if (!pinnedVideoUrl) return null;

  return (
    <div className="mb-4">
      <button
        ref={thumbButtonRef}
        type="button"
        onClick={() => {
          setLightboxOriginRect(thumbButtonRef.current?.getBoundingClientRect() ?? null);
          setShowLightbox(true);
        }}
        className="group relative block w-full sm:w-72 aspect-video rounded-2xl bg-black overflow-hidden border border-white/10"
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
      {showLightbox && (
        <ReferenceVideoLightbox url={pinnedVideoUrl} originRect={lightboxOriginRect} onClose={() => setShowLightbox(false)} />
      )}
    </div>
  );
}
