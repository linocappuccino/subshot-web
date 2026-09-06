"use client";

import { useEffect, useState } from "react";
import { publicScenesPreviewApi } from "@/lib/publicScenesPreviewApi";

/** Location block for the public "Szenenpreview" page (#268) — map thumbnail
 * (best-effort, see fetchStaticMapBlobUrl's own doc comment on the backend)
 * + address text, wrapped in a link to Google Maps, same idea as
 * share_view.py's _location_block. Renders nothing if there's no address at
 * all (same "only show what exists" convention as every other optional
 * block on this page). */
export function PublicMapThumb({
  token, unlockToken, address, lat, lng, compact,
}: {
  token: string;
  unlockToken: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  compact?: boolean;
}) {
  const [mapSrc, setMapSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setMapSrc(null);
    if (lat == null || lng == null) return;
    publicScenesPreviewApi
      .fetchStaticMapBlobUrl(token, unlockToken, Math.round(lat * 10000) / 10000, Math.round(lng * 10000) / 10000)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setMapSrc(url);
      })
      .catch(() => setMapSrc(null));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [token, unlockToken, lat, lng]);

  if (!address) return null;
  const mapsUrl = lat != null && lng != null ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` : null;
  const thumbSize = compact ? "w-11 h-11" : "w-16 h-16";

  const inner = (
    <>
      {mapSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={mapSrc} alt="" className={`${thumbSize} object-cover rounded-lg shrink-0`} />
      ) : lat != null && lng != null ? (
        <div className={`${thumbSize} rounded-lg shrink-0 bg-white/5`} />
      ) : null}
      <span className={`flex items-center gap-1.5 ${compact ? "text-xs text-white/60" : "text-[13px]"}`}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
          <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" />
        </svg>
        {address}
      </span>
    </>
  );

  const cls = `flex items-center gap-2.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.07] transition-colors ${compact ? "p-1.5 my-2" : "p-2"}`;

  if (mapsUrl) {
    return (
      <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className={cls}>
        {inner}
      </a>
    );
  }
  return <div className={cls}>{inner}</div>;
}
