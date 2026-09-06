"use client";

import { PublicIdeaMedia } from "./PublicIdeaMedia";
import { renderIdeaForPresentation } from "@/lib/ideaPresentation";
import { sanitizeRichTextHtml } from "@/lib/richText";
import { useLanguage } from "@/lib/i18n";
import type { IdeaPreview } from "@/lib/types";

/** Read-only grid tile for the public "Ideen-Preview" page (#262) — visually
 * matches IdeaTile.tsx (cover image/video, title, status badge, text
 * preview) but with no drag handle, no 3-dot menu (Duplizieren/Löschen),
 * nothing clickable except opening the lightbox. */
export function PublicIdeaTile({
  idea, onClick,
}: {
  idea: IdeaPreview;
  onClick: () => void;
}) {
  const { t } = useLanguage();
  const cover = idea.images.find((img) => img.status === "ready" && img.image_url);
  const approved = idea.status === "approved";
  const rejected = idea.status === "rejected";
  // 2026-08-09, Lino: "dürfen nie die / funktionen gezeigt werden oder
  // sichtbar sein" — this used to only strip HTML TAGS
  // (idea.text.replace(/<[^>]*>/g, " ")), which left slash-menu marker
  // LINES ("🎬 Szene/Shot:", "-- end scene", etc.) fully intact as plain
  // visible text, since those are literal characters, not tags. The
  // opened lightbox (PublicIdeaLightbox) already strips them via
  // renderIdeaForPresentation — this tile's small line-clamp-2 preview
  // never went through that same pipeline, so an idea whose text starts
  // with a scene/dialog/titel block leaked its raw marker straight into
  // the grid. Reusing renderIdeaForPresentation here first (same
  // sanitize-then-reshape order PublicIdeaLightbox uses) removes every
  // marker/end-cap the same way; the tag-strip below then only needs to
  // clean up the bold/italic spans renderIdeaForPresentation itself adds.
  const textPreview = renderIdeaForPresentation(sanitizeRichTextHtml(idea.text))
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const feedbackCount = idea.feedback.filter((f) => f.status === "sent").length;

  return (
    <div
      onClick={onClick}
      className={`relative cursor-pointer rounded-2xl border border-white/10 overflow-hidden bg-[#1c1c1e] hover:border-white/20 transition-colors ${approved || rejected ? "opacity-60" : ""}`}
    >
      <div className="aspect-video bg-white/5 flex items-center justify-center overflow-hidden">
        {cover?.image_url ? (
          <PublicIdeaMedia
            imageUrl={cover.image_url}
            className="w-full h-full object-cover"
            // 2026-07-31, Lino: same face-detected-focus logic as IdeaTile.tsx
            // (#388) should apply here too, so a tightly-cropped preview tile
            // doesn't cut a face out of frame.
            objectPosition={
              cover.focus_x != null && cover.focus_y != null
                ? `${(cover.focus_x * 100).toFixed(1)}% ${(cover.focus_y * 100).toFixed(1)}%`
                : undefined
            }
          />
        ) : (
          <span className="text-3xl">💡</span>
        )}
      </div>
      <div className="p-3">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-sm font-semibold truncate flex-1">{idea.title}</h3>
          {approved && (
            <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 rounded-full px-2 py-0.5 shrink-0">✓</span>
          )}
          {rejected && (
            <span className="text-[10px] font-semibold text-red-400 bg-red-500/10 rounded-full px-2 py-0.5 shrink-0">✗</span>
          )}
        </div>
        {approved && idea.approved_at ? (
          <p className="text-xs text-emerald-400/80">
            {t("ideaTile.approvedOn", {
              date: new Date(idea.approved_at).toLocaleString("de-CH", {
                day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
              }),
            })}
          </p>
        ) : rejected ? (
          <p className="text-xs text-red-400/80">{t("ideaTile.rejected")}</p>
        ) : (
          textPreview && <p className="text-xs text-white/50 line-clamp-2">{textPreview}</p>
        )}
        {feedbackCount > 0 && !approved && !rejected && (
          <p className="text-[11px] text-white/30 mt-1">{t("publicIdeaTile.feedbackCount", { count: feedbackCount, suffix: feedbackCount === 1 ? "" : "s" })}</p>
        )}
      </div>
    </div>
  );
}
