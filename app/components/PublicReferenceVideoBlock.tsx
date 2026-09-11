"use client";

import { useRef, useState } from "react";
import { AuthImage } from "@/app/components/AuthImage";
import { usePinnedUrl, ReferenceVideoLightbox } from "@/app/components/ReferenceVideoBlock";
import { useLanguage } from "@/lib/i18n";
import type { ReferenceVideo } from "@/lib/types";

/** 2026-09-08, Lino: "auf der Preview page muss das scribble video auch
 * dargestellt werden" — read-only counterpart to ReferenceVideoBlock.tsx
 * for the public Skript-/Szenen-Preview (preview-scenes/[token]/page.tsx),
 * same thumbnail+lightbox UI, no upload/delete affordances (no "…" menu at
 * all) — the server only ever sends "ready" rows here (see
 * get_scenes_preview's own filter in main.py), so every entry is safe to
 * render as-is.
 *
 * 2026-09-11 — multi-video (Lino: "man soll mehrere scribble videos
 * hochladen können, diese werden dann nebeneinander angezeigt"), same
 * `flex flex-wrap` grid + "V{n}" badge as the authenticated component;
 * "Preview seite dann auch!" was Lino's explicit ask for this file
 * specifically, not just the in-app editor. */
export function PublicReferenceVideoBlock({ videos }: { videos: ReferenceVideo[] }) {
  const [lightboxVideoId, setLightboxVideoId] = useState<string | null>(null);
  const [lightboxOriginRect, setLightboxOriginRect] = useState<DOMRect | null>(null);

  if (videos.length === 0) return null;

  return (
    <div className="mb-4 flex flex-wrap gap-3">
      {videos.map((video, index) => (
        <PublicReferenceVideoTile
          key={video.id}
          video={video}
          label={`V${index + 1}`}
          onOpen={(rect) => {
            setLightboxOriginRect(rect);
            setLightboxVideoId(video.id);
          }}
        />
      ))}
      {(() => {
        const lightboxVideo = videos.find((v) => v.id === lightboxVideoId);
        return lightboxVideo ? (
          <PinnedLightbox video={lightboxVideo} originRect={lightboxOriginRect} onClose={() => setLightboxVideoId(null)} />
        ) : null;
      })()}
    </div>
  );
}

function PinnedLightbox({ video, originRect, onClose }: { video: ReferenceVideo; originRect: DOMRect | null; onClose: () => void }) {
  const pinnedUrl = usePinnedUrl(video.url);
  if (!pinnedUrl) return null;
  return <ReferenceVideoLightbox url={pinnedUrl} originRect={originRect} onClose={onClose} />;
}

function PublicReferenceVideoTile({
  video,
  label,
  onOpen,
}: {
  video: ReferenceVideo;
  label: string;
  onOpen: (originRect: DOMRect) => void;
}) {
  const { t } = useLanguage();
  const thumbButtonRef = useRef<HTMLButtonElement>(null);
  const pinnedVideoUrl = usePinnedUrl(video.url);
  const pinnedThumbnailUrl = usePinnedUrl(video.thumbnail_url);
  const thumbnailObjectPosition =
    video.thumbnail_focus_x != null && video.thumbnail_focus_y != null
      ? `${(video.thumbnail_focus_x * 100).toFixed(1)}% ${(video.thumbnail_focus_y * 100).toFixed(1)}%`
      : undefined;

  if (!pinnedVideoUrl) return null;

  return (
    <button
      ref={thumbButtonRef}
      type="button"
      onClick={() => {
        const rect = thumbButtonRef.current?.getBoundingClientRect();
        if (rect) onOpen(rect);
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
      <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/50 backdrop-blur-sm text-[11px] font-semibold text-white/90 tabular-nums pointer-events-none">
        {label}
      </div>
    </button>
  );
}
