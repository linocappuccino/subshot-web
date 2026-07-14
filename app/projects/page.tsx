"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  pointerWithin,
  rectIntersection,
  PointerSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable } from "@dnd-kit/sortable";
import { useApi } from "@/lib/useApi";
import { ApiError } from "@/lib/api";
import type { Project, ProjectFolder } from "@/lib/types";
import { AuthImage } from "@/app/components/AuthImage";
import { AppShell } from "@/app/components/AppShell";
import { Button, IconButton } from "@/app/components/ui/Button";
import { Menu, MenuItem } from "@/app/components/ui/Menu";
import { ConfirmDialog } from "@/app/components/ui/ConfirmDialog";
import { useToast } from "@/app/components/ui/Toast";
import { FolderEditModal } from "@/app/components/FolderEditModal";
import { ProjectEditModal } from "@/app/components/ProjectEditModal";

/** Prefixed-id-aware collision detection (2026-07-13), same layered
 * pointerWithin -> rectIntersection -> closestCenter fallback chain as the
 * scene grid's sceneCollisionDetection, adapted for two different tile
 * "kinds" sharing one DndContext:
 * - Dragging a PROJECT: a FOLDER tile is a valid target too (file the
 *   project into it, existing behavior) alongside other project tiles
 *   (reorder).
 * - Dragging a FOLDER: only other folder tiles are valid targets (folders
 *   never nest, and a folder can't be filed into a project).
 * closestCenter as the last resort mirrors the same fix the scene grid
 * needed: without it, a fast/imprecise drop between tiles of different
 * heights can lose collision detection entirely (see project memory). */
const tileCollisionDetection: CollisionDetection = (args) => {
  const activeId = String(args.active.id);
  const activeIsProject = activeId.startsWith("project:");
  const isValidTarget = (c: { id: string | number }) => {
    if (String(c.id) === activeId) return false;
    return activeIsProject ? true : String(c.id).startsWith("folder:");
  };

  const pointerHits = pointerWithin(args).filter(isValidTarget);
  if (pointerHits.length > 0) return pointerHits;
  const rectHits = rectIntersection(args).filter(isValidTarget);
  if (rectHits.length > 0) return rectHits;
  return closestCenter(args).filter(isValidTarget);
};

/** Pure local array reorder for the immediate optimistic preview — mirrors
 * computeSceneReorder's role on the project detail page, but much simpler
 * (no section-scoping concept here, just one flat sibling list). Actual
 * persistence goes through api.moveProject/moveFolder (server-authoritative,
 * see the backend's move_project/move_folder), this only drives what's
 * shown on screen between drop and that call resolving. */
function localReorder<T extends { id: string }>(list: T[], activeId: string, overId: string, insertAfter: boolean): T[] | null {
  const active = list.find((x) => x.id === activeId);
  if (!active) return null;
  const without = list.filter((x) => x.id !== activeId);
  const overIdx = without.findIndex((x) => x.id === overId);
  if (overIdx === -1) return null;
  const insertAt = insertAfter ? overIdx + 1 : overIdx;
  return [...without.slice(0, insertAt), active, ...without.slice(insertAt)];
}

export default function ProjectsPage() {
  // useSearchParams() requires a Suspense boundary in the App Router.
  return (
    <Suspense
      fallback={
        <AppShell>
          <div className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 py-8 text-white/50">Lädt…</div>
        </AppShell>
      }
    >
      <ProjectsPageContent />
    </Suspense>
  );
}

function ProjectsPageContent() {
  const api = useApi();
  const toast = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const folderId = searchParams.get("folder");
  const currentFolder = useCurrentFolder(folderId);

  const [projects, setProjects] = useState<Project[]>([]);
  const [folders, setFolders] = useState<ProjectFolder[]>([]);
  const [loading, setLoading] = useState(true);

  const [editingFolder, setEditingFolder] = useState<ProjectFolder | null | "new">(null);
  const [editingProject, setEditingProject] = useState<Project | null | "new">(null);
  const [deleteTarget, setDeleteTarget] = useState<{ kind: "folder" | "project"; id: string; name: string } | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      // Folder tiles only make sense at the root — inside a folder it's
      // just that folder's projects, same as ProjectListView.swift on iOS
      // (a folder never nests another folder).
      try {
        const [p, f] = await Promise.all([api.projects(folderId ?? undefined), folderId ? Promise.resolve([]) : api.folders()]);
        if (cancelled) return;
        setProjects(p);
        setFolders(f);
      } catch (e) {
        if (!cancelled) toast.showError(e instanceof ApiError ? e.message : "Laden fehlgeschlagen.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderId]);

  async function createOrEditProject(name: string, color: string, emoji: string | null, existing: Project | null) {
    try {
      if (existing) {
        const updated = await api.patchProject(existing.id, { name, color, emoji });
        setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      } else {
        const created = await api.createProject(name, color, emoji ?? undefined);
        if (folderId) await api.patchProject(created.id, { folder_id: folderId });
        setProjects((prev) => [{ ...created, folder_id: folderId }, ...prev]);
        toast.showSuccess("Projekt angelegt.");
      }
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Speichern fehlgeschlagen.");
    }
  }

  async function createOrEditFolder(
    name: string,
    color: string,
    emoji: string | null,
    imageFile: File | null,
    clearImage: boolean,
    existing: ProjectFolder | null
  ) {
    try {
      let folder: ProjectFolder;
      if (existing) {
        folder = await api.patchFolder(existing.id, { name, color, emoji, clear_background_image: clearImage });
      } else {
        folder = await api.createFolder(name, color, emoji ?? undefined, folders.length);
      }
      if (imageFile) {
        folder = await api.uploadFolderImage(folder.id, imageFile);
      }
      if (existing) {
        setFolders((prev) => prev.map((f) => (f.id === folder.id ? folder : f)));
      } else {
        setFolders((prev) => [...prev, folder]);
        toast.showSuccess("Ordner angelegt.");
      }
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Speichern fehlgeschlagen.");
    }
  }

  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  // Real cursor position, tracked independently of dnd-kit — same reasoning
  // and pattern as the scene grid's pointerPosRef (comparing the DRAGGED
  // TILE's rect center against a target is a biased proxy for "which side/
  // edge is my cursor actually near", most visible once you grab a tile
  // somewhere other than its exact center).
  const pointerPosRef = useRef<{ x: number; y: number } | null>(null);
  // Notion-style insertion indicator (same idea as the scene grid's) — but
  // 4-directional here (left/right/top/bottom), not just left/right: this
  // grid wraps up to 5 columns depending on viewport width, so "the next
  // sibling" can sit to the side OR in the row above/below depending on
  // where in the grid you are. Direction is picked by whichever of the
  // hovered tile's 4 edges the cursor is nearest to (see handleDragOver) —
  // left/top mean "insert before this tile", right/bottom mean "insert
  // after", matching Lino's spec ("Man muss objekte Links, rechts, oben und
  // unten droppen können, dies muss der indikator auch anzeigen").
  const [insertionIndicator, setInsertionIndicator] = useState<{ targetId: string; edge: "left" | "right" | "top" | "bottom" } | null>(null);
  // Separate from insertionIndicator — set only while dragging a PROJECT
  // over a FOLDER tile (filing, not reordering), which gets its own ring-
  // highlight treatment instead of an insertion line (there's no
  // "before/after" concept for "put this project inside that folder").
  const [fileIntoFolderId, setFileIntoFolderId] = useState<string | null>(null);
  // Which tile is being dragged, for the DragOverlay preview below (2026-07-13,
  // Lino: "gezogenes Objekt schwebt nicht mit der Maus mit") — the scene grid
  // has always had this via DragOverlay, this grid never did.
  const [activeId, setActiveId] = useState<string | null>(null);
  // Which tile dnd-kit last told us the cursor is "over", and whether a
  // drag is in progress — dnd-kit's onDragOver only fires when the
  // collision result CHANGES (moving onto a DIFFERENT droppable), not
  // continuously while the cursor stays over the SAME one (see the scene
  // grid's identical fix + full writeup in project memory: this is exactly
  // the bug that made the indicator get stuck on whichever edge you
  // entered from, most visible for a 4-directional grid like this one
  // where "did I cross into the top or the left of this tile" genuinely
  // depends on continuous tracking, confirmed via a real Playwright sweep
  // here too before adding this). The pointermove listener below (which
  // DOES fire continuously) recomputes the edge live against a fresh
  // getBoundingClientRect() of whichever tile dnd-kit most recently told
  // us we're over, via data-sortable-tile-id (added to both tile wrappers
  // specifically for this) — dnd-kit only has to get "which tile" right
  // (works fine on enter/exit), the edge itself never depends on its cadence.
  const activeDragRef = useRef(false);
  const lastOverIdRef = useRef<string | null>(null);
  useEffect(() => {
    function onPointerMove(e: PointerEvent) {
      pointerPosRef.current = { x: e.clientX, y: e.clientY };
      const overId = lastOverIdRef.current;
      if (!activeDragRef.current || !overId) return;
      const el = document.querySelector<HTMLElement>(`[data-sortable-tile-id="${CSS.escape(overId)}"]`);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width;
      const relY = (e.clientY - rect.top) / rect.height;
      const distances = { left: relX, right: 1 - relX, top: relY, bottom: 1 - relY } as const;
      const edge = (Object.keys(distances) as Array<keyof typeof distances>).reduce((a, b) => (distances[a] <= distances[b] ? a : b));
      setInsertionIndicator({ targetId: overId, edge });
    }
    window.addEventListener("pointermove", onPointerMove);
    return () => window.removeEventListener("pointermove", onPointerMove);
  }, []);

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
    setInsertionIndicator(null);
    setFileIntoFolderId(null);
    activeDragRef.current = true;
    lastOverIdRef.current = null;
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) {
      lastOverIdRef.current = null;
      setInsertionIndicator(null);
      setFileIntoFolderId(null);
      return;
    }
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) {
      lastOverIdRef.current = null;
      setInsertionIndicator(null);
      setFileIntoFolderId(null);
      return;
    }

    if (activeId.startsWith("project:") && overId.startsWith("folder:")) {
      lastOverIdRef.current = null;
      setInsertionIndicator(null);
      setFileIntoFolderId(overId.slice("folder:".length));
      return;
    }
    setFileIntoFolderId(null);
    // Remembered for the pointermove listener above — see its comment for
    // why the edge itself is recomputed there continuously instead of only
    // here.
    lastOverIdRef.current = overId;

    const pointer = pointerPosRef.current;
    if (!pointer) return;
    // Nearest-edge-to-cursor (not just left/right like the scene grid) —
    // this grid genuinely wraps multiple rows, so "insert above/below" is a
    // real, distinct gesture here, not just a cosmetic variant of left/right.
    const rect = over.rect;
    const relX = (pointer.x - rect.left) / rect.width;
    const relY = (pointer.y - rect.top) / rect.height;
    const distances = { left: relX, right: 1 - relX, top: relY, bottom: 1 - relY } as const;
    const edge = (Object.keys(distances) as Array<keyof typeof distances>).reduce((a, b) => (distances[a] <= distances[b] ? a : b));
    setInsertionIndicator({ targetId: overId, edge });
  }

  async function handleProjectDropOnFolder(projectId: string, targetFolderId: string) {
    const project = projects.find((p) => p.id === projectId);
    if (!project || project.folder_id === targetFolderId) return;
    setProjects((prev) => prev.filter((p) => p.id !== projectId));
    setFolders((prev) => prev.map((f) => (f.id === targetFolderId ? { ...f, project_count: f.project_count + 1 } : f)));
    try {
      await api.patchProject(projectId, { folder_id: targetFolderId });
      toast.showSuccess("Projekt verschoben.");
    } catch (e) {
      // Best-effort rollback - a full reload would also fix this, but
      // putting the tile back immediately keeps the failure feeling local.
      setProjects((prev) => [...prev, project]);
      setFolders((prev) => prev.map((f) => (f.id === targetFolderId ? { ...f, project_count: f.project_count - 1 } : f)));
      toast.showError(e instanceof ApiError ? e.message : "Verschieben fehlgeschlagen.");
    }
  }

  // Persists via the last-DISPLAYED indicator, not a fresh read of dnd-kit's
  // own final `over` — same reasoning as the scene grid's handleSceneDragEnd
  // (onDragEnd fires on pointer-up, a physically separate event from the
  // last onDragOver that drew the indicator; trusting a fresh over here
  // could land the drop somewhere the indicator never actually showed).
  function handleDragEnd(event: DragEndEvent) {
    const indicator = insertionIndicator;
    const fileInto = fileIntoFolderId;
    setActiveId(null);
    setInsertionIndicator(null);
    setFileIntoFolderId(null);
    activeDragRef.current = false;
    lastOverIdRef.current = null;
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);

    if (fileInto) {
      handleProjectDropOnFolder(activeId.replace("project:", ""), fileInto);
      return;
    }

    const overIdStr = indicator ? indicator.targetId : String(over.id);
    if (overIdStr === activeId) return;
    const insertAfter = indicator ? indicator.edge === "right" || indicator.edge === "bottom" : false;

    if (activeId.startsWith("project:")) {
      const rawActiveId = activeId.slice("project:".length);
      const rawOverId = overIdStr.slice("project:".length);
      const next = localReorder(projects, rawActiveId, rawOverId, insertAfter);
      if (!next) return;
      setProjects(next);
      const idx = next.findIndex((p) => p.id === rawActiveId);
      const beforeId = next[idx + 1]?.id ?? null;
      api.moveProject(rawActiveId, beforeId).catch(() => toast.showError("Verschieben fehlgeschlagen."));
    } else {
      const rawActiveId = activeId.slice("folder:".length);
      const rawOverId = overIdStr.slice("folder:".length);
      const next = localReorder(folders, rawActiveId, rawOverId, insertAfter);
      if (!next) return;
      setFolders(next);
      const idx = next.findIndex((f) => f.id === rawActiveId);
      const beforeId = next[idx + 1]?.id ?? null;
      api.moveFolder(rawActiveId, beforeId).catch(() => toast.showError("Verschieben fehlgeschlagen."));
    }
  }

  // Escape / dropped outside any droppable — dnd-kit fires this SEPARATELY
  // from onDragEnd (which may not fire at all on cancel), so the refs need
  // resetting here too or a cancelled drag could leave activeDragRef stuck
  // true, making the pointermove listener above keep recomputing an
  // indicator for a drag that's no longer happening.
  function handleDragCancel() {
    setActiveId(null);
    setInsertionIndicator(null);
    setFileIntoFolderId(null);
    activeDragRef.current = false;
    lastOverIdRef.current = null;
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.kind === "folder") {
        await api.deleteFolder(deleteTarget.id);
        setFolders((prev) => prev.filter((f) => f.id !== deleteTarget.id));
      } else {
        await api.deleteProject(deleteTarget.id);
        setProjects((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      }
      toast.showSuccess("Gelöscht.");
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Löschen fehlgeschlagen.");
    } finally {
      setDeleteTarget(null);
    }
  }

  return (
    <AppShell>
      <div className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 py-8">
        <div className="flex items-center justify-between mb-8 gap-3 flex-wrap">
          <div>
            {folderId ? (
              <button
                onClick={() => router.push("/projects")}
                className="text-sm text-white/40 hover:text-white/70 transition-colors mb-1 flex items-center gap-1"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m15 18-6-6 6-6" />
                </svg>
                Alle Projekte
              </button>
            ) : null}
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              {currentFolder ? (
                <>
                  <span>{currentFolder.emoji || "📁"}</span> {currentFolder.name}
                </>
              ) : (
                "Projekte"
              )}
            </h1>
          </div>
          <div className="flex gap-2">
            {!folderId && (
              <Button variant="secondary" onClick={() => setEditingFolder("new")}>
                <PlusIcon /> Ordner
              </Button>
            )}
            <Button variant="primary" onClick={() => setEditingProject("new")}>
              <PlusIcon /> Projekt
            </Button>
          </div>
        </div>

        {loading ? (
          <GridSkeleton />
        ) : (
          <DndContext
            sensors={dndSensors}
            collisionDetection={tileCollisionDetection}
            // Faster viewport-edge auto-scroll while dragging (2026-07-13,
            // Lino: default dnd-kit acceleration was too slow; bumped
            // again 2026-07-14, still too slow at 40 — see the identical
            // autoScroll comment in projects/[id]/page.tsx for the exact
            // mechanics of what this number controls).
            autoScroll={{ acceleration: 120, interval: 5 }}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            {folders.length > 0 && (
              <>
                <SectionLabel>Ordner</SectionLabel>
                <SortableContext items={folders.map((f) => `folder:${f.id}`)}>
                  <TileGrid>
                    {folders.map((folder) => (
                      <DroppableFolderTile
                        key={folder.id}
                        folder={folder}
                        insertionEdge={insertionIndicator?.targetId === `folder:${folder.id}` ? insertionIndicator.edge : null}
                        filingHighlighted={fileIntoFolderId === folder.id}
                        onEdit={() => setEditingFolder(folder)}
                        onDelete={() => setDeleteTarget({ kind: "folder", id: folder.id, name: folder.name })}
                      />
                    ))}
                  </TileGrid>
                </SortableContext>
              </>
            )}

            {(folders.length > 0 || projects.length > 0) && <SectionLabel>Projekte</SectionLabel>}
            <SortableContext items={projects.map((p) => `project:${p.id}`)}>
              <TileGrid>
                {projects.map((project) => (
                  <DraggableProjectTile
                    key={project.id}
                    project={project}
                    insertionEdge={insertionIndicator?.targetId === `project:${project.id}` ? insertionIndicator.edge : null}
                    onEdit={() => setEditingProject(project)}
                    onDelete={() => setDeleteTarget({ kind: "project", id: project.id, name: project.name })}
                  />
                ))}
              </TileGrid>
            </SortableContext>

            {projects.length === 0 && folders.length === 0 && (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <span className="text-4xl mb-3">🎬</span>
                <p className="text-white/40">Noch keine Projekte — leg dein erstes an.</p>
              </div>
            )}

            <DragOverlay>
              {activeId?.startsWith("project:") &&
                (() => {
                  const project = projects.find((p) => p.id === activeId.slice("project:".length));
                  if (!project) return null;
                  return (
                    <div className="rotate-2 shadow-2xl shadow-black/50 cursor-grabbing">
                      <ProjectTile project={project} onEdit={() => {}} onDelete={() => {}} />
                    </div>
                  );
                })()}
              {activeId?.startsWith("folder:") &&
                (() => {
                  const folder = folders.find((f) => f.id === activeId.slice("folder:".length));
                  if (!folder) return null;
                  return (
                    <div className="rotate-2 shadow-2xl shadow-black/50 cursor-grabbing">
                      <FolderTile folder={folder} onEdit={() => {}} onDelete={() => {}} />
                    </div>
                  );
                })()}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      <FolderEditModal
        open={editingFolder !== null}
        onClose={() => setEditingFolder(null)}
        existing={editingFolder === "new" ? null : editingFolder}
        onSave={(name, color, emoji, imageFile, clearImage) =>
          createOrEditFolder(name, color, emoji, imageFile, clearImage, editingFolder === "new" ? null : editingFolder)
        }
      />
      <ProjectEditModal
        open={editingProject !== null}
        onClose={() => setEditingProject(null)}
        existing={editingProject === "new" ? null : editingProject}
        onSave={(name, color, emoji) =>
          createOrEditProject(name, color, emoji, editingProject === "new" ? null : editingProject)
        }
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        title={`${deleteTarget?.kind === "folder" ? "Ordner" : "Projekt"} löschen?`}
        message={`"${deleteTarget?.name}" wird endgültig gelöscht. Das kann nicht rückgängig gemacht werden.`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </AppShell>
  );
}

function useCurrentFolder(folderId: string | null) {
  const api = useApi();
  const [folder, setFolder] = useState<ProjectFolder | null>(null);
  useEffect(() => {
    if (!folderId) return;
    let cancelled = false;
    api.folders().then((all) => {
      if (!cancelled) setFolder(all.find((f) => f.id === folderId) ?? null);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderId]);
  // Derived, not stored: a null folderId always means "no current folder",
  // regardless of whatever the last fetch happened to leave in state.
  return folderId ? folder : null;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wide mb-3 mt-2">{children}</h2>;
}

function TileGrid({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      layout
      className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 mb-8"
    >
      <AnimatePresence mode="popLayout">{children}</AnimatePresence>
    </motion.div>
  );
}

function TileShell({
  href,
  color,
  hasImage,
  children,
  menu,
  label,
  subtitle,
}: {
  href: string;
  color: string;
  /** True whenever `children` is a full-bleed photo (folder background image
   * or a project's scene-thumbnail) rather than a bare emoji - applies the
   * same "light, slightly graded photo behind legible UI" treatment every
   * app-style card view uses (Spotify/Apple Music playlist art, Notion
   * covers, ...): a subtle darkening scrim plus a gentle exposure/contrast
   * grade, so an arbitrary uploaded photo always reads as part of this UI
   * instead of a raw, un-styled image sitting on top of it. */
  hasImage?: boolean;
  children: React.ReactNode;
  menu: React.ReactNode;
  label: string;
  subtitle?: string;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ type: "spring", stiffness: 380, damping: 30 }}
      whileHover={{ y: -3 }}
      className="group relative"
    >
      {/* Picked-color ambient glow behind the tile — same cue as the iOS
          app's .shadow(color: Color(hex: color).opacity(0.55), radius: 10)
          on ProjectListView's tiles, which the web version never got. A
          blurred color layer (not a box-shadow) reads as a proper glow
          bleeding past the tile edges rather than a tight drop shadow. */}
      <div
        aria-hidden
        className="absolute inset-3 rounded-2xl blur-2xl opacity-40 group-hover:opacity-60 transition-opacity pointer-events-none -z-10"
        style={{ backgroundColor: color }}
      />
      <Link href={href} style={hasImage ? { perspective: 800 } : undefined} className="block">
        <motion.div
          whileHover={hasImage ? { rotateX: -5, rotateY: 7, scale: 1.035 } : undefined}
          transition={{ type: "spring", stiffness: 260, damping: 18 }}
          style={{ backgroundColor: `${color}e6`, transformStyle: hasImage ? "preserve-3d" : undefined }}
          className={`aspect-[4/3] rounded-2xl overflow-hidden relative flex items-center justify-center ring-1 ring-white/10 transition-shadow ${
            hasImage ? "shadow-xl shadow-black/40 group-hover:shadow-2xl group-hover:shadow-black/50" : "shadow-lg shadow-black/20 group-hover:shadow-xl group-hover:shadow-black/30"
          }`}
        >
          {hasImage ? (
            <div className="absolute inset-0 [&>img]:w-full [&>img]:h-full [&>img]:object-cover" style={{ filter: "brightness(0.94) saturate(1.08) contrast(1.04)" }}>
              {children}
            </div>
          ) : (
            children
          )}
          {hasImage && (
            <>
              {/* darkening scrim so UI (menu button, label) stays legible over
                  an arbitrary uploaded photo */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.1) 55%, rgba(0,0,0,0.45) 100%)" }}
              />
              {/* glassy top-left highlight + inset rim light, the same
                  "physical glossy app icon" material cues as the actual
                  Subshot app icon (app/icon.svg) - a raw photo alone read as
                  a flat sticker, not part of this UI. */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{ background: "radial-gradient(140% 90% at 15% 8%, rgba(255,255,255,0.35), transparent 55%)" }}
              />
              <div className="absolute inset-0 rounded-2xl pointer-events-none shadow-[inset_0_1px_0_rgba(255,255,255,0.35),inset_0_0_0_1px_rgba(0,0,0,0.25)]" />
              {/* A thin glass rim (no backdrop-blur on the photo itself —
                  tried that, combined with the 3D hover transform below it
                  rendered WAY blurrier than the 1.5px requested in some
                  browsers, almost certainly a backdrop-filter + CSS 3D
                  transform compositing bug, not a value that needed tuning.
                  The gradients/rim-light/reflection streak already carry the
                  "glass" read without touching the photo's own sharpness). */}
              <div className="absolute inset-0 rounded-2xl pointer-events-none ring-1 ring-inset ring-white/20" />
              {/* Diagonal light-reflection streak, the classic "light
                  catching glass" cue — sweeps across on hover for a bit of
                  life instead of sitting static. */}
              <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-2xl">
                <div
                  className="absolute -inset-y-6 -left-2/3 w-1/2 rotate-[-20deg] blur-md transition-transform duration-700 ease-out group-hover:translate-x-[220%]"
                  style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)" }}
                />
              </div>
            </>
          )}
          <div className="absolute inset-0 bg-gradient-to-br from-white/15 to-transparent pointer-events-none" />
        </motion.div>
        {/* NO backdrop-blur on the photo itself, tried twice now (see also
            the pre-existing comment a few lines up on the ring-inset div) —
            ANY blur layer painted over/behind the actual photo softens the
            photo's own detail, which Lino explicitly does not want ("das
            Bild soll nicht blurry sein!!!! sondern nur so leicht als wäre
            es hinter dezentem Schaumglas", 2026-07-12) — a sibling with
            inset-0 sits directly on top of the photo in paint order,
            there's no way to backdrop-blur "in front of" content without
            blurring that content. The gradients/rim-light/reflection
            streak above are the entire glass treatment here — genuinely
            sharp photo, glass read carried by light/reflection cues only. */}
        <div className="mt-2 text-sm font-semibold truncate">{label}</div>
        {subtitle && <div className="text-xs text-white/40">{subtitle}</div>}
      </Link>
      <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">{menu}</div>
    </motion.div>
  );
}

function ProjectTile({
  project,
  onEdit,
  onDelete,
}: {
  project: Project;
  onEdit: () => void;
  onDelete: () => void;
}) {
  // Date.now() is impure and isn't allowed directly in a render body (React
  // flags it since two renders could disagree, e.g. server vs. client) - a
  // lazy useState initializer is the sanctioned way to grab a one-time
  // "now" reading; a few ms of staleness across re-renders doesn't matter
  // for a days-until-deletion countdown.
  const [now] = useState(() => Date.now());
  const daysUntilDeletion = Math.max(
    0,
    Math.ceil((new Date(project.last_opened_at).getTime() + 30 * 24 * 3600 * 1000 - now) / (24 * 3600 * 1000))
  );

  return (
    <TileShell
      href={`/projects/${project.id}`}
      color={project.color}
      hasImage={Boolean(project.thumbnail_url)}
      label={project.name}
      subtitle={`Wird gelöscht in ${daysUntilDeletion} Tagen`}
      menu={
        <Menu
          trigger={
            <IconButton size={28} className="bg-black/40 hover:bg-black/60 text-white">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="5" cy="12" r="1.8" />
                <circle cx="12" cy="12" r="1.8" />
                <circle cx="19" cy="12" r="1.8" />
              </svg>
            </IconButton>
          }
        >
          {(close) => (
            <>
              <MenuItem
                onClick={() => {
                  onEdit();
                  close();
                }}
              >
                Bearbeiten
              </MenuItem>
              <MenuItem
                danger
                onClick={() => {
                  onDelete();
                  close();
                }}
              >
                Löschen
              </MenuItem>
            </>
          )}
        </Menu>
      }
    >
      {project.thumbnail_url ? (
        <AuthImage path={project.thumbnail_url} alt={project.name} className="w-full h-full object-cover" />
      ) : (
        <span className="text-3xl">{project.emoji || "🎬"}</span>
      )}
    </TileShell>
  );
}

function FolderTile({
  folder,
  onEdit,
  onDelete,
}: {
  folder: ProjectFolder;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <TileShell
      href={`/projects?folder=${folder.id}`}
      color={folder.color}
      hasImage={Boolean(folder.background_image_url)}
      label={folder.name}
      subtitle={`${folder.project_count} Projekt${folder.project_count === 1 ? "" : "e"}`}
      menu={
        <Menu
          trigger={
            <IconButton size={28} className="bg-black/40 hover:bg-black/60 text-white">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="5" cy="12" r="1.8" />
                <circle cx="12" cy="12" r="1.8" />
                <circle cx="19" cy="12" r="1.8" />
              </svg>
            </IconButton>
          }
        >
          {(close) => (
            <>
              <MenuItem
                onClick={() => {
                  onEdit();
                  close();
                }}
              >
                Bearbeiten
              </MenuItem>
              <MenuItem
                danger
                onClick={() => {
                  onDelete();
                  close();
                }}
              >
                Löschen
              </MenuItem>
            </>
          )}
        </Menu>
      }
    >
      {folder.background_image_url ? (
        <AuthImage
          path={folder.background_image_url}
          alt={folder.name}
          className="w-full h-full object-cover"
          objectPosition={
            folder.background_image_focus_x != null && folder.background_image_focus_y != null
              ? `${(folder.background_image_focus_x * 100).toFixed(1)}% ${(folder.background_image_focus_y * 100).toFixed(1)}%`
              : undefined
          }
        />
      ) : (
        <span className="text-3xl">{folder.emoji || "📁"}</span>
      )}
    </TileShell>
  );
}

/** 4-directional Notion-style insertion line, same visual language as the
 * scene grid's SortableSceneCard indicator — see tileCollisionDetection's
 * doc comment above for why this grid needs all 4 directions, not just
 * left/right (it wraps multiple rows, unlike the scene grid). */
function TileInsertionIndicator({ edge }: { edge?: "left" | "right" | "top" | "bottom" | null }) {
  if (!edge) return null;
  const base = "absolute rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.7)] pointer-events-none z-10";
  if (edge === "left") return <div className={`${base} -left-[9px] top-0 bottom-0 w-[3px]`} />;
  if (edge === "right") return <div className={`${base} -right-[9px] top-0 bottom-0 w-[3px]`} />;
  if (edge === "top") return <div className={`${base} -top-[9px] left-0 right-0 h-[3px]`} />;
  return <div className={`${base} -bottom-[9px] left-0 right-0 h-[3px]`} />;
}

/** Always draggable now (2026-07-13) — was gated behind "only if at least
 * one folder exists" back when dragging a project could only ever mean
 * "file it into a folder"; now it also means "reorder among sibling
 * projects", which is always meaningful regardless of whether any folders
 * exist. transform/transition deliberately NOT applied (useSortable would
 * otherwise reflow every sibling toward its predicted post-drop position)
 * — same insertion-line-only design as the scene grid, isDragging/opacity
 * is all this tile needs. */
function DraggableProjectTile({
  project,
  insertionEdge,
  onEdit,
  onDelete,
}: {
  project: Project;
  insertionEdge?: "left" | "right" | "top" | "bottom" | null;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({ id: `project:${project.id}` });
  return (
    <div
      ref={setNodeRef}
      data-sortable-tile-id={`project:${project.id}`}
      {...attributes}
      {...listeners}
      className="relative"
      style={{
        opacity: isDragging ? 0.4 : 1,
        zIndex: isDragging ? 20 : "auto",
        touchAction: "none",
        cursor: "grab",
      }}
    >
      <TileInsertionIndicator edge={insertionEdge} />
      <ProjectTile project={project} onEdit={onEdit} onDelete={onDelete} />
    </div>
  );
}

/** Sortable AND a filing target (2026-07-13) — folders reorder among
 * themselves (insertion line, same as projects) but also stay droppable
 * FOR a dragged project (ring highlight, driven by fileIntoFolderId rather
 * than dnd-kit's own isOver — isOver would also fire while reordering two
 * folders past each other, which shouldn't show the "file into me" ring). */
function DroppableFolderTile({
  folder,
  insertionEdge,
  filingHighlighted,
  onEdit,
  onDelete,
}: {
  folder: ProjectFolder;
  insertionEdge?: "left" | "right" | "top" | "bottom" | null;
  filingHighlighted: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({ id: `folder:${folder.id}` });
  return (
    <div
      ref={setNodeRef}
      data-sortable-tile-id={`folder:${folder.id}`}
      {...attributes}
      {...listeners}
      className={`relative rounded-2xl ring-2 transition-all ${filingHighlighted ? "ring-blue-400 ring-offset-2 ring-offset-[#161616]" : "ring-transparent"}`}
      style={{
        opacity: isDragging ? 0.4 : 1,
        zIndex: isDragging ? 20 : "auto",
        touchAction: "none",
        cursor: "grab",
      }}
    >
      <TileInsertionIndicator edge={insertionEdge} />
      <FolderTile folder={folder} onEdit={onEdit} onDelete={onDelete} />
    </div>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="aspect-[4/3] rounded-2xl bg-white/5 animate-pulse" />
      ))}
    </div>
  );
}
