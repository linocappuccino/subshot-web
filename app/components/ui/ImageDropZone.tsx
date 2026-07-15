"use client";

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/cn";

/** Drag-and-drop OR click-to-pick, single image — the web equivalent of the
 * iOS app's ImageSourceButton (which offers camera vs. library; a browser
 * has no camera-capture API worth building here, so file-picker/drag&drop
 * covers the desktop+mobile-browser case). */
export function ImageDropZone({
  previewUrl,
  onFile,
  onRemove,
  uploading,
  emptyLabel = "Bild hinzufügen",
  className,
  lockAspectRatio = false,
}: {
  previewUrl: string | null;
  onFile: (file: File) => void;
  /** 2026-07-15, Lino: "man muss auch im web app und ios jegliche bilder
   * die man bei szenen oder ähnlichem eingefügt hat auch wieder
   * rauslöschen können" — this component had no remove affordance at all,
   * only add/replace (FolderEditModal built its own separate "Bild
   * entfernen" button outside this component; Scene/Shot never got an
   * equivalent). Optional: omit to keep the old add-only behavior
   * (e.g. project/folder tiles that don't want a delete option here). */
  onRemove?: () => void;
  uploading?: boolean;
  emptyLabel?: string;
  className?: string;
  /** Locks the box to a clean 16:9 (landscape source) or 9:16 (portrait
   * source) ratio once the photo loads, matching the iOS app's
   * AsyncShotThumbnail(lockAspectRatio:) - without this, a fixed-height box
   * + object-cover just crops every photo to whatever shape the box
   * happens to be, unrelated to the photo's real orientation, which reads
   * as "komisch" for anything that isn't already close to that ratio. */
  lockAspectRatio?: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [ratio, setRatio] = useState<"16/9" | "9/16" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (file && file.type.startsWith("image/")) onFile(file);
  }

  // Explicit height + aspectRatio (not width+aspectRatio) so the box's
  // width is derived from its intrinsic size - "w-fit" is what makes a
  // block element actually size itself from that intrinsic width instead
  // of the default block behavior of filling 100% of the container, which
  // would silently override the ratio again.
  const lockedStyle = lockAspectRatio && ratio ? { aspectRatio: ratio, height: 320, maxWidth: "100%" } : undefined;

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        handleFiles(e.dataTransfer.files);
      }}
      style={lockedStyle}
      className={cn(
        "relative rounded-xl border-2 border-dashed cursor-pointer overflow-hidden transition-colors",
        "flex items-center justify-center bg-white/3",
        lockedStyle ? "w-fit mx-auto" : "w-full min-h-[140px]",
        dragOver ? "border-blue-400 bg-blue-500/10" : "border-white/15 hover:border-white/30",
        className
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      {previewUrl ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt=""
            className="w-full h-full object-cover absolute inset-0"
            onLoad={(e) => {
              if (!lockAspectRatio) return;
              const img = e.currentTarget;
              setRatio(img.naturalWidth >= img.naturalHeight ? "16/9" : "9/16");
            }}
          />
          {onRemove && (
            <button
              type="button"
              onClick={(e) => {
                // Don't let this bubble to the outer div's onClick, which
                // opens the file picker — removing should never immediately
                // re-trigger "add a new one".
                e.stopPropagation();
                onRemove();
              }}
              aria-label="Bild entfernen"
              title="Bild entfernen"
              className="absolute top-2 right-2 z-10 w-7 h-7 rounded-full bg-black/60 hover:bg-red-500/80 text-white/80 hover:text-white flex items-center justify-center transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center gap-2 text-white/40 py-6">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <circle cx="8.5" cy="10" r="1.7" />
            <path d="m21 16-5-5-9 9" />
          </svg>
          <span className="text-xs font-medium">{emptyLabel}</span>
        </div>
      )}
      {uploading && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="absolute inset-0 bg-black/50 flex items-center justify-center"
        >
          <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        </motion.div>
      )}
    </div>
  );
}
