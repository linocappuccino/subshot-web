"use client";

import { useEffect, useState } from "react";

/** Video counterpart to AuthImage.tsx — for idea images that turned out to
 * be real video files (2026-07-21, Lino: "in der Ideenkachel kann man bis
 * jetzt nur Bilder hochladen, aber noch keine Videos"). Since #248
 * (2026-07-22) `path` is a presigned R2 URL, same as AuthImage.tsx — see
 * that component's own updated doc comment for why the auth-header-fetch
 * dance this used to need is gone. Always autoplays muted+looped — these
 * are silent GIF-like clips in an idea tile, not a video with its own audio
 * track anyone expects to hear (VideoReviewModal's real Postproduction
 * videos are a completely separate, audio-on player). */
export function AuthVideo({
  path,
  className,
  onAspectRatio,
}: {
  path: string;
  className?: string;
  /** Same contract as AuthImage's onAspectRatio — real width/height ratio
   * once metadata loads, so the caller can size its container to match
   * instead of assuming a fixed 16:9. */
  onAspectRatio?: (ratio: number) => void;
}) {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
  }, [path]);

  return (
    <>
      {!loaded && <div className={`${className ?? ""} bg-white/5 animate-pulse`} />}
      <video
        src={path}
        className={className}
        style={{ display: loaded ? undefined : "none" }}
        autoPlay
        loop
        muted
        playsInline
        onLoadedMetadata={(e) => {
          const el = e.currentTarget;
          if (el.videoHeight > 0) onAspectRatio?.(el.videoWidth / el.videoHeight);
          setLoaded(true);
        }}
        onError={() => setLoaded(false)}
      />
    </>
  );
}
