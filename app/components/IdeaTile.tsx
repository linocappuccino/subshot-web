"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AuthImage } from "./AuthImage";
import { AuthVideo } from "./AuthVideo";
import { Menu, MenuItem } from "./ui/Menu";
import { isVideoUrl } from "@/lib/media";
import { useLanguage } from "@/lib/i18n";
import type { Idea } from "@/lib/types";

export function IdeaTile({
  idea, onClick, onDuplicate, onDelete,
}: {
  idea: Idea;
  onClick: () => void;
  /** 2026-07-18 (Todoist #210) — 3-Punkte-Menü, gleiche Stelle/Look wie
   * anderswo im Web-App (siehe SceneCard.tsx). Optional: der Grid selbst
   * entscheidet, ob es die Menü-Aktionen anbietet. */
  onDuplicate?: () => void;
  onDelete?: () => void;
}) {
  const { t } = useLanguage();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: idea.id });
  const cover = idea.images.find((img) => img.status === "ready" && img.image_url);
  const approved = idea.status === "approved";
  const rejected = idea.status === "rejected";
  // idea.text can now contain bold/italic HTML (RichTextEditor, 2026-07-17)
  // — a plain-text preview snippet here should show the words, not the
  // literal <b>/<i> tags.
  const textPreview = idea.text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={`relative cursor-pointer rounded-2xl border border-white/10 overflow-hidden bg-[#1c1c1e] hover:border-white/20 transition-colors ${approved || rejected ? "opacity-60" : ""}`}
    >
      {(onDuplicate || onDelete) && (
        <div className="absolute top-2 right-2 z-10" onClick={(e) => e.stopPropagation()}>
          <Menu
            trigger={
              <span className="w-7 h-7 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center text-white/80 hover:text-white transition-colors">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
                </svg>
              </span>
            }
          >
            {(close) => (
              <>
                {onDuplicate && (
                  <MenuItem
                    onClick={() => {
                      onDuplicate();
                      close();
                    }}
                  >
                    {t("ideaTile.duplicate")}
                  </MenuItem>
                )}
                {onDelete && (
                  <MenuItem
                    danger
                    onClick={() => {
                      onDelete();
                      close();
                    }}
                  >
                    {t("common.delete")}
                  </MenuItem>
                )}
              </>
            )}
          </Menu>
        </div>
      )}
      {/* 2026-08-09, Lino: "wie bei der Videokachel oben rechts dargestellt
          werden, wie viele Kommentare noch offen sind" — mirrors
          VideoTile.tsx's "💬 {n}" badge exactly, just offset left of the
          3-dot menu (right-11 instead of right-2) since that menu already
          occupies this tile's own top-right corner, unlike VideoTile which
          has no such button there. */}
      {idea.open_feedback_count > 0 && (
        <div className="absolute top-2 right-11 z-10">
          <span className="flex items-center gap-1 text-xs text-white/80 bg-black/50 rounded-full px-2 py-0.5">
            💬 {idea.open_feedback_count}
          </span>
        </div>
      )}
      <div className="aspect-video bg-white/5 flex items-center justify-center overflow-hidden">
        {cover ? (
          isVideoUrl(cover.image_url ?? "") ? (
            <AuthVideo path={cover.image_url ?? ""} className="w-full h-full object-cover" />
          ) : (
            <AuthImage
              path={cover.image_url ?? ""}
              alt=""
              className="w-full h-full object-cover"
              // 2026-07-30 (#388), Lino: "hier soll auch immer versucht
              // werden ein Gesicht zu zeigen" — same face-detected focus
              // point ProjectFolder background images already use, so a
              // tightly-cropped tile doesn't cut a face out of frame.
              objectPosition={
                cover.focus_x != null && cover.focus_y != null
                  ? `${(cover.focus_x * 100).toFixed(1)}% ${(cover.focus_y * 100).toFixed(1)}%`
                  : undefined
              }
            />
          )
        ) : (
          <span className="text-3xl">💡</span>
        )}
      </div>
      <div className="p-3">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-sm font-semibold truncate flex-1">{idea.title}</h3>
          {/* 2026-07-27, Todoist #356 — small "intern noch offen" dot while
              the idea is still open and hasn't gone through the internal
              PL/Admin review gate yet, same read-only-everywhere-clickable-
              only-on-the-open-card convention as the rest of this feature. */}
          {idea.status === "open" && !idea.internal_status && (
            <span
              title={t("ideaCard.internalReviewPending")}
              className="w-2 h-2 rounded-full bg-amber-400/80 shrink-0"
            />
          )}
          {approved && (
            <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 rounded-full px-2 py-0.5 shrink-0">✓</span>
          )}
          {rejected && (
            <span className="text-[10px] font-semibold text-red-400 bg-red-500/10 rounded-full px-2 py-0.5 shrink-0">✗</span>
          )}
        </div>
        {/* 2026-07-17, Lino: "es braucht ein Datum und Uhrzeit WANN das
            Video abgenommen wurde" — auf der kleinen Kachel statt der
            Text-Vorschau, sobald angenommen (die Vorschau ist an dem
            Punkt ohnehin nicht mehr der aktuelle Stand). */}
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
      </div>
    </div>
  );
}
