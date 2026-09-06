"use client";

import { useEffect, useMemo, useState } from "react";
import { useApi } from "@/lib/useApi";
import { useLanguage } from "@/lib/i18n";
import { useToast } from "./ui/Toast";
import { ApiError } from "@/lib/api";
import { authorColor } from "@/lib/authorColor";
import { subscribeToChanges } from "@/lib/realtime";
import type { Annotation, Idea, IdeaFeedback } from "@/lib/types";

// 2026-07-22 (unification) — one round block mixes plain IdeaFeedback and
// highlight Annotation entries, see the round-merge doc comment below.
type RoundEntry = { kind: "feedback"; feedback: IdeaFeedback } | { kind: "highlight"; annotation: Annotation };

// 2026-07-22, Lino: "die kommentare müssen genau im gleichen system sein" —
// one shared formatter used by BOTH entry kinds (FeedbackEntry and the
// highlight branch in FeedbackRound below), so neither can silently drift
// from the other again.
function formatEntryDate(iso: string): string {
  return new Date(iso).toLocaleString("de-CH", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Client comments (left from the public "ideas" share page, no login),
 * grouped into numbered rounds. Lives inside IdeaFloatingCard — the
 * "Abgenommen" action itself lives THERE now (2026-07-18, Lino: "der
 * Abgenommen Button muss unten rechts in der Kachel platziert werden" — a
 * fixed corner spot on the whole card, not inline at the end of this
 * scrollable list), this panel only ever shows/manages feedback. */
export function IdeaFeedbackPanel({
  idea, onAllResolvedChange, annotations = [], highlightedAnnotationId = null, onDeleteAnnotation, onSelectAnnotation, onAnnotationUpdated,
}: {
  idea: Idea;
  /** 2026-07-18, Lino: "man kann erst Abgenommen drücken wenn man alle
   * Kommentare abgehackt hat. ansonsten kommt eine Meldung" — this panel
   * owns the feedback list, so it's the one that knows whether everything
   * is resolved; IdeaFloatingCard's approve button just reads the latest
   * value via this callback rather than duplicating the fetch. */
  onAllResolvedChange?: (allResolved: boolean) => void;
  /** 2026-07-22 — Textmarker-Kommentare left on the public preview page
   * (see PublicIdeaLightbox's own merged-list unification) were invisible
   * here entirely until now: Lino noticed clicking one from the app's
   * "Kommentare"-sidebar (AnnotationsPanel) opened nothing, since this
   * panel never rendered them. Caller passes the FULL project annotations
   * array (same one AnnotationsPanel already gets from page.tsx) — this
   * panel filters to this idea itself, same "self-contained, filters its
   * own scope" shape ideaFeedback's own fetch already has. */
  annotations?: Annotation[];
  highlightedAnnotationId?: string | null;
  onDeleteAnnotation?: (annotation: Annotation) => void;
  /** 2026-07-22 — "drückt man auf den Kommentar unten muss das
   * gehighlightete kurz aufleuchten": clicking a highlight-comment entry
   * calls this (IdeaFloatingCard's own handleSelectAnnotation) to flash/
   * scroll to the matching <mark> in the title/text above. */
  onSelectAnnotation?: (annotation: Annotation) => void;
  /** 2026-07-22, Lino: "die highlight kommentare kann man nicht abhacken
   * wie die anderen kommentare.. das muss aber möglich sein... GENAU DAS
   * GLEICHE SYSTEM": bubbles a PATCH'd Annotation up to page.tsx's own
   * `annotations` state, same shape `updateOne` below already uses for
   * IdeaFeedback. */
  onAnnotationUpdated?: (annotation: Annotation) => void;
}) {
  const api = useApi();
  const toast = useToast();
  const { t } = useLanguage();
  const [feedback, setFeedback] = useState<IdeaFeedback[]>([]);
  const [loading, setLoading] = useState(true);

  const highlightComments = useMemo(
    () => annotations.filter((a) => a.idea_id === idea.id),
    [annotations, idea.id]
  );

  useEffect(() => {
    if (!highlightedAnnotationId) return;
    document.querySelector(`[data-comment-annotation-id="${highlightedAnnotationId}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightedAnnotationId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .ideaFeedback(idea.id)
      .then((list) => !cancelled && setFeedback(list))
      .catch((e) => toast.showError(e instanceof ApiError ? e.message : t("ideaFeedbackPanel.loadFailed")))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idea.id]);

  useEffect(() => {
    onAllResolvedChange?.(feedback.every((f) => f.resolved));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedback]);

  // 2026-07-28 — live sync: another team member (or the public preview's
  // "also die preview seiten" client, same channel) sending/resolving
  // feedback while this panel is open updates it without a reload.
  useEffect(() => {
    return subscribeToChanges("idea", idea.id, () => {
      api.ideaFeedback(idea.id).then(setFeedback).catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idea.id]);

  // 2026-07-18, Lino: "die ersten Kommentare landen in 01 Feedback, die
  // darauf folgenden Kommentare in 02 Feedback" — group by the round number
  // the backend already assigned (see Idea.feedback_round's doc comment),
  // sorted ascending so 01 always renders above 02.
  // 2026-07-22, Lino: "die markierten kommentare müssen auch in der 01
  // oder 02 Feedbackkachel landen inkl. datum etc. genau wie die anderen
  // kommentare!!!!" — highlight-comments (Annotation, stamped with the
  // idea's feedback_round at creation, see Annotation.round's own doc
  // comment on the backend) merge into these SAME buckets instead of
  // rendering as their own separate list. A round-less annotation
  // (legacy, from before this field existed) is dropped rather than
  // guessed at.
  const rounds = useMemo(() => {
    const byRound = new Map<number, RoundEntry[]>();
    for (const f of feedback) {
      byRound.set(f.round, [...(byRound.get(f.round) ?? []), { kind: "feedback", feedback: f }]);
    }
    for (const a of highlightComments) {
      if (a.round == null) continue;
      byRound.set(a.round, [...(byRound.get(a.round) ?? []), { kind: "highlight", annotation: a }]);
    }
    return [...byRound.entries()]
      .map(([round, entries]) => [round, entries.sort((x, y) => {
        const xTime = x.kind === "feedback" ? x.feedback.created_at : x.annotation.created_at;
        const yTime = y.kind === "feedback" ? y.feedback.created_at : y.annotation.created_at;
        return xTime.localeCompare(yTime);
      })] as [number, RoundEntry[]])
      .sort((a, b) => a[0] - b[0]);
  }, [feedback, highlightComments]);

  function updateOne(updated: IdeaFeedback) {
    setFeedback((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
  }

  // 2026-07-21, Lino: "wenn keine kommentare da sind, kann das
  // kommentarfeld komplett ausgeblendet werden. nur wenn kommentare da
  // sind, soll das kommentarfeld eingeblendet werden" — this panel now owns
  // its own border-t divider (used to live in IdeaFloatingCard's wrapper
  // div) precisely so it can take the divider/spacing away too, not just
  // the text, once there's nothing to show. Also skipped while still
  // loading — no flash of an empty panel before the first fetch resolves.
  if (loading || (rounds.length === 0 && highlightComments.length === 0)) return null;

  return (
    <div className="border-t border-white/10 pt-4 mt-4">
      <p className="text-xs font-semibold text-white/50 uppercase tracking-wide mb-2">
        {t("ideaFeedbackPanel.heading", { count: feedback.length })}
      </p>
      <div className="space-y-2">
        {rounds.map(([round, entries]) => (
          <FeedbackRound
            key={round}
            round={round}
            entries={entries}
            ideaId={idea.id}
            onUpdated={updateOne}
            highlightedAnnotationId={highlightedAnnotationId}
            onDeleteAnnotation={onDeleteAnnotation}
            onSelectAnnotation={onSelectAnnotation}
            onAnnotationUpdated={onAnnotationUpdated}
          />
        ))}
      </div>
    </div>
  );
}

/** One collapsible round (2026-07-17, Lino: "die Kommentare... immer so
 * betiteln: 01 Feedback - (Datum/Uhrzeit)... kann aber mit Klick auf den
 * Kommentartitel zusammengeklappt werden" — originally per-comment, now
 * per-ROUND per 2026-07-18's follow-up spec). Defaults open, click the
 * title row to collapse/expand the whole round. */
function FeedbackRound({
  round, entries, ideaId, onUpdated, highlightedAnnotationId, onDeleteAnnotation, onSelectAnnotation, onAnnotationUpdated,
}: {
  round: number;
  entries: RoundEntry[];
  ideaId: string;
  onUpdated: (feedback: IdeaFeedback) => void;
  highlightedAnnotationId?: string | null;
  onDeleteAnnotation?: (annotation: Annotation) => void;
  onSelectAnnotation?: (annotation: Annotation) => void;
  onAnnotationUpdated?: (annotation: Annotation) => void;
}) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(true);
  const number = String(round).padStart(2, "0");
  const entryTime = (e: RoundEntry) => (e.kind === "feedback" ? e.feedback.created_at : e.annotation.created_at);
  const earliest = entries.reduce((min, e) => (entryTime(e) < min ? entryTime(e) : min), entryTime(entries[0]));
  const when = new Date(earliest).toLocaleString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  // 2026-07-22 (unification) — counts unresolved entries of BOTH kinds, not
  // just plain feedback, matching Annotation.status !== "resolved" as the
  // highlight-comment equivalent of IdeaFeedback.resolved === false.
  const openCount = entries.filter((e) => (e.kind === "feedback" ? !e.feedback.resolved : e.annotation.status !== "resolved")).length;

  return (
    <div className="bg-white/5 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="text-[11px] font-semibold text-white/60">
          {t("ideaFeedbackPanel.roundLabel", { number, when })}
          {openCount > 0 && <span className="ml-1.5 text-white/40">({t("ideaFeedbackPanel.openCount", { count: openCount })})</span>}
        </span>
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className={`shrink-0 text-white/40 transition-transform ${expanded ? "rotate-90" : ""}`}
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>
      {expanded && (
        <div className="px-3 pb-2.5 flex flex-col gap-2">
          {entries.map((entry) => {
            if (entry.kind === "feedback") {
              return (
                <FeedbackEntry
                  key={entry.feedback.id}
                  feedback={entry.feedback}
                  ideaId={ideaId}
                  onUpdated={onUpdated}
                  highlighted={highlightedAnnotationId === entry.feedback.id}
                />
              );
            }
            return (
              <HighlightEntry
                key={entry.annotation.id}
                annotation={entry.annotation}
                highlighted={highlightedAnnotationId === entry.annotation.id}
                onSelect={onSelectAnnotation}
                onDelete={onDeleteAnnotation}
                onUpdated={onAnnotationUpdated}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 2026-07-22, Lino: "die highlight kommentare kann man nicht abhacken wie
 * die anderen kommentare.. das muss aber möglich sein... die highlight
 * kommentare und normalen kommentare müssen GENAU DAS GLEICHE SYSTEM
 * SEIN!!!!" — mirrors FeedbackEntry below field-for-field (same
 * border-l-2/pl-2.5 wrapper, same checkbox-left layout, same strikethrough-
 * when-done text, same per-entry date). The only two differences left are
 * the quoted-text „...“ snippet and the click-to-pulse/delete affordances
 * that only make sense for a markup comment, not the checkbox/strikethrough
 * mechanics themselves. Maps the checkbox to Annotation.status ("open" ⇄
 * "resolved") — the same binary shape IdeaFeedback.resolved already has;
 * "rejected" stays reachable only via AnnotationsPanel's own 3-button
 * controls, not this simple tick. */
function HighlightEntry({
  annotation, highlighted, onSelect, onDelete, onUpdated,
}: {
  annotation: Annotation;
  highlighted: boolean;
  onSelect?: (annotation: Annotation) => void;
  onDelete?: (annotation: Annotation) => void;
  onUpdated?: (annotation: Annotation) => void;
}) {
  const api = useApi();
  const toast = useToast();
  const { t } = useLanguage();
  const [saving, setSaving] = useState(false);
  const color = authorColor(annotation.author_name);
  const resolved = annotation.status === "resolved";

  async function toggleResolved(e: React.MouseEvent) {
    e.stopPropagation();
    setSaving(true);
    try {
      const updated = await api.patchAnnotation(annotation.id, resolved ? "open" : "resolved");
      onUpdated?.(updated);
    } catch (err) {
      toast.showError(err instanceof ApiError ? err.message : t("ideaFeedbackPanel.toggleFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      data-comment-annotation-id={annotation.id}
      onClick={() => onSelect?.(annotation)}
      className={`relative flex items-start gap-2 border-l-2 pl-2.5 pr-6 transition-colors ${onSelect ? "cursor-pointer" : ""} ${
        highlighted ? "bg-blue-500/[0.08] subshot-annot-pulse" : ""
      }`}
      style={{ borderLeftColor: color }}
    >
      <button
        type="button"
        onClick={toggleResolved}
        disabled={saving}
        aria-label={resolved ? t("ideaFeedbackPanel.markOpen") : t("ideaFeedbackPanel.markDone")}
        className={`mt-0.5 shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors ${
          resolved ? "bg-emerald-500 border-emerald-500" : "border-white/25 hover:border-white/50"
        }`}
      >
        {resolved && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        )}
      </button>
      <div className="min-w-0">
        {annotation.text && <p className="text-xs text-yellow-400/90 italic break-words">„{annotation.text}“</p>}
        <p className={`text-sm text-white/90 whitespace-pre-line ${resolved ? "line-through decoration-white/40 text-white/50" : ""}`}>
          <span style={{ color }} className="font-bold">{annotation.author_name}:</span> {annotation.comment}
        </p>
        <p className="text-[11px] text-white/35 mt-0.5">
          {formatEntryDate(annotation.created_at)}
          {resolved && annotation.resolved_by_name && (
            <span className="ml-1.5">· ✓ {annotation.resolved_by_name}</span>
          )}
        </p>
      </div>
      {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(annotation);
          }}
          aria-label={t("common.delete")}
          className="absolute top-1 right-0 w-5 h-5 rounded-full bg-white/10 text-white/50 hover:bg-red-600/40 hover:text-white flex items-center justify-center text-sm transition-colors"
        >
          ×
        </button>
      )}
    </div>
  );
}

/** One comment within a round — colored per author (2026-07-17, same
 * deterministic per-name color as the Preview page, see lib/authorColor.ts)
 * + a checkbox to mark it processed (2026-07-18, Lino: "hier muss man auch
 * die Kommentare abhacken können um sie abarbeiten zu können, sie werden
 * dann durchgestrichen dargestellt"). */
function FeedbackEntry({
  feedback, ideaId, onUpdated, highlighted = false,
}: {
  feedback: IdeaFeedback;
  ideaId: string;
  onUpdated: (feedback: IdeaFeedback) => void;
  /** 2026-07-31 — plain feedback never had this at all (only HighlightEntry
   * did), so clicking a notification/deep-link for a PLAIN comment had
   * nothing to scroll/pulse to even though IdeaFeedbackPanel's own
   * scrollIntoView effect already queries `[data-comment-annotation-id]`
   * generically for either kind. */
  highlighted?: boolean;
}) {
  const api = useApi();
  const toast = useToast();
  const { t } = useLanguage();
  const [saving, setSaving] = useState(false);
  const color = authorColor(feedback.author_name);

  async function toggleResolved() {
    setSaving(true);
    try {
      const updated = await api.setIdeaFeedbackResolved(ideaId, feedback.id, !feedback.resolved);
      onUpdated(updated);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("ideaFeedbackPanel.toggleFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      data-comment-annotation-id={feedback.id}
      className={`flex items-start gap-2 border-l-2 pl-2.5 transition-colors ${highlighted ? "bg-blue-500/[0.08] subshot-annot-pulse" : ""}`}
      style={{ borderLeftColor: color }}
    >
      <button
        type="button"
        onClick={toggleResolved}
        disabled={saving}
        aria-label={feedback.resolved ? t("ideaFeedbackPanel.markOpen") : t("ideaFeedbackPanel.markDone")}
        className={`mt-0.5 shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors ${
          feedback.resolved ? "bg-emerald-500 border-emerald-500" : "border-white/25 hover:border-white/50"
        }`}
      >
        {feedback.resolved && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        )}
      </button>
      <div className="min-w-0">
        <p className={`text-sm text-white/90 whitespace-pre-line ${feedback.resolved ? "line-through decoration-white/40 text-white/50" : ""}`}>
          <span style={{ color }} className="font-bold">{feedback.author_name}:</span> {feedback.comment}
        </p>
        <p className="text-[11px] text-white/35 mt-0.5">
          {formatEntryDate(feedback.created_at)}
          {feedback.resolved && feedback.resolved_by_name && (
            <span className="ml-1.5">· ✓ {feedback.resolved_by_name}</span>
          )}
        </p>
      </div>
    </div>
  );
}
