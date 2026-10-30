"use client";

import { cn } from "@/lib/cn";

/** 2026-10-30, Lino: «Warum hat das Logo immer einen weissen Rahmen? Es soll doch füllend von dem Feld gezeigt
 * werden» — ONE look for every client-logo field (tile badge, project dialog, Deliver picker): the logo fills
 * its box (object-cover, no padding, no white plate; what sticks out is cut off by the rounded box). Behind a
 * transparent PNG / SVG there is nothing — the tile / panel colour shows through.
 * 2026-10-30, Lino: «Das Logo muss immer quadratisch angezeigt werden (abgerundete Ecken sollen bleiben)» — always a
 * square (aspect-square), centred; a wide logo is cut at the sides. The size comes from `className` (a width, e.g. "w-11"). */
export function ClientLogoImage({ src, className, alt = "" }: { src: string; className?: string; alt?: string }) {
  return (
    <span className={cn("block aspect-square shrink-0 overflow-hidden rounded-xl", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- presigned R2 URL / local preview */}
      <img src={src} alt={alt} draggable={false} className="h-full w-full object-cover object-center" />
    </span>
  );
}
