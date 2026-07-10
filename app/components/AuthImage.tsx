"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/useApi";

/** Renders a scene/shot photo that needs an auth header to fetch (see
 * ApiClient.fetchImageBlobUrl) — a plain <img src={apiPath}> can't attach
 * one, so this fetches the bytes itself and swaps in an object URL once
 * ready. Revokes the previous object URL on unmount/path change so repeated
 * navigation doesn't leak blob memory. */
export function AuthImage({
  path,
  alt,
  className,
  lockAspectRatio,
  objectPosition,
}: {
  path: string;
  alt: string;
  className?: string;
  /** Locks the rendered box to a clean 16:9 (landscape source) or 9:16
   * (portrait source) ratio based on the photo's real dimensions, instead
   * of whatever a fixed max-height class + object-cover happens to crop it
   * to — same fix as ImageDropZone's lockAspectRatio, for the read-only
   * scene tile cover photo this component also renders. */
  lockAspectRatio?: boolean;
  /** CSS object-position, e.g. "48% 90%" — used with a face-detected focus
   * point (see ProjectFolder.background_image_focus_x/y) so an
   * object-cover crop centers on the face instead of the geometric middle.
   * Falls back to the browser default (50% 50%, plain center) when omitted. */
  objectPosition?: string;
}) {
  const api = useApi();
  const [src, setSrc] = useState<string | null>(null);
  const [ratio, setRatio] = useState<"16 / 9" | "9 / 16" | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setRatio(null);
    api.fetchImageBlobUrl(path).then((url) => {
      if (cancelled) {
        URL.revokeObjectURL(url);
        return;
      }
      objectUrl = url;
      setSrc(url);
    }).catch(() => setSrc(null));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  if (!src) {
    return <div className={`${className ?? ""} bg-white/5 animate-pulse`} />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      style={{
        ...(lockAspectRatio && ratio ? { aspectRatio: ratio } : undefined),
        ...(objectPosition ? { objectPosition } : undefined),
      }}
      onLoad={(e) => {
        if (!lockAspectRatio) return;
        const img = e.currentTarget;
        setRatio(img.naturalWidth >= img.naturalHeight ? "16 / 9" : "9 / 16");
      }}
    />
  );
}
