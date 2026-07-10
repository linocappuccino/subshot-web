"use client";

import { useEffect, useRef, useState, use as usePromise } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
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
import { SectionInfoBox } from "@/app/components/SectionInfoBox";
import { TeamPanel } from "@/app/components/TeamPanel";
import { NotionImportModal } from "@/app/components/NotionImportModal";
import { ShareLinkModal } from "@/app/components/ShareLinkModal";
import { AppShell } from "@/app/components/AppShell";
import { Button } from "@/app/components/ui/Button";
import { ConfirmDialog } from "@/app/components/ui/ConfirmDialog";
import { useToast } from "@/app/components/ui/Toast";
import { Input } from "@/app/components/ui/Field";
import { Collapsible } from "@/app/components/ui/Collapsible";
import { Menu, MenuItem } from "@/app/components/ui/Menu";

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
  const [showShareModal, setShowShareModal] = useState(false);
  const [creatingSection, setCreatingSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  // Set right before showing the section-name input from the "Projektinfo"
  // entry in the "+" menu (2026-07-10, Lino: wants Projektinfo reachable
  // from the same "+" menu as Neue Szene/Zwischenschritt/Abschnitt, mirrors
  // iOS' addSceneButton menu exactly) — creates a section AND immediately
  // gives it a project-info box in one step, see createSection below.
  const [creatingSectionWithProjectInfo, setCreatingSectionWithProjectInfo] = useState(false);
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
  // Snapshot of data.scenes taken at drag start, restored verbatim on
  // cancel/invalid-drop (see handleSceneDragCancel) and used at drag end to
  // figure out which section the scene actually started in (data.scenes
  // itself gets live-reordered mid-drag, see handleSceneDragOver).
  const dragOriginScenesRef = useRef<Scene[] | null>(null);
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
  // Split into start/over/drop/end (same live-preview shape as the scene
  // grid's handleSceneDragOver) so sections visibly reflow during the drag
  // instead of only jumping into place on drop — Lino: cards/sections need
  // to make way and show exactly where the dragged one will land, not just
  // silently reorder on release.
  function handleSectionDragStart(id: string) {
    setDraggingSectionId(id);
    dragOriginSectionsRef.current = data?.sections ?? null;
  }

  function handleSectionDragOver(targetId: string) {
    if (!data || !draggingSectionId || draggingSectionId === targetId) return;
    const current = [...data.sections].sort((a, b) => a.sort_order - b.sort_order);
    const draggedIndex = current.findIndex((s) => s.id === draggingSectionId);
    const targetIndexBefore = current.findIndex((s) => s.id === targetId);
    if (draggedIndex === -1 || targetIndexBefore === -1) return;
    const dragged = current[draggedIndex];
    const withoutDragged = current.filter((s) => s.id !== draggingSectionId);
    let targetIndex = withoutDragged.findIndex((s) => s.id === targetId);
    if (targetIndex === -1) return;
    // Dragging downward (dragged started before target): insert AFTER target,
    // not before — otherwise hovering the very next section is a no-op,
    // since removing dragged from just above target shifts target's index
    // down by exactly the one slot "insert before" would have used anyway.
    if (draggedIndex < targetIndexBefore) targetIndex += 1;
    withoutDragged.splice(targetIndex, 0, dragged);
    const unchanged = withoutDragged.length === current.length && withoutDragged.every((s, i) => s.id === current[i].id);
    if (unchanged) return;
    setData((prev) => (prev ? { ...prev, sections: withoutDragged.map((s, i) => ({ ...s, sort_order: i })) } : prev));
  }

  // By the time this fires, data.sections already reflects the
  // live-previewed final order — just persist whatever actually changed
  // from the pre-drag snapshot.
  async function handleSectionDrop() {
    const origin = dragOriginSectionsRef.current;
    dragOriginSectionsRef.current = null;
    setDraggingSectionId(null);
    if (!data || !origin) return;
    const changed = data.sections.filter((s) => origin.find((o) => o.id === s.id)?.sort_order !== s.sort_order);
    if (changed.length === 0) return;
    try {
      await Promise.all(changed.map((s) => api.patchSection(s.id, { sort_order: s.sort_order })));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Umsortieren fehlgeschlagen.");
    }
  }

  // Fires on the drag SOURCE after every drag, successful or not (native
  // D&D always calls dragend). handleSectionDrop already clears
  // dragOriginSectionsRef on a real drop, so this only reverts when the
  // drag was cancelled/dropped somewhere invalid.
  function handleSectionDragEnd() {
    setDraggingSectionId(null);
    const origin = dragOriginSectionsRef.current;
    dragOriginSectionsRef.current = null;
    if (origin) setData((prev) => (prev ? { ...prev, sections: origin } : prev));
  }

  // Scene-level drag start — snapshots the pre-drag order so a cancelled or
  // invalid drop can restore it exactly (see handleSceneDragCancel/End).
  function handleSceneDragStart(event: DragStartEvent) {
    setActiveSceneId(String(event.active.id));
    dragOriginScenesRef.current = data?.scenes ?? null;
  }

  // Fires continuously while dragging, whenever the pointer moves onto a
  // new card/drop-zone. Lino: cards need to visibly get "out of the way" and
  // show exactly where the dragged card will land, not just highlight
  // whatever it's currently hovering (that read as "drop onto this card").
  // So this ACTUALLY reorders data.scenes live (dnd-kit's own official
  // "multiple containers" pattern) instead of only faking a preview via
  // CSS transforms — the grid re-renders in real time in the position the
  // scene would land in if dropped right now, with the gap opening up
  // between/beside its new neighbors exactly like Lino described. Nothing
  // here touches the backend; handleSceneDragEnd persists whatever this
  // left data.scenes in.
  function handleSceneDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over || !data) return;
    const activeId = String(active.id);
    const overIdStr = String(over.id);
    if (activeId === overIdStr) return;
    const activeScene = data.scenes.find((s) => s.id === activeId);
    if (!activeScene) return;

    let targetSectionId: string | null;
    let overSceneId: string | null = null;
    if (overIdStr.startsWith("section-drop:")) {
      targetSectionId = overIdStr.slice("section-drop:".length) || null;
    } else {
      const overScene = data.scenes.find((s) => s.id === overIdStr);
      if (!overScene || overScene.id === activeId) return;
      targetSectionId = overScene.section_id;
      overSceneId = overScene.id;
    }

    const withoutActive = data.scenes.filter((s) => s.id !== activeId);
    let insertAt = withoutActive.length;
    if (overSceneId) {
      const idx = withoutActive.findIndex((s) => s.id === overSceneId);
      if (idx !== -1) insertAt = idx;
    } else {
      let lastIdxInSection = -1;
      withoutActive.forEach((s, i) => {
        if (s.section_id === targetSectionId) lastIdxInSection = i;
      });
      insertAt = lastIdxInSection + 1;
    }
    const next = [...withoutActive];
    next.splice(insertAt, 0, { ...activeScene, section_id: targetSectionId });

    // Bail if this would be a no-op re-render (already in this exact spot) —
    // avoids fighting dnd-kit's own measuring with redundant state updates.
    const unchanged =
      next.length === data.scenes.length && next.every((s, i) => s.id === data.scenes[i].id && s.section_id === data.scenes[i].section_id);
    if (unchanged) return;
    setData((prev) => (prev ? { ...prev, scenes: next } : prev));
  }

  // Scene-level drag end — the ONE shared handler for every section's grid
  // (see the DndContext wrapping all of them further down). By the time
  // this fires, data.scenes already reflects the live-previewed final
  // position (handleSceneDragOver keeps it in sync on every hover change),
  // so this just has to persist it: PATCH section_id if it changed from
  // where the drag started, then reorderScenes() for the sort_order.
  function handleSceneDragEnd(event: DragEndEvent) {
    setActiveSceneId(null);
    const { active, over } = event;
    const origin = dragOriginScenesRef.current;
    dragOriginScenesRef.current = null;
    if (!data || !over) {
      if (origin) setData((prev) => (prev ? { ...prev, scenes: origin } : prev));
      return;
    }
    const activeId = String(active.id);
    const activeScene = data.scenes.find((s) => s.id === activeId);
    const originScene = origin?.find((s) => s.id === activeId);
    if (!activeScene || !originScene) return;

    const sectionChanged = activeScene.section_id !== originScene.section_id;
    const destScenes = data.scenes.filter((s) => s.section_id === activeScene.section_id);
    const idx = destScenes.findIndex((s) => s.id === activeId);
    const beforeId = destScenes[idx + 1]?.id ?? null;

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
    const origin = dragOriginScenesRef.current;
    dragOriginScenesRef.current = null;
    if (origin) setData((prev) => (prev ? { ...prev, scenes: origin } : prev));
  }

  async function createSection() {
    const name = newSectionName.trim();
    setCreatingSection(false);
    const withProjectInfo = creatingSectionWithProjectInfo;
    setCreatingSectionWithProjectInfo(false);
    if (!name || !data) return;
    try {
      let section = await api.createSection(data.id, name, data.sections.length);
      if (withProjectInfo) {
        section = await api.patchSection(section.id, { add_project_info: true });
      }
      setData((prev) => (prev ? { ...prev, sections: [...prev.sections, section] } : prev));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Fehlgeschlagen.");
    }
    setNewSectionName("");
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

  // Same "completed scenes always last within their group" rule as the iOS
  // app (ShotListViewModel.scenes(in:)) and the PDF/share-link exports.
  // Secondary sort_order compare (like shotsFor/sections below) — the
  // backend relationship this data comes from doesn't guarantee sort_order
  // sequence on its own, so without this a fresh page load could show
  // scenes in a different order than whatever was last dragged into place.
  const scenesIn = (sectionId: string | null) =>
    data.scenes
      .filter((s) => s.section_id === sectionId)
      .sort((a, b) => Number(a.completed) - Number(b.completed) || a.sort_order - b.sort_order);

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
          collisionDetection={pointerWithin}
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
                onReorder={(ordered, movedId, beforeId) => reorderScenes(api, ordered, movedId, beforeId, setData)}
                onSectionDragStart={handleSectionDragStart}
                onSectionDragOver={handleSectionDragOver}
                onSectionDrop={handleSectionDrop}
                onSectionDragEnd={handleSectionDragEnd}
                draggingSectionId={draggingSectionId}
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
              onReorder={(ordered, movedId, beforeId) => reorderScenes(api, ordered, movedId, beforeId, setData)}
              viewMode={viewMode}
            />
          )}

          <DragOverlay>
            {activeSceneId &&
              (() => {
                const activeScene = data.scenes.find((s) => s.id === activeSceneId);
                if (!activeScene) return null;
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
              placeholder={creatingSectionWithProjectInfo ? "Name (z.B. Tag 2)" : "Abschnittsname"}
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
                      setCreatingSectionWithProjectInfo(true);
                      setCreatingSection(true);
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
  onReorder,
  onSectionDragStart,
  onSectionDragOver,
  onSectionDrop,
  onSectionDragEnd,
  draggingSectionId,
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
  onReorder: (ordered: Scene[], movedSceneId: string, beforeSceneId: string | null) => void;
  onSectionDragStart?: (id: string) => void;
  onSectionDragOver?: (targetId: string) => void;
  onSectionDrop?: () => void;
  onSectionDragEnd?: () => void;
  draggingSectionId?: string | null;
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
            />
          ))}
        </AnimatePresence>
      </div>
      <SectionDropZone sectionId={section?.id ?? null} />
    </SortableContext>
  );

  const content =
    viewMode === "table" ? (
      <SceneTable scenes={scenes} shotsFor={shotsFor} members={members} onEditScene={onEditScene} onDeleteScene={onDeleteScene} onChange={onChange} onReorder={onReorder} />
    ) : (
      grid
    );

  if (!title) {
    return <div className="mb-8">{content}</div>;
  }

  return (
    <div
      className="mb-8 transition-transform"
      style={draggingSectionId === section?.id ? { opacity: 0.4 } : undefined}
      onDragOver={
        section && onSectionDragOver
          ? (e) => {
              e.preventDefault();
              onSectionDragOver(section.id);
            }
          : undefined
      }
      onDrop={
        section && onSectionDrop
          ? (e) => {
              e.preventDefault();
              onSectionDrop();
            }
          : undefined
      }
    >
      <div className="flex items-start gap-1">
        {section && onSectionDragStart && (
          <span
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("text/subshot-section-id", section.id);
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
          {section && projectId && onSectionChange && (
            <SectionInfoBox
              section={section}
              projectId={projectId}
              members={members}
              onOpenTeam={onOpenTeam ?? (() => {})}
              onSectionChange={onSectionChange}
            />
          )}
          <Collapsible title={title} subtitle={`${doneCount}/${scenes.length}`}>
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
function SectionDropZone({ sectionId }: { sectionId: string | null }) {
  const { setNodeRef, isOver } = useDroppable({ id: `section-drop:${sectionId ?? ""}` });
  return (
    <div
      ref={setNodeRef}
      className={`h-11 rounded-xl mt-2 transition-colors ${isOver ? "bg-blue-500/10 ring-1 ring-inset ring-blue-500/40" : ""}`}
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
