"use client";

import { createContext, useContext } from "react";

/** 2026-10-08, Lino: "bei jeder Datei, die man hochlädt, muss ein kleines
 * Download-Icon rechts oben sein" — always the ORIGINAL file (the board
 * itself shows the lighter web version). Provided by IdeaBoard. */
export const BoardDownloadContext = createContext<((key: string, name: string) => void) | null>(null);

/** 2026-11-19, Lino — client pages: downloads only where the team switched «Kunden dürfen herunterladen» on
 * (the server marks those nodes can_download / groups download_count and checks again on every download) */
export type ClientDownload = { file: (elementId: string) => void; zip: (groupId: string) => void; label: string; allLabel: string };
export const BoardClientDownloadContext = createContext<ClientDownload | null>(null);

/** the client's (blue, always visible) download button on an allowed node */
export function ClientDownloadButton({ elementId, scale = 1, className = "" }: { elementId: string; scale?: number; className?: string }) {
  const dl = useContext(BoardClientDownloadContext);
  if (!dl) return null;
  return (
    <button
      data-board-ui
      data-no-drag
      data-client-download
      title={dl.label}
      aria-label={dl.label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        dl.file(elementId);
      }}
      className={`absolute z-20 w-8 h-8 rounded-full bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center shadow-lg ${className}`}
      style={{ transform: `scale(${scale})`, transformOrigin: "100% 0" }}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
      </svg>
    </button>
  );
}

/** current zoom, bucketed (1, 2, 4) — images ask for a bigger file only
 * when the board is zoomed in far enough to need it */
export const BoardZoomContext = createContext(1);

/** 2026-11-01 — zoom bucket for picking image SIZES only (0.25 / 0.5 / 1 / 2 / 4): unlike BoardZoomContext it goes
 * below 1, so a zoomed-out board asks for the small R2 variant instead of the 2048-px one (iOS out-of-memory) */
export const BoardImageZoomContext = createContext(1);

/** the board's live zoom factor (a ref, so reading it doesn't re-render) */
export const BoardScaleContext = createContext<{ current: number }>({ current: 1 });

/** board image that fills its (positioned) parent. The board is zoomed with
 * CSS `zoom` (see IdeaBoard), so a plain <img> is painted at the resolution
 * it's shown at — on iPad too. */
export function SharpImg({ className = "", ...img }: React.ImgHTMLAttributes<HTMLImageElement>) {
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  return <img decoding="async" {...img} className={`absolute inset-0 w-full h-full ${className}`} />;
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
