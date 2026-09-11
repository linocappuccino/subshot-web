"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { publicPreviewApi } from "@/lib/publicPreviewApi";
import { publicScenesPreviewApi } from "@/lib/publicScenesPreviewApi";
import { ApiError } from "@/lib/api";
import { setPreviewLanguage, useLanguage } from "@/lib/i18n";
import type { Annotation, Scene, ScenesPreviewData, Shot } from "@/lib/types";
import { PublicSceneCard } from "@/app/components/PublicSceneCard";
import { PublicSceneMedia } from "@/app/components/PublicSceneMedia";
import { PublicSectionComments } from "@/app/components/PublicSectionComments";
import { PublicMapThumb } from "@/app/components/PublicMapThumb";
import { PublicTodoLists } from "@/app/components/PublicTodoLists";
import { PublicAnnotationPopup } from "@/app/components/PublicAnnotationPopup";
import { PublicAnnotationsSidebar } from "@/app/components/PublicAnnotationsSidebar";
import { PublicReferenceVideoBlock } from "@/app/components/PublicReferenceVideoBlock";
import { PENDING_ANNOTATION_ID } from "@/app/components/PublicHighlightedText";
import { SegmentedControl } from "@/app/components/ui/SegmentedControl";
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

// Kept in sync with the literal widths on PublicAnnotationsSidebar.tsx and
// the inline PublicSectionComments wrapper below.
const HIGHLIGHT_SIDEBAR_WIDTH = 340;
const SECTION_SIDEBAR_WIDTH = 380;
const COLLAPSED_SIDEBAR_WIDTH = 48;

function PreviewScenesPageInner() {
  const { t } = useLanguage();
  const params = useParams<{ token: string }>();
  const token = params.token;
  // 2026-09-10, Lino: "wenn man in einer shotlist drin ist und dann teilt,
  // muss der geteilte link auch direkt die preview öffnen IN der shotlist
  // und nicht in der shotlist übersicht" — same shape as preview-ideas'
  // own `?idea=` param (openIdeaId below), consumed once data loads (see
  // openedFromSectionParam below).
  const searchParams = useSearchParams();
  const openSectionParam = searchParams.get("section");

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
  // 2026-09-08, Lino: "auf kleinen bildschirmen überlappt die sidebar den
  // hauptcontent" — either right sidebar (PublicAnnotationsSidebar in
  // highlight mode, or the inline PublicSectionComments wrapper below once
  // a shotlist is open) can now collapse to a slim edge tab. Main content's
  // right padding (contentSidebarReserve, computed near the return below)
  // mirrors whichever one is actually visible, so expanding a sidebar
  // visibly pushes the content column left clear of it instead of just
  // floating on top.
  const [highlightSidebarCollapsed, setHighlightSidebarCollapsed] = useState(false);
  const [sectionSidebarCollapsed, setSectionSidebarCollapsed] = useState(false);
  // 2026-09-10, Lino: "die kommentarleiste soll [auf mobile] anders ein und
  // ausblendbar sein... evtl. mit einem button öffnet sich die
  // kommentarspalte" — the desktop collapse-to-slim-tab above doesn't
  // really work on a phone (48px is still a persistent strip, and the tiny
  // edge-pull is easy to miss/mistap). Below `md:` both sidebars become
  // bottom sheets instead, fully hidden by default and opened via
  // mobileCommentsButton further down — independent of the desktop
  // collapsed booleans, which stay purely a desktop concept now.
  const [highlightMobileOpen, setHighlightMobileOpen] = useState(false);
  const [sectionMobileOpen, setSectionMobileOpen] = useState(false);
  // 2026-08-31, Todoist #96 — Skript-Auswahlübersicht (mirrors the
  // authenticated app's own openSectionId, see projects/[id]/page.tsx):
  // visitors see a tile overview of the project's sections ("Skripte")
  // first, tap one to open just that shotlist and leave a comment there,
  // exactly like the Ideas preview page's per-idea feedback. null =
  // overview.
  const [openSectionId, setOpenSectionId] = useState<string | null>(null);
  // Guards the `?section=` param below to only ever auto-open once (same
  // pattern as preview-ideas' own openedFromParam) — otherwise every silent
  // background refetch (the live-sync effects further down) would snap the
  // visitor back to that section even after they'd manually navigated back
  // to the overview.
  const [openedFromSectionParam, setOpenedFromSectionParam] = useState(false);
  // 2026-09-08, Lino: "auf der preview seite muss genau die gleiche
  // sortierfunktion vorhanden sein wie in der Shotlist, man muss Szenen-
  // Reihenfolge und Shot-Reihenfolge sortieren können (kann aber keine
  // kacheln verschieben auf der preview seite)" — same two independent
  // orderings the authenticated app's own shotOrderMode toggles
  // (projects/[id]/page.tsx), read-only here: no DndContext, just which of
  // scenesFor/scenesInShootingOrder below feeds the grid.
  const [shotOrderMode, setShotOrderMode] = useState(false);

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
        if (openSectionParam && !openedFromSectionParam) {
          if (d.sections.some((s) => s.id === openSectionParam)) setOpenSectionId(openSectionParam);
          setOpenedFromSectionParam(true);
        }
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

  // 2026-09-08, Lino: "warum haben die szenen andere nummern auf der
  // preview seite, die müssen genau die gleichen nummern haben wie in der
  // shotlist selber" — the authenticated app replaced the old stable
  // scene.number/letter screenplay badge with a LIVE position-in-section
  // count, 1..N (see sceneNumberBySectionId in projects/[id]/page.tsx),
  // computed off the plain sort_order list. This page still rendered the
  // old scene.number/letter field directly (PublicSceneCard), which
  // drifted from the app's numbers the moment a scene was inserted/
  // reordered/deleted. Mirrors sceneNumberBySectionId exactly so the
  // number shown per scene is IDENTICAL to the app's. (2026-09-11: scenesFor
  // below no longer sinks completed scenes to the end either, so this list
  // and the numbering are now in the same order too — see scenesFor's own
  // comment.)
  const sceneNumberBySectionId = useMemo(() => {
    const bySection = new Map<string | null, Scene[]>();
    for (const s of data?.scenes ?? []) {
      const key = s.section_id;
      if (!bySection.has(key)) bySection.set(key, []);
      bySection.get(key)!.push(s);
    }
    const map = new Map<string | null, Map<string, number>>();
    for (const [sectionId, list] of bySection) {
      const sorted = [...list].sort((a, b) => a.sort_order - b.sort_order);
      const numbers = new Map<string, number>();
      sorted.forEach((s, i) => numbers.set(s.id, i + 1));
      map.set(sectionId, numbers);
    }
    return map;
  }, [data]);
  const sceneNumberIn = (sectionId: string | null) => sceneNumberBySectionId.get(sectionId) ?? new Map<string, number>();

  function scenesFor(sectionId: string | null) {
    if (!data) return [];
    // 2026-09-11, Lino: "die kachel die mit 'im kasten' markiert wurde
    // muss an der position bleiben, sie darf NICHT nach unten wandern" —
    // dropped the old "completed sinks to the end" rule this page used to
    // mirror from share_view.py's scenes_in. Now that scene status pushes
    // live via Pusher (see project_subshot_scene_completed_live memory),
    // that jump became visible in real time instead of only after a
    // reload, which is what made it read as broken/laggy. Plain sort_order
    // now, same as the authenticated app's own scenesBySectionId.
    return data.scenes.filter((s) => s.section_id === sectionId).sort((a, b) => a.sort_order - b.sort_order);
  }

  // 2026-09-08 — Shot-Reihenfolge counterpart to scenesFor above, same
  // shooting_order/sort_order fallback as the authenticated app's own
  // scenesInShootingOrder (projects/[id]/page.tsx) — a completely separate
  // field from sort_order, so toggling back to Szenen-Reihenfolge never
  // loses anything. Keeps the same "completed sinks to the end" grouping
  // scenesFor already applies, so shotOrderMode really is the ONLY thing
  // that changes, matching that page's own 1:1 parity comment.
  function scenesInShootingOrder(sectionId: string | null) {
    if (!data) return [];
    // No "completed sinks to the end" split here either — see scenesFor's
    // 2026-09-11 comment above, same reasoning applies to Shot-Reihenfolge.
    return data.scenes.filter((s) => s.section_id === sectionId).sort((a, b) => {
      if (a.shooting_order != null && b.shooting_order != null) return a.shooting_order - b.shooting_order;
      if (a.shooting_order != null) return -1;
      if (b.shooting_order != null) return 1;
      return a.sort_order - b.sort_order;
    });
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

  // 2026-09-07 fix, Lino: "und drückt man auf eine markierung muss es in
  // der sidebar der kommentar gehighlighted werden" — clicking an existing
  // mark used to unconditionally flip `mode` to "highlight" (opening the
  // separate PublicAnnotationsSidebar), the only place highlights showed
  // before. Now that an open shotlist's own highlights render right in
  // PublicSectionComments (see `sectionHighlightAnnotations` below), forcing
  // that OTHER sidebar open too would just be a second, redundant panel
  // fighting the section sidebar for the same screen edge — so `onMark`
  // defaults to the old behavior (no open section to show them in any other
  // way) but the open-section render below passes its own override that
  // just pulses the entry in place instead.
  function renderScenes(scenes: typeof unsectioned, onMark?: (ann: Annotation) => void) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
        {scenes.map((scene) => (
          <PublicSceneCard
            key={scene.id}
            scene={scene}
            displayNumber={sceneNumberIn(scene.section_id).get(scene.id)}
            shots={shotsByScene.get(scene.id) ?? []}
            annotations={annotationsByScene.get(scene.id) ?? []}
            memberById={memberById}
            token={token}
            unlockToken={unlockToken}
            onMarkClick={
              onMark ??
              ((ann) => {
                setMode("highlight");
                pulseAnnotation(ann.id);
              })
            }
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

  // 2026-09-08 follow-up audit fix: PublicAnnotationsSidebar is now only
  // ever rendered when no shotlist is open (see its render condition below —
  // it used to also pop up on top of the section-comments sidebar if a
  // visitor clicked "Textmarker" while a shotlist was already open, two
  // opaque `fixed right-0` panels stacking and blocking each other's
  // buttons). Reserve calc mirrors that same condition so it never reserves
  // space for a sidebar that in fact isn't showing.
  const highlightSidebarReserve =
    mode === "highlight" && openSectionId === null ? (highlightSidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : HIGHLIGHT_SIDEBAR_WIDTH) : 0;
  const sectionSidebarReserve = openSectionId !== null ? (sectionSidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : SECTION_SIDEBAR_WIDTH) : 0;
  const contentSidebarReserve = Math.max(highlightSidebarReserve, sectionSidebarReserve);

  return (
    <div className="min-h-screen bg-[#161616] text-white" style={{ "--accent": data?.project_color ?? "#3875bd" } as React.CSSProperties}>
      <div
        // 2026-09-10 — reserve is desktop-only now (md:pr-[var(...)]— both
        // sidebars are bottom sheets on mobile, not a right-side column, so
        // content never needs to make room for them there at all; only the
        // CSS var itself is set unconditionally (harmless without the class
        // consuming it).
        className={`max-w-6xl mx-auto w-full px-4 sm:px-6 pt-8 pb-28 transition-[padding-right] duration-200 ${
          contentSidebarReserve ? "md:pr-[var(--sidebar-reserve)]" : ""
        }`}
        // 2026-09-08 follow-up audit fix: was capped at 45vw while the
        // sidebars themselves clamp at `max-w-[92vw]` — on anything narrower
        // than ~800px (i.e. exactly the "kleine Bildschirme" this feature
        // targets) the reserve was smaller than the sidebar's real on-screen
        // width, so content was still partly covered. Cap now matches.
        style={contentSidebarReserve ? ({ "--sidebar-reserve": `min(${contentSidebarReserve}px, 92vw)` } as React.CSSProperties) : undefined}
      >
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
            {/* 2026-09-08, Lino: "auf der preview seite der shotliste
                braucht es die team kachel oben nicht" — PublicTeamChips
                removed; shoot-date/location tiles unaffected. */}
            {(data.shoot_date || data.location_address) && (
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
                const scenes = shotOrderMode ? scenesInShootingOrder(openSection.id) : scenesFor(openSection.id);
                // 2026-09-07, Lino: "die markierungskommentare müssen doch
                // auch rechts in der sidebar auftauchen unter den normalen
                // kommentaren" — every highlight-kind annotation belonging
                // to a scene IN this open shotlist, same grouping
                // annotationsByScene already does per-scene, just flattened
                // back across every scene in this section.
                const sectionHighlightAnnotations = scenes.flatMap((s) => annotationsByScene.get(s.id) ?? []);
                return (
                  <div>
                    {/* 2026-09-10, Lino: "über dem 'zur übersicht' button
                        nochmals gross der titel des Videos" — moved above
                        the back button and bumped to match the page's own
                        h1 size (was a smaller h2 below the button). */}
                    <h2 className="text-2xl font-bold text-white mb-3">{openSection.name}</h2>
                    <button
                      onClick={() => setOpenSectionId(null)}
                      className="mb-4 text-sm text-white/60 hover:text-white flex items-center gap-1.5"
                    >
                      ← {t("scriptOverview.backToOverview")}
                    </button>
                    {/* 2026-09-10 fix — was data.reference_video_* (one
                        video for the whole project, every shotlist showed
                        the same one); now genuinely scoped to THIS
                        shotlist, see Section.reference_video_url's own doc
                        comment on the backend. */}
                    <PublicReferenceVideoBlock
                      url={openSection.reference_video_url}
                      thumbnailUrl={openSection.reference_video_thumbnail_url}
                      thumbnailFocusX={openSection.reference_video_thumbnail_focus_x}
                      thumbnailFocusY={openSection.reference_video_thumbnail_focus_y}
                    />
                    <div className="mb-4 max-w-xs">
                      <SegmentedControl
                        value={shotOrderMode ? "shots" : "scenes"}
                        onChange={(v) => setShotOrderMode(v === "shots")}
                        options={[
                          { value: "scenes", label: t("scriptOverview.sceneOrderTab") },
                          { value: "shots", label: t("scriptOverview.shotOrderTab") },
                        ]}
                      />
                    </div>
                    {renderScenes(scenes, (ann) => pulseAnnotation(ann.id))}
                    {/* 2026-09-07, several rounds of Lino feedback on this
                        one sidebar, in order: (1) "muss immer rechts als
                        sidebar verfügbar sein" — `fixed right-0`, not a
                        card in the document flow. (2) "soll komplett rechts
                        am browser rand sein und nicht die grösse der
                        kacheln beeinflussen" — NOT sharing a flex row with
                        the scene grid (that squeezed every tile's column
                        width to fit both in the same max-w-6xl column);
                        floats independently like PublicAnnotationsSidebar
                        already does, one z-step above it (z-[71] vs
                        [70]) as a tie-break for the rare case both are
                        open. (3) "die feedbackbox muss unten sein" —
                        PublicSectionComments itself now lays out as a
                        fixed header + scrolling history + a compose box
                        pinned at the very bottom, chat-style; this wrapper
                        just hands it the full fixed height to do that in,
                        no overflow of its own. (4) "buttons... werden von
                        kommentare aus/textmarker überblendet" — pb-24
                        clears the bottom-right Kommentar-Toolbar's own
                        `fixed right-[18px] bottom-[18px]` footprint, same
                        clearance PublicAnnotationsSidebar already reserves
                        for it. (5) "die markierungskommentare müssen auch
                        rechts in der sidebar auftauchen unter den normalen
                        kommentaren" — highlight-kind annotations for every
                        scene in this shotlist now render in this same
                        sidebar too (sectionHighlightAnnotations above),
                        which is also why renderScenes above gets a custom
                        onMark override: a mark click pulses the entry
                        right here instead of switching `mode` to open the
                        separate, now-redundant PublicAnnotationsSidebar. */}
                    <div
                      // 2026-09-10 — same mobile-bottom-sheet/desktop-column
                      // split as PublicAnnotationsSidebar.tsx (see its own
                      // doc comment for the reasoning); every differing
                      // property gets an explicit md: override. `pb-24`
                      // unprefixed (2026-09-10 follow-up fix, Lino: "wird...
                      // vom 'kommentar aus/textmarker' und dem kommentar
                      // ein/ausblenden button verdeckt") — the compose box
                      // pinned at the bottom of PublicSectionComments' own
                      // flex column needs the SAME clearance from the
                      // floating `fixed ... bottom-[18px]` toolbar/button
                      // footprint on mobile that desktop already had.
                      className={`fixed z-[71] bg-[#1a1a1a] border-white/10 transition-[width] duration-200 flex flex-col
                        inset-x-0 bottom-0 max-h-[80vh] rounded-t-2xl border-t pb-24
                        md:inset-x-auto md:right-0 md:top-0 md:bottom-0 md:max-h-none md:rounded-t-none md:border-t-0 md:border-l md:pt-16
                        ${sectionMobileOpen ? "" : "hidden"} md:flex
                        ${sectionSidebarCollapsed ? "md:w-12" : "md:w-[380px] md:max-w-[92vw] md:px-3"}`}
                    >
                      {/* 2026-09-08, Lino: sidebar overlapped the shotlist
                          tiles on small screens — collapse tab shrinks this
                          to a slim edge strip, mirrored as right-padding on
                          the content column above (contentSidebarReserve).
                          Follow-up fix same day: arrow direction was
                          backwards (open = pointing right into the panel,
                          collapsed = pointing left to invite re-opening),
                          and the parent's overflow-hidden while collapsed
                          was clipping this button itself (it pokes out past
                          the left edge via `-left-3`) — dropped, nothing
                          left to overflow once the content div below is
                          hidden instead of unmounted. 2026-09-10 —
                          desktop-only now, see the mobile sheet header
                          right below for the phone equivalent. */}
                      <button
                        type="button"
                        onClick={() => setSectionSidebarCollapsed((v) => !v)}
                        title={t(sectionSidebarCollapsed ? "previewPage.expandSidebar" : "previewPage.collapseSidebar")}
                        aria-label={t(sectionSidebarCollapsed ? "previewPage.expandSidebar" : "previewPage.collapseSidebar")}
                        className="hidden md:flex absolute top-1/2 -left-3 -translate-y-1/2 z-10 w-6 h-10 rounded-full bg-[#2a2a2a] border border-white/10 items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          {sectionSidebarCollapsed ? <path d="M15 6l-6 6 6 6" /> : <path d="M9 6l6 6-6 6" />}
                        </svg>
                      </button>
                      {/* 2026-09-10 — mobile sheet header: drag-handle
                          affordance + close, same shape as
                          PublicAnnotationsSidebar's own mobile header
                          (PublicSectionComments already renders its own
                          "Feedback (N)" title inside itself, so no
                          duplicate title needed here). */}
                      <div className="md:hidden flex items-center justify-center pt-2 pb-1 shrink-0">
                        <div className="w-10 h-1 rounded-full bg-white/20" />
                      </div>
                      <div className="md:hidden flex justify-end px-3 pb-1 shrink-0">
                        <button
                          onClick={() => setSectionMobileOpen(false)}
                          className="rounded-full p-1.5 text-white/50 hover:text-white hover:bg-white/10 transition-colors"
                          aria-label={t("modal.closeAria")}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <path d="M18 6 6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      {/* 2026-09-08 follow-up audit fix: was conditionally
                          MOUNTING/unmounting PublicSectionComments itself on
                          collapse, which wiped its local draft/myDrafts/
                          confirm-timer state — a typed-but-unsaved comment
                          (or an already-saved-but-not-yet-sent draft) would
                          silently vanish from the UI on collapse. Stays
                          mounted always now, same "hide via a CSS class"
                          approach PublicAnnotationsSidebar already uses for
                          its own collapse. `collapsed` is a desktop-only
                          concept (2026-09-10) — on mobile this div is only
                          ever in the DOM at all while sectionMobileOpen
                          (the whole outer sheet is hidden otherwise), so it
                          always shows there regardless of `collapsed`'s
                          stale desktop value.

                          2026-09-10 fix, Lino: "kann man die kommentare
                          nicht scrollen" (mobile) — PublicSectionComments
                          relies on ITS OWN `h-full` (a percentage height)
                          to get a bounded box to scroll its middle region
                          within; on mobile that height comes from THIS
                          div's `flex-1` inside the sheet's `flex flex-col`
                          column, one extra percentage-height hop deeper
                          than desktop's directly-viewport-anchored `fixed
                          top-0 bottom-0` sidebar. That extra hop is exactly
                          the kind of thing mobile Safari doesn't always
                          resolve — `overflow-y-auto` directly on this div
                          is a robust fallback scroll container regardless
                          of whether the inner `h-full` height actually
                          resolves. `md:overflow-visible` keeps desktop
                          byte-for-byte unchanged (no overflow class here
                          before this fix) — desktop's own sticky-header/
                          compose-box split lives entirely inside
                          PublicSectionComments' own working `h-full`
                          chain, untouched. */}
                      <div className={sectionSidebarCollapsed ? "hidden md:hidden" : "flex-1 min-h-0 overflow-y-auto md:overflow-visible px-3 md:px-0"}>
                        {/* Lino's explicit ask: leaving feedback here works
                            "exactly like the Ideas page" — one comment
                            thread for the whole opened shotlist, not per
                            scene. */}
                        <PublicSectionComments
                          section={openSection}
                          comments={commentsBySection.get(openSection.id) ?? []}
                          highlightAnnotations={sectionHighlightAnnotations}
                          highlightedId={highlightedId}
                          onSelectHighlight={(ann) => pulseAnnotation(ann.id)}
                          onDeleteHighlight={handleDeleteAnnotation}
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

      {/* 2026-09-08 follow-up audit fix: gated on openSectionId===null too —
          this sidebar is redundant (and, worse, visually stacks on top of
          and blocks) the section-comments sidebar whenever a shotlist is
          open, since that one already shows the same highlights inline (see
          `sectionHighlightAnnotations` above). The "Textmarker" toolbar
          button/mode still needs to stay active while a shotlist is open —
          it's what enables selecting text to CREATE a new highlight
          (handleMouseUp effect above) — only the separate sidebar itself is
          suppressed. */}
      {mode === "highlight" && openSectionId === null && (
        <PublicAnnotationsSidebar
          annotations={annotations}
          onDelete={handleDeleteAnnotation}
          onSelect={(ann) => pulseAnnotation(ann.id)}
          highlightedId={highlightedId}
          onClose={() => setMode("off")}
          collapsed={highlightSidebarCollapsed}
          onToggleCollapsed={() => setHighlightSidebarCollapsed((v) => !v)}
          mobileOpen={highlightMobileOpen}
          onCloseMobile={() => setHighlightMobileOpen(false)}
        />
      )}

      {/* 2026-09-10, Lino: "die kommentarleiste soll [auf mobile] anders
          ein und ausblendbar sein... mit einem button öffnet sich die
          kommentarspalte" — the one dedicated way to open whichever
          comment sheet is currently relevant on a phone (md:hidden — the
          desktop edge-tabs on both sidebars cover this there already).
          Bottom-LEFT so it never collides with the existing off/Textmarker
          toolbar pill opposite it. Only rendered while a sheet actually
          has something to open, same conditions as the two sidebars
          themselves. */}
      {((mode === "highlight" && openSectionId === null) || openSectionId !== null) && (
        <button
          type="button"
          onClick={() => (openSectionId !== null ? setSectionMobileOpen(true) : setHighlightMobileOpen(true))}
          aria-label={t("previewPage.openComments")}
          className="md:hidden fixed left-[18px] bottom-[18px] z-[80] w-12 h-12 rounded-full bg-[#212121] border border-white/10 shadow-2xl flex items-center justify-center text-white/80"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
          {(openSectionId !== null ? (commentsBySection.get(openSectionId)?.length ?? 0) : annotations.length) > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--accent)] text-white text-[10px] font-bold flex items-center justify-center">
              {openSectionId !== null ? (commentsBySection.get(openSectionId)?.length ?? 0) : annotations.length}
            </span>
          )}
        </button>
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
