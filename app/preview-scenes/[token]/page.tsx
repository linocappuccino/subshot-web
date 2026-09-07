"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { publicPreviewApi } from "@/lib/publicPreviewApi";
import { publicScenesPreviewApi } from "@/lib/publicScenesPreviewApi";
import { ApiError } from "@/lib/api";
import { setPreviewLanguage, useLanguage } from "@/lib/i18n";
import type { Annotation, ScenesPreviewData, Shot } from "@/lib/types";
import { PublicSceneCard } from "@/app/components/PublicSceneCard";
import { PublicSceneMedia } from "@/app/components/PublicSceneMedia";
import { PublicSectionComments } from "@/app/components/PublicSectionComments";
import { PublicMapThumb } from "@/app/components/PublicMapThumb";
import { PublicTodoLists } from "@/app/components/PublicTodoLists";
import { PublicTeamChips } from "@/app/components/PublicTeamChips";
import { PublicAnnotationPopup } from "@/app/components/PublicAnnotationPopup";
import { PublicAnnotationsSidebar } from "@/app/components/PublicAnnotationsSidebar";
import { PENDING_ANNOTATION_ID } from "@/app/components/PublicHighlightedText";
import { subscribeToChanges } from "@/lib/realtime";

// 2026-07-21 (#268) — public no-login "Szenenpreview" (storyboard)
// counterpart to /projects/[id]/page.tsx (the authenticated scene/shot
// planning page), replacing the old server-rendered app/share_view.py the
// same way /preview-ideas/[token]/page.tsx (#262) replaced
// app/idea_share_view.py. Same Suspense/useParams/password-gate scaffolding,
// same minimal dark "Subshot - {Team}" / "Auftrag: {Projekt}" header. Per
// Lino's explicit scope decision, ONLY the text-highlight annotation kind is
// rebuilt here — pen/freehand drawing is dropped entirely (no creation UI,
// no rendering of any pre-existing kind:"pen" rows, see the `.filter(a =>
// a.kind === "highlight")` below).
export default function PreviewScenesPage() {
  return (
    <Suspense fallback={null}>
      <PreviewScenesPageInner />
    </Suspense>
  );
}

type PendingSelection = { sceneId: string; field: string; text: string; x: number; y: number };

function PreviewScenesPageInner() {
  const { t } = useLanguage();
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [data, setData] = useState<ScenesPreviewData | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [passwordDraft, setPasswordDraft] = useState("");
  const [passwordError, setPasswordError] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockToken, setUnlockToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [mode, setMode] = useState<"off" | "highlight">("off");
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  // 2026-08-31, Todoist #96 — Skript-Auswahlübersicht (mirrors the
  // authenticated app's own openSectionId, see projects/[id]/page.tsx):
  // visitors see a tile overview of the project's sections ("Skripte")
  // first, tap one to open just that shotlist and leave a comment there,
  // exactly like the Ideas preview page's per-idea feedback. null =
  // overview.
  const [openSectionId, setOpenSectionId] = useState<string | null>(null);

  function load(unlock: string | null, silent = false) {
    if (!silent) setLoading(true);
    // 2026-08-31 — perf pass: fetchAnnotations only needs token/unlock, not
    // the scenes-preview response — was chained with `.then()` for no
    // reason, doubling this cold page's load latency (the whole point of a
    // public share link is landing here fresh, no cache). Fire both
    // immediately instead; annotations keep their OWN independent
    // catch/best-effort handling (unchanged from before) so a flaky
    // comments fetch still can't block the actual scenes/shots from
    // showing — only scenesPreview's failure drives the password-gate/
    // error UI.
    publicScenesPreviewApi
      .fetchScenesPreview(token, unlock)
      .then((d) => {
        setData(d);
        setPreviewLanguage(d.language);
        setNeedsPassword(false);
        setError(null);
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 403) setNeedsPassword(true);
        else setError(e instanceof ApiError ? e.message : t("previewPage.loadFailed"));
      })
      .finally(() => {
        if (!silent) setLoading(false);
      });
    // 2026-07-27 — kind="comment" (plain scene comments, see
    // PublicSceneComments) kept alongside "highlight" now; "pen" stays
    // filtered out client-side (dropped from this rebuild, see this
    // file's own module doc comment).
    publicScenesPreviewApi
      .fetchAnnotations(token, unlock)
      .then((anns) => setAnnotations(anns.filter((a) => a.kind === "highlight" || a.kind === "comment")))
      .catch(() => {
        // Best-effort — see this function's own doc comment.
      });
  }

  useEffect(() => {
    load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // 2026-07-28 — live comment sync (Lino: "also die preview seiten"). This
  // page shows every scene at once (unlike the video/idea previews' one-
  // open-item-at-a-time modal), so it subscribes to ALL of them
  // simultaneously — cheap, Pusher multiplexes every channel over one
  // socket connection. Re-subscribes only when the actual set of scene ids
  // changes (new scene added/removed), not on every unrelated re-render.
  const sceneIds = useMemo(() => data?.scenes.map((s) => s.id).sort().join(",") ?? "", [data]);
  useEffect(() => {
    if (!sceneIds) return;
    const unsubscribers = sceneIds.split(",").map((id) => subscribeToChanges("scene", id, () => load(unlockToken, true)));
    return () => unsubscribers.forEach((unsub) => unsub());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneIds, unlockToken]);

  // 2026-08-31, Todoist #96 — same live sync as sceneIds above, for the
  // currently OPENED section's own comment thread (only ever one at a
  // time, unlike every scene at once above — a section's tile overview
  // has nothing live to sync until one is actually opened).
  useEffect(() => {
    if (!openSectionId) return;
    return subscribeToChanges("section", openSectionId, () => load(unlockToken, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSectionId, unlockToken]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Textmarker-Modus: capture a real text selection inside a
  // [data-field] element nested inside a [data-scene-id] card, same rule as
  // share_view.py's mouseup handler (closestCard/closestField). ──────────
  useEffect(() => {
    if (mode !== "highlight") return;
    function handleMouseUp() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      const text = sel.toString().trim();
      if (!text) return;
      const range = sel.getRangeAt(0);
      const container = range.commonAncestorContainer;
      const startEl = (container.nodeType === 3 ? container.parentElement : (container as Element)) ?? null;
      const sceneEl = startEl?.closest("[data-scene-id]") as HTMLElement | null;
      const fieldEl = startEl?.closest("[data-field]") as HTMLElement | null;
      if (!sceneEl || !fieldEl) {
        sel.removeAllRanges();
        return;
      }
      const rect = range.getBoundingClientRect();
      setPending({
        sceneId: sceneEl.dataset.sceneId!,
        field: fieldEl.dataset.field!,
        text,
        x: rect.left + window.scrollX,
        y: rect.bottom + window.scrollY + 6,
      });
      sel.removeAllRanges();
    }
    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, [mode]);

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

  function pulseAnnotation(id: string) {
    setHighlightedId(id);
    document.querySelectorAll(`[data-annotation-id="${id}"]`).forEach((el) => {
      el.classList.remove("annot-pulse");
      void (el as HTMLElement).offsetWidth;
      el.classList.add("annot-pulse");
      (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center" });
    });
    setTimeout(() => setHighlightedId((cur) => (cur === id ? null : cur)), 1500);
  }

  function handleDeleteAnnotation(ann: Annotation) {
    let authorName = "";
    try {
      authorName = localStorage.getItem("subshot_annot_name") || "";
    } catch {
      // ignore
    }
    publicScenesPreviewApi
      .deleteAnnotation(token, unlockToken, ann.id, authorName)
      .then(() => setAnnotations((prev) => prev.filter((a) => a.id !== ann.id)))
      .catch((e) => setToast(e instanceof ApiError ? e.message : t("previewPage.deleteAnnotationFailed")));
  }

  const shotsByScene = useMemo(() => {
    const map = new Map<string, Shot[]>();
    for (const shot of data?.shots ?? []) {
      if (!shot.scene_id) continue;
      if (!map.has(shot.scene_id)) map.set(shot.scene_id, []);
      map.get(shot.scene_id)!.push(shot);
    }
    return map;
  }, [data]);

  // 2026-07-22, Lino: "die Markierung muss auch da bleiben wenn das
  // Kommentarfeld aufgeht" — handleMouseUp below clears the native browser
  // selection the instant it captures `pending` (needed so the popup click
  // itself doesn't also re-fire a spurious selection), which used to leave
  // the just-selected text with no visual mark at all until the comment was
  // actually saved. Synthesizing a fake Annotation for the in-progress
  // selection lets wrapHighlights render it through the exact same
  // <mark>-wrapping path a real saved highlight uses (see
  // PublicHighlightedText.tsx's PENDING_ANNOTATION_ID branch for its
  // distinct, non-clickable styling) — it's folded into annotationsByScene
  // below so PublicSceneCard/ShotRow need no changes at all.
  const pendingAnnotation: Annotation | null = pending
    ? {
        id: PENDING_ANNOTATION_ID,
        project_id: "",
        scene_id: pending.sceneId,
        idea_id: null,
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

  // Highlight-kind only (field-scoped text marks, drives byField/
  // wrapHighlights in PublicSceneCard/ShotRow) — plain kind="comment" rows
  // now only ever render in the section-level sidebar (commentsBySection
  // below), see PublicSceneCard's own 2026-09-07 doc comment for why the
  // per-scene comment box (and its matching commentsByScene grouping) was
  // removed.
  const annotationsByScene = useMemo(() => {
    const map = new Map<string, Annotation[]>();
    for (const a of annotations) {
      if (!a.scene_id || a.kind !== "highlight") continue;
      if (!map.has(a.scene_id)) map.set(a.scene_id, []);
      map.get(a.scene_id)!.push(a);
    }
    if (pendingAnnotation?.scene_id) {
      if (!map.has(pendingAnnotation.scene_id)) map.set(pendingAnnotation.scene_id, []);
      map.get(pendingAnnotation.scene_id)!.push(pendingAnnotation);
    }
    return map;
  }, [annotations, pendingAnnotation]);

  // 2026-08-31, Todoist #96 — plain section comments (kind="comment",
  // section_id set), fed to PublicSectionComments below, grouped by section
  // the same way annotationsByScene above groups highlight annotations.
  const commentsBySection = useMemo(() => {
    const map = new Map<string, Annotation[]>();
    for (const a of annotations) {
      if (!a.section_id || a.kind !== "comment") continue;
      if (!map.has(a.section_id)) map.set(a.section_id, []);
      map.get(a.section_id)!.push(a);
    }
    return map;
  }, [annotations]);

  const memberById = useMemo(() => new Map((data?.team ?? []).map((m) => [m.user_id, m])), [data]);

  function scenesFor(sectionId: string | null) {
    if (!data) return [];
    const filtered = data.scenes.filter((s) => s.section_id === sectionId).sort((a, b) => a.sort_order - b.sort_order);
    // Same stable "completed scenes sink to the end" rule as
    // share_view.py's scenes_in (group.sort(key=lambda s: s.completed)).
    return [...filtered.filter((s) => !s.completed), ...filtered.filter((s) => s.completed)];
  }

  // 2026-09-07, Lino: "muss auf der in der shotlist übersicht das erste
  // thumbnail übernommen werden, ansonsten ist es schwierig die projekte
  // auseinander zu halten" — the Skript-Auswahlübersicht tiles below only
  // ever showed a name + count, indistinguishable at a glance across
  // several shared shotlists. Plain sort_order order (NOT scenesFor's own
  // completed-sinks-to-the-end reordering — "first" should mean first in
  // the shotlist, unaffected by what's already been shot), first scene
  // that actually HAS a cover photo wins (skips past an early scene with
  // no image rather than showing nothing just because scene #1 happens to
  // be bare).
  function firstThumbnailFor(sectionId: string): string | null {
    if (!data) return null;
    return (
      data.scenes
        .filter((s) => s.section_id === sectionId)
        .sort((a, b) => a.sort_order - b.sort_order)
        .find((s) => s.image_url)?.image_url ?? null
    );
  }

  const sectionsSorted = useMemo(() => (data ? [...data.sections].sort((a, b) => a.sort_order - b.sort_order) : []), [data]);
  const unsectioned = scenesFor(null);

  function renderScenes(scenes: typeof unsectioned) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
        {scenes.map((scene) => (
          <PublicSceneCard
            key={scene.id}
            scene={scene}
            shots={shotsByScene.get(scene.id) ?? []}
            annotations={annotationsByScene.get(scene.id) ?? []}
            memberById={memberById}
            token={token}
            unlockToken={unlockToken}
            onMarkClick={(ann) => {
              setMode("highlight");
              pulseAnnotation(ann.id);
            }}
          />
        ))}
      </div>
    );
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
            <button type="submit" disabled={unlocking} className="w-full text-sm font-bold py-3 rounded-lg bg-blue-600 text-white disabled:opacity-50">
              {t("previewPage.view")}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#161616] text-white" style={{ "--accent": data?.project_color ?? "#3875bd" } as React.CSSProperties}>
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
            werden und der projekttitel auch" — see preview-ideas/[token]'s
            identical header for the full comment; same size bump here. */}
        {/* 2026-08-06 — project's own color as text color (data.project_color),
            same treatment as the authenticated pipeline header. */}
        {data?.client_name && (
          <div className="text-lg font-medium" style={{ color: data.project_color }}>
            {data.client_name}
          </div>
        )}
        <h1 className="text-2xl font-bold text-white mb-1">{t("previewPage.projectLabel", { name: data?.project_name ?? "…" })}</h1>
        {data && <p className="text-[11px] text-white/30 mb-5">{t("previewScenesPage.linkExpires", { date: new Date(data.expires_at).toLocaleDateString("de-CH") })}</p>}

        {loading ? (
          <p className="text-sm text-white/40">{t("common.loading")}</p>
        ) : error ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : !data ? null : (
          <>
            {(data.shoot_date || data.location_address || data.team.length > 0) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
                {data.shoot_date && (
                  <div className="rounded-2xl bg-[#212121] border border-white/[0.06] p-3.5 flex items-center">
                    <span className="inline-flex items-center gap-1.5 text-xs text-white/70">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
                      </svg>
                      {t("previewPage.startLabel", { date: new Date(data.shoot_date).toLocaleDateString("de-CH") })}
                    </span>
                  </div>
                )}
                {data.location_address && (
                  <div className="rounded-2xl bg-[#212121] border border-white/[0.06] p-3.5">
                    <PublicMapThumb token={token} unlockToken={unlockToken} address={data.location_address} lat={data.location_lat} lng={data.location_lng} />
                  </div>
                )}
                <PublicTeamChips team={data.team} />
              </div>
            )}

            <div className="mb-6">
              <PublicTodoLists todoLists={data.todo_lists} memberById={memberById} />
            </div>

            {data.scenes.length === 0 ? (
              <div className="text-center text-white/40 py-16 flex flex-col items-center gap-2">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4M17 9h4M3 15h4M17 15h4" />
                </svg>
                <p className="text-sm">{t("previewScenesPage.noScenes")}</p>
              </div>
            ) : sectionsSorted.length === 0 ? (
              renderScenes(unsectioned)
            ) : openSectionId === null ? (
              // 2026-08-31, Todoist #96 — Skript-Auswahlübersicht, same tile
              // shape/copy as the authenticated app's own openSectionId===null
              // branch (projects/[id]/page.tsx) — a click here is the whole
              // point of the feature: opens one shotlist to comment on it.
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
                {sectionsSorted.map((section) => {
                  const scenes = scenesFor(section.id);
                  const doneCount = scenes.filter((s) => s.completed).length;
                  const thumbnailUrl = firstThumbnailFor(section.id);
                  return (
                    <button
                      key={section.id}
                      onClick={() => setOpenSectionId(section.id)}
                      className="text-left p-4 rounded-2xl bg-white/[0.04] border border-white/10 hover:bg-white/[0.07] hover:border-white/20 transition-colors"
                    >
                      {thumbnailUrl && (
                        <div className="mb-3 rounded-xl overflow-hidden aspect-video bg-white/5">
                          <PublicSceneMedia imageUrl={thumbnailUrl} className="w-full h-full object-cover" />
                        </div>
                      )}
                      <div className="font-semibold truncate">{section.name}</div>
                      <div className="text-sm text-white/50 mt-1">
                        {doneCount}/{scenes.length} {t("scriptOverview.sceneCount")}
                      </div>
                    </button>
                  );
                })}
                {unsectioned.length > 0 && (
                  <button
                    disabled
                    className="text-left p-4 rounded-2xl bg-white/[0.02] border border-white/5 opacity-50 cursor-default"
                    title={t("scriptOverview.unsectionedHint")}
                  >
                    <div className="font-semibold truncate">{t("scriptOverview.unsectionedTitle")}</div>
                    <div className="text-sm text-white/50 mt-1">{unsectioned.length}</div>
                  </button>
                )}
              </div>
            ) : (
              (() => {
                const openSection = sectionsSorted.find((s) => s.id === openSectionId);
                if (!openSection) return null;
                const scenes = scenesFor(openSection.id);
                return (
                  <div>
                    <button
                      onClick={() => setOpenSectionId(null)}
                      className="mb-4 text-sm text-white/60 hover:text-white flex items-center gap-1.5"
                    >
                      ← {t("scriptOverview.backToOverview")}
                    </button>
                    <h2 className="text-[17px] font-bold text-white mb-3">{openSection.name}</h2>
                    {renderScenes(scenes)}
                    {/* 2026-09-07 fix, Lino: "die kommentarfunktion muss
                        immer rechts als sidebar verfügbar sein und nicht
                        wie jetzt oben" — first attempt kept it in normal
                        document flow (a `sticky` column next to the scene
                        grid) specifically to avoid overlapping
                        PublicAnnotationsSidebar's own `fixed right-0`
                        highlight-mode panel. Lino corrected that: "die
                        kommentar sidebar ist KEINE kachel sondern eine
                        richtige sidebar" + "soll komplett rechts am
                        browser rand sein und nicht die grösse der kacheln
                        beeinflussen" — sharing the flex row with the scene
                        grid was squeezing every tile's column width down
                        to fit both in the SAME centered max-w-6xl content
                        column, instead of the sidebar just floating in
                        whatever margin the viewport actually has outside
                        it (or over the content on a narrow one) — exactly
                        how PublicAnnotationsSidebar already behaves. Kept
                        one z-step above it (z-[71] vs. z-[70]) as a plain
                        tie-break for the rare case both are open at once
                        (selecting text in a scene description while a
                        shotlist is open), rather than the scene grid ever
                        changing shape depending on whether this is open. */}
                    {/* 2026-09-07 fix, Lino: "die feedbackbox in der
                        sidebar muss unten sein und nicht oben" — this
                        wrapper used `overflow-y-auto` on the WHOLE sidebar
                        (heading + history + compose box together), so the
                        compose box just sat wherever the history's height
                        happened to push it, all the way at the top on a
                        shotlist with little/no feedback yet. No overflow
                        here anymore — PublicSectionComments now handles its
                        own internal chat-style layout (history scrolls in
                        its own middle region, compose box `shrink-0`
                        pinned at the bottom), this wrapper just needs to
                        actually give it the full fixed height to lay
                        that out in. */}
                    <div className="fixed right-0 top-0 bottom-0 z-[71] w-[380px] max-w-[92vw] bg-[#1a1a1a] border-l border-white/10 pt-16 pb-4 px-3">
                      {/* Lino's explicit ask: leaving feedback here works
                          "exactly like the Ideas page" — one comment
                          thread for the whole opened shotlist, not per
                          scene. */}
                      <PublicSectionComments
                        section={openSection}
                        comments={commentsBySection.get(openSection.id) ?? []}
                        token={token}
                        unlockToken={unlockToken}
                        onCommentsChanged={(updater) =>
                          setAnnotations((prev) => {
                            const others = prev.filter((a) => !(a.section_id === openSection.id && a.kind === "comment"));
                            const updated = updater(prev.filter((a) => a.section_id === openSection.id && a.kind === "comment"));
                            return [...others, ...updated];
                          })
                        }
                      />
                    </div>
                  </div>
                );
              })()
            )}
          </>
        )}
      </div>

      {/* Kommentar-Toolbar — mirrors share_view.py's #annot-toolbar, minus
          the dropped "Stift" option (Lino: pen/freehand not rebuilt for
          #268). Fixed bottom-right, same as the old page. */}
      <div className="fixed right-[18px] bottom-[18px] z-[80] flex gap-1 bg-[#212121] border border-white/10 rounded-2xl p-1 shadow-2xl">
        <button
          onClick={() => setMode("off")}
          className={`text-xs font-semibold rounded-xl px-3 py-2 transition-colors ${mode === "off" ? "bg-[var(--accent)] text-white" : "text-white/60 hover:text-white hover:bg-white/[0.06]"}`}
        >
          {t("previewPage.commentsOff")}
        </button>
        <button
          onClick={() => setMode("highlight")}
          className={`text-xs font-semibold rounded-xl px-3 py-2 transition-colors inline-flex items-center gap-1.5 ${
            mode === "highlight" ? "bg-[var(--accent)] text-white" : "text-white/60 hover:text-white hover:bg-white/[0.06]"
          }`}
        >
          {t("previewPage.textHighlight")}
        </button>
      </div>

      {mode === "highlight" && (
        <PublicAnnotationsSidebar
          annotations={annotations}
          onDelete={handleDeleteAnnotation}
          onSelect={(ann) => pulseAnnotation(ann.id)}
          highlightedId={highlightedId}
          onClose={() => setMode("off")}
        />
      )}

      {pending && (
        <PublicAnnotationPopup
          x={pending.x}
          y={pending.y}
          quotedText={pending.text}
          onCancel={() => setPending(null)}
          onSave={(authorName, comment) => {
            publicScenesPreviewApi
              .createAnnotation(token, unlockToken, pending.sceneId, authorName, pending.field, pending.text, comment)
              .then((ann) => {
                setAnnotations((prev) => [...prev, ann]);
                setPending(null);
              })
              .catch((e) => {
                setToast(e instanceof ApiError ? e.message : t("previewPage.saveAnnotationFailed"));
                setPending(null);
              });
          }}
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
