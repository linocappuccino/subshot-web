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
  uploading,
  emptyLabel = "Bild hinzufügen",
  className,
}: {
  previewUrl: string | null;
  onFile: (file: File) => void;
  uploading?: boolean;
  emptyLabel?: string;
  className?: string;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (file && file.type.startsWith("image/")) onFile(file);
  }

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
      className={cn(
        "relative rounded-xl border-2 border-dashed cursor-pointer overflow-hidden transition-colors",
        "flex items-center justify-center bg-white/3 min-h-[140px]",
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
        // eslint-disable-next-line @next/next/no-img-element
        <img src={previewUrl} alt="" className="w-full h-full object-cover absolute inset-0" />
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
