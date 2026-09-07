"use client";

import { Suspense, useEffect, useMemo, useRef, useState, use as usePromise } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  pointerWithin,
  rectIntersection,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragCancelEvent,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
// Aliased to avoid shadowing the browser's global `CSS` (this file uses
// `document.querySelector` with data attributes elsewhere in the app's
// history and may again).
import { CSS as DndCSS } from "@dnd-kit/utilities";
import { useApi } from "@/lib/useApi";
import { useLanguage } from "@/lib/i18n";
import { ApiError } from "@/lib/api";
import { setNavCache, takeNavCache } from "@/lib/navCache";
import type { Annotation, Member, PostproductionStatus, ProjectDetail, Scene, Section, Shot, Video } from "@/lib/types";
import { SortableSceneCard } from "@/app/components/SortableSceneCard";
import { SceneCard } from "@/app/components/SceneCard";
import { SceneEditModal } from "@/app/components/SceneEditModal";
import { SceneTable } from "@/app/components/SceneTable";
import { ProjectInfoBox } from "@/app/components/ProjectInfoBox";
import { ProjectInfoTile } from "@/app/components/ProjectInfoTile";
import { TeamPanel } from "@/app/components/TeamPanel";
import { NotionImportModal } from "@/app/components/NotionImportModal";
import { ShareLinkModal } from "@/app/components/ShareLinkModal";
import { EdgeNavButton } from "@/app/components/EdgeNavButton";
import { TimecodeBar } from "@/app/components/TimecodeBar";
import { IdeaGrid, type IdeaGridHandle } from "@/app/components/IdeaGrid";
import { AnnotationsPanel } from "@/app/components/AnnotationsPanel";
import { Modal } from "@/app/components/ui/Modal";
import { AppShell } from "@/app/components/AppShell";
import { AuthImage } from "@/app/components/AuthImage";
import { SegmentedControl } from "@/app/components/ui/SegmentedControl";
import { Button, IconButton } from "@/app/components/ui/Button";
import { ConfirmDialog } from "@/app/components/ui/ConfirmDialog";
import { useToast } from "@/app/components/ui/Toast";
import { Input } from "@/app/components/ui/Field";
import { Collapsible } from "@/app/components/ui/Collapsible";
import { Menu, MenuItem } from "@/app/components/ui/Menu";

// pointerWithin requires the cursor to be exactly inside a droppable's
// rect — cards have gap-4 between them, so hovering in that gap (very easy
// to do, especially moving fast) found nothing at all, which is exactly
// what Lino described as "man muss mega genau treffen". Falling back to
// rectIntersection (does the DRAGGED CARD's rect merely overlap a
// droppable's rect at all, not the exact pointer) when pointerWithin comes
// up empty keeps pointerWithin's precise cross-section behavior (see the
// comment at the DndContext below — that's still the primary check, this
// only fills the gaps) while making near-misses still register.
const sceneCollisionDetection: CollisionDetection = (args) => {
  // Filter out the dragged item's own id AND section-drop-zone ids from
  // "real" candidate lists. Two separate real bugs found here:
  // 1) (full-width Projektinfo tile) its translated rect stays just as
  //    wide as its original col-span-full layout, and rectIntersection
  //    compares that WHOLE rect against every droppable, not just the
  //    cursor position — self-overlapping its own still-registered
  //    droppable constantly, which without the active-id filter resolved
  //    as "over" = itself more often than any real target.
  // 2) (2026-07-13) a section's empty-space drop zone ("section-drop:...")
  //    has a rect that can span a wide area of the section — once a
  //    dragged card's cursor exits a SHORT neighboring card's actual
  //    bounding box (very possible: two same-row cards can have very
  //    different heights, e.g. one with an image+long description, one
  //    without either — dragging the tall one toward the short one, the
  //    cursor is very likely below the short card's bottom edge at some
  //    point), rectIntersection kept matching the section-drop zone
  //    instead, which used to be returned immediately — the REAL
  //    neighboring card was never found again for the rest of the drag.
  //    Reported: "man muss immer Kacheln von aussen nach innen schieben
  //    aber kann sie nicht von innen nach aussen schieben" — confirmed via
  //    a real repro with mismatched card heights (indicator vanished
  //    entirely once past the short card's bottom edge, drop silently did
  //    nothing). Real scene/card hits now always win over a section-drop
  //    hit, from every detection strategy in turn, with closestCenter
  //    (nearest droppable CENTER, regardless of rect overlap at all) added
  //    as a new last resort before ever falling back to section-drop.
  const activeId = args.active.id;
  const isRealCard = (c: { id: string | number }) => c.id !== activeId && !String(c.id).startsWith("section-drop:");

  // 2026-07-15, Lino: dragging a tile toward the END of a section (right
  // before the NEXT section starts) was still flaky after the h-24
  // SectionDropZone fix above — "der indikator springt herum... landet im
  // abschnitt darunter", and the indicator line visibly touched the NEXT
  // section's title. Root cause: every fallback below (rectIntersection,
  // closestCenter) searches across EVERY droppable in the whole page, so
  // once the cursor left the last real card of section A, "closest card"
  // could resolve to the FIRST card of section B — which reads on screen
  // as a "top" edge line sitting ~9px above that card, i.e. functionally
  // on top of B's own header (SortableSceneCard's insertionEdge==="top"
  // offset). That's a different, wrong target ("first item of B") from
  // what the user is aiming for ("last item of A").
  //
  // Fix: figure out which section's own vertical span (top of its first
  // card down through the bottom of ITS OWN SectionDropZone/TableDropZone
  // — already generously tall, see that component's comment) the pointer
  // is currently inside, via data.sectionId tagged on every card/dropzone
  // (see SortableSceneCard/SectionDropZone/TableDropZone), and restrict
  // every detection strategy to that section's droppables only. A card
  // from a different section can then never win, no matter how the
  // fallback chain resolves — the ambiguity is removed before it can
  // happen, not patched after the fact.
  let scopedContainers = args.droppableContainers;
  if (args.pointerCoordinates) {
    const pointerY = args.pointerCoordinates.y;
    const sectionIdOf = (c: (typeof args.droppableContainers)[number]) =>
      (c.data.current as { sectionId?: string | null } | undefined)?.sectionId;
    const ranges = new Map<string, { top: number; bottom: number }>();
    for (const c of args.droppableContainers) {
      const sectionId = sectionIdOf(c);
      if (sectionId === undefined) continue; // not a section-scoped droppable at all
      const rect = args.droppableRects.get(c.id);
      if (!rect) continue;
      const key = sectionId ?? "__unsectioned__";
      const range = ranges.get(key);
      if (!range) ranges.set(key, { top: rect.top, bottom: rect.bottom });
      else {
        range.top = Math.min(range.top, rect.top);
        range.bottom = Math.max(range.bottom, rect.bottom);
      }
    }
    // 2026-07-15 follow-up, verified via a real Playwright drag trace: the
    // raw per-section ranges above still left a real gap unmatched — the
    // ~20px pb-5 padding AFTER a section's own SectionDropZone before the
    // next section's wrapper starts. A pointer resting in exactly that
    // sliver matched no range at all, fell through to the old unscoped
    // fallback, and closestCenter picked the next section's nearest card —
    // reproduced landing scenes in the wrong section even after the
    // original scoping fix. Extending each section's range to the MIDPOINT
    // with its neighbors (first section's top and last section's bottom
    // opened to +/-Infinity) guarantees every possible pointerY maps to
    // exactly one section, with zero gap ever falling outside all ranges —
    // not just a bigger hit area like the h-24 SectionDropZone attempt.
    const sorted = [...ranges.entries()].sort((a, b) => a[1].top - b[1].top);
    const extended = new Map<string, { top: number; bottom: number }>();
    for (let i = 0; i < sorted.length; i++) {
      const [key, range] = sorted[i];
      const prev = sorted[i - 1]?.[1];
      const next = sorted[i + 1]?.[1];
      const top = prev ? (prev.bottom + range.top) / 2 : -Infinity;
      const bottom = next ? (range.bottom + next.top) / 2 : Infinity;
      extended.set(key, { top, bottom });
    }
    let matchedKey: string | null = null;
    for (const [key, range] of extended) {
      if (pointerY >= range.top && pointerY <= range.bottom) {
        matchedKey = key;
        break;
      }
    }
    if (matchedKey) {
      scopedContainers = args.droppableContainers.filter((c) => (sectionIdOf(c) ?? "__unsectioned__") === matchedKey);
    }
  }
  const scopedArgs = scopedContainers === args.droppableContainers ? args : { ...args, droppableContainers: scopedContainers };

  const pointerHits = pointerWithin(scopedArgs);
  const pointerCardHits = pointerHits.filter(isRealCard);
  if (pointerCardHits.length > 0) return pointerCardHits;

  const rectHits = rectIntersection(scopedArgs);
  const rectCardHits = rectHits.filter(isRealCard);
  if (rectCardHits.length > 0) return rectCardHits;

  const closestCardHits = closestCenter(scopedArgs).filter(isRealCard);
  if (closestCardHits.length > 0) return closestCardHits;

  // Nothing real anywhere nearby — genuinely an empty/near-empty section,
  // or past the end of the list. Fall back to whatever section-drop zone
  // pointerWithin/rectIntersection found, same as before this fix.
  const pointerNonActive = pointerHits.filter((c) => c.id !== activeId);
  if (pointerNonActive.length > 0) return pointerNonActive;
  return rectHits.filter((c) => c.id !== activeId);
};

// 2026-08-26 — the Ideas⇄Scenes swipe transition (was here as
// viewPanelVariants) is gone, see the "wir entfernen uns von
// Übergangsanimationen" note further down at activeView's declaration.

// 2026-07-17, Lino: "jeder workflow seite eine andere hintergrundfarbe...",
// dann 2026-08-07: "hintergrund bei der Ideen seite ist immer noch nicht
// schwarz" — der dezente Goldton für Ideen wurde wieder verworfen, jede
// Seite (inkl. Ideen) nutzt jetzt einfach AppShell's transparente
// Standard-Basis (das globale #161616 aus layout.tsx). Kein eigener Tint
// mehr nötig.

// 2026-07-31, Lino: "wenn man in den notifications auf einen kommentar
// klickt, soll es direkt die kachel öffnen ... egal wo man ist auf der
// seite" — the OLD approach (window.location.search read in a mount-only
// useEffect, see this page's own now-superseded doc comment) only ever
// caught a genuinely fresh page load; clicking a notification link while
// ALREADY on this exact project page changes the URL's query string
// without remounting the page (same route), so that one-time read never
// fired again. useSearchParams() IS reactive to a query-only navigation
// like that — it just needs its own small Suspense boundary, which this
// isolated read-only watcher provides without wrapping the whole page (the
// reason this page avoided the hook entirely before now).
function NotificationParamsWatcher({
  onParams,
}: {
  onParams: (params: { openIdea: string | null; openScene: string | null; openComment: string | null }) => void;
}) {
  const searchParams = useSearchParams();
  const openIdea = searchParams.get("openIdea");
  const openScene = searchParams.get("openScene");
  const openComment = searchParams.get("openComment");
  useEffect(() => {
    if (!openIdea && !openScene && !openComment) return;
    onParams({ openIdea, openScene, openComment });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openIdea, openScene, openComment]);
  return null;
}

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const api = useApi();
  const toast = useToast();
  const { t } = useLanguage();
  const router = useRouter();

  const [data, setData] = useState<ProjectDetail | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  // 2026-07-27, Todoist #356 — needed to gate the "Intern abgenommen/
  // abgelehnt" buttons to Projektleiter/Owner only, same pattern as
  // postproduction/page.tsx's canEditStatus/canEditDeadline.
  const [myRole, setMyRole] = useState<Member["role"] | null>(null);
  const [creatingScene, setCreatingScene] = useState(false);
  // "Zwischenschritt" (mirrors the iOS app's addSceneButton menu) — a
  // lighter connective-beat scene variant, creation-time choice only, see
  // SceneEditModal's isIntermediateStep prop.
  const [creatingIntermediateStep, setCreatingIntermediateStep] = useState(false);
  const [editingScene, setEditingScene] = useState<Scene | null>(null);
  // 2026-07-18, Lino: "klickt man auf eine Notification soll man direkt zu
  // dieser Seite und Kachel kommen" — autoOpenIdeaId is consumed by
  // IdeaGrid itself once its ideas have loaded (passed straight through as
  // a prop); autoOpenSceneId/autoOpenCommentId are consumed further down
  // (see the effect right after handleAnnotationSelect, which needs
  // goToScenes/goToIdeas/setHighlightedAnnotationId — all declared later
  // in this component than this point). Fed by NotificationParamsWatcher
  // (see its own doc comment above for why a reactive useSearchParams()
  // read replaced the old mount-only window.location.search one — that
  // version silently did nothing when a notification was clicked while
  // already on this exact project page).
  const [autoOpenIdeaId, setAutoOpenIdeaId] = useState<string | null>(null);
  const [autoOpenSceneId, setAutoOpenSceneId] = useState<string | null>(null);
  const [autoOpenCommentId, setAutoOpenCommentId] = useState<string | null>(null);
  // Live-refreshed view of editingScene (2026-07-16, Lino: AI-Bild
  // aktualisiert sich nicht in der offenen Karte) — editingScene itself is
  // just a one-time snapshot of WHICH scene id got opened (see the 12s
  // poll's setData below, which never touches editingScene directly), so
  // this re-resolves it against the live `data.scenes` on every render
  // instead. Passed to the modal so it picks up background changes
  // (image_url flipping once an AI generation finishes, image_generating
  // flipping back to false) without waiting for the modal to be closed and
  // reopened. Originally "display purposes ONLY" (handleSceneUpdated's own
  // before/after cascade-delta comparison further down used the frozen
  // `editingScene` instead) — 2026-09-07 fix: that was actually a bug, not
  // a deliberate choice — a scene can autosave+call handleSceneUpdated
  // MULTIPLE times in one still-open session, and `editingScene` staying
  // frozen at session-open meant a SECOND time edit computed its cascade
  // delta as the cumulative change since the modal opened rather than
  // since the last save. `liveEditingScene` (this variable) is exactly the
  // right baseline for that too, see handleSceneUpdated's own comment.
  const liveEditingScene = editingScene ? (data?.scenes.find((s) => s.id === editingScene.id) ?? editingScene) : null;
  const [deleteScene, setDeleteScene] = useState<Scene | null>(null);
  const [deleteSection, setDeleteSection] = useState<Section | null>(null);
  // 2026-09-07, Lino: "ich kann 'ohne abschnitte' nicht löschen, das muss
  // man auch löschen können!" — "Ohne Abschnitt" isn't a real Section row
  // (see the "__unsectioned__" sentinel elsewhere on this page), so there's
  // nothing for deleteSection/confirmDeleteSection's own DELETE /sections/
  // {id} to target. "Deleting" it means bulk-deleting every scene currently
  // sitting in that bucket — plain boolean (not a Scene[] snapshot) since
  // the confirm handler below always re-reads the CURRENT `unsectioned`
  // list at click time, not whatever it was when the dialog opened.
  const [deleteUnsectioned, setDeleteUnsectioned] = useState(false);
  // 2026-09-07, Lino: "2 sortierfunktionien 1. die Szenenreihenfolge 2.
  // Shotreihenfolge. diese 2 sortierungen kann man unabhäng voneinander
  // sortieren" — which of the two views an opened (real) Section shows.
  // Deliberately a single shared toggle rather than per-section state: it
  // resets to the scene view on its own the moment you leave the section
  // (component unmounts nothing, but re-entering a DIFFERENT section
  // showing the shot-order view of a section you weren't even looking at
  // would be confusing) by being reset in the "back to overview" handler.
  const [shotOrderMode, setShotOrderMode] = useState(false);
  const [sendToPostproduction, setSendToPostproduction] = useState<Section | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  async function goToProjectsWithTransition() {
    // 2026-08-26 — used to set an sessionStorage flag + wait 220ms so
    // projects/page.tsx could play a matching enter-slide; both sides of
    // that are gone now (see [[project_subshot_web_speed_and_correctness_2026-08-25]]),
    // navigation is instant.
    router.push("/projects");
  }
  const ideaGridRef = useRef<IdeaGridHandle>(null);
  // 2026-07-17, Lino: "rechts ein Pfeil-Button (Script/Shotlist Editor)...
  // links ein Pfeil-Button (Ideen) zurück" — replaces the old scroll-
  // position-driven `viewingIdeas` heuristic (the Ideen grid and the
  // Scripting-Tool used to share one continuously-scrolled page) with an
  // explicit two-panel view the user switches between (now a plain
  // conditional render, no transition — see 2026-08-26 note above). Also
  // still drives the Teilen button's kind (still "always shares whichever
  // page you're on") and the FAB.
  // 2026-07-17, Lino: "diese Buttons müssen IMMER sichtbar sein damit man
  // im Workflow vor und zurück kann" — der "zurück zu Szenen"-Button auf
  // der Postproduction-Seite (echte eigene Route) hinterlässt hier ein
  // sessionStorage-Flag statt eines URL-Query-Params (kein Suspense-
  // Wrapper um useSearchParams auf dieser Seite, siehe postproduction/
  // page.tsx's eigener Kommentar dazu), damit diese Seite nicht einfach
  // auf "ideas" zurückfällt, sondern wirklich auf der Szenenansicht landet.
  const returnViewRef = useRef<string | null | undefined>(undefined);
  if (returnViewRef.current === undefined) {
    const v = typeof window !== "undefined" ? sessionStorage.getItem("subshot:returnView") : null;
    if (v) sessionStorage.removeItem("subshot:returnView");
    returnViewRef.current = v;
  }
  const initialReturnView = returnViewRef.current;
  const [activeView, setActiveView] = useState<"ideas" | "scenes">(initialReturnView === "scenes" ? "scenes" : "ideas");
  // 2026-08-30 — Skript-Auswahlübersicht (Lino: die Skript-Seite soll die
  // abgenommenen Ideen erst als klickbare Kachel-Übersicht zeigen, Klick
  // öffnet dann die eigentliche Shot-Planung NUR für diesen einen
  // Abschnitt) — null = Übersicht, sonst die id des geöffneten Abschnitts.
  // Reset beim Verlassen der Skript-Seite (siehe goToIdeas unten), damit
  // ein erneuter Besuch immer wieder bei der Übersicht startet.
  const [openSectionId, setOpenSectionId] = useState<string | null>(null);
  // 2026-09-07 fix, Lino: "wenn ich einen Abschnitt erstelle und in diesen
  // hinein gehen, müssen ALLE neuen Szenen in das geöffnete Projekt [sic,
  // gemeint: den geöffneten Abschnitt]" — the FAB's "Neue Szene"/
  // "Zwischenschritt"/"Info" never told SceneEditModal/createProjectInfoScene
  // which section (if any) was currently open, so every new scene always
  // landed unsectioned regardless of which section's shotlist you were
  // actually looking at. "__unsectioned__" (the sentinel for the "Ohne
  // Abschnitt" bucket, see its own SectionBlock render below) deliberately
  // maps to `null` here too — same as the overview (openSectionId === null),
  // a new scene created from either place has no real section to inherit.
  const currentSectionId = openSectionId && openSectionId !== "__unsectioned__" ? openSectionId : null;
  const shareKind: "storyboard" | "ideas" = activeView === "ideas" ? "ideas" : "storyboard";
  function goToScenes() {
    setActiveView("scenes");
  }
  function goToIdeas() {
    setActiveView("ideas");
    setOpenSectionId(null);
  }
  async function goToPostproductionWithTransition() {
    // 2026-08-26 — used to flip the scenes panel to its "exit" animation
    // state first (see [[project_subshot_web_speed_and_correctness_2026-08-25]]
    // for why that's gone); the prefetch below still fires and is still
    // awaited (capped at 0.8s), since warming navCache before the target
    // page mounts is a real speed win independent of any animation — the
    // target page renders instantly instead of showing its own "Lädt…" on
    // arrival. Just no longer padded with a 220ms floor to match an exit
    // animation's duration.
    const prefetch = (async () => {
      try {
        // 2026-08-31 — perf: one bulk listProjectVideos call instead of one
        // listVideos per postproduction section, same fix as the
        // Postproduction page's own load() (see its doc comment).
        const [project, projectMembers, me, projectAnnotations, allVideos] = await Promise.all([
          api.projectDetail(id),
          api.members(id),
          api.me(),
          api.listAnnotations(id),
          api.listProjectVideos(id),
        ]);
        const videosBySection: Record<string, Video[]> = {};
        for (const video of allVideos) {
          (videosBySection[video.section_id] ??= []).push(video);
        }
        setNavCache(`postpro:${id}`, {
          project,
          members: projectMembers,
          myUserId: me.id,
          annotations: projectAnnotations,
          videosBySection,
        });
      } catch {
        // Reiner Optimierungs-Pfad — schlägt der Prefetch fehl, lädt die
        // Zielseite beim Mounten einfach ganz normal selbst nach.
      }
    })();
    // Nie länger als ~0.8s auf ein langsames Netz warten — lieber eine
    // Zielseite, die noch kurz selbst nachladen muss, als eine Navigation,
    // die spürbar hängt.
    await Promise.race([prefetch, new Promise((resolve) => setTimeout(resolve, 800))]);
    router.push(`/projects/${id}/postproduction`);
  }
  const [creatingSection, setCreatingSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  const [editingSection, setEditingSection] = useState<Section | null>(null);
  const [editSectionName, setEditSectionName] = useState("");
  const [showTeam, setShowTeam] = useState(false);
  const [showNotion, setShowNotion] = useState(false);
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  // 2026-07-14, comment mode in the logged-in app (mirrors the public
  // preview page's sidebar) — which markup is currently "active" (clicked
  // in the sidebar, or clicked directly on the page), both places read
  // this to decide what to visually brighten/pulse.
  const [highlightedAnnotationId, setHighlightedAnnotationId] = useState<string | null>(null);
  const annotationsByScene = useMemo(() => {
    const map = new Map<string, Annotation[]>();
    for (const a of annotations) {
      if (a.status !== "open" || !a.scene_id) continue;
      const list = map.get(a.scene_id) ?? [];
      list.push(a);
      map.set(a.scene_id, list);
    }
    return map;
  }, [annotations]);
  // Shared by both the sidebar (clicking an entry) and a direct click on a
  // markup on the page — pulses/brightens it and scrolls the OWNING SCENE
  // CARD into view (not the tiny markup itself, which the pulse animation
  // already draws the eye to once it's on-screen).
  function handleAnnotationSelect(annotation: Annotation) {
    setHighlightedAnnotationId(annotation.id);
    if (annotation.scene_id) {
      // The scene tile lives in the Scenes panel, which only exists in the
      // DOM while activeView === "scenes" (AnimatePresence mode="wait"
      // unmounts the Ideas panel first, then mounts this one) — switch,
      // then wait for that exit+enter cycle before scrolling to it.
      goToScenes();
      setTimeout(() => {
        document.querySelector(`[data-sortable-scene-id="${annotation.scene_id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 600);
    } else if (annotation.idea_id) {
      // 2026-07-22, Lino: "muss man auf den Kommentar in der Seitenleiste
      // drücken können und es öffnet sich die Kachel mit dem Kommentar und
      // der Kommentar wird gehighlighted" — same shape as the scene_id
      // branch above (switch panel, wait for the exit+enter cycle,
      // ideaGridRef only exists once the Ideas panel is actually mounted),
      // then IdeaGrid's own openIdea opens IdeaFocusView on that idea;
      // highlightedAnnotationId flows all the way down to
      // IdeaFeedbackPanel, which does its own scrollIntoView once the
      // matching entry is in the DOM.
      goToIdeas();
      setTimeout(() => ideaGridRef.current?.openIdea(annotation.idea_id!), 600);
    }
  }
  // 2026-07-31, Lino: "wenn man in den notifications auf einen kommentar
  // klickt, soll es direkt die ideenkachel oder szenenkachel ... öffnen mit
  // dem kommentar" — autoOpenIdeaId already opens the right idea (passed
  // straight to IdeaGrid as a prop, unrelated to this effect); this only
  // covers autoOpenSceneId itself. The actual highlight (both idea and
  // scene) is set by the SEPARATE effect right below, deliberately NOT
  // combined with this one — IdeaGrid clears autoOpenIdeaId itself via its
  // own onAutoOpened callback (see that prop wiring below) well before a
  // delayed highlight-set would fire, and an effect's cleanup cancels any
  // pending setTimeout the moment ONE of its dependencies changes; keying
  // the highlight off autoOpenIdeaId too would have that early clear cancel
  // the highlight before it ever appears. autoOpenCommentId's own lifecycle
  // is independent of both, so it's safe as the sole trigger.
  //
  // Scene case deliberately reuses handleAnnotationSelect's OWN scene
  // branch (goToScenes + scroll-into-view on the card) rather than the
  // OLDER "open SceneEditModal" behavior autoOpenSceneId used to trigger
  // unconditionally — SceneEditModal has no comment UI at all (see this
  // page's own investigation before this fix), so opening it would show
  // nothing resembling "the comment". Only falls back to the edit modal
  // when there's genuinely no comment id (a notification kind that isn't
  // actually comment-related, or a pre-existing unread notification from
  // before comment_id existed) — same graceful degradation as everywhere
  // else in this codebase rather than a broken deep link.
  useEffect(() => {
    if (!autoOpenSceneId || !data) return;
    const scene = data.scenes.find((s) => s.id === autoOpenSceneId);
    if (!scene) return;
    if (autoOpenCommentId) {
      setShowAnnotations(true);
      goToScenes();
      setTimeout(() => {
        document.querySelector(`[data-sortable-scene-id="${scene.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 600);
    } else {
      setEditingScene(scene);
    }
    setAutoOpenSceneId(null);
    router.replace(`/projects/${id}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenSceneId, data]);
  // Fires the actual highlight/pulse for EITHER kind, ~700ms after
  // whichever panel-switch above needs to settle first (idea card opening,
  // or the scene grid scroll-into-view) — see this block's own doc comment
  // above for why this has to be fully decoupled from autoOpenIdeaId's own
  // (much earlier) clearing. Deliberately does NOT clear autoOpenCommentId
  // itself once consumed — doing that INSIDE this same effect would change
  // its own dependency, which runs this effect's cleanup (cancelling the
  // just-scheduled timer) before the 700ms ever elapses, so the highlight
  // would never actually appear. Leaving it set is harmless: nothing else
  // reads it, and this effect only re-runs when the VALUE genuinely
  // changes (a different notification), never just because it's still set.
  useEffect(() => {
    if (!autoOpenCommentId) return;
    const timer = setTimeout(() => setHighlightedAnnotationId(autoOpenCommentId), 700);
    return () => clearTimeout(timer);
  }, [autoOpenCommentId]);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "table">(() =>
    typeof window !== "undefined" && window.localStorage.getItem("subshotSceneViewMode") === "table" ? "table" : "grid"
  );
  // Shared across every section's grid (dnd-kit's "multiple containers"
  // pattern: one DndContext, several SortableContexts) so a scene can be
  // dragged from one section straight into another, not just reordered
  // within the section it started in. See handleSceneDragEnd below.
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
  // Notion-style insertion indicator (Lino's own suggestion, 2026-07-10:
  // "eine blaue schöne Indikatorlinie... wo das gehaltene Objekt hin
  // fliegt") — the only visual feedback during the drag itself. Nothing in
  // the grid actually moves until drop (see handleSceneDragOver/End), so
  // this line is the sole "where will it land" signal while dragging.
  const [insertionIndicator, setInsertionIndicator] = useState<{ targetId: string; edge: "left" | "right" | "top" | "bottom" } | null>(null);
  // Snapshot of data.scenes taken at drag start, restored verbatim on
  // cancel/invalid-drop (see handleSceneDragCancel) and used at drag end to
  // figure out which section the scene actually started in.
  const dragOriginScenesRef = useRef<Scene[] | null>(null);
  // Real cursor position, tracked independently of dnd-kit — used instead
  // of `active.rect.current.translated` (the dragged tile's own rect) for
  // the insertion-line's left/right (or top/bottom) side. The tile's rect
  // is offset from the cursor by wherever on it you happened to grab the
  // handle, and that offset is constant for the whole drag — comparing
  // TILE center vs target center is a systematically biased proxy for
  // "which side is my cursor on", most visible on multi-row grids (Lino:
  // "die blaue Linie stimmt nicht überein mit wo die Kachel landet").
  // Comparing the actual cursor position removes that bias entirely.
  const pointerPosRef = useRef<{ x: number; y: number } | null>(null);
  // Always-current mirror of `data` for the pointermove handler below, which
  // is set up once (empty deps) and would otherwise close over a stale
  // `data` from mount time.
  const dataRef = useRef<ProjectDetail | null>(null);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);
  // Which scene dnd-kit last told us the cursor is "over", and whether a
  // scene drag is in progress at all — see the live-edge-recompute comment
  // on the pointermove handler below for why this is tracked independently
  // of insertionIndicator itself.
  const activeSceneDragRef = useRef(false);
  const lastOverIdRef = useRef<string | null>(null);
  // Mirrors activeSceneId state for the pointermove listener below, which is
  // set up once (empty-deps effect) and reads refs for fresh values instead
  // of closing over state — see its own comment for why.
  const activeSceneIdRef = useRef<string | null>(null);
  useEffect(() => {
    function onPointerMove(e: PointerEvent) {
      pointerPosRef.current = { x: e.clientX, y: e.clientY };
      // dnd-kit's onDragOver (see handleSceneDragOver) only fires when the
      // collision result CHANGES — i.e. when the cursor moves onto a
      // DIFFERENT droppable — not continuously while it stays over the
      // SAME one. For small cards that's rarely noticeable (you tend to
      // cross into a neighboring card before the stale edge matters), but
      // the full-width Projektinfo tile is one single large droppable that
      // can be 300+px tall — entering it computes the edge ONCE at
      // whichever point you crossed its boundary, and that never updates
      // again no matter how far you then move within it. Reported live:
      // dragging a lower Projektinfo tile up over an upper one always
      // showed the indicator at the bottom of the target, because you
      // enter a tile-you're-moving-upward-into from ITS bottom edge first,
      // and that first (correct, at-that-instant) "bottom" reading then
      // never got recomputed even once you'd moved well into its top half.
      // Fix: recompute the edge on every real pointermove (this listener,
      // which — unlike dnd-kit's callback — does fire continuously) against
      // a FRESH getBoundingClientRect() of whichever element dnd-kit most
      // recently told us we're over, via data-sortable-scene-id (added to
      // SortableSceneCard's root specifically for this). Section-drop
      // zones are excluded — dnd-kit computed "top" once for those on
      // purpose (see handleSceneDragOver's comment) and they have no
      // before/after neighbor of their own to split against.
      const overId = lastOverIdRef.current;
      if (!activeSceneDragRef.current || !overId || overId.startsWith("section-drop:")) return;
      const el = document.querySelector<HTMLElement>(`[data-sortable-scene-id="${CSS.escape(overId)}"]`);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const overTarget = dataRef.current?.scenes.find((s) => s.id === overId);
      const activeTarget = dataRef.current?.scenes.find((s) => s.id === activeSceneIdRef.current);
      // A full-width Projektinfo tile only ever has an above/below neighbor,
      // never a left/right one — true whether IT is the hovered target (no
      // left/right to straddle) or IT is the tile being dragged (it can only
      // ever land as a full row, regardless of how narrow the tile it's
      // currently hovering over is). Checking only the hovered target used
      // to miss the second case: dragging the Projektinfo tile itself over a
      // normal-width scene computed a left/right split from the target's
      // width alone, so the horizontal (top/bottom) line never showed
      // (Lino, 2026-07-14).
      const overIsFullWidth = (overTarget?.is_project_info || activeTarget?.is_project_info) ?? false;
      if (overIsFullWidth) {
        const targetCenterY = rect.top + rect.height / 2;
        setInsertionIndicator({ targetId: overId, edge: e.clientY < targetCenterY ? "top" : "bottom" });
      } else {
        const targetCenterX = rect.left + rect.width / 2;
        setInsertionIndicator({ targetId: overId, edge: e.clientX < targetCenterX ? "left" : "right" });
      }
    }
    window.addEventListener("pointermove", onPointerMove);
    return () => window.removeEventListener("pointermove", onPointerMove);
  }, []);
  const sceneSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } })
  );
  const isSectionId = (id: string) => (data?.sections.some((s) => s.id === id) ?? false);
  // Branches to a plain closestCenter scoped to section ids when a SECTION
  // is being dragged, leaving sceneCollisionDetection (hardened across many
  // real bug fixes, see its own comment) completely untouched for scenes —
  // one shared DndContext now covers both drag types, but the two
  // detection strategies stay fully independent of each other.
  const dragCollisionDetection: CollisionDetection = (args) => {
    if (isSectionId(String(args.active.id))) {
      return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => isSectionId(String(c.id))) });
    }
    return sceneCollisionDetection(args);
  };
  // Section drag-and-drop — 2026-07-21: converted from plain native HTML5
  // D&D to the SAME dnd-kit DndContext scenes already use (Lino: tiles must
  // stay draggable LIVE in the normal grid, no separate reorder window —
  // see [[feedback_no_modal_reorder]]). The native version raced dnd-kit's
  // own PointerSensor on the section grip handle's pointerdown ("3 von 10"
  // reliability, #38) since both systems listened to the same subtree;
  // routing section drags through dnd-kit too (handle-scoped `useSortable`
  // in SectionBlock, `isSectionId` branching in the shared handlers below)
  // removes the race entirely — only one drag system is ever active.
  // Still origin-snapshot + insertion-line-only, same reasoning as scenes.
  const [draggingSectionId, setDraggingSectionId] = useState<string | null>(null);
  // Same insertion-line-only idea as scenes (see handleSceneDragOver's
  // comment) — sections used to live-reflow during the drag itself, which
  // for a COLLAPSED section is basically invisible (a header shuffling
  // among other headers, no card motion to see), so a Lino: "welcher
  // Abschnitt landet wo?" complaint was really just this needing the same
  // fix scenes already got. top/bottom since sections stack vertically.
  const [sectionInsertionIndicator, setSectionInsertionIndicator] = useState<{ targetId: string; edge: "top" | "bottom" } | null>(null);
  const dragOriginSectionsRef = useRef<Section[] | null>(null);

  function setViewModePersisted(mode: "grid" | "table") {
    setViewMode(mode);
    window.localStorage.setItem("subshotSceneViewMode", mode);
  }

  useEffect(() => {
    let cancelled = false;
    // 2026-07-17: Rücksprung aus der Postproduction hat das Bundle schon
    // vorab geladen (siehe postproduction/page.tsx's goBackToScenes) — steht
    // es bereit, direkt anzeigen statt nochmal auf's Netz zu warten.
    const cached = takeNavCache<{ project: ProjectDetail; members: Member[]; annotations: Annotation[] }>(`scenes:${id}`);
    if (cached) {
      setData(cached.project);
      setMembers(cached.members);
      setAnnotations(cached.annotations);
      // myRole isn't part of this prefetch cache (written by postproduction/
      // page.tsx's goBackToScenes) — fetch it separately, it's cheap and
      // this is the only consumer that needs it.
      api.me().then((me) => {
        if (!cancelled) setMyRole(cached.members.find((m) => m.user_id === me.id)?.role ?? null);
      });
      return;
    }
    Promise.all([api.projectDetail(id), api.members(id), api.listAnnotations(id), api.me()]).then(([d, m, a, me]) => {
      if (cancelled) return;
      setData(d);
      setMembers(m);
      setAnnotations(a);
      setMyRole(m.find((mem) => mem.user_id === me.id)?.role ?? null);
    });
    // 2026-08-05, Lino: "sind ein paar kacheln auf der ideenseite, laden
    // die kacheln immer ein wenig später nach" — measured with Playwright:
    // <IdeaGrid> only mounts once `data` above resolves (this whole page
    // hard-gates on `if (!data) return <spinner>` further down), so its
    // own listIdeas() call used to only START after projectDetail/members/
    // annotations/me had ALL already finished — a needless serial
    // waterfall (project ~370ms, then ideas another ~580ms on top,
    // pushing the first idea-cover-photo request to ~2s instead of the
    // ~600ms it could start at). Firing listIdeas here too, in PARALLEL
    // with the block above rather than inside its Promise.all (folding it
    // in would instead delay `data` itself down to ideas' slower ~580ms),
    // warms lib/api.ts's shared GET cache — IdeaGrid's own later
    // listIdeas(projectId) call hits that already-in-flight/resolved
    // promise instead of starting a fresh request from zero. Result is
    // consumed nowhere here on purpose; IdeaGrid still owns the ideas
    // state.
    api.listIdeas(id).catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // 2026-07-19, Lino: Pipeline-Module sind jetzt ein echtes Freischalt-Gate
  // (vorher rein informativ, siehe types.ts). "Wählt man bei der Projekt-
  // Erstellung nur Postproduction aus, muss das Projekt auch dort starten,
  // die anderen Seiten sind NICHT verfügbar ausser man aktiviert sie in den
  // Projekteinstellungen." Diese Seite deckt Ideen (module_concept) UND
  // Scripting/Szenen (module_scripting) über dasselbe activeView ab — sind
  // BEIDE aus, hat diese Route für dieses Projekt gar nichts zu zeigen, also
  // direkt weiter zur einzig verbleibenden freigeschalteten Seite. Reagiert
  // auch auf spätere Umschaltungen in den Projekteinstellungen (nicht nur
  // beim ersten Laden), z.B. wenn man mitten in der Szenenansicht sitzt und
  // module_scripting dort selbst ausschaltet.
  useEffect(() => {
    if (!data) return;
    if (!data.module_concept && !data.module_scripting) {
      router.replace(data.module_postproduction ? `/projects/${id}/postproduction` : "/projects");
      return;
    }
    if (activeView === "ideas" && !data.module_concept) setActiveView("scenes");
    else if (activeView === "scenes" && !data.module_scripting) setActiveView("ideas");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.module_concept, data?.module_scripting, data?.module_postproduction]);

  // Lightweight "live updates" (2026-07-10): polls every 12s while this
  // page is open so a teammate's edits show up without anyone reloading —
  // deliberately NOT a websocket/real-time typing sync (overkill for a shot
  // list, same reasoning as the iOS app's identical polling loop in
  // ShotListView.swift). setData replaces state wholesale but React keys
  // scene/shot lists by id, so this diffs in place with no flicker/loading
  // flash — no isLoading gate anywhere in this component either.
  useEffect(() => {
    const interval = setInterval(() => {
      // 2026-08-31 — perf pass: was firing both requests every 12s
      // regardless of whether the tab was even visible — a backgrounded/
      // minimized tab (a very common way people actually leave this page
      // open all day) paid the same network+re-render cost as an actively
      // watched one, for zero user-facing benefit (nothing to show while
      // hidden anyway). Skipping while hidden also means the very next
      // poll after the tab comes back to front fires immediately on the
      // existing 12s cadence, not after some separate "just returned"
      // delay — no staleness regression, just fewer wasted background ticks.
      if (document.visibilityState !== "visible") return;
      api.projectDetail(id).then(setData).catch(() => {});
      api.listAnnotations(id).then(setAnnotations).catch(() => {});
    }, 12000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function updateScenesShots(updater: (d: { scenes: Scene[]; shots: Shot[] }) => { scenes: Scene[]; shots: Shot[] }) {
    setData((prev) => {
      if (!prev) return prev;
      const { scenes, shots } = updater({ scenes: prev.scenes, shots: prev.shots });
      return { ...prev, scenes, shots };
    });
  }

  /** Auto-sort button (2026-07-13, Lino: "ein Button um die Kacheln
   * automatisch nach Identifikationsnummer/Zeit/Ort zu sortieren") — sorts
   * this one section's (or the unsectioned bucket's, sectionId=null)
   * scenes locally by the chosen key, then persists the whole new order in
   * a single request (see reorderScenes/reorder_scenes_bulk) instead of
   * one move call per scene. Scenes missing the sort key (e.g. no
   * location_address set) sort to the end, stable otherwise.
   */
  async function handleSortScenes(sectionId: string | null, criterion: "number" | "time" | "location" | "priority") {
    if (!data) return;
    const group = data.scenes.filter((s) => (s.section_id ?? null) === sectionId);
    // must < should < optional < none (2026-07-14, Lino: "per Prio sortieren
    // ... evtl. auch die Zeitreihenfolge beachten") — priority is the primary
    // key, scheduled_at breaks ties within the same priority so same-priority
    // scenes still land in a sensible chronological order instead of staying
    // in whatever order they happened to be in before.
    const priorityRank: Record<string, number> = { must: 0, should: 1, optional: 2 };
    const key = (s: Scene): [number, string | number] => {
      if (criterion === "number") return [0, s.number * 1000 + (s.letter ? s.letter.charCodeAt(0) : 0)];
      if (criterion === "time") return s.scheduled_at ? [0, s.scheduled_at] : [1, ""];
      if (criterion === "priority") return [s.priority ? priorityRank[s.priority] : 3, s.scheduled_at ?? ""];
      return s.location_address ? [0, s.location_address.toLowerCase()] : [1, ""];
    };
    const sorted = [...group].sort((a, b) => {
      const [aMissing, aKey] = key(a);
      const [bMissing, bKey] = key(b);
      if (aMissing !== bMissing) return aMissing - bMissing;
      return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
    });
    const orderedIds = sorted.map((s) => s.id);
    updateScenesShots((d) => ({
      ...d,
      scenes: d.scenes.map((s) => {
        const idx = orderedIds.indexOf(s.id);
        return idx === -1 ? s : { ...s, sort_order: idx };
      }),
    }));
    try {
      await api.reorderScenes(data.id, sectionId, orderedIds);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Sortieren fehlgeschlagen.");
    }
  }

  async function handleSceneCreated(scene: Scene) {
    setData((prev) => (prev ? { ...prev, scenes: [...prev.scenes, scene] } : prev));
  }

  // Time-cascade offer (2026-07-11, Lino, spec corrected 2026-07-13): "ändert
  // man die Zeit in der ersten Szene, passen sich alle folgenden Szenen
  // (UND Zwischenschritte) die am gleichen Tag stattfinden an" — only
  // asked/confirmed via dialog, never silently. `liveEditingScene` (see its
  // own doc comment above — freshest known state of the scene being edited,
  // re-resolved from `data.scenes` every render, NOT the frozen `editingScene`
  // snapshot from whenever the modal opened, see the 2026-09-07 fix note in
  // handleSceneUpdated below for why that distinction actually matters here)
  // is what knows both the old and new start time.
  //
  // The actual shifting itself moved server-side (2026-07-13) — see
  // ScenePatch.cascade_shift_seconds / patch_scene in the backend — so web
  // AND iOS always compute the exact same result instead of each
  // re-implementing the same date math client-side (both had independently
  // arrived at the same "chain scenes back-to-back" bug, which silently
  // collapses any GAP between originally non-contiguous scenes to zero;
  // Lino: "so its automaticly gets updated via server... on both systems
  // always the same"). This component only detects (client-side, cheap,
  // just to decide whether to ask at all) whether there's anything to
  // offer a cascade for, and computes the plain delta to send.
  const [cascadeConfirm, setCascadeConfirm] = useState<{ sceneId: string; deltaSeconds: number } | null>(null);

  async function handleSceneUpdated(scene: Scene) {
    // 2026-09-07 fix, Lino: verifying the cascade feature surfaced a real
    // bug here — this used to read `editingScene` (frozen at whenever the
    // modal was OPENED, never updated again, see its own doc comment above)
    // instead of `liveEditingScene` (re-resolved from `data.scenes` every
    // render). Fine for the FIRST time edit in a session (both are equal
    // then), but autosave means a scene can save+call this MULTIPLE times
    // in one still-open modal session — on a SECOND time edit, `editingScene`
    // was still the pre-FIRST-edit value, so deltaSeconds came out as the
    // cumulative change since the modal opened, not just since the last
    // save/cascade. Confirming that second (inflated) cascade would shift
    // already-shifted-once siblings AGAIN by the full cumulative delta.
    // `liveEditingScene` already tracks exactly "the freshest known state
    // of the scene being edited" (that's what its own comment describes it
    // for), which is precisely the right baseline here too.
    const previous = liveEditingScene;
    setData((prev) => (prev ? { ...prev, scenes: prev.scenes.map((s) => (s.id === scene.id ? scene : s)) } : prev));

    const timeChanged = previous?.scheduled_at && scene.scheduled_at && previous.scheduled_at !== scene.scheduled_at;
    if (timeChanged && data) {
      const deltaSeconds = (new Date(scene.scheduled_at!).getTime() - new Date(previous!.scheduled_at!).getTime()) / 1000;
      const editedDay = new Date(scene.scheduled_at!);
      const editedStart = editedDay.getTime();
      // "Folgende [getimte] Szenen" — same calendar day (as the NEW start),
      // chronologically after the just-edited scene's NEW start, and
      // themselves already have a start time of their own ("getimte
      // Szenen") — their OWN duration doesn't matter for whether they're
      // eligible, only their start shifts. Zwischenschritte are ordinary
      // scenes with a flag, so they're included automatically here.
      // Projektinfo tiles excluded — the spec only ever mentions "Szenen
      // und Zwischenszenen", and shifting a Drehdatum display alongside an
      // unrelated scene's time edit would be a surprising side effect.
      // (Mirrors the server's own eligibility filter exactly, purely so
      // the dialog only pops up when there's actually something to do —
      // the server re-derives "affected" itself from scratch, this list
      // is never sent to it.)
      const hasAffected = data.scenes.some((s) => {
        if (s.id === scene.id || !s.scheduled_at || s.is_project_info) return false;
        const d = new Date(s.scheduled_at);
        return (
          d.getFullYear() === editedDay.getFullYear() &&
          d.getMonth() === editedDay.getMonth() &&
          d.getDate() === editedDay.getDate() &&
          d.getTime() > editedStart
        );
      });
      if (hasAffected) {
        setCascadeConfirm({ sceneId: scene.id, deltaSeconds });
      }
    }
  }

  // Single server round-trip — the backend does the actual shifting (see
  // the comment on cascadeConfirm above for why).
  async function confirmCascadeTimes() {
    if (!cascadeConfirm) return;
    const { sceneId, deltaSeconds } = cascadeConfirm;
    setCascadeConfirm(null);
    try {
      await api.patchScene(sceneId, { cascade_shift_seconds: deltaSeconds });
      if (data) {
        const fresh = await api.projectDetail(data.id);
        setData(fresh);
      }
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Zeiten anpassen fehlgeschlagen.");
    }
  }

  // 2026-09-07 fix, Lino: "wenn ich eine Kachel duplizieren will geht das
  // sehr sehr lange!!! alles muss schnell und direkt passieren" — this used
  // to await the duplicate POST and then a SECOND full projectDetail()
  // refetch (every scene/dialogue/shot/todo-list in the whole project) just
  // to pick up the sort_order shift duplicate_scene applies to the
  // duplicate's siblings (see that endpoint's own comment in main.py) —
  // two full round trips from the browser for what should feel instant.
  // Mirrors that exact renumbering locally instead (same section, contiguous
  // reindex: siblings-before + original + copy + siblings-after) so this is
  // ONE request. The exact numeric sort_order values only need to preserve
  // relative order, not bit-for-bit match the server's own — this local
  // guess is naturally overwritten by the next 12s poll regardless, so even
  // a missed edge case here self-heals within seconds instead of silently
  // drifting forever (the actual risk the old full-refetch approach was
  // guarding against, and still isn't possible here for that reason).
  async function handleDuplicateScene(scene: Scene) {
    try {
      const copy = await api.duplicateScene(scene.id);
      setData((prev) => {
        if (!prev) return prev;
        const sectionId = scene.section_id ?? null;
        const siblings = prev.scenes
          .filter((s) => s.id !== scene.id && (s.section_id ?? null) === sectionId)
          .sort((a, b) => a.sort_order - b.sort_order);
        const insertAt = siblings.findIndex((s) => s.sort_order >= scene.sort_order);
        const idx = insertAt === -1 ? siblings.length : insertAt;
        const before = siblings.slice(0, idx).map((s, i) => ({ ...s, sort_order: i }));
        const after = siblings.slice(idx).map((s, i) => ({ ...s, sort_order: idx + 2 + i }));
        const reindexedOriginal = { ...scene, sort_order: idx };
        const reindexedCopy = { ...copy, sort_order: idx + 1 };
        const touched = new Set([scene.id, copy.id, ...before.map((s) => s.id), ...after.map((s) => s.id)]);
        const untouched = prev.scenes.filter((s) => !touched.has(s.id));
        return { ...prev, scenes: [...untouched, ...before, reindexedOriginal, reindexedCopy, ...after] };
      });
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Duplizieren fehlgeschlagen.");
    }
  }

  async function confirmDeleteScene() {
    if (!deleteScene) return;
    try {
      await api.deleteScene(deleteScene.id);
      setData((prev) => (prev ? { ...prev, scenes: prev.scenes.filter((s) => s.id !== deleteScene.id) } : prev));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Löschen fehlgeschlagen.");
    } finally {
      setDeleteScene(null);
    }
  }

  // Deleting a section never deletes its scenes — the backend FK is
  // ON DELETE SET NULL (see iOS' matching deleteSection comment), so they
  // fall back to "Ohne Abschnitt" instead of disappearing. Clear
  // section_id locally on whatever scenes had it so that shows immediately
  // instead of waiting for a reload.
  async function confirmDeleteSection() {
    if (!deleteSection) return;
    try {
      await api.deleteSection(deleteSection.id);
      setData((prev) =>
        prev
          ? {
              ...prev,
              sections: prev.sections.filter((s) => s.id !== deleteSection.id),
              scenes: prev.scenes.map((s) => (s.section_id === deleteSection.id ? { ...s, section_id: null } : s)),
            }
          : prev
      );
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Löschen fehlgeschlagen.");
    } finally {
      setDeleteSection(null);
    }
  }

  // "Ohne Abschnitt" has no Section row to send a single DELETE for (see
  // deleteUnsectioned's own doc comment) — deletes every currently-
  // unsectioned scene one request at a time, same api.deleteScene single-
  // scene endpoint confirmDeleteScene above already uses. Sequential, not
  // Promise.all — this is a rare, deliberate bulk action (not a hot path
  // worth parallelizing), and sequential means a mid-batch failure still
  // leaves every scene deleted SO FAR correctly reflected in local state
  // rather than an all-or-nothing race against a partially-applied setData.
  async function confirmDeleteUnsectioned() {
    const toDelete = unsectioned;
    setDeleteUnsectioned(false);
    for (const scene of toDelete) {
      try {
        await api.deleteScene(scene.id);
        setData((prev) => (prev ? { ...prev, scenes: prev.scenes.filter((s) => s.id !== scene.id) } : prev));
      } catch (e) {
        toast.showError(e instanceof ApiError ? e.message : "Löschen fehlgeschlagen.");
        return;
      }
    }
  }

  // #11 Schritt 5 (Postproduction-Tracking): "Alle Szenen im Kasten? Ab in
  // die Postproduction?" — explizit pro Section bestaetigt, nicht
  // automatisch (2026-07-17, Lino), siehe SectionPostproductionPatch-
  // Kommentar im Backend.
  async function confirmSendToPostproduction() {
    if (!sendToPostproduction) return;
    try {
      const updated = await api.sendSectionToPostproduction(sendToPostproduction.id);
      setData((prev) => (prev ? { ...prev, sections: prev.sections.map((s) => (s.id === updated.id ? updated : s)) } : prev));
      toast.showSuccess(`"${updated.name}" ist jetzt in der Postproduction.`);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Fehlgeschlagen.");
    } finally {
      setSendToPostproduction(null);
    }
  }

  // Section-level reordering now runs through the shared dnd-kit
  // DndContext below — see handleSceneDragStart/Over/End/Cancel's
  // isSectionId branches, and SectionBlock's own useSortable for the
  // handle. computeSectionReorder (still used by handleSceneDragEnd's
  // section branch) stays defined further down.

  // Scene-level drag start — snapshots the pre-drag order so a cancelled or
  // invalid drop can restore it exactly (see handleSceneDragCancel/End).
  function handleSceneDragStart(event: DragStartEvent) {
    // 2026-09-07, Lino: bumping autoScroll's `acceleration` (see DndContext
    // above) had NO visible effect — root cause found here, not there:
    // globals.css sets `html { scroll-behavior: smooth }` for normal
    // in-page navigation, but dnd-kit's autoScroll calls plain
    // `element.scrollBy(x, y)` on an interval, which per spec is STILL
    // governed by the scrolling element's CSS scroll-behavior — every one
    // of those calls was kicking off a new smooth-scroll animation that
    // the next tick (5ms later) immediately interrupted, capping the net
    // scroll speed regardless of `acceleration`. Suspended for the
    // duration of the drag, restored in handleSceneDragEnd/-Cancel.
    document.documentElement.style.scrollBehavior = "auto";
    const id = String(event.active.id);
    if (isSectionId(id)) {
      setDraggingSectionId(id);
      dragOriginSectionsRef.current = data?.sections ?? null;
      return;
    }
    setActiveSceneId(String(event.active.id));
    activeSceneIdRef.current = String(event.active.id);
    dragOriginScenesRef.current = data?.scenes ?? null;
    activeSceneDragRef.current = true;
    lastOverIdRef.current = null;
  }

  // Fires continuously while dragging, whenever the pointer moves onto a
  // new card/drop-zone. This used to also live-reorder data.scenes here
  // (cards visibly "making way" during the drag itself), removed
  // 2026-07-10: found via a real repro that the reflow could shift the
  // hovered target out from under a STATIONARY cursor mid-drag (most
  // visible with the full-width Projektinfo tile reflowing a whole row,
  // but not exclusive to it) — the exact "Vorschau zeigt eine Stelle,
  // Loslassen landet wo anders" bug Lino reported. Only updating the
  // insertion-line indicator here (cheap, doesn't move anything) sidesteps
  // that whole class of bug: nothing in the grid actually moves until
  // handleSceneDragEnd computes and applies the real result in one step,
  // so the target a user is hovering can never drift away mid-drag. This
  // was Lino's own suggested alternative ("Notion-artige Indikatorlinie").
  // 2026-07-21: tried live reflow again (matching IdeaImageReorderGrid),
  // twice — both attempts had real, Lino-confirmed bugs (visual corruption,
  // then wrong landing positions even after a fix). Reverted back to this
  // insertion-line design, which IS the confirmed-working baseline.
  function handleSceneDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (isSectionId(String(active.id))) {
      if (!over || active.id === over.id || !isSectionId(String(over.id)) || !data) {
        setSectionInsertionIndicator(null);
        return;
      }
      // 2026-07-21 fix (real bug, found via console-logged live testing after
      // Lino reported sections "always snap back to their old position"):
      // this used to split top/bottom by comparing the CURSOR's Y position
      // against `over.rect`'s vertical center — but `over.rect` is the whole
      // SectionBlock wrapper (header + scene grid + padding), not just the
      // visible grip/title row, so its center sits much lower than where a
      // user naturally releases while aiming at the title text. Releasing
      // anywhere near the visible row overwhelmingly resolved to "bottom"
      // (insert after) — for a simple drag-the-lower-one-up-past-the-upper-
      // one gesture, "insert after" is a NO-OP (it's already positioned
      // after), so the drop visibly did nothing, reading exactly like a
      // snap-back even though the code ran correctly end to end. Fixed by
      // dropping pixel geometry entirely: compare the dragged section's
      // CURRENT index to the target's — moving it earlier in the list
      // inserts it BEFORE the target, moving it later inserts it AFTER,
      // matching what a user actually just did with their mouse regardless
      // of exactly where within the target row they released.
      const activeIdx = sections.findIndex((s) => s.id === String(active.id));
      const overIdx = sections.findIndex((s) => s.id === String(over.id));
      const edge: "top" | "bottom" = activeIdx > overIdx ? "top" : "bottom";
      setSectionInsertionIndicator({ targetId: String(over.id), edge });
      return;
    }
    if (!over) {
      lastOverIdRef.current = null;
      setInsertionIndicator(null);
      return;
    }
    const activeId = String(active.id);
    const overIdStr = String(over.id);
    if (activeId === overIdStr) {
      lastOverIdRef.current = null;
      setInsertionIndicator(null);
      return;
    }
    // Remembered for the pointermove handler above — this event only fires
    // on ENTER into a new droppable, but which droppable that is stays
    // correct until the next enter/exit, so it's safe to read continuously
    // from there in between.
    lastOverIdRef.current = overIdStr;

    // Which half of the hovered card/row the cursor currently sits over
    // (see pointerPosRef's comment above for why the cursor, not the
    // dragged tile's rect). Grid tiles sit side by side (compare X), table
    // rows stack vertically (compare Y) — same before/after idea, different
    // axis. A bare section-drop zone (empty/near-empty section, or the
    // Projektinfo-onto-a-section case) has no "before/after" neighbor of
    // its own to straddle — show a plain "drop here" indicator instead,
    // rendered by SectionDropZone/TableDropZone themselves (Lino: "hat man
    // keine Ahnung wo man die Projektinfo ablegen muss").
    if (overIdStr.startsWith("section-drop:")) {
      setInsertionIndicator({ targetId: overIdStr, edge: "top" });
    } else {
      const pointer = pointerPosRef.current;
      // A Projektinfo tile spans the full grid row (col-span-full) — it has
      // no left/right neighbor to straddle, only tiles above/below it, so a
      // left/right split (like every normal same-row scene tile gets) would
      // point at a spot on the far edge of the row that has nothing to do
      // with where the card would actually land. Compare Y instead whenever
      // EITHER the hovered target OR the dragged tile itself is full-width —
      // dragging the Projektinfo tile over a normal-width scene can only
      // ever land as a full row too, so it needs the same top/bottom split
      // even though the target it's currently over is narrow (missing this
      // half used to mean the horizontal line never showed while dragging
      // the Projektinfo tile itself, Lino 2026-07-14).
      const overTarget = data?.scenes.find((s) => s.id === overIdStr);
      const activeTarget = data?.scenes.find((s) => s.id === activeId);
      const overIsFullWidth = (overTarget?.is_project_info || activeTarget?.is_project_info) ?? false;
      if (pointer) {
        if (viewMode === "table" || overIsFullWidth) {
          const targetCenterY = over.rect.top + over.rect.height / 2;
          setInsertionIndicator({ targetId: overIdStr, edge: pointer.y < targetCenterY ? "top" : "bottom" });
        } else {
          const targetCenterX = over.rect.left + over.rect.width / 2;
          setInsertionIndicator({ targetId: overIdStr, edge: pointer.x < targetCenterX ? "left" : "right" });
        }
      }
    }
  }

  // Scene-level drag end — the ONE shared handler for every section's grid
  // (see the DndContext wrapping all of them further down). Nothing moves
  // in the grid during the drag itself (see handleSceneDragOver) — this is
  // where the actual reorder is computed and persisted, fed with dnd-kit's
  // real final `over` so the result always matches exactly what the
  // insertion line last pointed at.
  function handleSceneDragEnd(event: DragEndEvent) {
    document.documentElement.style.scrollBehavior = "";
    const { active: sectionActive, over: sectionOver } = event;
    if (isSectionId(String(sectionActive.id))) {
      setDraggingSectionId(null);
      const indicator = sectionInsertionIndicator;
      setSectionInsertionIndicator(null);
      const origin = dragOriginSectionsRef.current;
      dragOriginSectionsRef.current = null;
      if (!data || !origin) return;
      const draggedId = String(sectionActive.id);
      const targetId = indicator?.targetId ?? (sectionOver ? String(sectionOver.id) : null);
      if (!targetId || targetId === draggedId || !isSectionId(targetId)) return;
      // Same index-direction rule as handleSceneDragOver's indicator (see
      // its comment) — falls back to it here too on the rare drop that
      // never got an onDragOver first (e.g. a very fast flick).
      const insertAfter =
        indicator?.targetId === targetId
          ? indicator.edge === "bottom"
          : sections.findIndex((s) => s.id === draggedId) < sections.findIndex((s) => s.id === targetId);
      const next = computeSectionReorder(data.sections, draggedId, targetId, insertAfter);
      if (!next) return;
      setData((prev) => (prev ? { ...prev, sections: next } : prev));
      const idx = next.findIndex((s) => s.id === draggedId);
      const beforeId = next[idx + 1]?.id ?? null;
      (async () => {
        try {
          await api.moveSection(draggedId, beforeId);
        } catch (e) {
          toast.showError(e instanceof ApiError ? e.message : "Umsortieren fehlgeschlagen.");
        }
      })();
      return;
    }
    setActiveSceneId(null);
    activeSceneIdRef.current = null;
    activeSceneDragRef.current = false;
    lastOverIdRef.current = null;
    // Captured BEFORE clearing — this indicator is the single source of
    // truth for where the drop lands (see below for why).
    const indicator = insertionIndicator;
    setInsertionIndicator(null);
    const { active, over } = event;
    const origin = dragOriginScenesRef.current;
    dragOriginScenesRef.current = null;
    if (!data || !over) {
      if (origin) setData((prev) => (prev ? { ...prev, scenes: origin } : prev));
      return;
    }
    const activeId = String(active.id);
    const originScene = origin?.find((s) => s.id === activeId);
    if (!originScene) return;

    // CRITICAL: use the last-DISPLAYED indicator, not a fresh read of
    // dnd-kit's own `event.over` — onDragEnd fires on pointer-up, a
    // physically separate event from the last onDragOver that drew the
    // indicator, and sceneCollisionDetection's rectIntersection fallback
    // can resolve differently between the two right at a section boundary
    // (the dragged card's rect can overlap both the current section's
    // empty-space dropzone AND the next section's first card at once).
    // That mismatch was a real, reported bug: the indicator visibly showed
    // "end of this section" but the card silently landed in the section
    // below (Lino: "die Kachel muss GENAU DA HIN FALLEN WO DER INDIKATOR
    // ES ANZEIGT, NIRGENDS ANDERS"). Falling back to event.over only when
    // there's no indicator at all (e.g. a drag that never moved).
    const overIdStr = indicator ? indicator.targetId : String(over.id) === activeId ? null : String(over.id);
    const insertAfter = indicator ? indicator.edge === "right" || indicator.edge === "bottom" : false;
    const finalScenes = overIdStr ? computeSceneReorder(data.scenes, activeId, overIdStr, insertAfter) : null;
    const resultScenes = finalScenes ?? data.scenes;
    const activeScene = resultScenes.find((s) => s.id === activeId);
    if (!activeScene) return;

    const sectionChanged = activeScene.section_id !== originScene.section_id;
    const destScenes = resultScenes.filter((s) => s.section_id === activeScene.section_id);
    const idx = destScenes.findIndex((s) => s.id === activeId);
    const beforeId = destScenes[idx + 1]?.id ?? null;

    setData((prev) => (prev ? { ...prev, scenes: resultScenes } : prev));

    (async () => {
      if (sectionChanged) {
        try {
          const patched = activeScene.section_id
            ? await api.patchScene(activeScene.id, { section_id: activeScene.section_id })
            : await api.patchScene(activeScene.id, { clear_section: true });
          setData((prev) => (prev ? { ...prev, scenes: prev.scenes.map((s) => (s.id === patched.id ? patched : s)) } : prev));
        } catch (e) {
          toast.showError(e instanceof ApiError ? e.message : "Verschieben fehlgeschlagen.");
          return;
        }
      }
      reorderScenes(api, destScenes, activeScene.id, beforeId, setData);
    })();
  }

  // Drag cancelled (Escape, dropped outside any droppable, etc.) — revert
  // the live preview reordering from handleSceneDragOver, nothing was ever
  // persisted to the backend so a plain state restore is enough.
  function handleSceneDragCancel(event: DragCancelEvent) {
    document.documentElement.style.scrollBehavior = "";
    if (isSectionId(String(event.active.id))) {
      setDraggingSectionId(null);
      setSectionInsertionIndicator(null);
      dragOriginSectionsRef.current = null;
      return;
    }
    setActiveSceneId(null);
    activeSceneIdRef.current = null;
    activeSceneDragRef.current = false;
    lastOverIdRef.current = null;
    setInsertionIndicator(null);
    const origin = dragOriginScenesRef.current;
    dragOriginScenesRef.current = null;
    if (origin) setData((prev) => (prev ? { ...prev, scenes: origin } : prev));
  }

  async function createSection() {
    const name = newSectionName.trim();
    setCreatingSection(false);
    if (!name || !data) return;
    try {
      const section = await api.createSection(data.id, name, data.sections.length);
      setData((prev) => (prev ? { ...prev, sections: [...prev.sections, section] } : prev));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Fehlgeschlagen.");
    }
    setNewSectionName("");
  }

  // "Projektinfo" (2026-07-10 redesign, Lino: NEVER auto-create a section
  // for this) — a Projektinfo is just a scene tile with is_project_info
  // set, created directly with no section (lands in "Ohne Abschnitt", same
  // bucket every other unsectioned scene sits in) and no name prompt (it
  // has no name of its own to ask for). From there it's dragged into
  // whichever section it belongs to using the exact same scene drag
  // mechanism as any other tile — see computeSceneReorder's
  // is_project_info handling for the "always lands first, one per
  // section" rule.
  async function saveEditedSection() {
    const name = editSectionName.trim();
    if (!editingSection || !name) {
      setEditingSection(null);
      return;
    }
    try {
      const updated = await api.patchSection(editingSection.id, { name });
      setData((prev) => (prev ? { ...prev, sections: prev.sections.map((s) => (s.id === updated.id ? updated : s)) } : prev));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Fehlgeschlagen.");
    } finally {
      setEditingSection(null);
    }
  }

  async function createProjectInfoScene() {
    if (!data) return;
    try {
      const scene = await api.createScene(data.id, {
        project_id: data.id, color: "#3875bd", is_project_info: true, sort_order: data.scenes.length,
        section_id: currentSectionId,
      });
      setData((prev) => (prev ? { ...prev, scenes: [...prev.scenes, scene] } : prev));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Fehlgeschlagen.");
    }
  }

  // 2026-07-13, Lino: "beim Klick auf PDF Export soll zuerst gefragt werden,
  // ob Kachelansicht oder Tabellenansicht exportiert werden soll" — was a
  // single click straight to the (card-only) export before.
  // 2026-08-08, Lino: this button always exported the Scenes/shotlist PDF
  // even when triggered from the Ideas page — irrelevant there (a project
  // usually has no scenes yet at the ideas stage). Added a third `"ideas"`
  // view (backend: build_project_pdf_ideas) — one card per Idea with its
  // full image gallery — and the toolbar below now only offers the
  // Kachelansicht/Tabellenansicht choice on the Scenes page, a single
  // one-click export on the Ideas page.
  async function exportPdf(view: "cards" | "table" | "ideas") {
    if (!data) return;
    setExportingPdf(true);
    try {
      const url = await api.projectPdfUrl(data.id, view);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${data.name || (view === "ideas" ? "ideen" : "shotlist")}.pdf`;
      a.click();
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "PDF-Export fehlgeschlagen.");
    } finally {
      setExportingPdf(false);
    }
  }

  // 2026-07-26, Lino: "öffnet man ein projekt flasht IMMER NOCH eine
  // andere seite... bevor sie dann den content und die richtige seite
  // lädt" — the module-gate redirect below (useEffect) only ever RUNS
  // after this component has already rendered+painted once with the
  // default `activeView` ("ideas"), since effects fire post-paint — a
  // real (if brief) flash of the wrong page for any project that's about
  // to redirect away, not just the tile-click path (see projects/page.tsx's
  // own `targetHref` fix for that one). Extending the existing `!data`
  // loading gate to ALSO cover "data is here, but we already know this
  // render will just redirect" means the wrong view is never painted in
  // the first place — the effect further down still performs the actual
  // navigation (and still reacts to a LATER module toggle mid-session,
  // its own original purpose), this only changes what's on screen while
  // that's in flight.
  const needsPostproductionRedirect = !!data && !data.module_concept && !data.module_scripting;

  // 2026-08-31 — perf pass: scenesIn/shotsFor/sections/unsectioned/lastScene
  // used to be plain `const`s recomputed on EVERY render (filtering+sorting
  // the full scenes/shots arrays from scratch) — since shotsFor is called
  // once PER SCENE to build its shot list, a project with 50 scenes/200
  // shots re-scanned the whole shots array 50 times per render, including
  // every no-op 12s poll tick. Grouped once per actual data change instead
  // (same "group into a Map, O(1) lookup per call" fix already applied to
  // the iOS app's ShotListViewModel.scenes(in:)/shots(in:) this same
  // session), memoized on the underlying arrays so an unrelated state
  // change elsewhere in this large component doesn't re-run the grouping.
  // Placed here (before the `!data` early return below) because Hooks must
  // run unconditionally on every render — data can still be null/undefined
  // this early, hence the `?? []` fallbacks.
  const scenesBySectionId = useMemo(() => {
    const map = new Map<string | null, Scene[]>();
    const sorted = [...(data?.scenes ?? [])].sort((a, b) => a.sort_order - b.sort_order);
    for (const s of sorted) {
      const key = s.section_id;
      const list = map.get(key);
      if (list) list.push(s);
      else map.set(key, [s]);
    }
    return map;
  }, [data?.scenes]);
  const scenesIn = (sectionId: string | null) => scenesBySectionId.get(sectionId) ?? [];
  // 2026-09-07, Lino: "bei der szenen reihenfolge, müssen die zahlen für
  // die szenen sich anpassen und von 1 hochzählen... in der shot
  // reihenfolge sollen die nummern von der szenenreihenfolge für die
  // szenen übernommen werden und sich NICHT ändern wenn man sie verzieht"
  // — replaces the old screenplay-style scene.number/letter badge (stable
  // identity, deliberately non-renumbering — see _assign_scene_number in
  // main.py) with a live position-in-section count, 1..N, recomputed
  // straight off scenesBySectionId above (already sort_order-first) so it
  // updates the instant a scene drag reorders that array. Keyed by
  // section id (null for "Ohne Abschnitt") purely because SectionBlock
  // only ever renders ONE section at a time — a scene's number never
  // needs to account for any OTHER section's scenes. Consumed by
  // SectionBlock for both the narrative Szenen-Reihenfolge AND (2026-09-09)
  // the Shot-Reihenfolge, which reuses that same SectionBlock verbatim
  // (see its call site below) just fed a Scene.shooting_order-sorted list
  // — dragging there only ever touches shooting_order, never a scene's
  // position in THIS map, so the badge shown per scene stays put.
  const sceneNumberBySectionId = useMemo(() => {
    const map = new Map<string | null, Map<string, number>>();
    for (const [sectionId, list] of scenesBySectionId) {
      const numbers = new Map<string, number>();
      list.forEach((s, i) => numbers.set(s.id, i + 1));
      map.set(sectionId, numbers);
    }
    return map;
  }, [scenesBySectionId]);
  const sceneNumberIn = (sectionId: string | null) => sceneNumberBySectionId.get(sectionId) ?? new Map<string, number>();
  // 2026-09-07, Lino: same "erstes Thumbnail für die Übersicht" ask as the
  // public preview page's own identical helper (see its doc comment) —
  // scenesIn is already sort_order-first (see scenesBySectionId above), so
  // this just needs to skip past any early scene that has no cover photo.
  const firstThumbnailFor = (sectionId: string) => scenesIn(sectionId).find((s) => s.image_url)?.image_url ?? null;

  const shotsBySceneId = useMemo(() => {
    const map = new Map<string | null, Shot[]>();
    const sorted = [...(data?.shots ?? [])]
      .filter((s) => s.status !== "deleted")
      .sort((a, b) => a.sort_order - b.sort_order);
    for (const s of sorted) {
      const list = map.get(s.scene_id);
      if (list) list.push(s);
      else map.set(s.scene_id, [s]);
    }
    return map;
  }, [data?.shots]);
  const shotsFor = (sceneId: string) => shotsBySceneId.get(sceneId) ?? [];

  // is_unplanned sections (Postproduction's "+ Video" button, #251) are
  // deliberately invisible everywhere except their own video tile on the
  // Postproduction page (Lino: "soll KEINE sections box erstellt werden") —
  // that rule only ever got enforced ON that page; nothing excluded them
  // from the Scenes overview too, so they leaked through here as an empty,
  // functionless "0/0" section box. Filtered out same as the Postproduction
  // page already filters its OWN empty-state placeholder for these.
  const sections = useMemo(
    () => [...(data?.sections ?? [])].filter((s) => !s.is_unplanned).sort((a, b) => a.sort_order - b.sort_order),
    [data?.sections]
  );
  const unsectioned = scenesIn(null);
  const lastScene = useMemo(
    () => [...(data?.scenes ?? [])].sort((a, b) => a.sort_order - b.sort_order).at(-1) ?? null,
    [data?.scenes]
  );

  if (!data || needsPostproductionRedirect) {
    return (
      <AppShell>
        <div className="flex-1 flex items-center justify-center text-white/50">Lädt…</div>
      </AppShell>
    );
  }

  // Marking a scene "Im Kasten" (completed) must NOT shove it to the back
  // of the list (Lino, 2026-07-10: "wenn man im kasten drückt, die kacheln
  // NICHT nach hinten geschoben werden sollen") — a completed-sorts-last
  // rule used to live here, removed. is_project_info no longer forces
  // first position either (Lino, 2026-07-11: "die Info-Kachel kann man
  // jetzt überall platzieren... kann wie eine normale Szenenkachel
  // behandelt werden von der Platzierung her") — plain sort_order for
  // everything, same as every other scene. scenesIn/shotsFor/sections/
  // unsectioned/lastScene themselves now live ABOVE the `!data` early
  // return above (see that block's own doc comment — memoized there since
  // Hooks can't follow a conditional early return).

  // Plain-TXT export of every scene's "Good Take" note, grouped by Section
  // in the same order as the Kachelansicht (sections' own sort_order, then
  // each scene's sort_order inside it) — Lino wants an overview list of
  // just the good takes, not a full shotlist export, so unlike PDF export
  // this is built client-side (no backend endpoint). Every real scene is
  // listed even without a good-take note (Lino, 2026-08-08: "sollen auch
  // trotzdem mit exportiert werden aber mit dem Vermerk 'Nicht
  // eingetragen'") — only is_intermediate_step scenes are skipped, since
  // those never show the good-take pill in SceneCard at all (no field to
  // report on). "Kachel ID" is the number/letter badge printed on the tile
  // itself (`${scene.number}${scene.letter}`, same as SceneCard's
  // ColorBadge), NOT the internal scene.id UUID — Lino corrected this
  // after the first version exported the raw UUID. Exact block layout below
  // (label + tabs, blank lines, 54-dash separator) matches the reference
  // file Lino uploaded via /compare 2026-08-08 — "Titel:" gets 2 tabs
  // (vs. 1 for the other two labels) so all three values land on the same
  // column under 8-wide tab stops (both "Kachel ID:" and "Good Take:" are
  // already 10 chars, "Titel:" is only 6).
  function exportGoodTakes() {
    if (!data) return;
    const groups: { label: string; scenes: Scene[] }[] = [
      ...sections.map((section) => ({ label: section.name || t("workflow.goodTakes"), scenes: scenesIn(section.id) })),
      { label: "Ohne Abschnitt", scenes: unsectioned },
    ]
      .map((g) => ({ label: g.label, scenes: g.scenes.filter((s) => !s.is_intermediate_step) }))
      .filter((g) => g.scenes.length > 0);

    if (groups.length === 0) {
      toast.showError(t("workflow.goodTakesEmpty"));
      return;
    }

    const lines: string[] = [`${t("workflow.goodTakes")} – ${data.name}`, ""];
    groups.forEach(({ label, scenes }) => {
      lines.push(label);
      scenes.forEach((scene) => {
        lines.push(`Kachel ID:\t${scene.number}${scene.letter ?? ""}`);
        lines.push(`Titel:\t\t${scene.name || "-"}`);
        lines.push("");
        lines.push(`Good Take:\t${scene.good_take_filename || "nicht eingetragen"}`);
        lines.push("");
        lines.push("-".repeat(54));
        lines.push("");
      });
    });

    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${data.name || "good-takes"} - Good Takes.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AppShell>
      <Suspense fallback={null}>
        <NotificationParamsWatcher
          onParams={({ openIdea, openScene, openComment }) => {
            if (openIdea) setAutoOpenIdeaId(openIdea);
            if (openScene) setAutoOpenSceneId(openScene);
            if (openComment) setAutoOpenCommentId(openComment);
          }}
        />
      </Suspense>
      {/* pb-28 (not just py-8) so the fixed "+ Hinzufügen" FAB never
          overlaps the last scene/section when scrolled to the bottom.
          2026-07-18, Lino: "Animation von Projektübersicht zur ersten
          workflow seite ist schrecklick... swipe von rechts nach links wie
          bei den anderen workflow transitions" — replaces the old flying-
          tile-morph landing (TileMorphOverlay/finishMorph) with the SAME
          enter-from-the-right variant used by postproduction/page.tsx's
          entranceTransition. Deliberately does NOT wrap EdgeNavButton/the
          "+ Hinzufügen" FAB below (both `position: fixed`, which breaks
          the moment an ancestor gets a CSS transform from x/scale/filter
          animate props) — this motion.div closes early, right before that
          block starts, see the matching comment down there. */}
      <div
        className="flex-1 mx-auto w-full px-4 sm:px-6 pt-8 pb-28"
        // 2026-07-21, Lino: "drückt man den Tabellenmodus, wird die
        // tabellenbreite viel breiter dargestellt aber so das die
        // navigationspfeile links und rechts nicht berühre werden" —
        // EdgeNavButton sitzt fixed 28px vom echten Viewport-Rand + 64px
        // Klickfläche (siehe EdgeNavButton.tsx). Folgeanfrage (selber Tag):
        // "muss noch ein wenig breiter sein (100px) und soll sich nach der
        // Bildschirmgroesse skalieren" — Cap 1900->2000px, Rand-Abzug
        // 200->160px (noch immer deutlich mehr als die ~92px, die die
        // EdgeNavButtons tatsächlich brauchen) für spürbar mehr Breite auf
        // jeder Fensterbreite, nicht nur am Cap. Normale Kachel-/Ideen-
        // Ansicht bleibt unverändert bei max-w-6xl.
        style={{ maxWidth: activeView === "scenes" && viewMode === "table" ? "min(2000px, calc(100vw - 160px))" : "72rem" }}
      >
        {/* 2026-07-30, Lino: "der pipeline titel soll jeweils horizontal
            zentriert auf der gleichen höhe wie < projekt und den buttons
            rechts sein" — the workflow-stage label ("Ideen"/"Script") used
            to sit left-aligned directly under the back-link, its own row
            further down than the buttons. Pulled it OUT of the left column
            into an absolutely-centered layer of this same row (centered
            against the row's full width AND height, not just the left
            half), same technique on both this page and postproduction/
            page.tsx so the header reads identically across every workflow
            stage. client_name/h1 stay in their own row below, unaffected. */}
        <div className="relative flex items-center justify-between mb-2 gap-3 flex-wrap">
          {/* 2026-07-21, Lino: "die animation von einer workflow seite
              zurück zur projektübersicht ist noch sehr hackelig" — THIS
              was the actual culprit, not the edge chevron button below
              (that one already called goToProjectsWithTransition and was
              fine). This breadcrumb-style link was a plain <Link> — an
              instant route change with zero exit animation — while it's
              almost certainly the more-used affordance since it's the
              one with visible text right next to the title, not an
              icon-only edge button. Now shares the exact same transition
              function as the edge button, so both feel identical. */}
          <button
            type="button"
            onClick={goToProjectsWithTransition}
            className="text-sm text-white/40 hover:text-white/70 transition-colors flex items-center gap-1"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
            {t("workflow.backToProjects")}
          </button>
          {/* 2026-07-18, Lino: "irgendwo braucht es noch einen grossen
                Titel der zeigt auf welcher Workflowseite man ist: Ideen/
                Konzept, Script/Shotlist, Postproduction" — Postproduction
                hat das schon (ihr eigenes h1 "Postproduction", siehe
                postproduction/page.tsx), hier fehlte das Pendant für die
                geteilte Ideen/Szenen-Route. */}
            {/* 2026-07-18, Lino: "Workflow Titel bitte auch in einem coolen
                font darstellen" — font-bebas statt reinem font-bold, wie h1
                (siehe globals.css's h1-Regel). 2026-07-19: gewechselt von
                font-anton auf font-bricolage zusammen mit der h1-Regel;
                2026-08-06 zusammen mit der h1-Regel weiter auf Bebas Neue —
                nur das Logo-Wortzeichen selbst bleibt Anton. */}
            {/* 2026-07-21, Lino: "den Workflow titel NICHT blau machen... ändere
                das auf eher was gräuliches" — war text-blue-400, jetzt neutral
                grau wie das Postproduction-Pendant (postproduction/page.tsx). */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
            <div className="font-bebas text-xl uppercase tracking-wide text-white/40 whitespace-nowrap">
              {activeView === "ideas" ? t("workflow.ideasConcept") : t("workflow.scriptShotlist")}
            </div>
          </div>
          <div className="relative z-10 flex gap-2 flex-wrap">
            <Button
              variant={showAnnotations ? "primary" : "secondary"}
              size="sm"
              onClick={() => setShowAnnotations((v) => !v)}
              className="relative"
            >
              <CommentIcon /> {t("workflow.comments")}
              {annotations.some((a) => a.status === "open") && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                  {annotations.filter((a) => a.status === "open").length}
                </span>
              )}
            </Button>
            {/* 2026-07-17, Lino: "Notion Import brauchen wir auch nicht (nur
                den button ausblenden, an der funktion arbeiten wir noch
                weiter)" — Button raus, showNotion-State + NotionImportModal
                bewusst NICHT entfernt, bleibt fuer die Weiterarbeit
                bestehen, nur aktuell von nirgendwo mehr erreichbar. */}
            {activeView === "ideas" ? (
              <Button variant="secondary" size="sm" disabled={exportingPdf} onClick={() => exportPdf("ideas")}>
                <DocIcon /> {exportingPdf ? t("workflow.pdfExporting") : t("workflow.pdf")}
              </Button>
            ) : (
              <Menu
                trigger={
                  <Button variant="secondary" size="sm" disabled={exportingPdf}>
                    <DocIcon /> {exportingPdf ? t("workflow.pdfExporting") : t("workflow.pdf")}
                  </Button>
                }
              >
                {(close) => (
                  <>
                    <MenuItem
                      onClick={() => {
                        exportPdf("cards");
                        close();
                      }}
                    >
                      {t("workflow.pdfCardView")}
                    </MenuItem>
                    <MenuItem
                      onClick={() => {
                        exportPdf("table");
                        close();
                      }}
                    >
                      {t("workflow.pdfTableView")}
                    </MenuItem>
                  </>
                )}
              </Menu>
            )}
            {activeView === "scenes" && (
              <Button variant="secondary" size="sm" onClick={exportGoodTakes}>
                <GoodTakeIcon /> {t("workflow.goodTakes")}
              </Button>
            )}
            {/* 2026-07-17, Lino: "der teilen button soll immer die seite
                teilen auf der man gerade ist... keine Auswahl beim teilen"
                — no menu, shareKind already tracks activeView live. */}
            <Button variant="secondary" size="sm" onClick={() => setShowShareModal(true)}>
              <ShareIcon /> {t("workflow.share")}
            </Button>
            {/* 2026-07-17, Lino: "auf der Ideenseite braucht es den
                Tabellenbutton nicht, der soll auf der Szenenübersicht
                vorhanden sein" — was always visible regardless of which
                part of the page you were looking at. */}
            {activeView === "scenes" && (
              <div className="flex bg-white/5 border border-white/10 rounded-xl p-0.5">
                <button
                  onClick={() => setViewModePersisted("grid")}
                  title="Kachelansicht"
                  className={`p-1.5 rounded-lg transition-colors ${viewMode === "grid" ? "bg-white/15 text-white" : "text-white/40 hover:text-white/70"}`}
                >
                  <GridIcon />
                </button>
                <button
                  onClick={() => setViewModePersisted("table")}
                  title="Tabellenansicht"
                  className={`p-1.5 rounded-lg transition-colors ${viewMode === "table" ? "bg-white/15 text-white" : "text-white/40 hover:text-white/70"}`}
                >
                  <TableIcon />
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="mb-8">
          {/* 2026-07-29, Lino: "Auftraggeber und Projektname sollen dann
              IMMER im header auf den pipelines dargestellt werden" —
              client_name renders as a line above the h1 whenever a project
              has one set (most existing real projects don't, since the
              client used to be informally baked into `name` itself instead
              — see client_name's own comment in models.py). Same treatment
              on postproduction/page.tsx's header.
              2026-07-30, Lino: "auftraggeber soll jeweils grösser dargestellt
              werden auf den pipeline seiten" — was text-sm, bumped to
              text-lg so it reads as its own real header line.
              2026-08-06, Lino: "Auftraggeber werden IMMER mit der auf der
              Kachel ausgewählten Farbe dargestellt (Textfarbe)" — was a
              fixed text-white/60 gray, now the project's own color
              (data.color, same value the tile itself uses). Same treatment
              ported to postproduction/page.tsx's header and all three
              public preview pages (project_color in their own response). */}
          {data.client_name && (
            <div className="text-lg font-medium mb-0.5" style={{ color: data.color }}>
              {data.client_name}
            </div>
          )}
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            {data.emoji && <span>{data.emoji}</span>} {data.name}
          </h1>
        </div>

        {/* 2026-07-17, Lino: "rechts ein Pfeil-Button (Script/Shotlist
            Editor)... mit einer coolen Swipe-Animation auf die Szenenseite...
            links ein Pfeil-Button (Ideen) zurück, smooth animiert" — the
            Ideen-Kachelübersicht (Planungssektor) and the Scripting-Tool
            (Sections/Scenes below) used to share one continuously-scrolled
            page; now two swipeable panels, one mounted at a time
            (AnimatePresence mode="wait", same slide+fade spring feel as
            IdeaFocusView's own idea-to-idea navigation) instead of a scroll
            position deciding which one you're "looking at". `perspective`
            on this wrapping div (CSS perspective only affects a 3D
            transform on a CHILD, not the element carrying it itself) is
            what makes the panels' rotateY in viewPanelVariants actually
            render as a 3D turn instead of a flat skew. */}
        <div>
          {activeView === "ideas" ? (
            <div>
              <ProjectInfoBox
                project={data}
                members={members}
                onProjectChange={(updater) => setData((prev) => (prev ? { ...prev, ...updater(prev) } : prev))}
                onOpenTeam={() => setShowTeam(true)}
                todoLists={data.todo_lists}
                onTodoListsChange={(updater) => setData((prev) => (prev ? { ...prev, todo_lists: updater(prev.todo_lists) } : prev))}
                showDateLocation={false}
              />

              {/* Planungssektor (2026-07-16) — idea tiles + client-approval
                  share link. Self-contained, own data fetch. */}
              <IdeaGrid
                ref={ideaGridRef}
                projectId={data.id}
                onIdeaApproved={() => api.projectDetail(data.id).then(setData)}
                autoOpenIdeaId={autoOpenIdeaId}
                onAutoOpened={() => {
                  setAutoOpenIdeaId(null);
                  router.replace(`/projects/${id}`, { scroll: false });
                }}
                annotations={annotations}
                highlightedAnnotationId={highlightedAnnotationId}
                onAnnotationUpdated={(updated) => setAnnotations((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))}
                myRole={myRole}
              />
            </div>
          ) : (
            <div>
        {/* 2026-08-07, Lino: "Auf der Script/Shotliste Seite soll keine
            'Projektinfos' Kachel oben mehr sein!" — removes the #234
            instance below (Ideas view keeps its own, unaffected). Team-
            Zugriff bleibt über den Header-Button (onOpenTeam), Todo-Listen
            bleiben über die Ideen-Ansicht sowie die globale Todo-Sidebar
            erreichbar. */}

        {/* 2026-08-30 — Skript-Auswahlübersicht (siehe openSectionId's
            eigener Kommentar oben): ohne geöffneten Abschnitt zeigt die
            Skript-Seite nur noch eine Kachel-Übersicht der Abschnitte
            (jeder Abschnitt entspricht einer abgenommenen Idee, siehe
            approve_idea im Backend) statt sofort aller Szenen aller
            Abschnitte gleichzeitig. Klick auf eine Kachel öffnet NUR
            diesen einen Abschnitt in der bestehenden, unveränderten
            Shot-Planungsansicht darunter (siehe die Filterung von
            `sections` weiter unten). */}
        {openSectionId === null ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
            {sections.map((section) => {
              const thumbnailUrl = firstThumbnailFor(section.id);
              return (
                <div key={section.id} className="relative">
                  <button
                    onClick={() => setOpenSectionId(section.id)}
                    className="w-full text-left p-4 rounded-2xl bg-white/[0.04] border border-white/10 hover:bg-white/[0.07] hover:border-white/20 transition-colors"
                  >
                    {thumbnailUrl && (
                      <div className="mb-3 rounded-xl overflow-hidden aspect-video bg-white/5">
                        <AuthImage path={thumbnailUrl} alt="" className="w-full h-full object-cover" />
                      </div>
                    )}
                    <div className="font-semibold truncate pr-6">{section.name}</div>
                    <div className="text-sm text-white/50 mt-1">
                      {scenesIn(section.id).length} {t("scriptOverview.sceneCount")}
                    </div>
                  </button>
                  {/* 2026-09-07 fix, Lino: "man muss hier auch ganze
                      shotlisten löschen können (in der Übersicht)" —
                      explicitly only for logged-in users here, NOT on the
                      public preview link ("nur die eingeloggten sollen
                      löschen können"). First attempt was a plain absolutely-
                      positioned sibling <button> — Lino confirmed the icon
                      showed but clicking it did nothing (never reached the
                      backend, see the DELETE /sections/{id} logs). Rebuilt
                      on the shared Menu component instead, the exact same
                      proven "…" pattern SceneCard already uses for its own
                      Bearbeiten/Duplizieren/Löschen — Menu's own trigger
                      wrapper already does preventDefault+stopPropagation
                      correctly, no more hand-rolled click-isolation to get
                      subtly wrong. Reuses the same setDeleteSection +
                      ConfirmDialog SectionBlock's dropdown menu already
                      has for an OPENED section. */}
                  <div className="absolute top-2 right-2">
                    <Menu
                      trigger={
                        <IconButton size={28} className="bg-black/40 backdrop-blur-sm text-white/60 hover:text-white hover:bg-black/60">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
                          </svg>
                        </IconButton>
                      }
                    >
                      {(close) => (
                        <MenuItem
                          danger
                          onClick={() => {
                            setDeleteSection(section);
                            close();
                          }}
                        >
                          {t("common.delete")}
                        </MenuItem>
                      )}
                    </Menu>
                  </div>
                </div>
              );
            })}
            {/* 2026-09-07 fix, Lino: neu angelegte Szenen/Zwischenschritte
                landen standardmässig immer hier (kein section_id gesetzt) —
                bei einem frischen Projekt ohne Ideen/Abschnitte (z.B. reines
                Scripting-Modul, module_concept aus) war diese Kachel bisher
                fest `disabled`, wodurch JEDE hier erstellte Szene faktisch
                unerreichbar wurde: sie speicherte serverseitig einwandfrei,
                tauchte aber nirgends in der UI mehr auf ("Speichern tut
                nichts"). Jetzt genauso klickbar wie eine echte Abschnitts-
                Kachel, öffnet dieselbe Shot-Planungsansicht unten (siehe
                openSectionId === "__unsectioned__" weiter unten). */}
            {unsectioned.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setOpenSectionId("__unsectioned__")}
                  className="w-full text-left p-4 rounded-2xl bg-white/[0.04] border border-white/10 hover:bg-white/[0.07] hover:border-white/20 transition-colors"
                  title={t("scriptOverview.unsectionedHint")}
                >
                  <div className="font-semibold truncate pr-6">{t("scriptOverview.unsectionedTitle")}</div>
                  <div className="text-sm text-white/50 mt-1">
                    {unsectioned.length} {t("scriptOverview.sceneCount")}
                  </div>
                </button>
                {/* 2026-09-07, Lino: "ich kann 'ohne abschnitte' nicht
                    löschen, das muss man auch löschen können!" — see
                    deleteUnsectioned's own doc comment: no Section row
                    exists to delete here, this bulk-deletes every scene
                    currently in the bucket instead. */}
                <div className="absolute top-2 right-2">
                  <Menu
                    trigger={
                      <IconButton size={28} className="bg-black/40 backdrop-blur-sm text-white/60 hover:text-white hover:bg-black/60">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                          <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
                        </svg>
                      </IconButton>
                    }
                  >
                    {(close) => (
                      <MenuItem
                        danger
                        onClick={() => {
                          setDeleteUnsectioned(true);
                          close();
                        }}
                      >
                        {t("common.delete")}
                      </MenuItem>
                    )}
                  </Menu>
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            <button
              onClick={() => {
                setOpenSectionId(null);
                setShotOrderMode(false);
              }}
              className="mb-4 text-sm text-white/60 hover:text-white flex items-center gap-1.5"
            >
              ← {t("scriptOverview.backToOverview")}
            </button>

            {/* 2026-08-30 — Set-Marker-Feature (Timecode-Leiste), NUR
                innerhalb der geöffneten Shotlist sichtbar (Lino: "der
                timecode muss immer in der shotlist selber laufen! NICHT
                in der uebersicht!! jedes video/projekt braucht ja seinen
                eigenen timecode!") — `key={section.id}` erzwingt eine
                frische Komponenten-Instanz (frisches selectedFps etc.) bei
                jedem Abschnittswechsel, kein Zustand leckt zwischen
                Abschnitten. `allScenesDone` beendet die laufende Uhr
                automatisch, sobald jede Szene "im Kasten" ist. */}
            {(() => {
              const openSection = sections.find((s) => s.id === openSectionId);
              if (!openSection) return null;
              const scenesInSection = scenesIn(openSection.id);
              const allScenesDone = scenesInSection.length > 0 && scenesInSection.every((s) => s.completed);
              return <TimecodeBar key={openSection.id} section={openSection} allScenesDone={allScenesDone} />;
            })()}

            {/* 2026-09-07, Lino: "2 sortierfunktionien 1. die
                Szenenreihenfolge 2. Shotreihenfolge. diese 2 sortierungen
                kann man unabhäng voneinander sortieren" — only for a REAL
                section (Shot.shooting_order is scoped to one Section's own
                scenes server-side, see reorder_shots_shooting_order in
                main.py; "Ohne Abschnitt" has no Section row to scope it
                to). Toggling back to Szenen-Reihenfolge never loses
                anything — shooting_order is a completely separate field
                from sort_order, switching views just changes which one
                drives the display. */}
            {openSectionId !== "__unsectioned__" && (
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
            )}

            {shotOrderMode && openSectionId !== "__unsectioned__" ? (
              (() => {
                const openSection = sections.find((s) => s.id === openSectionId);
                if (!openSection) return null;
                const sectionId = openSection.id;
                // 2026-09-09, Lino: "wieso wird die shot-reihenfolge
                // anderst dargestellt?? sie soll doch genau gleich
                // dargestellt werden!! NUR DIE REIHENFOLGE SOLL MAN
                // SELBER VON DEN SZENEN wählen können" — a first attempt
                // built a whole separate card design here (ShotOrderView's
                // own SceneBlockContent); this reuses the EXACT same
                // SectionBlock the Szenen-Reihenfolge itself renders with
                // (grid or table, whichever `viewMode` is active), just
                // fed the shooting-order-sorted scene list and wrapped in
                // its own, isolated DndContext so a drag here writes
                // Scene.shooting_order instead of Scene.sort_order — see
                // Scene.shooting_order's own doc comment for the fuller
                // "Szenen-Reihenfolge = narrative order, Shot-Reihenfolge
                // = shooting-day order of the same scenes" explanation.
                // No `title` passed -> SectionBlock's own early-return
                // skips its header/section-menu chrome entirely, leaving
                // just the bare scene cards.
                const scenesInSection = [...scenesIn(openSection.id)].sort((a, b) => {
                  if (a.shooting_order != null && b.shooting_order != null) return a.shooting_order - b.shooting_order;
                  if (a.shooting_order != null) return -1;
                  if (b.shooting_order != null) return 1;
                  return a.sort_order - b.sort_order;
                });
                function handleShotOrderDragEnd(event: DragEndEvent) {
                  const { active, over } = event;
                  if (!over || active.id === over.id) return;
                  const oldIndex = scenesInSection.findIndex((s) => s.id === active.id);
                  const newIndex = scenesInSection.findIndex((s) => s.id === over.id);
                  if (oldIndex === -1 || newIndex === -1) return;
                  const orderedSceneIds = arrayMove(scenesInSection, oldIndex, newIndex).map((s) => s.id);
                  // Optimistic — mirrors the order the user just dropped
                  // locally, same reasoning handleSortScenes/duplicate's
                  // own local reindex already use elsewhere on this page.
                  updateScenesShots((d) => ({
                    ...d,
                    scenes: d.scenes.map((s) => {
                      const idx = orderedSceneIds.indexOf(s.id);
                      return idx === -1 ? s : { ...s, shooting_order: idx };
                    }),
                  }));
                  api.reorderScenesShootingOrder(sectionId, orderedSceneIds).catch((e) => {
                    toast.showError(e instanceof ApiError ? e.message : "Sortieren fehlgeschlagen.");
                  });
                }
                return (
                  <DndContext sensors={sceneSensors} collisionDetection={closestCenter} onDragEnd={handleShotOrderDragEnd}>
                    <SectionBlock
                      section={openSection}
                      scenes={scenesInSection}
                      sceneNumberById={sceneNumberIn(openSection.id)}
                      shotsFor={shotsFor}
                      members={members}
                      onChange={updateScenesShots}
                      onEditScene={setEditingScene}
                      onDeleteScene={setDeleteScene}
                      onDuplicateScene={handleDuplicateScene}
                      viewMode={viewMode}
                      onOpenTeam={() => setShowTeam(true)}
                      dragDisabled={showAnnotations}
                      annotationsByScene={showAnnotations ? annotationsByScene : undefined}
                      highlightedAnnotationId={highlightedAnnotationId}
                      onAnnotationClick={handleAnnotationSelect}
                    />
                  </DndContext>
                );
              })()
            ) : (
            <>
            {/* One shared DndContext for every section's scene grid (dnd-kit's
                "multiple containers" pattern) — lets a scene be dragged from one
                section straight into another, not just reordered within
                whichever section it started in. See handleSceneDragEnd. */}
        <DndContext
          sensors={sceneSensors}
          // pointerWithin (not closestCenter) — closestCenter compares the
          // WHOLE dragged card's center against each droppable's center,
          // and a thin SectionDropZone (see below) almost never wins that
          // comparison against a much taller card, especially once the
          // DragOverlay's position is offset by wherever on the card you
          // grabbed it (e.g. the trailing edge handle). Verified via a real
          // browser drag+drop trace with Playwright — closestCenter silently
          // dropped every cross-section move (over resolved to undefined,
          // no error, nothing happened, no console error either — see
          // project memory), pointerWithin (checks whether the actual
          // cursor position is over a droppable, which is what a user
          // visually expects "am I over this drop zone" to mean) fixed it.
          // sceneCollisionDetection layers a rectIntersection fallback on
          // top for when the cursor is in the gap between cards (Lino:
          // "man muss mega genau treffen") — see its own comment above.
          collisionDetection={dragCollisionDetection}
          // Viewport-edge auto-scroll while dragging. All earlier tuning
          // (40, then 120, then 400 on 2026-09-07) happened while
          // globals.css' `html { scroll-behavior: smooth }` was silently
          // throttling every scrollBy() dnd-kit issued (see
          // handleSceneDragStart's own comment on suspending it for the
          // drag) — those numbers all measured a THROTTLED speed, not the
          // real one, which is why "too slow" at 120 became "way too
          // fast" at 400 the moment the throttle was actually removed.
          // 60 is the first real (unthrottled) calibration point.
          autoScroll={{ acceleration: 60, interval: 5 }}
          onDragStart={handleSceneDragStart}
          onDragOver={handleSceneDragOver}
          onDragEnd={handleSceneDragEnd}
          onDragCancel={handleSceneDragCancel}
        >
          {/* Outer SortableContext for the sections themselves (vertical
              list) — sibling to each section's own inner scene
              SortableContext (see SectionBlock), same "multiple containers"
              shape dnd-kit's docs describe, just one level deeper than the
              scenes-only version this page already had. */}
          <SortableContext items={sections.filter((s) => s.id === openSectionId).map((s) => s.id)} strategy={verticalListSortingStrategy}>
          {sections.filter((section) => section.id === openSectionId).map((section) => {
            // A newly created section starts with zero scenes — it used to be
            // filtered out entirely here, which made it invisible right after
            // creating it (no header, no "+ Szene" row, no way to ever put a
            // scene into it from the UI). Sections now always render.
            const group = scenesIn(section.id);
            return (
              <SectionBlock
                key={section.id}
                section={section}
                title={section.name}
                scenes={group}
                sceneNumberById={sceneNumberIn(section.id)}
                shotsFor={shotsFor}
                members={members}
                onChange={updateScenesShots}
                onEditScene={setEditingScene}
                onDeleteScene={setDeleteScene}
                onDuplicateScene={handleDuplicateScene}
                onDeleteSection={setDeleteSection}
                onEditSection={(s) => {
                  setEditingSection(s);
                  setEditSectionName(s.name);
                }}
                onSendToPostproduction={data.module_postproduction ? setSendToPostproduction : undefined}
                // SectionBlock only renders the drag handle at all when
                // this is false — same "man kann in diesem modus keine
                // kacheln verschieben" rule as scenes' dragDisabled.
                sectionDragDisabled={showAnnotations}
                draggingSectionId={draggingSectionId}
                sectionInsertionIndicator={sectionInsertionIndicator}
                insertionIndicator={insertionIndicator}
                viewMode={viewMode}
                projectId={data.id}
                onSectionChange={(updated) =>
                  setData((prev) => (prev ? { ...prev, sections: prev.sections.map((s) => (s.id === updated.id ? updated : s)) } : prev))
                }
                onOpenTeam={() => setShowTeam(true)}
                onSortScenes={(criterion) => handleSortScenes(section.id, criterion)}
                dragDisabled={showAnnotations}
                annotationsByScene={showAnnotations ? annotationsByScene : undefined}
                highlightedAnnotationId={highlightedAnnotationId}
                onAnnotationClick={handleAnnotationSelect}
              />
            );
          })}
          </SortableContext>

          {/* 2026-09-07 fix, Lino: "Ohne Abschnitt" ist jetzt über die
              gleichnamige Kachel in der Übersicht (openSectionId ===
              "__unsectioned__") genauso erreichbar wie ein echter
              Abschnitt — der 2026-08-30-Kommentar hier hatte diesen Zweig
              bewusst entfernt, weil ein UNGEÖFFNETER Mix aus mehreren
              Ideen verwirrend wäre, aber übersah dabei, dass neu erstellte
              Szenen/Zwischenschritte (Menu unten: "Neue Szene"/
              "Zwischenschritt") IMMER ohne section_id starten — bei einem
              Projekt ohne jede Idee/Abschnitt (z.B. reines Scripting-Modul)
              landete dadurch jede einzelne Szene in einem UI-Zustand, der
              nie mehr geöffnet werden konnte. section={"undefined"} ist von
              SectionBlock selbst schon immer unterstützt worden (siehe
              dessen eigenen "Ohne Abschnitt"-Kommentar), nur dieser
              Aufruf hier fehlte. */}
          {openSectionId === "__unsectioned__" && (
            <SectionBlock
              key="__unsectioned__"
              section={undefined}
              title={t("scriptOverview.unsectionedTitle")}
              scenes={unsectioned}
              sceneNumberById={sceneNumberIn(null)}
              shotsFor={shotsFor}
              members={members}
              onChange={updateScenesShots}
              onEditScene={setEditingScene}
              onDeleteScene={setDeleteScene}
              onDuplicateScene={handleDuplicateScene}
              sectionDragDisabled={showAnnotations}
              draggingSectionId={draggingSectionId}
              sectionInsertionIndicator={sectionInsertionIndicator}
              insertionIndicator={insertionIndicator}
              viewMode={viewMode}
              projectId={data.id}
              onOpenTeam={() => setShowTeam(true)}
              onSortScenes={(criterion) => handleSortScenes(null, criterion)}
              dragDisabled={showAnnotations}
              annotationsByScene={showAnnotations ? annotationsByScene : undefined}
              highlightedAnnotationId={highlightedAnnotationId}
              onAnnotationClick={handleAnnotationSelect}
            />
          )}

          {/* 2026-07-19, Lino: "greift man die Szene an den 6 Punkten ist die
              Kachel beim Draggen sehr weit von der Maus entfernt" —
              DragOverlay positions its floating clone via `position: fixed`
              internally, which stops being relative to the viewport the
              moment ANY ancestor has a CSS `transform` (even an identity
              one) — exactly what this page's own `motion.div key="scenes"`
              wrapper carries (the spring page-transition animation, still
              nested around this DndContext). The clone was rendering
              offset by however far that wrapper sits from the viewport
              origin instead of tracking the cursor. Rendering it through a
              portal straight onto `document.body` sidesteps the transformed
              ancestor entirely — same React tree (still gets DndContext via
              context, not a prop), different DOM parent. */}
          {typeof document !== "undefined" &&
            createPortal(
              <DragOverlay>
                {activeSceneId &&
                  (() => {
                    const activeScene = data.scenes.find((s) => s.id === activeSceneId);
                    if (!activeScene) return null;
                    if (activeScene.is_project_info) {
                      return (
                        <div className="w-full shadow-2xl shadow-black/50 cursor-grabbing opacity-90">
                          <ProjectInfoTile scene={activeScene} members={members} onDelete={() => {}} onChange={() => {}} onOpenTeam={() => {}} />
                        </div>
                      );
                    }
                    return (
                      <div className="rotate-2 shadow-2xl shadow-black/50 cursor-grabbing">
                        <SceneCard
                          scene={activeScene}
                          displayNumber={sceneNumberIn(activeScene.section_id ?? null).get(activeScene.id)}
                          shots={shotsFor(activeScene.id)}
                          members={members}
                          onEdit={() => {}}
                          onDelete={() => {}}
                          onChange={() => {}}
                        />
                      </div>
                    );
                  })()}
              </DragOverlay>,
              document.body
            )}
        </DndContext>
            </>
            )}
          </>
        )}
            </div>
          )}
        </div>
      </div>

      {/* 2026-07-17, Lino: "rechts am Browser ein schöner Button der nach
            rechts zeigt (Script / Shotlist Editor)... links ein Pfeil-Button
            (Ideen)" — fixed to the actual viewport edge (not the content
            column, unlike the FAB below), vertically centered, one or the
            other depending on activeView. Two follow-ups same day: 1) "der
            Button... muss schöner sein, der ist noch zu versteckt" — was a
            near-invisible flat white/10 chip, first fix made it solid
            blue-600 instead; 2) "soll den typischen Apple Glaseffekt
            haben... aber das Glowen finde ich cool" — solid blue lost that
            glass look, so back to the same Apple-glass recipe as
            IdeaFloatingCard (translucent white tint + heavy blur+saturate
            backdrop-filter, inline style since Tailwind has no utility for
            backdrop-filter's saturate() combo), keeping the pulsing blue
            glow ring from the previous pass — glass card body, blue accent
            glow is what actually makes it read as "important" against it. */}
        {activeView === "ideas" ? (
          <>
            <EdgeNavButton
              side="left"
              onClick={goToProjectsWithTransition}
              ariaLabel="Projektübersicht"
              label="Projektübersicht"
            />
            {data.module_scripting && (
              <EdgeNavButton
                side="right"
                onClick={goToScenes}
                ariaLabel="Script / Shotlist Editor"
                label="Script / Shotlist Editor"
              />
            )}
          </>
        ) : (
          <>
            {data.module_concept && (
              <EdgeNavButton
                side="left"
                onClick={goToIdeas}
                ariaLabel="Ideen"
                label="Ideen"
              />
            )}
            {/* 2026-07-17, Lino: "auf der Szenenansicht braucht es rechts
                wieder den Button um in den naechsten Workflow-Bereich zu
                kommen (Postproduction)" — Postproduction ist eine eigene
                Seite (siehe #11 Schritt 6, eigener Tab statt drittem
                activeView-Zustand), also ein echter Link statt eines
                dritten Swipe-Ziels. Nur wenn das Modul genutzt wird (#96). */}
            {data.module_postproduction && (
              <EdgeNavButton
                side="right"
                onClick={goToPostproductionWithTransition}
                ariaLabel="Postproduction"
                label="Postproduction"
              />
            )}
          </>
        )}

        {/* Fixed bottom-right OF THE CONTENT COLUMN, not the viewport edge —
            same max-w-6xl/mx-auto/px as the content div above, so on a wide
            screen this sits under the actual content instead of out in the
            empty margin to its right. Same idea as the iOS app's
            addSceneButton (an always-visible floating FAB, not part of the
            scrolling page content) — was inline at the bottom of the scene
            list before, which meant scrolling all the way down every time
            to reach it on any project with more than a couple of scenes. */}
        <div className="fixed bottom-6 inset-x-0 z-40 pointer-events-none">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-wrap gap-3 justify-end pointer-events-none [&>*]:pointer-events-auto">
          {/* 2026-07-17, Lino: "+ Hinzufügen unten braucht es nicht [auf
              der Ideenseite]... soll durch den + Idee Button ersetzt
              werden" — while scrolled to the Ideen section, this FAB
              becomes a single-action "+ Idee" button instead of the
              scene/section menu (which makes no sense there — you can't
              add scenes/sections from the Ideen section anyway). Scrolled
              to the Scripting section, it's back to the original menu,
              untouched. */}
          {activeView === "ideas" ? (
            <Button
              variant="primary"
              className="shadow-2xl shadow-black/50"
              onClick={() => ideaGridRef.current?.createIdea()}
            >
              <PlusIcon /> {t("workflow.newIdea")}
            </Button>
          ) : (
            /* Mirrors the iOS app's addSceneButton menu exactly (same 4
                options, same order) — was 3 separate flat buttons before,
                which had no room for a 4th ("Projektinfo") without cluttering
                the toolbar further, and iOS already uses one "+" menu for all
                of these. */
            <Menu
              align="end"
              direction="up"
              trigger={
                <Button variant="primary" className="shadow-2xl shadow-black/50">
                  <PlusIcon /> Hinzufügen
                </Button>
              }
            >
              {(close) => (
                <>
                  <MenuItem
                    onClick={() => {
                      setCreatingScene(true);
                      close();
                    }}
                  >
                    Neue Szene
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      setCreatingIntermediateStep(true);
                      close();
                    }}
                  >
                    Zwischenschritt
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      setCreatingSection(true);
                      close();
                    }}
                  >
                    Abschnitt
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      createProjectInfoScene();
                      close();
                    }}
                  >
                    Info
                  </MenuItem>
                </>
              )}
            </Menu>
          )}
          </div>
        </div>

      {/* Centered modal for the section name, not an inline input next to
          the FAB (Lino, 2026-07-10) — matches every other "name this thing"
          prompt in the app (SceneEditModal etc.) instead of being the one
          exception tucked into a corner. */}
      <Modal open={creatingSection} onClose={() => setCreatingSection(false)} title="Neuer Abschnitt">
        <Input
          autoFocus
          value={newSectionName}
          onChange={(e) => setNewSectionName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && createSection()}
          placeholder="Abschnittsname"
        />
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="ghost" onClick={() => setCreatingSection(false)}>
            Abbrechen
          </Button>
          <Button variant="primary" onClick={createSection}>
            Speichern
          </Button>
        </div>
      </Modal>

      {/* Abschnitt umbenennen — mirrors iOS' contextMenu "Umbenennen" entry
          (see ShotListView.swift's sectionHeader), which the web app never
          had at all (only create/delete existed here before). */}
      <Modal open={editingSection !== null} onClose={() => setEditingSection(null)} title="Abschnitt umbenennen">
        <Input
          autoFocus
          value={editSectionName}
          onChange={(e) => setEditSectionName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && saveEditedSection()}
          placeholder="Abschnittsname"
        />
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="ghost" onClick={() => setEditingSection(null)}>
            Abbrechen
          </Button>
          <Button variant="primary" onClick={saveEditedSection}>
            Speichern
          </Button>
        </div>
      </Modal>

      <SceneEditModal
        open={editingScene !== null || creatingScene || creatingIntermediateStep}
        onClose={() => {
          setEditingScene(null);
          setCreatingScene(false);
          setCreatingIntermediateStep(false);
        }}
        projectId={data.id}
        existing={liveEditingScene}
        shots={liveEditingScene ? shotsFor(liveEditingScene.id) : []}
        previousScene={creatingScene || creatingIntermediateStep ? lastScene : null}
        nextSortOrder={(lastScene?.sort_order ?? -1) + 1}
        sectionId={currentSectionId}
        members={members}
        onCreated={handleSceneCreated}
        onUpdated={handleSceneUpdated}
        onShotCreated={(shot) => updateScenesShots((d) => ({ ...d, shots: [...d.shots, shot] }))}
        onShotUpdated={(shot) => updateScenesShots((d) => ({ ...d, shots: d.shots.map((s) => (s.id === shot.id ? shot : s)) }))}
        isIntermediateStep={creatingIntermediateStep}
      />
      <ConfirmDialog
        open={deleteScene !== null}
        title="Szene löschen?"
        message={`"${deleteScene?.name || "Unbenannte Szene"}" wird endgültig gelöscht.`}
        onConfirm={confirmDeleteScene}
        onCancel={() => setDeleteScene(null)}
      />
      <ConfirmDialog
        open={deleteSection !== null}
        title="Abschnitt löschen?"
        message={`"${deleteSection?.name}" wird gelöscht. Enthaltene Szenen bleiben erhalten und landen unter "Ohne Abschnitt".`}
        onConfirm={confirmDeleteSection}
        onCancel={() => setDeleteSection(null)}
      />
      <ConfirmDialog
        open={deleteUnsectioned}
        title={t("scriptOverview.unsectionedTitle") + " löschen?"}
        message={`${unsectioned.length} Szene${unsectioned.length === 1 ? "" : "n"} ohne Abschnitt werden endgültig gelöscht.`}
        onConfirm={confirmDeleteUnsectioned}
        onCancel={() => setDeleteUnsectioned(false)}
      />
      <ConfirmDialog
        open={sendToPostproduction !== null}
        title="Alle Szenen im Kasten?"
        message={`"${sendToPostproduction?.name}" wandert in die Postproduction-Tracking-Liste.`}
        confirmLabel="Ab in die Postproduction"
        danger={false}
        onConfirm={confirmSendToPostproduction}
        onCancel={() => setSendToPostproduction(null)}
      />
      <ConfirmDialog
        open={cascadeConfirm !== null}
        title="Möchtest du die nachfolgenden Szenen zeitlich angleichen?"
        message=""
        confirmLabel="Bestätigen"
        cancelLabel="Nicht angleichen"
        danger={false}
        onConfirm={confirmCascadeTimes}
        onCancel={() => setCascadeConfirm(null)}
      />
      <TeamPanel
        open={showTeam}
        onClose={() => setShowTeam(false)}
        projectId={data.id}
        teamId={data.team_id}
        members={members}
        onChange={(updater) => setMembers(updater)}
      />
      <NotionImportModal
        open={showNotion}
        onClose={() => setShowNotion(false)}
        project={data}
        onImported={() => api.projectDetail(data.id).then(setData)}
      />
      <ShareLinkModal
        open={showShareModal}
        onClose={() => setShowShareModal(false)}
        projectId={data.id}
        projectName={data.name}
        kind={shareKind}
      />
      <AnnotationsPanel
        open={showAnnotations}
        onClose={() => setShowAnnotations(false)}
        annotations={annotations}
        onChange={(updater) => setAnnotations(updater)}
        scenes={data.scenes}
        highlightedAnnotationId={highlightedAnnotationId}
        onSelect={handleAnnotationSelect}
      />
    </AppShell>
  );
}

// Pure — same idea as computeSceneReorder below, for whole sections.
// insertAfter comes straight from the cursor position (top vs bottom half
// of the target header, see handleSectionDragOver/Drop) rather than being
// inferred from index direction — a pointer-driven flag mirrors the
// insertion line exactly, instead of a "which way did the drag start"
// heuristic that could disagree with what the line last showed.
function computeSectionReorder(sections: Section[], draggedId: string, targetId: string, insertAfter: boolean): Section[] | null {
  const current = [...sections].sort((a, b) => a.sort_order - b.sort_order);
  const draggedIndex = current.findIndex((s) => s.id === draggedId);
  const targetIndexBefore = current.findIndex((s) => s.id === targetId);
  if (draggedIndex === -1 || targetIndexBefore === -1) return null;
  const dragged = current[draggedIndex];
  const withoutDragged = current.filter((s) => s.id !== draggedId);
  let targetIndex = withoutDragged.findIndex((s) => s.id === targetId);
  if (targetIndex === -1) return null;
  if (insertAfter) targetIndex += 1;
  withoutDragged.splice(targetIndex, 0, dragged);
  return withoutDragged.map((s, i) => ({ ...s, sort_order: i }));
}

// Pure — computes what `scenes` would look like if `activeId` were dropped
// on `overIdStr` right now (either another scene's id, or a
// "section-drop:{id}" empty-section drop zone). Returns null if the inputs
// don't resolve to a valid move. Shared by handleSceneDragOver's debounced
// live preview AND handleSceneDragEnd's definitive final computation, so
// the two can never disagree about what a given (scenes, activeId, overId)
// triple resolves to.
function computeSceneReorder(scenes: Scene[], activeId: string, overIdStr: string, insertAfter = false): Scene[] | null {
  const activeScene = scenes.find((s) => s.id === activeId);
  if (!activeScene) return null;

  let targetSectionId: string | null;
  let overSceneId: string | null = null;
  if (overIdStr.startsWith("section-drop:")) {
    targetSectionId = overIdStr.slice("section-drop:".length) || null;
  } else {
    const overScene = scenes.find((s) => s.id === overIdStr);
    if (!overScene || overScene.id === activeId) return null;
    targetSectionId = overScene.section_id;
    overSceneId = overScene.id;
  }

  const sourceSectionId = activeScene.section_id;

  // No more "only one Info tile per section" restriction (Lino, 2026-07-11:
  // "man soll jetzt mehrere Info-Kacheln in einen Abschnitt legen können")
  // — an is_project_info scene is now just a normal scene for every
  // placement purpose, full stop, including how many can share a section.

  // Renumber each affected section from ITS OWN scenes sorted by their
  // current sort_order — never from raw array position. The scenes array
  // this data comes from has no guaranteed order (the backend relationship
  // it's fetched from doesn't sort it), so walking raw array order here
  // would reassign sequential sort_order to whatever section a scene
  // happened to sit next to in that arbitrary order — corrupting a
  // completely unrelated, untouched section's sequence in the process
  // (confirmed via a real reload-mismatch: dragging a scene between two
  // sections silently swapped the sort_order of two scenes in a THIRD
  // section that was never part of the drag).
  const targetSectionScenes = scenes.filter((s) => s.section_id === targetSectionId && s.id !== activeId).sort((a, b) => a.sort_order - b.sort_order);
  let insertAt = targetSectionScenes.length;
  if (overSceneId) {
    const idx = targetSectionScenes.findIndex((s) => s.id === overSceneId);
    // insertAfter mirrors the insertion-line indicator exactly (left half
    // of the hovered card = insert before it, right half = after) — the
    // preview and the actual result must always agree on this, or dropping
    // lands somewhere different than what the line just showed. An
    // is_project_info scene (Info tile) is no longer pinned to a fixed
    // position (Lino, 2026-07-11: "kann wie eine normale Szenenkachel
    // behandelt werden von der Platzierung her") — it drags/reorders
    // exactly like any other scene now, on both sides of this check.
    if (idx !== -1) insertAt = insertAfter ? idx + 1 : idx;
  }
  const newTargetOrder = [...targetSectionScenes];
  newTargetOrder.splice(insertAt, 0, { ...activeScene, section_id: targetSectionId });
  const renumberedTarget = newTargetOrder.map((s, i) => (s.sort_order === i ? s : { ...s, sort_order: i }));

  let renumberedSource: Scene[] = [];
  if (sourceSectionId !== targetSectionId) {
    // Cross-section move: the source section's remaining scenes close the
    // gap the active scene left behind, same section-scoped renumbering.
    renumberedSource = scenes
      .filter((s) => s.section_id === sourceSectionId && s.id !== activeId)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((s, i) => (s.sort_order === i ? s : { ...s, sort_order: i }));
  }

  const touchedIds = new Set([...renumberedTarget.map((s) => s.id), ...renumberedSource.map((s) => s.id)]);
  const untouched = scenes.filter((s) => !touchedIds.has(s.id));
  return [...untouched, ...renumberedSource, ...renumberedTarget];
}

// Serializes backend move calls across successive drags (even across
// separate SectionBlocks/tables). Two drags fired back-to-back used to send
// their moveScene calls concurrently, and each call renumbers/reorders every
// sibling scene in the project server-side - an in-flight call from drag #1
// racing with drag #2's could scramble sort_order/number-letter assignment
// badly enough that two scenes ended up sharing a number, which read as a
// "duplicated" tile. Chaining through this queue guarantees only one
// moveScene request is ever in flight at a time.
let reorderQueue: Promise<void> = Promise.resolve();

async function reorderScenes(
  api: ReturnType<typeof useApi>,
  ordered: Scene[],
  movedSceneId: string,
  beforeSceneId: string | null,
  setData: React.Dispatch<React.SetStateAction<ProjectDetail | null>>
) {
  setData((prev) => {
    if (!prev) return prev;
    const others = prev.scenes.filter((s) => !ordered.some((o) => o.id === s.id));
    return { ...prev, scenes: [...others, ...ordered] };
  });
  // Only the scene that actually moved needs a backend call - everything
  // else in `ordered` just shifted index because of it.
  reorderQueue = reorderQueue.then(() =>
    api.moveScene(movedSceneId, beforeSceneId).then(
      () => {},
      () => {
        // best-effort; a full reload will fix any drift
      }
    )
  );
  await reorderQueue;
}

function SectionBlock({
  section,
  title,
  scenes,
  sceneNumberById,
  shotsFor,
  members,
  onChange,
  onEditScene,
  onDeleteScene,
  onDuplicateScene,
  onDeleteSection,
  onEditSection,
  onSendToPostproduction,
  sectionDragDisabled,
  draggingSectionId,
  sectionInsertionIndicator,
  insertionIndicator,
  viewMode,
  projectId,
  onSectionChange,
  onOpenTeam,
  onSortScenes,
  dragDisabled,
  annotationsByScene,
  highlightedAnnotationId,
  onAnnotationClick,
}: {
  /** Undefined for the "Ohne Abschnitt" bucket — that one has no real
   * SceneSection to drag/attach a project-info box to. */
  section?: Section;
  title?: string;
  scenes: Scene[];
  /** Position-in-section count, 1..N, keyed by scene id — see its own
   * doc comment on sceneNumberBySectionId in the parent. Replaces the old
   * screenplay-style scene.number/letter badge everywhere in this block. */
  sceneNumberById: Map<string, number>;
  shotsFor: (sceneId: string) => Shot[];
  members: Member[];
  onChange: (updater: (d: { scenes: Scene[]; shots: Shot[] }) => { scenes: Scene[]; shots: Shot[] }) => void;
  onEditScene: (scene: Scene) => void;
  onDeleteScene: (scene: Scene) => void;
  onDuplicateScene?: (scene: Scene) => void;
  onDeleteSection?: (section: Section) => void;
  onEditSection?: (section: Section) => void;
  /** Undefined = das Projekt nutzt das Postproduction-Modul nicht (#96) —
   * dann taucht der Menüpunkt gar nicht erst auf. */
  onSendToPostproduction?: (section: Section) => void;
  insertionIndicator?: { targetId: string; edge: "left" | "right" | "top" | "bottom" } | null;
  /** Same "man kann in diesem modus keine kacheln verschieben" rule as
   * scenes' dragDisabled — hides the grip handle entirely. */
  sectionDragDisabled?: boolean;
  draggingSectionId?: string | null;
  sectionInsertionIndicator?: { targetId: string; edge: "top" | "bottom" } | null;
  viewMode: "grid" | "table";
  projectId?: string;
  onSectionChange?: (updated: Section) => void;
  onOpenTeam?: () => void;
  onSortScenes?: (criterion: "number" | "time" | "location" | "priority") => void;
  /** 2026-07-14, comment mode (see page.tsx's showAnnotations) — "man kann
   * in diesem modus keine kacheln verschieben". */
  dragDisabled?: boolean;
  annotationsByScene?: Map<string, Annotation[]>;
  highlightedAnnotationId?: string | null;
  onAnnotationClick?: (a: Annotation) => void;
}) {
  const { t } = useLanguage();
  const postproductionStatusLabels: Record<PostproductionStatus, string> = {
    wartend: t("postproductionStatus.wartend"),
    in_bearbeitung: t("postproductionStatus.inBearbeitung"),
    wartet_auf_feedback: t("postproductionStatus.wartetAufFeedback"),
    abgeschlossen: t("postproductionStatus.abgeschlossen"),
    abgelehnt: t("postproductionStatus.abgelehnt"),
  };
  const doneCount = scenes.filter((s) => s.completed).length;

  // Section-level sortable (2026-07-21) — id is a stable placeholder when
  // there's no real section (the "Ohne Abschnitt" bucket), `disabled` makes
  // it fully inert there so it's never a real drag source/target; the id
  // itself is never added to the page-level SortableContext's `items` list
  // for that bucket anyway, this is just satisfying the Rules of Hooks
  // (useSortable must be called unconditionally, section is optional).
  const sortableSection = useSortable({ id: section?.id ?? "__unsectioned__", disabled: !section || sectionDragDisabled });

  // No DndContext/sensors/DragOverlay here anymore — dragging a scene
  // *between* sections needs one shared DndContext spanning every section
  // at once (dnd-kit's documented "multiple containers" pattern: several
  // SortableContexts, one parent DndContext), so that lives on the page
  // component now. This SortableContext is still scoped to just this
  // section's own scenes (needed for correct within-section drag visuals),
  // but the drag gesture itself is handled by the ancestor. SectionDropZone
  // below is what makes an empty section (or dropping past the last card)
  // a valid target, not just dropping directly onto another card.
  const grid = (
    <SortableContext items={scenes.map((s) => s.id)} strategy={rectSortingStrategy}>
      {/* Widened by 16px on each side (negative margin) with matching inner
          padding to cancel it back out — the grid itself, and every card's
          size/position inside it, ends up pixel-identical to before. Only
          gives the -9px insertion-line offset on the outermost column (see
          SortableSceneCard) more guaranteed non-clipped room around it
          (2026-07-13, Lino: "der Indikator wird NIE ganz rechts/links am
          Seitenrand angezeigt" — widen the container, not the cards). */}
      <div className="-mx-4 px-4 overflow-visible">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
        {scenes.map((scene) => (
          <SortableSceneCard
            key={scene.id}
            scene={scene}
            displayNumber={sceneNumberById.get(scene.id)}
            shots={shotsFor(scene.id)}
            members={members}
            onEdit={() => onEditScene(scene)}
            onDelete={() => onDeleteScene(scene)}
            onDuplicate={onDuplicateScene ? () => onDuplicateScene(scene) : undefined}
            onChange={onChange}
            onOpenTeam={onOpenTeam ?? (() => {})}
            insertionEdge={insertionIndicator?.targetId === scene.id ? insertionIndicator.edge : null}
            dragDisabled={dragDisabled}
            annotations={annotationsByScene?.get(scene.id)}
            highlightedAnnotationId={highlightedAnnotationId}
            onAnnotationClick={onAnnotationClick}
          />
        ))}
      </div>
      </div>
      <SectionDropZone sectionId={section?.id ?? null} insertionIndicator={insertionIndicator} />
    </SortableContext>
  );

  const content =
    viewMode === "table" ? (
      <SceneTable
        scenes={scenes}
        sceneNumberById={sceneNumberById}
        shotsFor={shotsFor}
        members={members}
        onEditScene={onEditScene}
        onDeleteScene={onDeleteScene}
        onDuplicateScene={onDuplicateScene}
        onChange={onChange}
        sectionId={section?.id ?? null}
        insertionIndicator={insertionIndicator}
      />
    ) : (
      grid
    );

  if (!title) {
    return <div className="mb-5">{content}</div>;
  }

  const sectionInsertionEdge = section && sectionInsertionIndicator?.targetId === section.id ? sectionInsertionIndicator.edge : null;

  return (
    <div
      ref={sortableSection.setNodeRef}
      // pb-5 (padding), not mb-5 (margin) — 2026-07-15, Lino: "beim
      // abschnitt dragen... muss man die linie super genau treffen". A
      // margin sits OUTSIDE the box and isn't part of it for hit-testing,
      // so the ~20px gap between two sections (exactly where a user
      // intuitively aims when dropping "between" them) needs to be real
      // padding, inside the border-box, to stay part of this drop target.
      className="relative pb-5 transition-transform"
      // section && ... — without the `section &&` guard this was also true
      // for the "Ohne Abschnitt" bucket (section is undefined there) any
      // time draggingSectionId was ALSO undefined (i.e. nothing being
      // dragged at all, the normal/idle state) — undefined === undefined,
      // permanently dimming the unsectioned bucket even when nothing was
      // being dragged (Lino, 2026-07-10: "sollen NICHT ausgegraut werden").
      style={{
        transform: DndCSS.Transform.toString(sortableSection.transform),
        transition: sortableSection.transition,
        ...(section && draggingSectionId === section.id ? { opacity: 0.4 } : undefined),
      }}
    >
      {/* Notion-style insertion line, same idea as scenes' left/right —
          sections stack vertically so top/bottom is the meaningful edge.
          Positioned on the OUTER wrapper (not just the header) so it reads
          clearly as "the whole section goes here", not just its title row.
          INSIDE the wrapper's own box (top-0/bottom-0, not a negative
          offset like scenes' left/right line uses) — native HTML5 D&D's
          drop/dragover fire off real elementFromPoint hit-testing (unlike
          dnd-kit's own geometry-based collision detection for scenes), so a
          line drawn outside the wrapper's box sat in the dead margin gap
          between sections: releasing right on the line — the exact thing
          it invites you to do — landed on no valid drop target at all and
          silently did nothing (Lino, 2026-07-10: "die blaue linie wird
          angezeigt aber der Abschnitt wird nicht verschoben"). */}
      {sectionInsertionEdge === "top" && (
        <div className="absolute top-0 left-0 right-0 h-[3px] rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.7)] pointer-events-none" />
      )}
      {sectionInsertionEdge === "bottom" && (
        <div className="absolute bottom-0 left-0 right-0 h-[3px] rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.7)] pointer-events-none" />
      )}
      <div className="flex items-start gap-1">
        {section && !sectionDragDisabled && (
          <span
            {...sortableSection.attributes}
            {...sortableSection.listeners}
            // 2026-07-21: real dnd-kit sortable now (see sortableSection
            // above), listeners/attributes scoped to just this handle span
            // (dnd-kit's own documented "drag handle" pattern) — the whole
            // section list shares ONE DndContext with the scene-level drag
            // now, so there's no second, independent drag system left to
            // race against on the same pointerdown. This handle used to be
            // plain native HTML5 D&D specifically to dodge that race (see
            // [[project_subshot_architecture]]'s #38 "3 von 10" note) —
            // converting it removes the race at the root instead.
            className="cursor-grab active:cursor-grabbing text-white/20 hover:text-white/50 shrink-0 p-1.5 mt-0.5 touch-none"
            title="Abschnitt verschieben"
          >
            <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor">
              <circle cx="2" cy="2" r="1.4" /><circle cx="2" cy="8" r="1.4" /><circle cx="2" cy="14" r="1.4" />
              <circle cx="9" cy="2" r="1.4" /><circle cx="9" cy="8" r="1.4" /><circle cx="9" cy="14" r="1.4" />
            </svg>
          </span>
        )}
        <div className="flex-1 min-w-0">
          <Collapsible
            title={title}
            titleClassName="text-sm"
            // 2026-09-07, Lino: reversed the 2026-08-08 "immer eingeklappt"
            // rule — since the 2026-08-30 tile-overview redesign only ONE
            // section is ever rendered at a time (see the `openSectionId`
            // filter above), so a collapsed default meant every tile click
            // needed a second click just to see its scenes. Sections should
            // always start open when you open them; a user collapsing one
            // manually during their session is untouched by this (fresh
            // `useState(defaultOpen)` per mount via SectionBlock's `key`).
            defaultOpen={true}
            subtitle={
              section?.in_postproduction && section.postproduction_status
                ? `${doneCount}/${scenes.length} · ${postproductionStatusLabels[section.postproduction_status]}`
                : `${doneCount}/${scenes.length}`
            }
            actions={
              // Menu itself no longer requires a real `section` (2026-07-13:
              // sort-by options are useful for "Ohne Abschnitt" too) -
              // rename/delete stay conditional on one existing.
              (onSortScenes || (section && onDeleteSection) || (section && !section.in_postproduction && onSendToPostproduction)) && (
                <Menu
                  trigger={
                    <IconButton size={24} className="text-white/30 hover:text-white/70">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="5" cy="12" r="1.8" />
                        <circle cx="12" cy="12" r="1.8" />
                        <circle cx="19" cy="12" r="1.8" />
                      </svg>
                    </IconButton>
                  }
                >
                  {(close) => (
                    <>
                      {onSortScenes && scenes.length > 1 && (
                        <>
                          <MenuItem
                            onClick={() => {
                              onSortScenes("number");
                              close();
                            }}
                          >
                            Nach Identifikationsnummer sortieren
                          </MenuItem>
                          <MenuItem
                            onClick={() => {
                              onSortScenes("time");
                              close();
                            }}
                          >
                            Nach Zeit sortieren
                          </MenuItem>
                          <MenuItem
                            onClick={() => {
                              onSortScenes("location");
                              close();
                            }}
                          >
                            Nach Ort sortieren
                          </MenuItem>
                          <MenuItem
                            onClick={() => {
                              onSortScenes("priority");
                              close();
                            }}
                          >
                            Nach Priorität sortieren
                          </MenuItem>
                        </>
                      )}
                      {section && onEditSection && (
                        <MenuItem
                          onClick={() => {
                            onEditSection(section);
                            close();
                          }}
                        >
                          Umbenennen
                        </MenuItem>
                      )}
                      {section && !section.in_postproduction && onSendToPostproduction && (
                        <MenuItem
                          onClick={() => {
                            onSendToPostproduction(section);
                            close();
                          }}
                        >
                          Ab in die Postproduction
                        </MenuItem>
                      )}
                      {section && onDeleteSection && (
                        <MenuItem
                          danger
                          onClick={() => {
                            onDeleteSection(section);
                            close();
                          }}
                        >
                          Abschnitt löschen
                        </MenuItem>
                      )}
                    </>
                  )}
                </Menu>
              )
            }
          >
            {content}
          </Collapsible>
        </div>
      </div>
    </div>
  );
}

// Always-present drop target INSIDE a section, below its scenes — an empty
// (or collapsed-looking, few-scene) section previously had no way to drop a
// scene into it at all in the multi-container dnd-kit setup (dropping
// directly onto another card works via useSortable already, but an empty
// section has no cards to drop onto). id encodes which section (or the
// unsectioned bucket) this is; the page-level handleDragEnd below decodes
// it. Mirrors the iOS app's sectionDropZone.
//
// A card-reflow preview used to double up with a blue highlight bar here
// and read as two different things happening at once (Lino: "wieso soll ich
// eine karte auf die andere karte legen") — that reflow is gone now
// (nothing moves until drop, see handleSceneDragOver's comment), which left
// this zone with NO landing feedback at all. That's exactly what made
// dropping a Projektinfo tile into a section a guessing game (Lino: "hat
// man keine Ahnung wo man die Projektinfo ablegen muss") — an empty/sparse
// section has no neighboring card to show the left/right insertion line
// against. Highlight is now driven by the same shared `insertionIndicator`
// state as every other drop target, so it's the one consistent mechanism.
function SectionDropZone({ sectionId, insertionIndicator }: { sectionId: string | null; insertionIndicator?: { targetId: string } | null }) {
  const { setNodeRef } = useDroppable({ id: `section-drop:${sectionId ?? ""}`, data: { sectionId } });
  const active = insertionIndicator?.targetId === `section-drop:${sectionId ?? ""}`;
  return (
    <div
      ref={setNodeRef}
      // Taller hit area (was h-11/44px) — 2026-07-14, Lino: dragging a
      // scene toward the END of its section, right before the NEXT
      // section's header, landed in that next section instead. Root cause:
      // sceneCollisionDetection's closestCenter last-resort fallback (see
      // its own comment) jumps to whichever REAL card's center is nearest
      // once the cursor is past both this dropzone's rect and any card
      // rect — with only 44px of hit area here, the cursor crosses into
      // "closer to the next section's first card" territory almost
      // immediately after leaving the last card, well before a user
      // visually feels like they've left this section. A much taller zone
      // keeps the cursor inside a REAL pointerWithin/rectIntersection hit
      // (this dropzone) for longer, so the ambiguous cross-section
      // fallback only ever kicks in once the cursor is unambiguously in
      // the next section.
      className={`h-24 rounded-xl mt-2 border-2 border-dashed transition-colors ${
        active ? "border-blue-500 bg-blue-500/10" : "border-transparent"
      }`}
    />
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function InfoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v5h1" />
    </svg>
  );
}
function DocIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" />
    </svg>
  );
}
function GoodTakeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17 2H9L4 7v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Zm-9 4h2v5H8V6Zm4 0h2v5h-2V6Zm4 0h2v5h-2V6Z" />
    </svg>
  );
}
function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
      <path d="M8.6 10.5 15.4 6.5M8.6 13.5l6.8 4" />
    </svg>
  );
}
function NotionIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 7h2l6 8V7h2M7 17h2" />
    </svg>
  );
}
function CommentIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}
function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}
function TableIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="1" /><path d="M3 10h18M9 10v10" />
    </svg>
  );
}
