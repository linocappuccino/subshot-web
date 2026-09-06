"use client";

import { useEffect, useRef, useState } from "react";
import { PublicIdeaMedia } from "./PublicIdeaMedia";
import { publicIdeasPreviewApi } from "@/lib/publicIdeasPreviewApi";
import { renderIdeaForPresentation } from "@/lib/ideaPresentation";
import { sanitizeRichTextHtml } from "@/lib/richText";
import { authorColor } from "@/lib/authorColor";
import { ApiError } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import { wrapHighlights, wrapHighlightsInHtml, PENDING_ANNOTATION_ID } from "./PublicHighlightedText";
import { isIdeaFeedbackLocked } from "@/lib/ideaFeedbackLock";
import type { IdeaPreview, IdeaFeedback, Annotation } from "@/lib/types";

const NAME_KEY = "subshotPreviewVisitorName";
const SLIDESHOW_INTERVAL_MS = 4000;

// 2026-07-22 (unification) — one round block mixes plain IdeaFeedback and
// highlight Annotation entries, see the round-merge doc comment below.
// 2026-07-28, Lino: "markierte Kommentare landen im Feedback Reiter,
// normale Kommentare landen ausserhalb des Reiters" — a still-unsent plain
// draft used to render in its own separate box below every round block
// instead of inside the current one, unlike a highlight comment (no draft
// concept at all, always instantly in its round). Added as a third
// RoundEntry kind so it folds into the SAME accordion instead of a second,
// visually disconnected list.
type RoundEntry =
  | { kind: "feedback"; feedback: IdeaFeedback }
  | { kind: "highlight"; annotation: Annotation }
  | { kind: "draftFeedback"; feedback: IdeaFeedback };

// 2026-07-22, Lino: "wird das Datum auf der Preview-Seite nicht angezeigt..
// die kommentare müssen genau im gleichen system sein" — one shared
// formatter used by BOTH entry kinds in FeedbackRoundBlock below, so
// neither one can silently drift from the other again.
function formatEntryDate(iso: string): string {
  return new Date(iso).toLocaleString("de-CH", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Read-only big glass-card lightbox for the public "Ideen-Preview" page
 * (#262) — visually matches IdeaFloatingCard.tsx (same glass tint/blur,
 * same image-slideshow-left-text-right composition, same presentation-mode
 * rendering of idea.text) but with everything editing-related stripped:
 * no title/description autosave, no image upload/generate/reorder/remove,
 * no Abgenommen/Abgelehnt buttons (that's a PL-only action in the real
 * app). Only two things a visitor can actually DO here: browse this
 * idea's images/videos, and leave feedback (save a draft / send a round —
 * see the feedback section's own gating logic below, mirroring
 * idea_share_view.py's `round_closed`) — either plain, or anchored to a
 * text-marker selection, both landing in the SAME merged list (2026-07-22
 * unification, see this component's own feedback-section comment below).
 *
 * 2026-07-22, Lino: "die layoutkachel... so wie bei der normalen preview
 * seite (diashow links, text rechts, und das Fenster darf auch wieder
 * breit sein)" — was a single `max-w-[900px]` scrolling column (image on
 * top, text+feedback below), a pixel-match of the OLD server-rendered
 * idea_share_view.py page rather than the newer wide IdeaFloatingCard
 * redesign this page's own module doc comment already claimed to mirror.
 * Now genuinely matches it: `max-w-[1900px]`, a fixed-46%-width image
 * column on the left, text+feedback filling the rest on the right behind a
 * `border-l`, only the right column scrolls. */
export function PublicIdeaLightbox({
  idea, token, unlockToken, onClose, onPrev, onNext, onIdeaUpdated,
  annotations = [], onMarkClick, onMarkHoverChange,
  highlightedAnnotationId = null, hoveredAnnotationId = null,
  onSelectAnnotation, onDeleteAnnotation,
  pendingSelection = null, onCancelPendingSelection, onSaveHighlightComment,
}: {
  idea: IdeaPreview;
  token: string;
  unlockToken: string | null;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onIdeaUpdated: (idea: IdeaPreview) => void;
  // Text-highlight annotations for THIS idea only (2026-07-21, #268
  // follow-up), already filtered by the caller — same "caller pre-filters"
  // contract as PublicSceneCard's own `annotations` prop. Optional/default
  // empty so nothing else that renders this lightbox needs updating.
  annotations?: Annotation[];
  onMarkClick?: (annotation: Annotation) => void;
  // 2026-07-22 (unification) — new props powering the merged comment list
  // and the always-on text-marker compose flow (replacing the old separate
  // floating PublicAnnotationPopup/PublicAnnotationsSidebar for this page).
  onMarkHoverChange?: (annotationId: string | null) => void;
  highlightedAnnotationId?: string | null;
  hoveredAnnotationId?: string | null;
  onSelectAnnotation?: (annotation: Annotation) => void;
  onDeleteAnnotation?: (annotation: Annotation) => void;
  /** The currently-selected-but-not-yet-commented text, if any, for THIS
   * idea (caller already scopes it — a selection made on a different idea
   * is irrelevant here). */
  pendingSelection?: string | null;
  onCancelPendingSelection?: () => void;
  onSaveHighlightComment?: (authorName: string, comment: string) => void;
}) {
  const { t } = useLanguage();
  const [slideIndex, setSlideIndex] = useState(0);
  const [aspectRatio, setAspectRatio] = useState(16 / 9);
  const [authorName, setAuthorName] = useState(
    () => (typeof window !== "undefined" ? sessionStorage.getItem(NAME_KEY) ?? "" : "")
  );
  const [comment, setComment] = useState("");
  // Separate from `comment` above (2026-07-22 unification) — the highlight-
  // comment box and the plain-feedback box can both be visible at once
  // (a pending selection doesn't close the plain form), so they need their
  // own text field or typing in one would leak into the other. `authorName`
  // stays shared — same visitor, same session-persisted name either way.
  const [highlightComment, setHighlightComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirmingSend, setConfirmingSend] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "saved" | "sent" | "deleted" | "error"; text: string } | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSlideIndex(0);
  }, [idea.id]);

  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
  }, []);

  function showNotice(kind: "saved" | "sent" | "deleted" | "error", text: string) {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice({ kind, text });
    noticeTimer.current = setTimeout(() => setNotice(null), 4000);
  }

  const readyImages = idea.images.filter((img) => img.status === "ready" && img.image_url);

  // 2026-07-22, Lino: "die diashow muss man auch per klick stoppen und
  // wieder laufen lassen können" — click the image itself to pause/resume
  // the auto-advance (prev/next arrows and the dots below still work
  // regardless of paused state, same as before).
  const [slideshowPaused, setSlideshowPaused] = useState(false);
  useEffect(() => {
    setSlideshowPaused(false);
  }, [idea.id]);

  useEffect(() => {
    if (readyImages.length < 2 || slideshowPaused) return;
    const timer = setInterval(() => setSlideIndex((i) => (i + 1) % readyImages.length), SLIDESHOW_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [readyImages.length, slideshowPaused]);

  function persistName(name: string) {
    setAuthorName(name);
    if (typeof window !== "undefined") sessionStorage.setItem(NAME_KEY, name);
  }

  // 2026-07-31, Lino: "das Zwischenspeichern soll über die Enter Taste
  // passieren" — the visible "Feedback speichern" button is gone (see the
  // textarea's onKeyDown below and this component's Ideas-only scope doc
  // comment), but the underlying draft-save action stays, now Enter-only.
  async function handleSave() {
    if (!authorName.trim() || !comment.trim() || saving) return;
    setSaving(true);
    try {
      const created = await publicIdeasPreviewApi.saveFeedback(token, unlockToken, idea.id, authorName.trim(), comment.trim());
      onIdeaUpdated({ ...idea, feedback: [...idea.feedback, created] });
      persistName(authorName.trim());
      setComment("");
      showNotice("saved", t("publicIdeaLightbox.draftSaved"));
    } catch (e) {
      showNotice("error", e instanceof ApiError ? e.message : t("publicIdeaLightbox.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  // 2026-07-22 (unification) — submits the SAME name+comment fields
  // handleSave uses, just routed to the annotation endpoint instead
  // whenever a text selection is pending. No local saving/error state of
  // its own: onSaveHighlightComment (the page-level saveHighlightComment)
  // already owns the request and clears the pending selection itself on
  // success; this only needs to persist the visitor's name locally and
  // reset the shared comment field the same way handleSave does.
  function handleSaveHighlightComment() {
    if (!authorName.trim() || !highlightComment.trim() || !onSaveHighlightComment) return;
    onSaveHighlightComment(authorName.trim(), highlightComment.trim());
    persistName(authorName.trim());
    setHighlightComment("");
  }

  async function handleConfirmSend() {
    if (!authorName.trim() || sending) return;
    setSending(true);
    try {
      const result = await publicIdeasPreviewApi.sendFeedback(token, unlockToken, idea.id, authorName.trim(), comment.trim());
      onIdeaUpdated({ ...idea, feedback: result.feedback, feedback_round: result.feedback_round, round_advance_pending: result.round_advance_pending });
      persistName(authorName.trim());
      setComment("");
      setConfirmingSend(false);
      showNotice("sent", t("publicIdeaLightbox.feedbackSent"));
    } catch (e) {
      showNotice("error", e instanceof ApiError ? e.message : t("publicIdeaLightbox.sendFailed"));
    } finally {
      setSending(false);
    }
  }

  async function handleDelete(feedbackId: string) {
    setDeletingId(feedbackId);
    try {
      await publicIdeasPreviewApi.deleteFeedback(token, unlockToken, idea.id, feedbackId);
      onIdeaUpdated({ ...idea, feedback: idea.feedback.filter((f) => f.id !== feedbackId) });
      showNotice("deleted", t("publicIdeaLightbox.draftDeleted"));
    } catch (e) {
      showNotice("error", e instanceof ApiError ? e.message : t("publicIdeaLightbox.deleteFailed"));
    } finally {
      setDeletingId(null);
    }
  }

  const approved = idea.status === "approved";
  const rejected = idea.status === "rejected";
  // 2026-07-31 — excludes the backend's synthetic empty-comment "round
  // close" marker (see send_share_idea_feedback_json's own doc comment):
  // it exists purely so a highlight-only round can still be locked via
  // "Finales Feedback absenden", never meant to show up as a blank entry
  // in the round history.
  const sentFeedback = idea.feedback.filter((f) => f.status === "sent" && f.comment);
  const draftFeedback = idea.feedback.filter((f) => f.status === "draft").sort((a, b) => a.created_at.localeCompare(b.created_at));

  const titleAnnotations = annotations.filter((a) => a.field === "idea.title");
  const textAnnotations = annotations.filter((a) => a.field === "idea.text");
  // 2026-07-22 (unification) — the real (saved) highlight-comments for this
  // idea. Every real Annotation here has a non-empty comment (see
  // PublicAnnotationPopup's own doc comment: an empty comment was never
  // saveable at all), so there's no "highlight with no comment to show"
  // case to filter out.
  const highlightComments = annotations.filter((a) => a.id !== PENDING_ANNOTATION_ID);

  // 2026-07-26, Todoist #327 — single shared gate (see its own doc comment
  // in lib/ideaFeedbackLock.ts) covering BOTH comment kinds identically:
  // approved/rejected (permanent) OR the current round already has a sent
  // plain-feedback entry awaiting PL resolution. Used below to hide BOTH
  // compose forms and BOTH delete affordances the same way — the highlight
  // compose form used to be deliberately exempt from this ("Textmarker ist
  // IMMER aktiv", #312), which is exactly the inconsistency this ticket
  // fixes; a highlight-comment still never closes a round on its own (only
  // sentFeedback does), it just now has to respect an already-closed one.
  const locked = isIdeaFeedbackLocked(idea);

  // 2026-07-22, Lino: "die markierten kommentare müssen auch in der 01
  // oder 02 Feedbackkachel landen inkl. datum etc. genau wie die anderen
  // kommentare!!!!" — a highlight-comment on an idea is stamped with the
  // idea's CURRENT feedback_round at creation time (backend, see
  // Annotation.round's doc comment), same value a SENT IdeaFeedback row
  // gets, so both kinds merge into ONE set of round buckets here instead
  // of highlight-comments living in their own separate list. A round-less
  // annotation (round === null, only legacy rows from before this field
  // existed) has nowhere correct to render and is dropped rather than
  // guessed at.
  const roundsMap = new Map<number, RoundEntry[]>();
  for (const f of sentFeedback) roundsMap.set(f.round, [...(roundsMap.get(f.round) ?? []), { kind: "feedback", feedback: f }]);
  for (const a of highlightComments) {
    if (a.round == null) continue;
    roundsMap.set(a.round, [...(roundsMap.get(a.round) ?? []), { kind: "highlight", annotation: a }]);
  }
  // 2026-07-31, Lino: "Kommentare von der zweiten Feedbackrunde dürfen beim
  // schreiben und speichern NIE in der Kachel von der ersten Feedbackrunde
  // landen" — once the PL has resolved every comment in the current round,
  // `round_advance_pending` flips true and compose reopens, but
  // idea.feedback_round itself only increments at the moment a comment is
  // actually SENT (see send_share_idea_feedback_json's own "bump once per
  // click" comment). A draft written+saved during that in-between window is
  // really the visitor's FIRST comment of the round that's about to open —
  // bucketing it under the still-raw idea.feedback_round put it visibly
  // inside the just-closed previous round's tile instead.
  const composeRound = idea.round_advance_pending ? idea.feedback_round + 1 : idea.feedback_round;
  // 2026-07-28, Lino: "markierte Kommentare landen im Feedback Reiter,
  // normale Kommentare landen ausserhalb des Reiters" — a still-unsent
  // draft has no `round` stamped yet (IdeaFeedback.round is only assigned
  // on "senden", see that model's own doc comment), but it can only ever
  // exist while the current round is unlocked (locked hides/promotes
  // drafts, see isIdeaFeedbackLocked above) — so it unambiguously belongs
  // to composeRound, the round currently being composed. Folding it into
  // that SAME bucket (creating one if this round has no sent/highlight
  // entries yet) is what makes it show up inside the Feedback tab like a
  // highlight comment already does, instead of a second, disconnected box.
  if (!locked) {
    for (const f of draftFeedback) {
      roundsMap.set(composeRound, [...(roundsMap.get(composeRound) ?? []), { kind: "draftFeedback", feedback: f }]);
    }
  }
  const entryTime = (e: RoundEntry) => (e.kind === "highlight" ? e.annotation.created_at : e.feedback.created_at);
  const rounds = [...roundsMap.entries()]
    .map(([round, entries]) => [round, entries.sort((a, b) => entryTime(a).localeCompare(entryTime(b)))] as [number, RoundEntry[]])
    .sort((a, b) => a[0] - b[0]);

  return (
    <div data-idea-id={idea.id} className="fixed inset-0 z-50 flex items-center justify-center gap-6 p-4">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-xl cursor-pointer" onClick={onClose} />
      <button
        onClick={onClose}
        aria-label={t("modal.closeAria")}
        className="absolute top-5 right-5 z-20 w-10 h-10 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>

      {onPrev && (
        <button
          onClick={onPrev}
          aria-label={t("ideaFocusView.previousIdea")}
          className="relative z-10 shrink-0 w-12 h-12 rounded-full bg-white/10 border border-white/10 text-white flex items-center justify-center hover:bg-white/20 transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
        </button>
      )}

      <div
        className="relative z-10 w-full max-w-[1900px] h-[88vh] overflow-hidden rounded-[32px] shadow-2xl shadow-black/50 flex flex-col"
        style={{ background: "rgba(255,255,255,0.08)", backdropFilter: "blur(40px) saturate(1.8)", WebkitBackdropFilter: "blur(40px) saturate(1.8)", border: "1px solid rgba(255,255,255,0.18)" }}
      >
        <div className="shrink-0 flex items-start justify-between gap-3 px-8 pt-8 pb-3">
          <span className="text-[28px] font-bold tracking-tight" data-field="idea.title">
            {wrapHighlights(idea.title, titleAnnotations, onMarkClick, onMarkHoverChange)}
          </span>
          {approved && <span className="text-xs font-semibold text-emerald-400 bg-emerald-500/10 rounded-full px-3 py-1.5 shrink-0">{t("publicIdeaLightbox.approvedBadge")}</span>}
          {rejected && <span className="text-xs font-semibold text-red-400 bg-red-500/10 rounded-full px-3 py-1.5 shrink-0">{t("publicIdeaLightbox.rejectedBadge")}</span>}
        </div>

        {/* 2026-07-22 — slideshow-left/text-right split, matching
            IdeaFloatingCard.tsx's own `w-[46%]` image column +
            `flex-1 border-l` text column (see this component's own doc
            comment above). Only the right column scrolls.
            2026-08-09, Lino: "das Bild oder der Content ... muss oben
            angezeigt werden und der Text darunter" (öffnet man eine Idee
            auf einem Smartphone) — this row had no responsive breakpoint at
            all, so the 46%/54% split (fine on a 1900px-wide desktop modal)
            squeezed both columns into ~170px each on a real phone. Below
            `md`, this is now a single flex-COLUMN that scrolls as ONE
            region (image full-width on top, text below, natural document
            flow) instead of two independently-scrolling side-by-side
            panes; `md:` and up restores the original two-pane row exactly. */}
        <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden">
          <div className="w-full md:w-[46%] shrink-0 overflow-visible md:overflow-y-auto px-8 pb-4 md:pb-8 flex flex-col gap-3">
          <div
            className={`relative rounded-2xl overflow-hidden bg-black/20 ${readyImages.length > 1 ? "cursor-pointer" : ""}`}
            style={{ aspectRatio: readyImages.length > 0 ? aspectRatio : 16 / 9 }}
            onClick={() => readyImages.length > 1 && setSlideshowPaused((p) => !p)}
          >
            {readyImages.length > 0 ? (
              <>
                <div
                    key={readyImages[slideIndex]?.id ?? slideIndex}
                    className="absolute inset-0"
                  >
                    <PublicIdeaMedia
                      imageUrl={readyImages[slideIndex]?.image_url ?? ""}
                      className="w-full h-full object-contain"
                      onAspectRatio={setAspectRatio}
                    />
                  </div>
                {readyImages.length > 1 && (
                  <>
                    {/* 2026-07-22, Lino: "die diashow muss man auch per klick
                        stoppen und wieder laufen lassen können" — clicking
                        the image itself (see onClick above) toggles this;
                        the icon only shows on hover while playing (a quiet
                        "you can pause this" affordance) but stays visible
                        while actually paused, mirroring standard video-
                        player pause/play icon conventions. cursor-pointer
                        here (not on the outer frame) so it doesn't visually
                        suggest the arrows/dots below are also "clickable
                        anywhere", which they already are on their own. */}
                    <div
                      className={`absolute inset-0 flex items-center justify-center pointer-events-none transition-opacity ${slideshowPaused ? "opacity-100" : "opacity-0 hover:opacity-100"}`}
                    >
                      <div className="w-12 h-12 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center text-white cursor-pointer">
                        {slideshowPaused ? (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                        ) : (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" /><rect x="14" y="5" width="4" height="14" /></svg>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSlideIndex((i) => (i - 1 + readyImages.length) % readyImages.length);
                      }}
                      aria-label={t("ideaCard.previousImage")}
                      className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center backdrop-blur-sm transition-colors"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSlideIndex((i) => (i + 1) % readyImages.length);
                      }}
                      aria-label={t("ideaCard.nextImage")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center backdrop-blur-sm transition-colors"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
                    </button>
                    <div className="absolute bottom-3 inset-x-0 flex items-center justify-center gap-1.5">
                      {readyImages.map((img, i) => (
                        <button
                          key={img.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSlideIndex(i);
                          }}
                          aria-label={t("ideaCard.imageDot", { number: i + 1 })}
                          className={`w-1.5 h-1.5 rounded-full transition-all ${i === slideIndex ? "bg-white w-4" : "bg-white/40"}`}
                        />
                      ))}
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-white/20 text-5xl">💡</div>
            )}
          </div>
          </div>

          <div className="flex-1 min-h-0 min-w-0 flex flex-col border-l-0 md:border-l border-white/10 overflow-visible md:overflow-y-auto px-8 pb-8">
            {/* 2026-07-22, Lino: "die kommentar box ist nun einfach vor dem
                geschriebenen Text" — this column is a flex COLUMN now (used
                to be plain block layout, see this component's own layout
                doc comment above), and flex items default to shrinkable
                (flex-shrink: 1) even past their own content height. With a
                long idea.text, this div's rendered box (measured: 741px)
                was shrinking well below what its content actually needed
                (1352px) to make room for the feedback section below it —
                since it's `overflow: visible` (deliberately, no per-field
                inner scrollbar), the un-shrunk remainder of the text simply
                rendered UNDERNEATH/behind the feedback section instead of
                pushing it down. `shrink-0` here (and on the feedback
                section right below) stops either from being squished; the
                PARENT's own `overflow-y-auto` is what should handle
                anything that doesn't fit, exactly like it already did
                before this was a flex column. */}
            <div
              className="shrink-0 min-h-[80px] text-[15px] leading-relaxed text-[#e5e5e5] whitespace-pre-line mb-5 [&>div]:mb-2 mt-8"
              data-field="idea.text"
            >
              {/* 2026-07-28, Lino — same fix as IdeaFloatingCard.tsx's
                  presentation view: sanitize the RAW idea.text first, then
                  let renderIdeaForPresentation build its trusted, already-
                  escaped Titel/Dialog markup on top, instead of sanitizing
                  its output afterward (which stripped the `class` attributes
                  those styles depend on). */}
              {wrapHighlightsInHtml(renderIdeaForPresentation(sanitizeRichTextHtml(idea.text)), textAnnotations, onMarkClick, onMarkHoverChange)}
            </div>

            {/* 2026-07-26, Todoist #327 (Lino) — this whole section used to
                disappear ENTIRELY once approved/rejected (no history, no
                nothing), unlike the authenticated app's IdeaFeedbackPanel
                which always shows past rounds regardless of idea status.
                Now the round HISTORY always renders (a permanent record,
                same as the authenticated view) — only the compose
                forms/delete affordances are gated on `locked`, via the
                single shared `locked` value below, identically for both
                comment kinds. */}
            <div className="shrink-0 border-t border-white/10 pt-5">
              <div className="text-xs font-bold text-white/50 uppercase tracking-wide mb-2.5">
                {t("publicIdeaLightbox.feedbackHeading")}{sentFeedback.length > 0 ? ` (${sentFeedback.length})` : ""}
              </div>

              {notice && (
                <p className={`text-[13px] font-semibold px-3 py-2 rounded-lg mb-3 ${
                  notice.kind === "sent" ? "bg-emerald-900/40 text-emerald-300" :
                  notice.kind === "error" ? "bg-red-900/40 text-red-300" : "bg-white/10 text-white/80"
                }`}>{notice.text}</p>
              )}

              {rounds.length === 0 && (
                <p className="text-[13px] text-white/35 mb-3.5">{t("publicIdeaLightbox.noFeedbackYet")}</p>
              )}

              <div className="space-y-2 mb-3.5">
                {rounds.map(([round, entries]) => (
                  <FeedbackRoundBlock
                    key={round}
                    round={round}
                    entries={entries}
                    // 2026-07-27, Lino: "die kommentare einer vorherigen
                    // feedback runde sind für den previewer anfangs IMMER
                    // eingeklappt" — only the CURRENT (compose) round starts
                    // open; composeRound (see above) accounts for the
                    // round_advance_pending window the same way the draft
                    // bucket above does.
                    defaultExpanded={round === composeRound}
                    onSelectAnnotation={onSelectAnnotation}
                    highlightedAnnotationId={highlightedAnnotationId}
                    hoveredAnnotationId={hoveredAnnotationId}
                    // 2026-07-26, #327 — a highlight-comment from a PAST
                    // round, or from the CURRENT round once it's `locked`,
                    // is exactly as permanent as a sent plain-feedback
                    // entry (which never renders a delete button at all,
                    // see the "feedback" branch inside FeedbackRoundBlock
                    // below) — only the currently-open, unlocked round's
                    // own highlights stay deletable. Passing `undefined`
                    // (not just disabling inside the child) removes the ×
                    // affordance entirely rather than rendering a
                    // dead/disabled button.
                    onDeleteAnnotation={round === composeRound && !locked ? onDeleteAnnotation : undefined}
                    onDeleteDraft={handleDelete}
                    deletingDraftId={deletingId}
                    // 2026-07-31, Lino: "macht man einen markierten Kommentar
                    // und danach einen normalen, sehen die unterschiedlich
                    // aus... (noch nicht abgesendete Kommentare)" — a
                    // highlight has no real draft STATUS (it's written once,
                    // instantly, see this component's own top-of-file doc
                    // comment on why), so it always rendered in the
                    // permanent/"sent" style even while the round itself
                    // hasn't been finalized via "Finales Feedback absenden"
                    // yet — visually looking done when a plain comment sitting
                    // right next to it (a genuine draft) still showed the
                    // dashed "not sent yet" box. Same condition
                    // onDeleteAnnotation above already uses to know "this
                    // round's highlights aren't finalized yet".
                    pendingHighlightRound={round === composeRound && !locked}
                  />
                ))}
              </div>

              {/* 2026-07-26, #327 — this used to be unconditional
                  ("Textmarker ist IMMER aktiv in der Kommentar-Funktion",
                  #312) specifically so it stayed postable even while the
                  plain form below was closed pending PL review. Lino's
                  explicit new spec is "KEINE KOMMENTARE" of either kind
                  once sent — same `locked` gate as the plain form now (the
                  page-level mouseup listener that produces
                  `pendingSelection` in the first place is ALSO now gated on
                  this, see preview-ideas/[token]/page.tsx's `canComment`,
                  so this branch is mostly unreachable while locked anyway;
                  kept here too as the same belt-and-suspenders shape the
                  rest of this component already uses). */}
              {!locked && pendingSelection && (
                <div className="flex flex-col gap-2 mb-3.5">
                  <div className="flex items-start justify-between gap-2 bg-blue-500/10 border border-blue-500/30 rounded-[10px] px-3 py-2">
                    <p className="text-xs text-blue-300 italic line-clamp-2">
                      <span className="not-italic font-semibold text-blue-200">{t("publicIdeaLightbox.markedTextLabel")} </span>„{pendingSelection}“
                    </p>
                    <button
                      type="button"
                      onClick={onCancelPendingSelection}
                      aria-label={t("publicIdeaLightbox.clearSelection")}
                      className="shrink-0 text-blue-300/70 hover:text-white transition-colors"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                    </button>
                  </div>
                  <input
                    value={authorName}
                    onChange={(e) => setAuthorName(e.target.value)}
                    placeholder={t("videoReviewModal.visitorNamePlaceholder")}
                    maxLength={80}
                    className="w-full text-sm px-3 py-2.5 rounded-[10px] border border-white/[0.12] bg-white/[0.06] text-white placeholder:text-white/35 outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                  <textarea
                    value={highlightComment}
                    onChange={(e) => setHighlightComment(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSaveHighlightComment();
                      }
                    }}
                    placeholder={t("publicIdeaLightbox.highlightCommentPlaceholder")}
                    rows={3}
                    className="w-full text-sm px-3 py-2.5 rounded-[10px] border border-white/[0.12] bg-white/[0.06] text-white placeholder:text-white/35 outline-none focus:ring-2 focus:ring-blue-500/50 resize-y"
                  />
                  <div className="flex justify-end">
                    <button
                      onClick={handleSaveHighlightComment}
                      disabled={!authorName.trim() || !highlightComment.trim()}
                      className="text-sm font-bold px-4.5 py-2.5 rounded-[10px] text-white disabled:opacity-40 transition-colors"
                      style={{ background: "var(--idea-preview-accent, #3875bd)" }}
                    >
                      {t("publicIdeaLightbox.addHighlightComment")}
                    </button>
                  </div>
                </div>
              )}

              {/* 2026-07-27, Lino: "markiert man etwas kommen auf einmal 2
                  kommentarfelder unten.. das ist sehr verwirrend" — a
                  pending text-marker selection already shows its OWN
                  compose box right above (see the pendingSelection branch
                  above); showing the plain one too, at the same time,
                  looked like two competing ways to say the same thing.
                  While a selection is pending, only the highlight-comment
                  box stays — clearing the selection (its own × button)
                  gets back to the plain form. */}
              {locked ? (
                <p className={`text-[13px] ${approved ? "text-emerald-400" : "text-white/45"}`}>
                  {approved
                    ? t("publicIdeaLightbox.approvedNoFeedback")
                    : rejected
                    ? t("publicIdeaLightbox.rejectedNoFeedback")
                    : t("publicIdeaLightbox.roundClosedMessage")}
                </p>
              ) : pendingSelection ? null : (
                <div className="flex flex-col gap-2">
                  <input
                    value={authorName}
                    onChange={(e) => setAuthorName(e.target.value)}
                    placeholder={t("videoReviewModal.visitorNamePlaceholder")}
                    maxLength={80}
                    className="w-full text-sm px-3 py-2.5 rounded-[10px] border border-white/[0.12] bg-white/[0.06] text-white placeholder:text-white/35 outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                  {/* 2026-07-31, Lino: "auch der 'Feedback speichern' Button
                      kann weg" — the visible button is gone, but the
                      draft-save action itself stays: "das Zwischenspeichern
                      soll über die Enter Taste passieren" (Shift+Enter still
                      makes a line break, matching the placeholder hint). */}
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSave();
                      }
                    }}
                    placeholder={t("publicIdeaLightbox.feedbackPlaceholder")}
                    rows={3}
                    className="w-full text-sm px-3 py-2.5 rounded-[10px] border border-white/[0.12] bg-white/[0.06] text-white placeholder:text-white/35 outline-none focus:ring-2 focus:ring-blue-500/50 resize-y"
                  />
                  <div className="flex justify-end">
                    <button
                      onClick={() => (authorName.trim() ? setConfirmingSend(true) : showNotice("error", t("publicIdeaLightbox.enterNameFirst")))}
                      className="text-sm font-bold px-4.5 py-2.5 rounded-[10px] text-white transition-colors"
                      style={{ background: "var(--idea-preview-accent, #3875bd)" }}
                    >
                      {t("publicIdeaLightbox.sendFeedback")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {onNext && (
        <button
          onClick={onNext}
          aria-label={t("ideaFocusView.nextIdea")}
          className="relative z-10 shrink-0 w-12 h-12 rounded-full bg-white/10 border border-white/10 text-white flex items-center justify-center hover:bg-white/20 transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
        </button>
      )}

      {confirmingSend && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/55 cursor-pointer" onClick={() => setConfirmingSend(false)} />
          <div className="relative z-10 w-full max-w-[360px] max-h-[80vh] overflow-y-auto bg-[#1c1c1e] border border-white/15 rounded-2xl p-5 shadow-2xl">
            <p className="text-[13px] text-[#ddd] leading-relaxed mb-3.5">
              {t("publicIdeaLightbox.confirmSendMessage")}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmingSend(false)}
                className="text-[13px] font-semibold px-3.5 py-2 rounded-lg bg-white/[0.08] text-white hover:bg-white/[0.14] transition-colors"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleConfirmSend}
                disabled={sending}
                className="text-[13px] font-bold px-4 py-2 rounded-lg text-white disabled:opacity-50 transition-colors"
                style={{ background: "var(--idea-preview-accent, #3875bd)" }}
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

/** One collapsible SENT round — matches IdeaFeedbackPanel.tsx's own
 * FeedbackRound look (numbered "01 Feedback — <date>"), read-only: no
 * resolved-checkbox (PL-only action), no delete for plain feedback (sent
 * rows are a permanent record, see delete_share_idea_feedback_json's own
 * doc comment) — highlight-comment entries CAN still be deleted by their
 * own author (existing behavior, see onDeleteAnnotation), that's unrelated
 * to the plain-feedback "sent is permanent" rule.
 *
 * 2026-07-22 (unification), Lino: "die markierten kommentare müssen auch
 * in der 01 oder 02 Feedbackkachel landen inkl. datum etc. genau wie die
 * anderen kommentare" — `entries` now mixes plain IdeaFeedback and
 * highlight Annotation rows (see RoundEntry above), rendered inline
 * side-by-side instead of highlight-comments living in their own separate
 * list below. */
function FeedbackRoundBlock({
  round, entries, defaultExpanded = true, onSelectAnnotation, highlightedAnnotationId, hoveredAnnotationId, onDeleteAnnotation,
  onDeleteDraft, deletingDraftId, pendingHighlightRound = false,
}: {
  round: number;
  entries: RoundEntry[];
  /** 2026-07-27, Lino: a previous (not-current) round starts collapsed for
   * the previewer — only the caller knows which round is current. */
  defaultExpanded?: boolean;
  onSelectAnnotation?: (annotation: Annotation) => void;
  highlightedAnnotationId?: string | null;
  hoveredAnnotationId?: string | null;
  onDeleteAnnotation?: (annotation: Annotation) => void;
  /** 2026-07-28 — only meaningful for whichever round holds this idea's
   * still-unsent drafts (always idea.feedback_round, see the round-merge
   * doc comment above this component). */
  onDeleteDraft?: (feedbackId: string) => void;
  deletingDraftId?: string | null;
  /** 2026-07-31 — true for the current, not-yet-finalized round: a
   * highlight has no real draft status of its own (written once,
   * instantly), so it rendered in the permanent/"sent" look even while
   * this round hasn't actually been finalized via "Finales Feedback
   * absenden" yet. While this is true, highlight entries below borrow the
   * same dashed "not sent yet" box a plain draft already uses, so both
   * look consistent for as long as they both really are un-finalized. */
  pendingHighlightRound?: boolean;
}) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(defaultExpanded);
  // 2026-07-31, Lino: "ist die feedbackrunde davor IMMER eingeklappt" — this
  // block doesn't remount when a round stops being current (same `round`
  // key, same component instance), so the `useState(defaultExpanded)`
  // initial value alone only collapses it on a fresh page load. A visitor
  // who has THIS round open while composing (it's still current, expanded
  // by default) and then sends their comment — advancing to the next round
  // in the same session, no reload — used to keep seeing it expanded
  // forever after, since nothing ever re-ran the initial state. Force a
  // collapse the moment `defaultExpanded` flips true→false (current→past),
  // without fighting a manual expand/collapse click while it's genuinely
  // still current.
  const wasCurrent = useRef(defaultExpanded);
  useEffect(() => {
    if (wasCurrent.current && !defaultExpanded) setExpanded(false);
    wasCurrent.current = defaultExpanded;
  }, [defaultExpanded]);
  const number = String(round).padStart(2, "0");
  const entryTime = (e: RoundEntry) => (e.kind === "highlight" ? e.annotation.created_at : e.feedback.created_at);
  const earliest = entries.reduce((min, e) => (entryTime(e) < min ? entryTime(e) : min), entryTime(entries[0]));
  const when = new Date(earliest).toLocaleString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="bg-white/5 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="text-[11px] font-semibold text-white/60">{t("publicIdeaLightbox.roundHeading", { number, when })}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 text-white/40 transition-transform ${expanded ? "rotate-90" : ""}`}>
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>
      {expanded && (
        <div className="px-3 pb-2.5 flex flex-col gap-2">
          {entries.map((entry) => {
            if (entry.kind === "feedback") {
              const f = entry.feedback;
              return (
                <div key={f.id} className="relative border-l-2 pl-2.5 pr-6" style={{ borderLeftColor: authorColor(f.author_name) }}>
                  <p className="text-sm text-white/90 whitespace-pre-line">
                    <span style={{ color: authorColor(f.author_name) }} className="font-bold">{f.author_name}:</span> {f.comment}
                  </p>
                  <p className="text-[11px] text-white/35 mt-0.5">{formatEntryDate(f.created_at)}</p>
                </div>
              );
            }
            if (entry.kind === "draftFeedback") {
              // 2026-07-28, Lino — same dashed-border "not sent yet" look
              // this used to have in its own separate box below every
              // round, just now rendered AS a round entry (see this file's
              // top-of-component doc comment on why).
              const f = entry.feedback;
              return (
                <div key={f.id} className="bg-white/[0.03] border border-dashed border-white/20 rounded-xl px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold" style={{ color: authorColor(f.author_name) }}>
                        {f.author_name} <span className="text-white/35 font-normal">{t("publicIdeaLightbox.draftLabel")}</span>
                      </p>
                      <p className="text-[13.5px] text-[#e5e5e5] whitespace-pre-line mt-1">{f.comment}</p>
                      <p className="text-[11px] text-white/35 mt-0.5">{formatEntryDate(f.created_at)}</p>
                    </div>
                    {onDeleteDraft && (
                      <button
                        onClick={() => onDeleteDraft(f.id)}
                        disabled={deletingDraftId === f.id}
                        aria-label={t("publicIdeaLightbox.deleteDraft")}
                        title={t("publicIdeaLightbox.deleteDraft")}
                        className="shrink-0 w-6 h-6 rounded-full bg-white/10 hover:bg-red-500/25 text-white/60 hover:text-red-300 flex items-center justify-center transition-colors"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>
              );
            }
            const ann = entry.annotation;
            // 2026-07-22, Lino: "die highlight und normalen kommentare
            // müssen genau gleich aussehen und behandelt werden!... einziger
            // Unterschied ist die Highlightmarkierung und die erwähnte
            // Markierung im Markierungs-Kommentar" — same wrapper shape/
            // classes as the plain-feedback branch above (border-l-2
            // pl-2.5 pr-6, same text sizes, same per-entry date, added for
            // BOTH here in the same pass — see formatEntryDate below), no
            // rounded/hover background distinguishing it anymore. The only
            // two differences left: the quoted-text snippet, and clicking
            // this one pulses its matching <mark> (data-comment-annotation-id
            // + onClick) — an interaction, not a resting visual difference,
            // so the temporary glow while highlighted/hovered is the only
            // conditional class left.
            //
            // 2026-07-31, Lino: "macht man einen markierten Kommentar und
            // danach einen normalen, sehen die unterschiedlich aus (noch
            // nicht abgesendete Kommentare)" — this SOLID look above is only
            // correct once the round is actually finalized. A highlight in
            // the still-open current round is exactly as "not sent yet" as
            // a plain draft (see pendingHighlightRound's own doc comment) —
            // borrow the identical dashed box that branch already uses so
            // both read the same while both really are unfinalized.
            if (pendingHighlightRound) {
              return (
                <div
                  key={ann.id}
                  data-comment-annotation-id={ann.id}
                  onClick={() => onSelectAnnotation?.(ann)}
                  className={`cursor-pointer transition-colors bg-white/[0.03] border border-dashed border-white/20 rounded-xl px-3 py-2.5 ${
                    highlightedAnnotationId === ann.id || hoveredAnnotationId === ann.id ? "bg-blue-500/[0.08]" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold" style={{ color: authorColor(ann.author_name) }}>
                        {ann.author_name} <span className="text-white/35 font-normal">{t("publicIdeaLightbox.draftLabel")}</span>
                      </p>
                      {ann.text && <p className="text-xs text-yellow-400/90 italic truncate mt-1">„{ann.text.slice(0, 80)}“</p>}
                      <p className="text-[13.5px] text-[#e5e5e5] whitespace-pre-line mt-1">{ann.comment}</p>
                      <p className="text-[11px] text-white/35 mt-0.5">{formatEntryDate(ann.created_at)}</p>
                    </div>
                    {onDeleteAnnotation && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteAnnotation(ann);
                        }}
                        aria-label={t("common.delete")}
                        className="shrink-0 w-6 h-6 rounded-full bg-white/10 hover:bg-red-500/25 text-white/60 hover:text-red-300 flex items-center justify-center transition-colors"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>
              );
            }
            return (
              <div
                key={ann.id}
                data-comment-annotation-id={ann.id}
                onClick={() => onSelectAnnotation?.(ann)}
                className={`relative border-l-2 pl-2.5 pr-6 cursor-pointer transition-colors ${
                  highlightedAnnotationId === ann.id || hoveredAnnotationId === ann.id ? "bg-blue-500/[0.08]" : ""
                }`}
                style={{ borderLeftColor: authorColor(ann.author_name) }}
              >
                {ann.text && <p className="text-xs text-yellow-400/90 italic truncate">„{ann.text.slice(0, 80)}“</p>}
                <p className="text-sm text-white/90 whitespace-pre-line">
                  <span style={{ color: authorColor(ann.author_name) }} className="font-bold">{ann.author_name}:</span> {ann.comment}
                </p>
                <p className="text-[11px] text-white/35 mt-0.5">{formatEntryDate(ann.created_at)}</p>
                {onDeleteAnnotation && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteAnnotation(ann);
                    }}
                    aria-label={t("common.delete")}
                    className="absolute top-1 right-0 w-5 h-5 rounded-full bg-white/10 text-white/50 hover:bg-red-600/40 hover:text-white flex items-center justify-center text-sm transition-colors"
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
