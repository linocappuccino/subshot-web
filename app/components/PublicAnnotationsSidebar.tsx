"use client";

import { useState } from "react";
import { useLanguage } from "@/lib/i18n";
import type { Annotation } from "@/lib/types";

/** Right-edge list of every highlight annotation on this project — React
 * counterpart to share_view.py's _annotation_sidebar_html, simplified for
 * #268's narrowed scope (Lino: pen/freehand dropped entirely, and this
 * page's annotations have no resolve/reject status — those stay app-only,
 * see AnnotationsPanel.tsx). Delete has no real ownership check (see
 * ShareAnnotationDelete's own doc comment on the backend) — always shown,
 * a mismatched typed name just 403s, surfaced via onError. Two-step confirm
 * (tap once to arm, again within a few seconds to actually delete) instead
 * of a native confirm(), same reasoning as every other public preview page
 * on this app. */
export function PublicAnnotationsSidebar({
  annotations, onDelete, onSelect, highlightedId, onClose, collapsed, onToggleCollapsed,
}: {
  annotations: Annotation[];
  onDelete: (annotation: Annotation) => void;
  onSelect: (annotation: Annotation) => void;
  highlightedId: string | null;
  onClose: () => void;
  // 2026-09-08, Lino: this sidebar overlapped the page's main content
  // underneath it on small screens (both just floated at their own width,
  // content never made room). Parent shrinks this to a slim edge tab via
  // `collapsed` and mirrors the width as right-padding on the content
  // column, so content visibly shifts left clear of the sidebar whenever
  // it's expanded.
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const { t } = useLanguage();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  function handleDeleteClick(ann: Annotation) {
    if (confirmingId !== ann.id) {
      setConfirmingId(ann.id);
      setTimeout(() => setConfirmingId((cur) => (cur === ann.id ? null : cur)), 4000);
      return;
    }
    setConfirmingId(null);
    onDelete(ann);
  }

  const sorted = [...annotations].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return (
    <div
      className={`fixed right-0 top-0 bottom-0 z-[70] bg-[#1a1a1a] border-l border-white/10 pt-16 pb-24 transition-[width] duration-200 ${
        collapsed ? "w-12 overflow-hidden" : "w-[340px] max-w-[92vw] overflow-y-auto px-3"
      }`}
    >
      <button
        type="button"
        onClick={onToggleCollapsed}
        title={t(collapsed ? "previewPage.expandSidebar" : "previewPage.collapseSidebar")}
        aria-label={t(collapsed ? "previewPage.expandSidebar" : "previewPage.collapseSidebar")}
        className="absolute top-1/2 -left-3 -translate-y-1/2 z-10 w-6 h-10 rounded-full bg-[#2a2a2a] border border-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          {collapsed ? <path d="M9 6l6 6-6 6" /> : <path d="M15 6l-6 6 6 6" />}
        </svg>
      </button>
      {collapsed ? (
        <div className="flex flex-col items-center gap-1 pt-1 text-white/40">
          <span className="text-[11px] font-semibold">{annotations.length}</span>
        </div>
      ) : (
        <>
      <div className="flex items-center justify-between px-1 pb-3">
        <h2 className="text-sm font-semibold text-white/80">{t("publicAnnotationsSidebar.title", { count: annotations.length })}</h2>
        <button onClick={onClose} className="rounded-full p-1.5 text-white/50 hover:text-white hover:bg-white/10 transition-colors" aria-label={t("modal.closeAria")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      {sorted.length === 0 && <p className="text-xs text-white/40 px-1">{t("publicAnnotationsSidebar.empty")}</p>}
      <div className="flex flex-col gap-2">
        {sorted.map((ann) => (
          <div
            key={ann.id}
            className={`relative rounded-xl border p-3 pr-8 transition-colors ${
              highlightedId === ann.id ? "border-blue-500/60 bg-blue-500/[0.08]" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
            }`}
          >
            <button type="button" onClick={() => onSelect(ann)} className="block w-full text-left">
              <div className="flex items-center gap-1.5 text-xs font-semibold">
                <span className="opacity-60">“</span>
                {ann.author_name}
              </div>
              {ann.text && <p className="text-xs text-yellow-400/90 italic mt-1 truncate">„{ann.text.slice(0, 80)}“</p>}
              <p className="text-xs text-white/75 mt-1 break-words">
                {ann.comment || <em className="text-white/40">{t("publicAnnotationsSidebar.noComment")}</em>}
              </p>
              <p className="text-[11px] text-white/40 mt-1.5">
                {new Date(ann.created_at).toLocaleString("de-CH", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </p>
            </button>
            <button
              type="button"
              title={confirmingId === ann.id ? t("publicAnnotationsSidebar.clickAgainToDelete") : t("common.delete")}
              aria-label={t("common.delete")}
              onClick={() => handleDeleteClick(ann)}
              className={`absolute top-2.5 right-2.5 w-5 h-5 rounded-full flex items-center justify-center text-sm transition-colors ${
                confirmingId === ann.id ? "bg-red-600 text-white" : "bg-white/10 text-white/50 hover:bg-red-600/40 hover:text-white"
              }`}
            >
              ×
            </button>
          </div>
        ))}
      </div>
        </>
      )}
    </div>
  );
}
