"use client";

import { useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { readVideoMetadata } from "@/lib/media";
import { useLanguage } from "@/lib/i18n";
import { useToast } from "@/app/components/ui/Toast";
import { ConfirmDialog } from "@/app/components/ui/ConfirmDialog";
import { Menu, MenuItem } from "@/app/components/ui/Menu";
import { IconButton } from "@/app/components/ui/Button";
import type { Project } from "@/lib/types";

const ALLOWED_REFERENCE_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];

type ReferenceVideoFields = Pick<
  Project,
  "reference_video_url" | "reference_video_status" | "reference_video_original_filename" | "reference_video_duration_seconds"
>;

/** 2026-09-08, Lino: "ganz oben in einer Shotlist soll man ein
 * Beispielvideo hochladen können, das man als Referenz abspielen lassen
 * kann" — shown above the Skript-Auswahlübersicht's Abschnitt-Kacheln
 * (projects/[id]/page.tsx). One slot per project (not per Abschnitt/
 * Section — a single reference for the whole shotlist), same presign-then-
 * complete upload flow the postproduction page's video versions already
 * use (see createReferenceVideo/completeReferenceVideo in lib/api.ts),
 * deliberately without versioning/comments/watermark — a single
 * replaceable file is enough here. */
export function ReferenceVideoBlock({
  projectId,
  project,
  onUpdate,
}: {
  projectId: string;
  project: ReferenceVideoFields;
  onUpdate: (patch: Partial<Project>) => void;
}) {
  const { t } = useLanguage();
  const toast = useToast();
  const api = useApi();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!ALLOWED_REFERENCE_VIDEO_TYPES.includes(file.type)) {
      toast.showError(t("referenceVideo.unsupportedType"));
      return;
    }
    setUploadProgress(0);
    try {
      const { upload_url } = await api.createReferenceVideo(projectId, file);
      onUpdate({ reference_video_status: "uploading", reference_video_original_filename: file.name });
      await api.uploadVideoFile(upload_url, file, setUploadProgress);
      const meta = await readVideoMetadata(file);
      const updated = await api.completeReferenceVideo(projectId, meta.duration);
      onUpdate(updated);
    } catch (err) {
      toast.showError(err instanceof ApiError ? err.message : t("referenceVideo.uploadFailed"));
      onUpdate({ reference_video_status: null, reference_video_url: null, reference_video_original_filename: null });
    } finally {
      setUploadProgress(null);
    }
  }

  async function handleDelete() {
    setConfirmingDelete(false);
    try {
      await api.deleteReferenceVideo(projectId);
      onUpdate({
        reference_video_url: null,
        reference_video_status: null,
        reference_video_original_filename: null,
        reference_video_duration_seconds: null,
      });
    } catch (err) {
      toast.showError(err instanceof ApiError ? err.message : t("referenceVideo.deleteFailed"));
    }
  }

  const hasVideo = project.reference_video_status === "ready" && !!project.reference_video_url;

  return (
    <div className="mb-5">
      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_REFERENCE_VIDEO_TYPES.join(",")}
        className="hidden"
        onChange={handlePick}
      />
      {uploadProgress !== null ? (
        <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-4 flex flex-col gap-2">
          <span className="text-sm font-medium text-white/70">
            {t("postproduction.uploading", { percent: Math.round(uploadProgress * 100) })}
          </span>
          <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-[width] duration-150"
              style={{ width: `${Math.round(uploadProgress * 100)}%` }}
            />
          </div>
        </div>
      ) : hasVideo ? (
        <div className="relative rounded-2xl bg-black overflow-hidden border border-white/10">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption -- reference footage, no track available */}
          <video src={project.reference_video_url!} controls preload="metadata" className="w-full max-h-[360px]" />
          <div className="absolute top-2 right-2">
            <Menu
              trigger={
                <IconButton size={28} className="bg-black/50 backdrop-blur-sm text-white/70 hover:text-white hover:bg-black/70">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="5" cy="12" r="1.8" />
                    <circle cx="12" cy="12" r="1.8" />
                    <circle cx="19" cy="12" r="1.8" />
                  </svg>
                </IconButton>
              }
            >
              {(close) => (
                <>
                  <MenuItem
                    onClick={() => {
                      inputRef.current?.click();
                      close();
                    }}
                  >
                    {t("referenceVideo.replace")}
                  </MenuItem>
                  <MenuItem
                    danger
                    onClick={() => {
                      setConfirmingDelete(true);
                      close();
                    }}
                  >
                    {t("common.delete")}
                  </MenuItem>
                </>
              )}
            </Menu>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full flex items-center gap-2 justify-center rounded-2xl border border-dashed border-white/15 hover:border-white/30 bg-white/[0.02] hover:bg-white/[0.05] text-white/50 hover:text-white/80 py-5 transition-colors text-sm font-medium"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          {t("referenceVideo.upload")}
        </button>
      )}
      <ConfirmDialog
        open={confirmingDelete}
        title={t("referenceVideo.deleteTitle")}
        message={t("referenceVideo.deleteMessage")}
        onConfirm={handleDelete}
        onCancel={() => setConfirmingDelete(false)}
      />
    </div>
  );
}
