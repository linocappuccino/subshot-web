"use client";

import { useEffect, useRef, useState } from "react";
import { authorColor } from "@/lib/authorColor";
import { isSectionFeedbackLocked } from "@/lib/sectionFeedbackLock";
import { publicScenesPreviewApi } from "@/lib/publicScenesPreviewApi";
import { ApiError } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import type { Annotation, Section } from "@/lib/types";

const NAME_STORAGE_KEY = "subshot_annot_name";

function formatEntryDate(iso: string): string {
  return new Date(iso).toLocaleString("de-CH", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function persistedName(): string {
  try {
    return localStorage.getItem(NAME_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

/** 2026-08-31, Todoist #96 — Section counterpart of PublicSceneComments,
 * same draft/send/round-lock mechanic, just scoped to a whole opened
 * Section ("Skript"/Shotlist) instead of one scene tile — Lino's explicit
 * ask was for this to work "exactly like the Ideas page". Simpler than
 * PublicSceneComments in one respect: a Section has no highlight-kind
 * annotations to merge in (no text field on a section tile to select a
 * substring of), so every round entry here is a plain comment. Rendered
 * once, at the top of the opened section (not per-scene), in
 * preview-scenes/[token]/page.tsx. */
export function PublicSectionComments({
  section, comments, token, unlockToken, onCommentsChanged,
}: {
  section: Section;
  /** This section's non-draft kind="comment" annotations — the parent page
   * owns the fetched list (same one it already fetches for scene comments/
   * highlights). */
  comments: Annotation[];
  token: string;
  unlockToken: string | null;
  onCommentsChanged: (updater: (comments: Annotation[]) => Annotation[]) => void;
}) {
  const { t } = useLanguage();
  const [authorName, setAuthorName] = useState(persistedName);
  const [draft, setDraft] = useState("");
  // Same client-only-draft shape as PublicSceneComments' myDrafts — a draft
  // is private to whoever just wrote it (list_share_annotations excludes
  // status="draft" server-side).
  const [myDrafts, setMyDrafts] = useState<Annotation[]>([]);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirmingSend, setConfirmingSend] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const locked = isSectionFeedbackLocked(section, comments);

  function persistName(name: string) {
    setAuthorName(name);
    try {
      localStorage.setItem(NAME_STORAGE_KEY, name);
    } catch {
      // ignore
    }
  }

  async function handleSave() {
    if (!authorName.trim() || !draft.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const created = await publicScenesPreviewApi.saveSectionComment(token, unlockToken, section.id, authorName.trim(), draft.trim());
      setMyDrafts((prev) => [...prev, created]);
      persistName(authorName.trim());
      setDraft("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("publicIdeaLightbox.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmSend() {
    if (!authorName.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const result = await publicScenesPreviewApi.sendSectionComment(token, unlockToken, section.id, authorName.trim(), draft.trim());
      onCommentsChanged(() => result.comments.filter((c) => c.status !== "draft"));
      persistName(authorName.trim());
      setDraft("");
      setMyDrafts([]);
      setConfirmingSend(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("publicIdeaLightbox.sendFailed"));
    } finally {
      setSending(false);
    }
  }

  async function handleDeleteDraft(id: string) {
    setDeletingId(id);
    try {
      await publicScenesPreviewApi.deleteSectionComment(token, unlockToken, section.id, id);
      setMyDrafts((prev) => prev.filter((d) => d.id !== id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("publicIdeaLightbox.deleteFailed"));
    } finally {
      setDeletingId(null);
    }
  }

  const roundsMap = new Map<number, Annotation[]>();
  for (const c of comments) {
    if (c.round == null) continue;
    roundsMap.set(c.round, [...(roundsMap.get(c.round) ?? []), c]);
  }
  const rounds = [...roundsMap.entries()]
    .map(([round, entries]) => [round, entries.sort((a, b) => a.created_at.localeCompare(b.created_at))] as [number, Annotation[]])
    .sort((a, b) => a[0] - b[0]);

  return (
    <div className="rounded-2xl bg-[#212121] border border-white/[0.06] p-4 mb-4" onClick={(e) => e.stopPropagation()}>
      <h2 className="text-sm font-bold text-white/80 mb-3">
        {t("publicIdeaLightbox.feedbackHeading")}{comments.length > 0 ? ` (${comments.length})` : ""}
      </h2>

      <div className="flex flex-col gap-2">
        {error && <p className="text-[12px] text-red-300 bg-red-900/30 rounded-lg px-2.5 py-1.5">{error}</p>}

        {rounds.map(([round, entries]) => (
          <SectionRoundBlock
            key={round}
            round={round}
            entries={entries}
            defaultExpanded={round === section.feedback_round}
            deletableRound={!locked ? section.feedback_round : null}
            onDelete={(a) => handleDeleteDraft(a.id)}
          />
        ))}

        {!locked && myDrafts.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {myDrafts.map((d) => (
              <div key={d.id} className="bg-white/[0.03] border border-dashed border-white/20 rounded-lg px-2.5 py-2 flex items-start justify-between gap-2">
                <p className="text-[12.5px] text-[#e5e5e5] whitespace-pre-line min-w-0">{d.comment}</p>
                <button
                  onClick={() => handleDeleteDraft(d.id)}
                  disabled={deletingId === d.id}
                  aria-label={t("publicIdeaLightbox.deleteDraft")}
                  className="shrink-0 w-5 h-5 rounded-full bg-white/10 hover:bg-red-500/25 text-white/60 hover:text-red-300 flex items-center justify-center text-xs transition-colors"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {locked ? (
          <p className="text-[12px] text-white/45">{t("publicIdeaLightbox.roundClosedMessage")}</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <input
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
              placeholder={t("videoReviewModal.visitorNamePlaceholder")}
              maxLength={80}
              className="w-full text-xs px-2.5 py-2 rounded-lg border border-white/[0.12] bg-white/[0.06] text-white placeholder:text-white/35 outline-none focus:ring-2 focus:ring-blue-500/50"
            />
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSave();
                }
              }}
              placeholder={t("publicIdeaLightbox.feedbackPlaceholder")}
              rows={2}
              className="w-full text-xs px-2.5 py-2 rounded-lg border border-white/[0.12] bg-white/[0.06] text-white placeholder:text-white/35 outline-none focus:ring-2 focus:ring-blue-500/50 resize-y"
            />
            <div className="flex justify-between items-center gap-2">
              <button
                onClick={handleSave}
                disabled={saving || !authorName.trim() || !draft.trim()}
                className="text-xs font-bold px-3 py-1.5 rounded-lg border border-white/15 bg-white/[0.06] hover:bg-white/[0.12] text-white disabled:opacity-40 transition-colors"
              >
                {saving ? t("common.saving") : t("publicIdeaLightbox.saveFeedback")}
              </button>
              <button
                onClick={() => (authorName.trim() ? setConfirmingSend(true) : setError(t("publicIdeaLightbox.enterNameFirst")))}
                className="text-xs font-bold px-3 py-1.5 rounded-lg text-white transition-colors"
                style={{ background: "var(--accent, #3875bd)" }}
              >
                {t("publicIdeaLightbox.sendFeedback")}
              </button>
            </div>
          </div>
        )}
      </div>

      {confirmingSend && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
          <div className="absolute inset-0 bg-black/55 cursor-pointer" onClick={() => setConfirmingSend(false)} />
          <div className="relative z-10 w-full max-w-[360px] max-h-[80vh] overflow-y-auto bg-[#1c1c1e] border border-white/15 rounded-2xl p-5 shadow-2xl">
            <p className="text-[13px] text-[#ddd] leading-relaxed mb-3.5">{t("publicIdeaLightbox.confirmSendMessage")}</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmingSend(false)} className="text-[13px] font-semibold px-3.5 py-2 rounded-lg bg-white/[0.08] text-white hover:bg-white/[0.14] transition-colors">
                {t("common.cancel")}
              </button>
              <button
                onClick={handleConfirmSend}
                disabled={sending}
                className="text-[13px] font-bold px-4 py-2 rounded-lg text-white disabled:opacity-50 transition-colors"
                style={{ background: "var(--accent, #3875bd)" }}
              >
                {sending ? t("teamPanel.sending") : t("common.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionRoundBlock({
  round, entries, defaultExpanded, deletableRound, onDelete,
}: {
  round: number;
  entries: Annotation[];
  defaultExpanded: boolean;
  /** Only an entry belonging to THIS round number stays deletable — null
   * means nothing in any round is (locked). Note: only ever fires for a
   * still-draft entry via myDrafts above in practice, this prop exists for
   * parity with PublicSceneComments' identical shape. */
  deletableRound: number | null;
  onDelete?: (annotation: Annotation) => void;
}) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(defaultExpanded);
  // Same fix as PublicSceneComments' SceneRoundBlock: this block's `round`
  // key stays stable across a round transition (no remount), so it needs an
  // explicit collapse on the current→past edge, not just an initial
  // useState value that only applies on a fresh mount.
  const wasCurrent = useRef(defaultExpanded);
  useEffect(() => {
    if (wasCurrent.current && !defaultExpanded) setExpanded(false);
    wasCurrent.current = defaultExpanded;
  }, [defaultExpanded]);
  const number = String(round).padStart(2, "0");
  const earliest = entries.reduce((min, e) => (e.created_at < min ? e.created_at : min), entries[0].created_at);
  const when = new Date(earliest).toLocaleString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="bg-white/5 rounded-lg overflow-hidden">
      <button type="button" onClick={() => setExpanded((v) => !v)} className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-left">
        <span className="text-[10.5px] font-semibold text-white/60">{t("ideaFeedbackPanel.roundLabel", { number, when })}</span>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 text-white/40 transition-transform ${expanded ? "rotate-90" : ""}`}>
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>
      {expanded && (
        <div className="px-2.5 pb-2 flex flex-col gap-1.5">
          {entries.map((a) => {
            const canDelete = round === deletableRound && a.status === "draft" && Boolean(onDelete);
            if (canDelete) {
              return (
                <div key={a.id} className="bg-white/[0.03] border border-dashed border-white/20 rounded-lg px-2.5 py-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold" style={{ color: authorColor(a.author_name) }}>
                      {a.author_name} <span className="text-white/35 font-normal">{t("publicIdeaLightbox.draftLabel")}</span>
                    </p>
                    <p className="text-[12.5px] text-white/90 whitespace-pre-line mt-0.5">{a.comment}</p>
                    <p className="text-[10px] text-white/35 mt-0.5">{formatEntryDate(a.created_at)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete!(a);
                    }}
                    aria-label={t("common.delete")}
                    className="shrink-0 w-5 h-5 rounded-full bg-white/10 hover:bg-red-500/25 text-white/60 hover:text-red-300 flex items-center justify-center text-xs transition-colors"
                  >
                    ×
                  </button>
                </div>
              );
            }
            return (
              <div key={a.id} className="relative border-l-2 pl-2 pr-5" style={{ borderLeftColor: authorColor(a.author_name) }}>
                <p className="text-[12.5px] text-white/90 whitespace-pre-line">
                  <span style={{ color: authorColor(a.author_name) }} className="font-bold">{a.author_name}:</span> {a.comment}
                </p>
                <p className="text-[10px] text-white/35 mt-0.5">{formatEntryDate(a.created_at)}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
