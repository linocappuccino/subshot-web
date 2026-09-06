"use client";

import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/lib/i18n";

const NAME_STORAGE_KEY = "subshot_annot_name";

/** Name + comment popup shown after selecting text in "Textmarker" mode —
 * React counterpart to share_view.py's showPopup(). Positioned near the
 * selection (caller passes viewport coordinates), clamped to stay on-screen.
 * Same rule as the old page (2026-07-15, Lino, explicit): a highlight
 * without a comment is discarded, not saved — Speichern with an empty
 * comment behaves exactly like Abbrechen. */
export function PublicAnnotationPopup({
  x, y, quotedText, onSave, onCancel,
}: {
  x: number;
  y: number;
  quotedText: string;
  onSave: (authorName: string, comment: string) => void;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const popupRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useEffect(() => {
    try {
      setName(localStorage.getItem(NAME_STORAGE_KEY) || "");
    } catch {
      // localStorage unavailable — fine, name just starts blank
    }
  }, []);

  useEffect(() => {
    const el = popupRef.current;
    if (!el) return;
    const maxLeft = window.scrollX + document.documentElement.clientWidth - el.offsetWidth - 10;
    const maxTop = window.scrollY + document.documentElement.clientHeight - el.offsetHeight - 10;
    setPos({ left: Math.max(10, Math.min(x, maxLeft)), top: Math.max(10, Math.min(y, maxTop)) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function save() {
    const trimmedComment = comment.trim();
    if (!trimmedComment) {
      onCancel();
      return;
    }
    const typedName = name.trim();
    const finalName = typedName || "Anonym";
    if (typedName) {
      try {
        localStorage.setItem(NAME_STORAGE_KEY, typedName);
      } catch {
        // ignore
      }
    }
    onSave(finalName, trimmedComment);
  }

  return (
    <div
      ref={popupRef}
      style={{ position: "absolute", left: pos.left, top: pos.top }}
      className="z-[90] w-[340px] max-w-[calc(100vw-20px)] bg-[#2a2a2a] border border-white/10 rounded-xl p-3 shadow-2xl flex flex-col gap-2"
    >
      <p className="text-xs text-yellow-400/90 italic line-clamp-2">„{quotedText}“</p>
      <input
        autoFocus
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("videoReviewModal.visitorNamePlaceholder")}
        className="w-full text-sm bg-white/5 border border-white/10 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
      />
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        onKeyDown={(e) => {
          // 2026-07-26 (Todoist #329) — same Enter-to-save/Shift+Enter-for-
          // newline convention as the idea-comments box
          // (PublicIdeaLightbox.tsx) and the video-comments box
          // (VideoReviewModal.tsx), brought in line here too. A bare Enter
          // on an empty box does nothing (mirrors the removed Save button
          // having been effectively disabled then) rather than triggering
          // save()'s own "empty comment == cancel" fallback.
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (comment.trim()) save();
          }
        }}
        placeholder={t("publicAnnotationPopup.commentPlaceholder")}
        rows={4}
        className="w-full text-sm bg-white/5 border border-white/10 rounded-lg px-3 py-2 resize-y focus:outline-none focus:ring-2 focus:ring-blue-500/50"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white/10 text-white/70 hover:bg-white/15 transition-colors"
        >
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}
