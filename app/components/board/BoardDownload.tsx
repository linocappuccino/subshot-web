"use client";

import { createContext, useContext } from "react";

/** 2026-10-08, Lino: "bei jeder Datei, die man hochlädt, muss ein kleines
 * Download-Icon rechts oben sein" — always the ORIGINAL file (the board
 * itself shows the lighter web version). Provided by IdeaBoard. */
export const BoardDownloadContext = createContext<((key: string, name: string) => void) | null>(null);

/** current zoom, bucketed (1, 2, 4) — images ask for a bigger file only
 * when the board is zoomed in far enough to need it */
export const BoardZoomContext = createContext(1);

/** 2026-10-08 (Lino: "beim starken Einzoomen pixelig" on the iPad) — WebKit
 * (Safari and Chrome on iPad/iPhone) rasterizes an image at its LAYOUT size,
 * i.e. before the board's zoom transform, and then just scales that bitmap
 * up — so even a 4000 px file looks soft at 400 %. When the board is zoomed
 * in, the image is laid out `zoom` times larger and scaled back down by the
 * same factor: it then gets rasterized at the size it's actually shown at.
 * At normal zoom it's a plain <img>. Fills its (positioned) parent. */
export function SharpImg({ className = "", style, ...img }: React.ImgHTMLAttributes<HTMLImageElement>) {
  const zoom = useContext(BoardZoomContext);
  if (zoom <= 1) {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...img} className={`absolute inset-0 w-full h-full ${className}`} style={style} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img
      {...img}
      className={`absolute left-0 top-0 max-w-none ${className}`}
      style={{ ...style, width: `${zoom * 100}%`, height: `${zoom * 100}%`, transform: `scale(${1 / zoom})`, transformOrigin: "0 0" }}
    />
  );
}

export function DownloadButton({ fileKey, name, title, scale = 1, className = "" }: { fileKey: string; name: string; title: string; scale?: number; className?: string }) {
  const download = useContext(BoardDownloadContext);
  if (!download) return null;
  return (
    <button
      data-board-ui
      data-no-drag
      title={title}
      aria-label={title}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        download(fileKey, name);
      }}
      className={`absolute z-20 w-7 h-7 rounded-full bg-black/65 backdrop-blur text-white flex items-center justify-center shadow-lg hover:bg-blue-600 transition-[opacity,background-color] opacity-0 group-hover:opacity-100 group-hover/mb:opacity-100 [@media(hover:none)]:opacity-90 ${className}`}
      style={{ transform: `scale(${scale})`, transformOrigin: "100% 0" }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
      </svg>
    </button>
  );
}
