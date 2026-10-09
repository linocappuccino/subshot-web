"use client";

/* 2026-10-09, Lino: "die Adressen-Node sieht super verpixelt aus … man sieht
 * auch nicht den Pointer, der auf die genaue Adresse zeigt". The location
 * card used to show one baked 640×340 map image. Now it's a small tile map:
 * the tiles are loaded at the zoom level the board is shown at (sharp on
 * Retina and at 400 %, with more detail the further you zoom in), and the
 * pin is drawn on top, exactly on the address. Tiles come through the API
 * (app/map_tiles.py: Google Map Tiles if enabled, else OpenStreetMap). */

import { useContext, useEffect, useState } from "react";
import { BoardZoomContext } from "./BoardDownload";

const API = process.env.NEXT_PUBLIC_API_BASE_URL!;
const TILE = 256;
/** map zoom at 100 % board zoom (1 tile pixel = 1 CSS pixel of the card) */
const BASE_ZOOM = { map: 16, satellite: 17 } as const;
const MAX_ZOOM = { google: 20, osm: 19 } as const;

type Provider = "google" | "osm" | null;
type Info = { map: Provider; satellite: Provider };
let infoPromise: Promise<Info> | null = null;
function tileInfo(): Promise<Info> {
  infoPromise ??= fetch(`${API}/maps/tiles/info`)
    .then((r) => (r.ok ? r.json() : { map: null, satellite: null }))
    .catch(() => ({ map: null, satellite: null }));
  return infoPromise;
}

function worldPx(lat: number, lng: number, z: number) {
  const n = TILE * 2 ** z;
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return { x: ((lng + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}

function TileLayer({ lat, lng, w, h, style, z0, zt, provider }: { lat: number; lng: number; w: number; h: number; style: string; z0: number; zt: number; provider: string }) {
  const k = 2 ** (zt - z0);
  const c = worldPx(lat, lng, zt);
  const left0 = c.x - (w * k) / 2;
  const top0 = c.y - (h * k) / 2;
  const n = 2 ** zt;
  const tiles: { x: number; y: number; key: string }[] = [];
  for (let tx = Math.floor(left0 / TILE); tx <= Math.floor((left0 + w * k) / TILE); tx++)
    for (let ty = Math.floor(top0 / TILE); ty <= Math.floor((top0 + h * k) / TILE); ty++)
      if (ty >= 0 && ty < n) tiles.push({ x: tx, y: ty, key: `${zt}/${tx}/${ty}` });
  const size = TILE / k;
  return (
    <>
      {tiles.map((t) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={t.key}
          // the source in the URL: switching OSM → Google must not reuse cached tiles
          src={`${API}/maps/tiles/${style}/${zt}/${((t.x % n) + n) % n}/${t.y}?p=${provider}`}
          alt=""
          draggable={false}
          className="absolute max-w-none pointer-events-none select-none"
          // +0.5: no hairline seams between tiles
          style={{ left: (t.x * TILE - left0) / k, top: (t.y * TILE - top0) / k, width: size + 0.5, height: size + 0.5 }}
        />
      ))}
    </>
  );
}

export function LocationMap({ lat, lng, style, w, fallbackSrc }: { lat: number; lng: number; style: "map" | "satellite"; w: number; fallbackSrc?: string | null }) {
  const zoom = useContext(BoardZoomContext);
  const [info, setInfo] = useState<Info | null>(null);
  useEffect(() => {
    let alive = true;
    tileInfo().then((i) => alive && setInfo(i));
    return () => {
      alive = false;
    };
  }, []);
  const h = (w * 34) / 64;
  const provider = info?.[style] ?? null;
  const hidpi = provider === "google"; // Google sends 512 px tiles for the same area
  const dpr = typeof window === "undefined" ? 2 : window.devicePixelRatio || 1;
  const z0 = BASE_ZOOM[style];
  const maxZ = provider ? MAX_ZOOM[provider] : z0;
  const zFor = (boardZoom: number) => Math.min(maxZ, z0 + Math.max(0, Math.ceil(Math.log2(boardZoom * dpr) - (hidpi ? 1 : 0) - 0.15)));
  const zBase = zFor(1);
  const zHigh = zFor(zoom);

  return (
    <div className="relative w-full overflow-hidden bg-[#e8e4dc]" style={{ height: h }}>
      {fallbackSrc && (
        // stored map image: placeholder while tiles load, and the only map when the style has no tiles
        // eslint-disable-next-line @next/next/no-img-element
        <img src={fallbackSrc} alt="" draggable={false} className="absolute inset-0 w-full h-full object-cover pointer-events-none select-none" />
      )}
      {provider && (
        <>
          <TileLayer lat={lat} lng={lng} w={w} h={h} style={style} z0={z0} zt={zBase} provider={provider} />
          {zHigh > zBase && <TileLayer lat={lat} lng={lng} w={w} h={h} style={style} z0={z0} zt={zHigh} provider={provider} />}
          {/* the pin: its tip sits exactly on the address; grows only half as
              fast as the board zoom, so it never covers the spot when zoomed in */}
          <svg width="26" height="36" viewBox="0 0 26 36" className="absolute pointer-events-none drop-shadow-[0_2px_3px_rgba(0,0,0,0.45)]"
            style={{ left: w / 2 - 13, top: h / 2 - 35, transform: `scale(${1 / Math.sqrt(zoom)})`, transformOrigin: "13px 35px" }}>
            <path d="M13 35C13 35 25 21.5 25 13A12 12 0 0 0 1 13C1 21.5 13 35 13 35Z" fill="#e5484d" stroke="#fff" strokeWidth="2" />
            <circle cx="13" cy="13" r="4.5" fill="#fff" />
          </svg>
          <div className="absolute right-1 bottom-0.5 text-[7px] leading-none px-1 py-0.5 rounded-sm bg-white/70 text-black/70 pointer-events-none select-none">
            © {provider === "google" ? "Google" : "OpenStreetMap"}
          </div>
        </>
      )}
      {!provider && !fallbackSrc && <div className="absolute inset-0 flex items-center justify-center text-3xl">📍</div>}
    </div>
  );
}
