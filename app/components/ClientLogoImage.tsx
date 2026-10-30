"use client";

import { cn } from "@/lib/cn";

/** 2026-10-30, Lino: «Warum hat das Logo immer einen weissen Rahmen? Es soll doch füllend von dem Feld gezeigt
 * werden» — ONE look for every client-logo field (tile badge, project dialog, Deliver picker): the logo fills
 * its box (object-cover, no padding, no white plate; what sticks out is cut off by the rounded box). Behind a
 * transparent PNG / SVG there is nothing — the tile / panel colour shows through. The box size comes from
 * `className` (e.g. "h-8 w-14 rounded-lg"). */
export function ClientLogoImage({ src, className, alt = "" }: { src: string; className?: string; alt?: string }) {
  return (
    <span className={cn("block shrink-0 overflow-hidden rounded-lg", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- presigned R2 URL / local preview */}
      <img src={src} alt={alt} draggable={false} className="h-full w-full object-cover" />
    </span>
  );
}
