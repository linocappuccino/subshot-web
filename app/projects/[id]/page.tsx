"use client";

import { useEffect, useRef, useState, use as usePromise } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
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
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import { useApi } from "@/lib/useApi";
import { ApiError } from "@/lib/api";
import type { Annotation, Member, ProjectDetail, Scene, Section, Shot } from "@/lib/types";
import { SortableSceneCard } from "@/app/components/SortableSceneCard";
import { SceneCard } from "@/app/components/SceneCard";
import { SceneEditModal } from "@/app/components/SceneEditModal";
import { SceneTable } from "@/app/components/SceneTable";
import { ProjectInfoBox } from "@/app/components/ProjectInfoBox";
import { ProjectInfoTile } from "@/app/components/ProjectInfoTile";
import { TeamPanel } from "@/app/components/TeamPanel";
import { NotionImportModal } from "@/app/components/NotionImportModal";
import { ShareLinkModal } from "@/app/components/ShareLinkModal";
import { AnnotationsPanel } from "@/app/components/AnnotationsPanel";
import { Modal } from "@/app/components/ui/Modal";
import { AppShell } from "@/app/components/AppShell";
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

  const pointerHits = pointerWithin(args);
  const pointerCardHits = pointerHits.filter(isRealCard);
  if (pointerCardHits.length > 0) return pointerCardHits;

  const rectHits = rectIntersection(args);
  const rectCardHits = rectHits.filter(isRealCard);
  if (rectCardHits.length > 0) return rectCardHits;

  const closestCardHits = closestCenter(args).filter(isRealCard);
  if (closestCardHits.length > 0) return closestCardHits;

  // Nothing real anywhere nearby — genuinely an empty/near-empty section,
  // or past the end of the list. Fall back to whatever section-drop zone
  // pointerWithin/rectIntersection found, same as before this fix.
  const pointerNonActive = pointerHits.filter((c) => c.id !== activeId);
  if (pointerNonActive.length > 0) return pointerNonActive;
  return rectHits.filter((c) => c.id !== activeId);
};

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const api = useApi();
  const toast = useToast();

  const [data, setData] = useState<ProjectDetail | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [creatingScene, setCreatingScene] = useState(false);
  // "Zwischenschritt" (mirrors the iOS app's addSceneButton menu) — a
  // lighter connective-beat scene variant, creation-time choice only, see
  // SceneEditModal's isIntermediateStep prop.
  const [creatingIntermediateStep, setCreatingIntermediateStep] = useState(false);
  const [editingScene, setEditingScene] = useState<Scene | null>(null);
  const [deleteScene, setDeleteScene] = useState<Scene | null>(null);
  const [deleteSection, setDeleteSection] = useState<Section | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [creatingSection, setCreatingSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  const [editingSection, setEditingSection] = useState<Section | null>(null);
  const [editSectionName, setEditSectionName] = useState("");
  const [showTeam, setShowTeam] = useState(false);
  const [showNotion, setShowNotion] = useState(false);
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
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
  // Section drag-and-drop (plain HTML5 D&D, not dnd-kit — see reorderSections'
  // comment further down) — same live-preview-on-hover + origin-snapshot
  // pattern as scenes/shots above, just driven by native dragover/dragend
  // events instead of dnd-kit's since native D&D can't reliably read
  // dataTransfer payloads during dragover (only at drop), so which section
  // is being dragged has to live in React state instead.
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
    Promise.all([api.projectDetail(id), api.members(id), api.listAnnotations(id)]).then(([d, m, a]) => {
      if (cancelled) return;
      setData(d);
      setMembers(m);
      setAnnotations(a);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Lightweight "live updates" (2026-07-10): polls every 12s while this
  // page is open so a teammate's edits show up without anyone reloading —
  // deliberately NOT a websocket/real-time typing sync (overkill for a shot
  // list, same reasoning as the iOS app's identical polling loop in
  // ShotListView.swift). setData replaces state wholesale but React keys
  // scene/shot lists by id, so this diffs in place with no flicker/loading
  // flash — no isLoading gate anywhere in this component either.
  useEffect(() => {
    const interval = setInterval(() => {
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
  // asked/confirmed via dialog, never silently. `editingScene` still holds
  // the PRE-edit scene here (SceneEditModal's onUpdated fires before the
  // page clears it in its own onClose), so it's the only place that knows
  // both the old and new start time.
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
    const previous = editingScene;
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

  // Full refetch rather than patching local state (2026-07-11) — the
  // backend shifts sort_order on every sibling from the duplicate's
  // insertion point onward (see duplicate_scene in main.py) to make room
  // right next to the original, and duplicating is infrequent enough
  // (unlike dragging) that a plain refetch is simpler and safer than trying
  // to mirror that shift locally and risking the same kind of drift bug
  // that plagued the drag-and-drop reorder logic before it got a backend
  // source of truth.
  async function handleDuplicateScene(scene: Scene) {
    try {
      await api.duplicateScene(scene.id);
      const fresh = await api.projectDetail(data!.id);
      setData(fresh);
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

  // Section-level reordering (drag the whole section, scenes included) —
  // same "insert before/after target depending on drag direction" approach
  // as the iOS app's ShotListViewModel.reorderSection, since the backend
  // has no dedicated "move section" endpoint (unlike scenes/shots, which
  // do — see reorderScenes). Plain native HTML5 drag-and-drop (not dnd-kit)
  // on purpose, kept as an independent mechanism from the scene-level
  // dnd-kit DndContext below (handleSceneDragEnd) rather than folding
  // section-dragging into the same DndContext — a section drag-handle is
  // never a dnd-kit sortable item, so there's no event conflict, and it
  // avoids having to discriminate "is this drag a scene or a whole
  // section" inside one shared collision-detection/onDragEnd handler.
  //
  // Insertion-line-only, same as scenes (see handleSceneDragOver's
  // comment) — nothing in `data.sections` moves until drop, only the
  // indicator line updates during the drag itself.
  function handleSectionDragStart(id: string) {
    setDraggingSectionId(id);
    dragOriginSectionsRef.current = data?.sections ?? null;
  }

  function handleSectionDragOver(targetId: string, e: React.DragEvent) {
    if (!draggingSectionId || draggingSectionId === targetId) {
      setSectionInsertionIndicator(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setSectionInsertionIndicator({ targetId, edge: e.clientY < rect.top + rect.height / 2 ? "top" : "bottom" });
  }

  // Recomputes the definitive final order fresh from the actual drop
  // event's own cursor position (same reasoning as handleSceneDragEnd —
  // never trust stale hover state), so what's persisted always matches
  // exactly what the insertion line last pointed at. computeSectionReorder
  // is still used for the local array (drives the visible order
  // immediately), but persistence is now a single api.moveSection call
  // (2026-07-13) — same server-authoritative move_section endpoint iOS
  // uses, replacing the old per-changed-section Promise.all(patchSection)
  // loop (see move_section in the backend for why: one shared computation
  // instead of two independently-implemented, potentially divergent ones).
  async function handleSectionDrop(targetId: string, e: React.DragEvent) {
    setSectionInsertionIndicator(null);
    const origin = dragOriginSectionsRef.current;
    dragOriginSectionsRef.current = null;
    const draggedId = draggingSectionId;
    setDraggingSectionId(null);

    if (!data || !origin || !draggedId || draggedId === targetId) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const insertAfter = e.clientY >= rect.top + rect.height / 2;
    const next = computeSectionReorder(data.sections, draggedId, targetId, insertAfter);
    if (!next) return;
    setData((prev) => (prev ? { ...prev, sections: next } : prev));
    const idx = next.findIndex((s) => s.id === draggedId);
    const beforeId = next[idx + 1]?.id ?? null;
    try {
      await api.moveSection(draggedId, beforeId);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Umsortieren fehlgeschlagen.");
    }
  }

  // Fires on the drag SOURCE after every drag, successful or not (native
  // D&D always calls dragend). Nothing was ever mutated during the drag
  // itself (see above), so cancelling just clears the indicator/state —
  // no revert needed.
  function handleSectionDragEnd() {
    setDraggingSectionId(null);
    setSectionInsertionIndicator(null);
    dragOriginSectionsRef.current = null;
  }

  // Scene-level drag start — snapshots the pre-drag order so a cancelled or
  // invalid drop can restore it exactly (see handleSceneDragCancel/End).
  function handleSceneDragStart(event: DragStartEvent) {
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
  function handleSceneDragOver(event: DragOverEvent) {
    const { active, over } = event;
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
  function handleSceneDragCancel() {
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
      });
      setData((prev) => (prev ? { ...prev, scenes: [...prev.scenes, scene] } : prev));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Fehlgeschlagen.");
    }
  }

  // 2026-07-13, Lino: "beim Klick auf PDF Export soll zuerst gefragt werden,
  // ob Kachelansicht oder Tabellenansicht exportiert werden soll" — was a
  // single click straight to the (card-only) export before.
  async function exportPdf(view: "cards" | "table") {
    if (!data) return;
    setExportingPdf(true);
    try {
      const url = await api.projectPdfUrl(data.id, view);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${data.name || "shotlist"}.pdf`;
      a.click();
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "PDF-Export fehlgeschlagen.");
    } finally {
      setExportingPdf(false);
    }
  }

  if (!data) {
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
  // everything, same as every other scene. Still just sort_order compare
  // (like shotsFor/sections below) — the backend relationship this data
  // comes from doesn't guarantee sort_order sequence on its own, so
  // without this a fresh page load could show scenes in a different order
  // than whatever was last dragged into place.
  const scenesIn = (sectionId: string | null) =>
    data.scenes
      .filter((s) => s.section_id === sectionId)
      .sort((a, b) => a.sort_order - b.sort_order);

  const shotsFor = (sceneId: string) => data.shots.filter((s) => s.scene_id === sceneId && s.status !== "deleted").sort((a, b) => a.sort_order - b.sort_order);

  const sections = [...data.sections].sort((a, b) => a.sort_order - b.sort_order);
  const unsectioned = scenesIn(null);
  const lastScene = [...data.scenes].sort((a, b) => a.sort_order - b.sort_order).at(-1) ?? null;

  return (
    <AppShell>
      {/* pb-28 (not just py-8) so the fixed "+ Hinzufügen" FAB never
          overlaps the last scene/section when scrolled to the bottom. */}
      <div className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 pt-8 pb-28">
        <div className="flex items-start justify-between mb-8 gap-3 flex-wrap">
          <div>
            <Link href="/projects" className="text-sm text-white/40 hover:text-white/70 transition-colors flex items-center gap-1 mb-1">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 18-6-6 6-6" />
              </svg>
              Projekte
            </Link>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              {data.emoji && <span>{data.emoji}</span>} {data.name}
            </h1>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="secondary" size="sm" onClick={() => setShowTeam(true)}>
              <UsersIcon /> Team
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setShowAnnotations(true)} className="relative">
              <CommentIcon /> Kommentare
              {annotations.some((a) => a.status === "open") && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                  {annotations.filter((a) => a.status === "open").length}
                </span>
              )}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setShowNotion(true)}>
              <NotionIcon /> Notion-Import
            </Button>
            <Menu
              trigger={
                <Button variant="secondary" size="sm" disabled={exportingPdf}>
                  <DocIcon /> {exportingPdf ? "Exportiert…" : "PDF"}
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
                    Kachelansicht
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      exportPdf("table");
                      close();
                    }}
                  >
                    Tabellenansicht
                  </MenuItem>
                </>
              )}
            </Menu>
            <Button variant="secondary" size="sm" onClick={() => setShowShareModal(true)}>
              <ShareIcon /> Teilen
            </Button>
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
          </div>
        </div>

        <ProjectInfoBox
          project={data}
          members={members}
          onProjectChange={(updater) => setData((prev) => (prev ? { ...prev, ...updater(prev) } : prev))}
          onOpenTeam={() => setShowTeam(true)}
          todoLists={data.todo_lists}
          onTodoListsChange={(updater) => setData((prev) => (prev ? { ...prev, todo_lists: updater(prev.todo_lists) } : prev))}
        />

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
          collisionDetection={sceneCollisionDetection}
          // Faster viewport-edge auto-scroll while dragging (2026-07-13,
          // Lino: default dnd-kit acceleration was too slow; bumped again
          // 2026-07-14, still felt "super langsam" at 40 — dnd-kit scrolls
          // scrollBy(speed) every `interval` ms, speed maxing out at
          // `acceleration` px only right at the very edge of the 20%
          // threshold zone, so this is the actual top speed once the
          // cursor is fully at the viewport edge).
          autoScroll={{ acceleration: 120, interval: 5 }}
          onDragStart={handleSceneDragStart}
          onDragOver={handleSceneDragOver}
          onDragEnd={handleSceneDragEnd}
          onDragCancel={handleSceneDragCancel}
        >
          {sections.map((section) => {
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
                onSectionDragStart={handleSectionDragStart}
                onSectionDragOver={handleSectionDragOver}
                onSectionDrop={handleSectionDrop}
                onSectionDragEnd={handleSectionDragEnd}
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
              />
            );
          })}

          {/* Renders even when currently empty, same reasoning as sections
              above — with cross-section dragging, "Ohne Abschnitt" needs to
              stay a valid drop target (SectionDropZone) even with nothing in
              it yet, or there'd be no way to drag a scene back out of every
              section. Only fully hidden when there are no sections at all
              (then unsectioned IS every scene, rendered titleless below). */}
          {(unsectioned.length > 0 || sections.length > 0) && (
            <SectionBlock
              title={sections.length > 0 ? "Ohne Abschnitt" : undefined}
              scenes={unsectioned}
              shotsFor={shotsFor}
              members={members}
              onChange={updateScenesShots}
              onEditScene={setEditingScene}
              onDeleteScene={setDeleteScene}
              onDuplicateScene={handleDuplicateScene}
              insertionIndicator={insertionIndicator}
              viewMode={viewMode}
              onSortScenes={(criterion) => handleSortScenes(null, criterion)}
            />
          )}

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
                    <SceneCard scene={activeScene} shots={shotsFor(activeScene.id)} members={members} onEdit={() => {}} onDelete={() => {}} onChange={() => {}} />
                  </div>
                );
              })()}
          </DragOverlay>
        </DndContext>

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
          {/* Mirrors the iOS app's addSceneButton menu exactly (same 4
              options, same order) — was 3 separate flat buttons before,
              which had no room for a 4th ("Projektinfo") without cluttering
              the toolbar further, and iOS already uses one "+" menu for all
              of these. */}
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
          </div>
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
        existing={editingScene}
        previousScene={creatingScene || creatingIntermediateStep ? lastScene : null}
        nextSortOrder={(lastScene?.sort_order ?? -1) + 1}
        members={members}
        onCreated={handleSceneCreated}
        onUpdated={handleSceneUpdated}
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
      />
      <AnnotationsPanel
        open={showAnnotations}
        onClose={() => setShowAnnotations(false)}
        annotations={annotations}
        onChange={(updater) => setAnnotations(updater)}
        scenes={data.scenes}
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
  shotsFor,
  members,
  onChange,
  onEditScene,
  onDeleteScene,
  onDuplicateScene,
  onDeleteSection,
  onEditSection,
  onSectionDragStart,
  onSectionDragOver,
  onSectionDrop,
  onSectionDragEnd,
  draggingSectionId,
  sectionInsertionIndicator,
  insertionIndicator,
  viewMode,
  projectId,
  onSectionChange,
  onOpenTeam,
  onSortScenes,
}: {
  /** Undefined for the "Ohne Abschnitt" bucket — that one has no real
   * SceneSection to drag/attach a project-info box to. */
  section?: Section;
  title?: string;
  scenes: Scene[];
  shotsFor: (sceneId: string) => Shot[];
  members: Member[];
  onChange: (updater: (d: { scenes: Scene[]; shots: Shot[] }) => { scenes: Scene[]; shots: Shot[] }) => void;
  onEditScene: (scene: Scene) => void;
  onDeleteScene: (scene: Scene) => void;
  onDuplicateScene?: (scene: Scene) => void;
  onDeleteSection?: (section: Section) => void;
  onEditSection?: (section: Section) => void;
  insertionIndicator?: { targetId: string; edge: "left" | "right" | "top" | "bottom" } | null;
  onSectionDragStart?: (id: string) => void;
  onSectionDragOver?: (targetId: string, e: React.DragEvent) => void;
  onSectionDrop?: (targetId: string, e: React.DragEvent) => void;
  onSectionDragEnd?: () => void;
  draggingSectionId?: string | null;
  sectionInsertionIndicator?: { targetId: string; edge: "top" | "bottom" } | null;
  viewMode: "grid" | "table";
  projectId?: string;
  onSectionChange?: (updated: Section) => void;
  onOpenTeam?: () => void;
  onSortScenes?: (criterion: "number" | "time" | "location" | "priority") => void;
}) {
  const doneCount = scenes.filter((s) => s.completed).length;

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
        <AnimatePresence>
          {scenes.map((scene) => (
            <SortableSceneCard
              key={scene.id}
              scene={scene}
              shots={shotsFor(scene.id)}
              members={members}
              onEdit={() => onEditScene(scene)}
              onDelete={() => onDeleteScene(scene)}
              onDuplicate={onDuplicateScene ? () => onDuplicateScene(scene) : undefined}
              onChange={onChange}
              onOpenTeam={onOpenTeam ?? (() => {})}
              insertionEdge={insertionIndicator?.targetId === scene.id ? insertionIndicator.edge : null}
            />
          ))}
        </AnimatePresence>
      </div>
      </div>
      <SectionDropZone sectionId={section?.id ?? null} insertionIndicator={insertionIndicator} />
    </SortableContext>
  );

  const content =
    viewMode === "table" ? (
      <SceneTable
        scenes={scenes}
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
      className="relative mb-5 transition-transform"
      // section && ... — without the `section &&` guard this was also true
      // for the "Ohne Abschnitt" bucket (section is undefined there) any
      // time draggingSectionId was ALSO undefined (i.e. nothing being
      // dragged at all, the normal/idle state) — undefined === undefined,
      // permanently dimming the unsectioned bucket even when nothing was
      // being dragged (Lino, 2026-07-10: "sollen NICHT ausgegraut werden").
      style={section && draggingSectionId === section.id ? { opacity: 0.4 } : undefined}
      onDragOver={
        section && onSectionDragOver
          ? (e) => {
              e.preventDefault();
              onSectionDragOver(section.id, e);
            }
          : undefined
      }
      onDrop={
        section && onSectionDrop
          ? (e) => {
              e.preventDefault();
              onSectionDrop(section.id, e);
            }
          : undefined
      }
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
        {section && onSectionDragStart && (
          <span
            draggable
            // 2026-07-14, Lino: "wenn man einen abschnitt über einen
            // anderen abschnitt dragen und droppen will funktioniert es
            // nur 3 von 10 mal" — this whole section list renders INSIDE
            // the scene-level <DndContext> (see its own comment: shared
            // across every section's scene grid, dnd-kit's "multiple
            // containers" pattern), so dnd-kit's PointerSensor listens for
            // pointerdown anywhere in that subtree, including this native
            // draggable handle, even though it's never a registered
            // dnd-kit sortable item. The two systems then race on the same
            // initiating pointerdown: native HTML5 drag-and-drop needs
            // an uninterrupted mousedown to initiate, and depending on
            // which one's handler runs first, dnd-kit's sensor sometimes
            // wins that race and the native drag never actually starts —
            // exactly the probabilistic "3 of 10" pattern. Stopping
            // propagation at the CAPTURE phase, on the handle itself,
            // keeps this pointerdown from ever reaching dnd-kit's own
            // (ancestor-attached) listener at all, so only the native
            // drag mechanism ever sees it.
            onPointerDownCapture={(e) => e.stopPropagation()}
            onDragStart={(e) => {
              e.dataTransfer.setData("text/subshot-section-id", section.id);
              // Without this the browser shows its default "copy" cursor
              // (a "+") for the whole drag, which reads as "this will
              // duplicate something" rather than "this will move it".
              e.dataTransfer.effectAllowed = "move";
              onSectionDragStart(section.id);
            }}
            onDragEnd={() => onSectionDragEnd?.()}
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
            subtitle={`${doneCount}/${scenes.length}`}
            actions={
              // Menu itself no longer requires a real `section` (2026-07-13:
              // sort-by options are useful for "Ohne Abschnitt" too) -
              // rename/delete stay conditional on one existing.
              (onSortScenes || (section && onDeleteSection)) && (
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
  const { setNodeRef } = useDroppable({ id: `section-drop:${sectionId ?? ""}` });
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
function UsersIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="7" r="3.5" /><path d="M2 20c0-3.5 3.1-6.2 7-6.2s7 2.7 7 6.2" />
      <path d="M16.5 4.2a3.5 3.5 0 0 1 0 6.6M22 20c0-2.9-2.1-5.4-5-6.1" />
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
