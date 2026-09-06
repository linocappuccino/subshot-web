"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { PublicIdeaTile } from "@/app/components/PublicIdeaTile";
import { PublicIdeaLightbox } from "@/app/components/PublicIdeaLightbox";
import { publicPreviewApi } from "@/lib/publicPreviewApi";
import { publicIdeasPreviewApi } from "@/lib/publicIdeasPreviewApi";
import { ApiError } from "@/lib/api";
import { setPreviewLanguage, useLanguage } from "@/lib/i18n";
import type { SharedIdeasPreviewData, IdeaPreview, Annotation } from "@/lib/types";
import { PENDING_ANNOTATION_ID } from "@/app/components/PublicHighlightedText";
import { isIdeaFeedbackLocked } from "@/lib/ideaFeedbackLock";
import { subscribeToChanges } from "@/lib/realtime";

// 2026-07-21 (#262) — public no-login "Ideen-Preview" counterpart to
// /projects/[id]/ideas/page.tsx (the authenticated Ideen/Planungssektor
// page), replacing the old server-rendered app/idea_share_view.py exactly
// the way /preview/[token]/page.tsx (#254) replaced app/video_share_view.py
// for videos — same Suspense/useParams/password-gate scaffolding, same
// minimal dark "Subshot - {Team}" / "Auftrag: {Projekt}" header (see
// _brand_header_html on the backend, every public preview page uses it).
// Grid of read-only PublicIdeaTile, click one to open the big glass-card
// PublicIdeaLightbox — matches the authenticated app's own IdeaTile/
// IdeaFloatingCard look field-for-field (Lino's explicit brief in
// idea_share_view.py's module docstring) but with zero editing affordances:
// no title/text autosave, no image upload/generate/reorder, no Abgenommen/
// Abgelehnt buttons. The only visitor actions are browsing images/videos
// and leaving feedback (save a draft / send a round, see
// PublicIdeaLightbox's own gating logic).
export default function PreviewIdeasPage() {
  return (
    <Suspense fallback={null}>
      <PreviewIdeasPageInner />
    </Suspense>
  );
}

// Text-highlight selection payload (2026-07-21, #268 follow-up) — same
// shape as preview-scenes/[token]/page.tsx's own PendingSelection, just
// ideaId instead of sceneId. No x/y anymore (2026-07-22 unification) — the
// selection used to anchor a floating PublicAnnotationPopup near the
// cursor; it now just feeds a chip inside PublicIdeaLightbox's own
// already-positioned compose form instead.
type PendingSelection = { ideaId: string; field: string; text: string };

function PreviewIdeasPageInner() {
  const { t } = useLanguage();
  const params = useParams<{ token: string }>();
  const token = params.token;
  const searchParams = useSearchParams();
  const openIdeaId = searchParams.get("idea");

  const [data, setData] = useState<SharedIdeasPreviewData | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [passwordDraft, setPasswordDraft] = useState("");
  const [passwordError, setPasswordError] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockToken, setUnlockToken] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openedFromParam, setOpenedFromParam] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Textmarker (2026-07-22, unification): used to be a separate on/off
  // "mode" toggled via a fixed toolbar, with its own floating popup+sidebar
  // — Lino: "Textmarker ist IMMER aktiv in der Kommentar-Funktion... sonst
  // haben wir 2 Kommentarfunktionen für eine Seite, das macht keinen Sinn."
  // Selection-capture is now always armed (see the mouseup effect below,
  // gated only on a lightbox being open for a non-approved/rejected idea),
  // no separate toggle state needed. `pending` now feeds a chip INSIDE
  // PublicIdeaLightbox's own compose form instead of a floating
  // PublicAnnotationPopup, and highlight-annotations render as entries in
  // that same lightbox's feedback list instead of a separate floating
  // PublicAnnotationsSidebar (both those components stay in use by
  // preview-scenes/[token]/page.tsx, untouched by this).
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [hoveredAnnotationId, setHoveredAnnotationId] = useState<string | null>(null);

  function load(unlock: string | null, silent = false) {
    if (!silent) setLoading(true);
    // 2026-08-31 — perf pass: same fix as preview-scenes/[token]/page.tsx's
    // identical load() — fetchAnnotations only needs token/unlock, doesn't
    // depend on the ideas-preview response, so it doesn't need to wait for
    // it. Fires immediately instead of after `fetchIdeasPreview` resolves,
    // with its own independent best-effort catch (unchanged behavior: a
    // flaky annotations fetch never blocked the ideas grid from showing).
    publicIdeasPreviewApi
      .fetchIdeasPreview(token, unlock)
      .then((d) => {
        setData(d);
        setPreviewLanguage(d.language);
        setNeedsPassword(false);
        setError(null);
        if (openIdeaId && !openedFromParam) {
          if (d.ideas.some((i) => i.id === openIdeaId)) setOpenId(openIdeaId);
          setOpenedFromParam(true);
        }
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 403) setNeedsPassword(true);
        else setError(e instanceof ApiError ? e.message : t("previewPage.loadFailed"));
      })
      .finally(() => {
        if (!silent) setLoading(false);
      });
    publicIdeasPreviewApi
      .fetchAnnotations(token, unlock)
      .then((anns) => setAnnotations(anns.filter((a) => a.kind === "highlight")))
      .catch(() => {
        // Best-effort — see this function's own doc comment.
      });
  }

  useEffect(() => {
    load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // 2026-07-27, Lino: "auf der Ideen preview Seite verschwindet das
  // thumbnail.. auf der Seite vom Bearbeiter ist es aber noch weiterhin
  // ersichtlich" — every image_url here is a presigned R2 URL computed
  // FRESH per response (schemas.py's `_presign_image` field_validator,
  // default 2h expiry, see r2_client.presigned_url). The authenticated app
  // re-signs periodically (AuthImage.tsx, see #303) so a long-open tab
  // never notices; this page only ever fetched once on mount, so a preview
  // left open past ~2h (a client slowly reviewing over a meeting/day) had
  // its image URLs silently expire — the <img> just goes broken, exactly
  // like a vanished thumbnail. Re-fetches well inside that window; `load`
  // replaces `data` wholesale but `openId`/`openIndex` are derived from it
  // by id, so an open lightbox stays on the same idea with a freshly
  // presigned image, not reset.
  useEffect(() => {
    const interval = setInterval(() => load(unlockToken), 20 * 60 * 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, unlockToken]);

  // 2026-07-28 — live comment sync (Lino: "also die preview seiten" — same
  // channel the authenticated in-app IdeaFeedbackPanel subscribes to, see
  // that component). `silent` re-fetch only while a lightbox is actually
  // open, same reasoning as preview/[token]/page.tsx's video counterpart —
  // `load`'s normal `setLoading(true)` would flash the whole grid.
  useEffect(() => {
    if (!openId) return;
    return subscribeToChanges("idea", openId, () => load(unlockToken, true));
  }, [openId, unlockToken]);

  const ideas = useMemo(() => (data ? [...data.ideas].sort((a, b) => a.sort_order - b.sort_order) : []), [data]);
  const openIndex = openId ? ideas.findIndex((i) => i.id === openId) : -1;
  const openIdea = openIndex >= 0 ? ideas[openIndex] : null;
  // 2026-07-26, Todoist #327 — same shared `isIdeaFeedbackLocked` gate
  // PublicIdeaLightbox's compose forms now both use (see that helper's own
  // doc comment for why this used to only check approved/rejected here,
  // missing the round-closed case entirely: a visitor could still select
  // text and get a "chip" for a highlight comment while the round was
  // closed, even though PublicIdeaLightbox had no compose box to show for
  // it — a dangling selection with nowhere to go). Selection-capture below
  // mirrors this instead of a separate on/off mode toggle.
  const canComment = Boolean(openIdea) && !isIdeaFeedbackLocked(openIdea!);

  // Same mouseup/closest("[data-idea-id]")/closest("[data-field]") capture
  // as preview-scenes' own handler, retargeted to idea-id instead of
  // scene-id — works fine against the lightbox's modal DOM since it's just
  // a document-level listener, no lightbox-specific wiring needed. Always
  // armed while a commentable idea is open (see canComment above) — no
  // separate "Textmarker" mode to turn on first.
  useEffect(() => {
    if (!canComment) return;
    function handleMouseUp() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      const text = sel.toString().trim();
      if (!text) return;
      const range = sel.getRangeAt(0);
      const container = range.commonAncestorContainer;
      const startEl = (container.nodeType === 3 ? container.parentElement : (container as Element)) ?? null;
      const ideaEl = startEl?.closest("[data-idea-id]") as HTMLElement | null;
      const fieldEl = startEl?.closest("[data-field]") as HTMLElement | null;
      if (!ideaEl || !fieldEl) {
        sel.removeAllRanges();
        return;
      }
      setPending({
        ideaId: ideaEl.dataset.ideaId!,
        field: fieldEl.dataset.field!,
        text,
      });
      sel.removeAllRanges();
    }
    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, [canComment]);

  function pulseAnnotation(id: string) {
    setHighlightedId(id);
    // Flashes both the <mark> in the title/text AND (2026-07-22
    // unification) its matching entry in the merged comment list —
    // whichever of the two the visitor DIDN'T just click on.
    document.querySelectorAll(`[data-annotation-id="${id}"], [data-comment-annotation-id="${id}"]`).forEach((el) => {
      el.classList.remove("annot-pulse");
      void (el as HTMLElement).offsetWidth;
      el.classList.add("annot-pulse");
      (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center" });
    });
    setTimeout(() => setHighlightedId((cur) => (cur === id ? null : cur)), 1500);
  }

  // 2026-07-22 (unification) — used to also handle opening a DIFFERENT
  // idea first (annotations came from a cross-idea floating sidebar). Now
  // every annotation entry only ever renders inside its OWN idea's already-
  // open lightbox (see the merged feedback list in PublicIdeaLightbox), so
  // selecting one is always just a same-idea pulse.
  function selectAnnotation(ann: Annotation) {
    pulseAnnotation(ann.id);
  }

  function saveHighlightComment(authorName: string, comment: string) {
    if (!pending) return;
    publicIdeasPreviewApi
      .createAnnotation(token, unlockToken, pending.ideaId, authorName, pending.field, pending.text, comment)
      .then((ann) => {
        setAnnotations((prev) => [...prev, ann]);
        setPending(null);
      })
      .catch((e) => setToast(e instanceof ApiError ? e.message : t("previewPage.saveAnnotationFailed")));
  }

  function handleDeleteAnnotation(ann: Annotation) {
    let authorName = "";
    try {
      authorName = localStorage.getItem("subshot_annot_name") || "";
    } catch {
      // ignore
    }
    publicIdeasPreviewApi
      .deleteAnnotation(token, unlockToken, ann.id, authorName)
      .then(() => setAnnotations((prev) => prev.filter((a) => a.id !== ann.id)))
      .catch((e) => setToast(e instanceof ApiError ? e.message : t("previewPage.deleteAnnotationFailed")));
  }

  // 2026-07-22 — same fix as preview-scenes/[token]/page.tsx's own
  // pendingAnnotation: handleMouseUp below clears the native browser
  // selection the moment it captures `pending`, so without this the
  // just-selected text showed no mark at all until the comment was saved.
  // A synthetic Annotation folded into annotationsByIdea lets
  // wrapHighlights/wrapHighlightsInHtml render it via their existing
  // PENDING_ANNOTATION_ID branch, no changes needed in PublicIdeaLightbox.
  const pendingAnnotation: Annotation | null = pending
    ? {
        id: PENDING_ANNOTATION_ID,
        project_id: "",
        scene_id: null,
        idea_id: pending.ideaId,
        section_id: null,
        author_name: "",
        kind: "highlight",
        field: pending.field,
        text: pending.text,
        pen_path: null,
        comment: null,
        status: "open",
        created_at: "",
        round: null,
        resolved_by_name: null,
      }
    : null;

  const annotationsByIdea = useMemo(() => {
    const map = new Map<string, Annotation[]>();
    for (const a of annotations) {
      if (!a.idea_id) continue;
      if (!map.has(a.idea_id)) map.set(a.idea_id, []);
      map.get(a.idea_id)!.push(a);
    }
    if (pendingAnnotation?.idea_id) {
      if (!map.has(pendingAnnotation.idea_id)) map.set(pendingAnnotation.idea_id, []);
      map.get(pendingAnnotation.idea_id)!.push(pendingAnnotation);
    }
    return map;
  }, [annotations, pendingAnnotation]);

  async function submitPassword() {
    if (!passwordDraft.trim() || unlocking) return;
    setUnlocking(true);
    setPasswordError(false);
    try {
      const { unlock_token } = await publicPreviewApi.unlock(token, passwordDraft);
      setUnlockToken(unlock_token);
      load(unlock_token);
    } catch {
      setPasswordError(true);
    } finally {
      setUnlocking(false);
    }
  }

  function updateIdea(updated: IdeaPreview) {
    setData((prev) => (prev ? { ...prev, ideas: prev.ideas.map((i) => (i.id === updated.id ? updated : i)) } : prev));
  }

  if (needsPassword) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#161616] text-white p-5">
        <div className="w-full max-w-xs rounded-2xl bg-[#212121] border border-white/10 p-7 text-center">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-3 text-white/40">
            <rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" />
          </svg>
          <h1 className="text-sm font-bold mb-1">{t("previewPage.gateTitle")}</h1>
          <p className="text-xs text-white/40 mb-5">{t("previewPage.gateMessage")}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitPassword();
            }}
          >
            <input
              autoFocus
              type="password"
              value={passwordDraft}
              onChange={(e) => setPasswordDraft(e.target.value)}
              placeholder={t("shareLinkModal.passwordPlaceholder")}
              className="w-full text-sm bg-white/5 border border-white/10 rounded-lg px-3.5 py-3 mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            />
            {passwordError && <p className="text-xs text-red-400 mb-3">{t("previewPage.wrongPassword")}</p>}
            <button
              type="submit"
              disabled={unlocking}
              className="w-full text-sm font-bold py-3 rounded-lg bg-blue-600 text-white disabled:opacity-50"
            >
              {t("previewPage.view")}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-[#161616] text-white"
      style={{ "--idea-preview-accent": data?.project_color ?? "#3875bd" } as React.CSSProperties}
    >
      <div className="max-w-6xl mx-auto w-full px-4 sm:px-6 pt-8 pb-28">
        <a href="https://subshot.ch" className="inline-flex items-baseline gap-1.5 mb-1 hover:opacity-80 transition-opacity">
          {data?.team_logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- presigned R2 URL, not a static/local asset next/image can optimize
            <img src={data.team_logo_url} alt={data.team_name ?? "Logo"} className="w-8 h-8 rounded-lg object-cover" />
          ) : (
            <span className="font-anton text-lg uppercase">
              Subshot
              {data?.team_name && <span className="text-white/40"> - {data.team_name}</span>}
            </span>
          )}
        </a>
        {/* 2026-07-30, Lino: "der auftraggeber muss grösser dargestellt
            werden und der projekttitel auch" — both were text-sm, same
            size as any small caption text on the page; bumped to match the
            authenticated app's own pipeline-header treatment (#387,
            2026-07-30: client_name text-lg, project title a real bold
            heading). */}
        {/* 2026-08-06 — project's own color as text color (data.project_color),
            same treatment as the authenticated pipeline header. */}
        {data?.client_name && (
          <div className="text-lg font-medium" style={{ color: data.project_color }}>
            {data.client_name}
          </div>
        )}
        <h1 className="text-2xl font-bold text-white mb-6">{t("previewPage.projectLabel", { name: data?.project_name ?? "…" })}</h1>

        {loading ? (
          <p className="text-sm text-white/40">{t("common.loading")}</p>
        ) : error ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : !data || ideas.length === 0 ? (
          <p className="text-sm text-white/40">{t("previewIdeasPage.noIdeas")}</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
            {ideas.map((idea) => (
              <PublicIdeaTile
                key={idea.id}
                idea={idea}
                onClick={() => setOpenId(idea.id)}
              />
            ))}
          </div>
        )}
      </div>

      {openIdea && (
        <PublicIdeaLightbox
          idea={openIdea}
          token={token}
          unlockToken={unlockToken}
          onClose={() => {
            // 2026-07-22 (#3) — closing used to leave `pending` (and thus
            // the popup/chip anchored to a selection inside this now-
            // unmounted lightbox) stuck visible with nowhere valid to
            // render relative to. Always clear it on close.
            setOpenId(null);
            setPending(null);
          }}
          onPrev={openIndex > 0 ? () => setOpenId(ideas[openIndex - 1].id) : undefined}
          onNext={openIndex < ideas.length - 1 ? () => setOpenId(ideas[openIndex + 1].id) : undefined}
          onIdeaUpdated={updateIdea}
          annotations={annotationsByIdea.get(openIdea.id) ?? []}
          onMarkClick={selectAnnotation}
          onMarkHoverChange={setHoveredAnnotationId}
          highlightedAnnotationId={highlightedId}
          hoveredAnnotationId={hoveredAnnotationId}
          onSelectAnnotation={selectAnnotation}
          onDeleteAnnotation={handleDeleteAnnotation}
          pendingSelection={pending?.ideaId === openIdea.id ? pending.text : null}
          onCancelPendingSelection={() => setPending(null)}
          onSaveHighlightComment={saveHighlightComment}
        />
      )}

      {toast && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-6 z-[200] bg-[#2a2a2a] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white/90 shadow-2xl max-w-[calc(100vw-32px)]">
          {toast}
        </div>
      )}

      <style jsx global>{`
        @keyframes annot-pulse {
          0%, 100% { filter: none; }
          50% { filter: brightness(1.6) saturate(1.4); }
        }
        .annot-pulse { animation: annot-pulse 0.6s ease-in-out 2; }
      `}</style>
    </div>
  );
}
