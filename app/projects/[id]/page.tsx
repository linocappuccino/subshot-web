"use client";

import { useEffect, useRef, useState, use as usePromise } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  DndContext,
  DragOverlay,
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
import type { Member, ProjectDetail, Scene, Section, Shot } from "@/lib/types";
import { SortableSceneCard } from "@/app/components/SortableSceneCard";
import { SceneCard } from "@/app/components/SceneCard";
import { SceneEditModal } from "@/app/components/SceneEditModal";
import { SceneTable } from "@/app/components/SceneTable";
import { ProjectInfoBox } from "@/app/components/ProjectInfoBox";
import { ProjectInfoTile } from "@/app/components/ProjectInfoTile";
import { TeamPanel } from "@/app/components/TeamPanel";
import { NotionImportModal } from "@/app/components/NotionImportModal";
import { ShareLinkModal } from "@/app/components/ShareLinkModal";
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
  // Filter out the dragged item's own id from every candidate list — found
  // via a real repro with the (full-width) Projektinfo tile: its
  // translated rect stays just as wide as its original col-span-full
  // layout, and rectIntersection (unlike pointerWithin) compares that
  // WHOLE rect against every droppable, not just the cursor position. A
  // rect that size self-overlaps its own still-registered droppable
  // constantly, which without this filter resolved as "over" = itself
  // more often than any real target — the drag looked like it accepted no
  // valid drop at all. pointerWithin doesn't have this problem (it only
  // cares where the cursor actually is), but keep the filter on both for
  // safety.
  const pointerHits = pointerWithin(args).filter((c) => c.id !== args.active.id);
  if (pointerHits.length > 0) return pointerHits;
  return rectIntersection(args).filter((c) => c.id !== args.active.id);
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
  const [showTeam, setShowTeam] = useState(false);
  const [showNotion, setShowNotion] = useState(false);
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
  useEffect(() => {
    function onPointerMove(e: PointerEvent) {
      pointerPosRef.current = { x: e.clientX, y: e.clientY };
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
    Promise.all([api.projectDetail(id), api.members(id)]).then(([d, m]) => {
      if (cancelled) return;
      setData(d);
      setMembers(m);
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

  async function handleSceneCreated(scene: Scene) {
    setData((prev) => (prev ? { ...prev, scenes: [...prev.scenes, scene] } : prev));
  }

  async function handleSceneUpdated(scene: Scene) {
    setData((prev) => (prev ? { ...prev, scenes: prev.scenes.map((s) => (s.id === scene.id ? scene : s)) } : prev));
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
  // exactly what the insertion line last pointed at.
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
    const changed = next.filter((s) => origin.find((o) => o.id === s.id)?.sort_order !== s.sort_order);
    if (changed.length === 0) return;
    try {
      await Promise.all(changed.map((s) => api.patchSection(s.id, { sort_order: s.sort_order })));
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
    dragOriginScenesRef.current = data?.scenes ?? null;
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
      setInsertionIndicator(null);
      return;
    }
    const activeId = String(active.id);
    const overIdStr = String(over.id);
    if (activeId === overIdStr) {
      setInsertionIndicator(null);
      return;
    }

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
      if (pointer) {
        if (viewMode === "table") {
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
    setInsertionIndicator(null);
    const { active, over } = event;
    const origin = dragOriginScenesRef.current;
    dragOriginScenesRef.current = null;
    if (!data || !over) {
      if (origin) setData((prev) => (prev ? { ...prev, scenes: origin } : prev));
      return;
    }
    const activeId = String(active.id);
    const overIdStr = String(over.id) === activeId ? null : String(over.id);
    const originScene = origin?.find((s) => s.id === activeId);
    if (!originScene) return;

    // data.scenes is still the pre-drag order (nothing moves during the
    // drag itself, see handleSceneDragOver) — compute the result fresh
    // here from the same pure logic the indicator line used, fed with
    // dnd-kit's real final `over`, so what gets persisted always matches
    // exactly what the user dropped onto.
    let insertAfter = false;
    if (overIdStr && !overIdStr.startsWith("section-drop:")) {
      const pointer = pointerPosRef.current;
      if (pointer && over) {
        insertAfter =
          viewMode === "table"
            ? pointer.y >= over.rect.top + over.rect.height / 2
            : pointer.x >= over.rect.left + over.rect.width / 2;
      }
    }
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

  async function exportPdf() {
    if (!data) return;
    setExportingPdf(true);
    try {
      const url = await api.projectPdfUrl(data.id);
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
  // rule used to live here, removed. is_project_info still sorts first
  // (Lino: "die Projektinfo ist immer die erste Kachel in einem
  // Abschnitt"). Secondary sort_order compare (like shotsFor/sections
  // below) — the backend relationship this data comes from doesn't
  // guarantee sort_order sequence on its own, so without this a fresh page
  // load could show scenes in a different order than whatever was last
  // dragged into place.
  const scenesIn = (sectionId: string | null) =>
    data.scenes
      .filter((s) => s.section_id === sectionId)
      .sort((a, b) => Number(b.is_project_info) - Number(a.is_project_info) || a.sort_order - b.sort_order);

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
            <Button variant="secondary" size="sm" onClick={() => setShowNotion(true)}>
              <NotionIcon /> Notion-Import
            </Button>
            <Button variant="secondary" size="sm" onClick={exportPdf} disabled={exportingPdf}>
              <DocIcon /> {exportingPdf ? "Exportiert…" : "PDF"}
            </Button>
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
                onDeleteSection={setDeleteSection}
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
              insertionIndicator={insertionIndicator}
              viewMode={viewMode}
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
          {creatingSection ? (
            <Input
              autoFocus
              value={newSectionName}
              onChange={(e) => setNewSectionName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createSection()}
              onBlur={createSection}
              placeholder="Abschnittsname"
              className="w-48 shadow-2xl shadow-black/50"
            />
          ) : (
            // Mirrors the iOS app's addSceneButton menu exactly (same 4
            // options, same order) — was 3 separate flat buttons before,
            // which had no room for a 4th ("Projektinfo") without cluttering
            // the toolbar further, and iOS already uses one "+" menu for all
            // of these.
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
                    Projektinfo
                  </MenuItem>
                </>
              )}
            </Menu>
          )}
          </div>
        </div>
      </div>

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

  // A Projektinfo tile always lands first, full stop — wherever within the
  // target section it's dropped, ignore the specific hover position (Lino:
  // "die Projektinfo ist immer die erste Kachel in einem Abschnitt, alle
  // anderen Kacheln kommen unter der eingefügten Projektinfo Kachel"). Only
  // one per section: reject the move if the target already has a
  // different Projektinfo tile.
  if (activeScene.is_project_info) {
    const conflict = scenes.find((s) => s.section_id === targetSectionId && s.is_project_info && s.id !== activeId);
    if (conflict) return null;
  }

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
  if (activeScene.is_project_info) {
    insertAt = 0;
  } else if (overSceneId) {
    const idx = targetSectionScenes.findIndex((s) => s.id === overSceneId);
    // insertAfter mirrors the insertion-line indicator exactly (left half
    // of the hovered card = insert before it, right half = after) — the
    // preview and the actual result must always agree on this, or dropping
    // lands somewhere different than what the line just showed.
    if (idx !== -1) insertAt = insertAfter ? idx + 1 : idx;
    // Never insert a regular scene BEFORE the section's Projektinfo tile —
    // that tile is pinned to index 0 unconditionally.
    if (insertAt === 0 && targetSectionScenes[0]?.is_project_info) insertAt = 1;
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
  onDeleteSection,
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
  onDeleteSection?: (section: Section) => void;
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
              onChange={onChange}
              onOpenTeam={onOpenTeam ?? (() => {})}
              insertionEdge={insertionIndicator?.targetId === scene.id ? insertionIndicator.edge : null}
            />
          ))}
        </AnimatePresence>
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
        onChange={onChange}
        sectionId={section?.id ?? null}
        insertionIndicator={insertionIndicator}
      />
    ) : (
      grid
    );

  if (!title) {
    return <div className="mb-8">{content}</div>;
  }

  const sectionInsertionEdge = section && sectionInsertionIndicator?.targetId === section.id ? sectionInsertionIndicator.edge : null;

  return (
    <div
      className="relative mb-8 transition-transform"
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
          clearly as "the whole section goes here", not just its title row. */}
      {sectionInsertionEdge === "top" && (
        <div className="absolute -top-[9px] left-0 right-0 h-[3px] rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.7)] pointer-events-none" />
      )}
      {sectionInsertionEdge === "bottom" && (
        <div className="absolute -bottom-[9px] left-0 right-0 h-[3px] rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.7)] pointer-events-none" />
      )}
      <div className="flex items-start gap-1">
        {section && onSectionDragStart && (
          <span
            draggable
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
            subtitle={`${doneCount}/${scenes.length}`}
            actions={
              section &&
              onDeleteSection && (
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
      className={`h-11 rounded-xl mt-2 border-2 border-dashed transition-colors ${
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
