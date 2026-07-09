"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/useApi";

/** Renders a scene/shot photo that needs an auth header to fetch (see
 * ApiClient.fetchImageBlobUrl) — a plain <img src={apiPath}> can't attach
 * one, so this fetches the bytes itself and swaps in an object URL once
 * ready. Revokes the previous object URL on unmount/path change so repeated
 * navigation doesn't leak blob memory. */
export function AuthImage({ path, alt, className }: { path: string; alt: string; className?: string }) {
  const api = useApi();
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
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
  return <img src={src} alt={alt} className={className} />;
}
