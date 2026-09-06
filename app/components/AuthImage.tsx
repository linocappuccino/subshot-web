"use client";

import { useEffect, useState } from "react";

/** Renders a scene/shot/folder/idea cover photo. Named "AuthImage" from when
 * this needed a Clerk Bearer token to fetch the bytes itself and swap in an
 * object URL (a plain <img src={apiPath}> couldn't attach one) — since #248
 * (2026-07-22) these 4 image fields are presigned R2 URLs computed fresh
 * per-response (same scheme video's own playback_url already used), so
 * `path` is now already a plain, directly-fetchable external URL and this
 * is just a thin wrapper around <img> for the onLoad-derived aspect-ratio/
 * orientation reporting below. Kept the name (rather than renaming every
 * call site) since it's still THE way this app renders one of these 4
 * fields, auth or not. */
export function AuthImage({
  path,
  alt,
  className,
  lockAspectRatio,
  objectPosition,
  onOrientation,
  onAspectRatio,
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
  /** 2026-07-17 — reports the loaded photo's real orientation to the
   * caller, independent of `lockAspectRatio` (which only affects THIS
   * element's own aspect-ratio style). IdeaFloatingCard uses this to size
   * its OUTER container differently per orientation (Lino: 16:9 photos
   * shown at full card width uncropped, 9:16 shown smaller so a tall
   * portrait photo doesn't dominate the tile). */
  onOrientation?: (orientation: "landscape" | "portrait") => void;
  /** 2026-07-18 (Todoist #197, Lino: "16:9 Bilder werden abgeschnitten...
   * die Kachel soll sich dem Bild anpassen") — the exact natural width/
   * height ratio, not bucketed into a rough 16:9/9:16 guess like
   * `onOrientation` above. Lets a caller size its OWN container to the
   * photo's REAL proportions (e.g. a 21:9 screenshot) instead of forcing
   * every landscape photo into an assumed 16:9 box. */
  onAspectRatio?: (ratio: number) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [ratio, setRatio] = useState<"16 / 9" | "9 / 16" | null>(null);

  // 2026-07-22, Lino: "springt der abschnitt für eine millisekunde nach
  // unten und dann wieder hoch... so ca. alle 13 sekunden" — the page's own
  // 12s "live updates" poll (projects/[id]/page.tsx) refetches the whole
  // project on an interval, and since #248 every image_url is a presigned
  // R2 URL signed FRESH per response — a new query string every single
  // poll, even though the underlying photo never changed. This effect used
  // to key off the full `path` string, so a poll's mere re-signing counted
  // as "a new image": hid the real <img>, dropped `ratio` (collapsing
  // `lockAspectRatio`'s box) and showed the blank pulse placeholder until
  // the (byte-identical) image finished reloading — a real collapse/
  // restore flicker every ~12s, not just a harmless extra fetch. Keying off
  // origin+pathname instead (the actual R2 object key, which only changes
  // when the photo genuinely does) ignores the query string's auth
  // parameters entirely.
  const pathIdentity = (() => {
    try {
      const u = new URL(path);
      return u.origin + u.pathname;
    } catch {
      return path;
    }
  })();

  useEffect(() => {
    setLoaded(false);
    setRatio(null);
  }, [pathIdentity]);

  return (
    <>
      {!loaded && <div className={`${className ?? ""} bg-white/5 animate-pulse`} />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={path}
        alt={alt}
        // 2026-08-31 — perf pass: this is THE way every scene/shot/folder/
        // idea cover photo renders app-wide (see this component's own doc
        // comment) — native lazy-loading means a photo well below the fold
        // (a long scene list, a big folder grid) doesn't start downloading
        // until it's actually about to scroll into view, instead of every
        // cover photo on the page competing for bandwidth immediately on
        // load. No next/image migration needed for this alone — the
        // attribute works on a plain <img> in every browser this app targets.
        loading="lazy"
        className={className}
        style={{
          display: loaded ? undefined : "none",
          ...(lockAspectRatio && ratio ? { aspectRatio: ratio } : undefined),
          ...(objectPosition ? { objectPosition } : undefined),
        }}
        onLoad={(e) => {
          const img = e.currentTarget;
          const isLandscape = img.naturalWidth >= img.naturalHeight;
          if (lockAspectRatio) setRatio(isLandscape ? "16 / 9" : "9 / 16");
          onOrientation?.(isLandscape ? "landscape" : "portrait");
          if (img.naturalHeight > 0) onAspectRatio?.(img.naturalWidth / img.naturalHeight);
          setLoaded(true);
        }}
        onError={() => setLoaded(false)}
      />
    </>
  );
}
