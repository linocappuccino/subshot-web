"use client";

import { isVideoUrl } from "@/lib/media";

/** Read-only image/video renderer for the public "Ideen-Preview" page
 * (#262). `imageUrl` is an `IdeaImageOut.image_url` — since the #248
 * image-to-R2 migration this is always already a full presigned R2 URL
 * (auth lives in the query string), so this can render it directly with a
 * plain <img>/<video> instead of fetching the bytes ourselves through a
 * share-link-authenticated proxy route the way AuthImage.tsx/the old
 * version of this component did. Branches on isVideoUrl the same way
 * IdeaTile.tsx/IdeaFloatingCard.tsx do — idea images can now also be real
 * video files (2026-07-21). */
export function PublicIdeaMedia({
  imageUrl, className, onAspectRatio, objectPosition,
}: {
  imageUrl: string;
  className?: string;
  onAspectRatio?: (ratio: number) => void;
  /** Face-detected auto-focus point (IdeaImage.focus_x/focus_y, #388) so a
   * tightly-cropped tile doesn't cut a face out of frame — same convention
   * as IdeaTile.tsx's AuthImage usage. */
  objectPosition?: string;
}) {
  if (isVideoUrl(imageUrl)) {
    return (
      <video
        src={imageUrl}
        className={className}
        style={objectPosition ? { objectPosition } : undefined}
        autoPlay
        loop
        muted
        playsInline
        onLoadedMetadata={(e) => {
          const el = e.currentTarget;
          if (el.videoHeight > 0) onAspectRatio?.(el.videoWidth / el.videoHeight);
        }}
      />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={imageUrl}
      alt=""
      className={className}
      style={objectPosition ? { objectPosition } : undefined}
      onLoad={(e) => {
        const img = e.currentTarget;
        if (img.naturalHeight > 0) onAspectRatio?.(img.naturalWidth / img.naturalHeight);
      }}
    />
  );
}
