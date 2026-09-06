"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  rectIntersection,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type CollisionDetection,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useApi } from "@/lib/useApi";
import { ApiError } from "@/lib/api";
import { setNavCache } from "@/lib/navCache";
import type { Annotation, Member, Project, ProjectFolder } from "@/lib/types";
import { AuthImage } from "@/app/components/AuthImage";
import { AppShell } from "@/app/components/AppShell";
import { useLanguage } from "@/lib/i18n";
import { Button, IconButton } from "@/app/components/ui/Button";
import { Menu, MenuItem } from "@/app/components/ui/Menu";
import { ConfirmDialog } from "@/app/components/ui/ConfirmDialog";
import { useToast } from "@/app/components/ui/Toast";
import { FolderEditModal } from "@/app/components/FolderEditModal";
import { ProjectEditModal, type ProjectMemberPick, type ProjectModules } from "@/app/components/ProjectEditModal";
import { TodoSidebar } from "@/app/components/TodoSidebar";

/** Prefixed-id-aware collision detection.
 *
 * 2026-08-06, Lino: "sortieren soll man nicht können, aber man soll
 * projekte in ordner ziehen können und ordner in ordner ziehen können" —
 * manual reordering (sort_order) removed entirely: list_projects/
 * list_folders always sort by "most recently opened" (added 2026-07-17)
 * and never actually read sort_order at all, so the old drag-to-reorder
 * feature had already been a silent no-op for weeks (confirmed live: a
 * reorder drag "succeeded" but reverted on the next reload) — nobody had
 * noticed since it never actually did anything. Rather than fix that dead
 * code path, dropping it: the only valid drop targets now are FOLDER tiles
 * — a dragged PROJECT files into it, a dragged FOLDER nests into it
 * (new — folders could previously only nest via explicit create/edit).
 *
 * 2026-08-06 correction, Lino: "zieht man ein Projekt über einen Ordner
 * und die Markierung kommt, dann wieder weg zieht, landet das Projekt
 * trotzdem im Ordner" — the old scene-grid-style fallback chain (pointerWithin
 * -> rectIntersection -> closestCenter) ends in `closestCenter`, which has NO
 * distance cutoff at all: it always returns whichever droppable is nearest,
 * no matter how far the cursor actually is, so once you'd dragged near a
 * folder at all, dragging back away still resolved to "nearest folder" on
 * drop instead of "no folder". That fallback existed for the OLD reorder
 * feature (recovering collision on a fast drop between tightly packed
 * tiles) — no longer needed now that the only valid target is "am I
 * genuinely, visually over a folder". Dropped `closestCenter` entirely:
 * `pointerWithin` (cursor literally inside the folder) with `rectIntersection`
 * as a lenient second tier (the dragged tile/row's own rect overlaps the
 * folder's) — both still require real, visible overlap. */
const tileCollisionDetection: CollisionDetection = (args) => {
  const activeId = String(args.active.id);
  const isValidTarget = (c: { id: string | number }) => String(c.id) !== activeId && String(c.id).startsWith("folder:");

  const pointerHits = pointerWithin(args).filter(isValidTarget);
  if (pointerHits.length > 0) return pointerHits;
  return rectIntersection(args).filter(isValidTarget);
};

export default function ProjectsPage() {
  // useSearchParams() requires a Suspense boundary in the App Router. AppShell
  // (and the LanguageProvider it mounts) must wrap the Suspense itself, not
  // just live inside the fallback branch — ProjectsPageContent calls
  // useLanguage() (and renders its own <AppShell>) from its OWN function
  // body, which sits as a SIBLING of the fallback's AppShell in the fiber
  // tree once Suspense resolves, not a descendant of it. That mismatch was
  // a real, 100%-reproducible bug (not the "Vercel-only" mystery it looked
  // like — every render past the first fallback frame hit it, we just never
  // exercised the exact real page structure while investigating), root-caused
  // 2026-07-22 — see project_subshot_i18n_language_switcher.md.
  return (
    <AppShell>
      <Suspense fallback={<div className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 py-8 text-white/50">Lädt…</div>}>
        <ProjectsPageContent />
      </Suspense>
    </AppShell>
  );
}

function ProjectsPageContent() {
  const api = useApi();
  const toast = useToast();
  const { t } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const folderId = searchParams.get("folder");
  const breadcrumb = useFolderBreadcrumb(folderId);
  const currentFolder = breadcrumb.length > 0 ? breadcrumb[breadcrumb.length - 1] : null;

  const [projects, setProjects] = useState<Project[]>([]);
  const [folders, setFolders] = useState<ProjectFolder[]>([]);
  const [loading, setLoading] = useState(true);
  // 2026-07-30, Lino: "wäre noch cool wenn man zwischen listen oder kachel
  // ansicht wechseln könnte" — persisted per-browser (not per-project, one
  // preference for the whole Projektübersicht), read once on mount so a
  // returning user doesn't see a flash of the other mode first. List mode
  // intentionally skips the whole DndContext/Sortable machinery below (drag
  // reordering only ever made sense as a spatial grid interaction) — rows
  // are plain links, same click/edit/delete behavior, no reordering.
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  useEffect(() => {
    const stored = localStorage.getItem("subshot:projectsViewMode");
    if (stored === "grid" || stored === "list") setViewMode(stored);
  }, []);
  function changeViewMode(mode: "grid" | "list") {
    setViewMode(mode);
    localStorage.setItem("subshot:projectsViewMode", mode);
  }
  // 2026-07-26, Lino: "klickt man auf ein Projekt oder ordner erscheint für
  // eine millisekunde immer 6 kacheln, bis die finalen kacheln geladen
  // wurde" — `loading` used to unconditionally swap the whole grid for
  // <GridSkeleton/> on EVERY folderId change, including navigating INTO a
  // folder that was already fetched fast (usually <100ms on this backend),
  // producing a real-content -> skeleton -> real-content flash each time.
  // `projects`/`folders` state is never cleared before a fetch starts (only
  // overwritten on success), so the previous folder's tiles are still sitting
  // there the whole time — only the FIRST ever load (no prior fetch to fall
  // back on) actually needs the skeleton. Every subsequent navigation just
  // dims the still-visible old tiles instead of replacing them with
  // placeholders.
  const hasLoadedOnceRef = useRef(false);
  // 2026-07-17, Lino: "drückt man + Projekt muss man auch definieren wer
  // zu diesem Projekt hinzugefügt wird" — braucht das eigene Team (falls
  // vorhanden) fürs Mitglieder-Picker im ProjectEditModal.
  const [myTeamId, setMyTeamId] = useState<string | null>(null);

  // 2026-08-26 — Lino: "wir entfernen uns von Übergangsanimationen, soll
  // super schnell sein". This used to be a whole exit/enter swipe-transition
  // system (page slides+blurs out, waits ~220ms so the animation can play,
  // THEN navigates; the target page plays a matching slide-in on mount via
  // a sessionStorage flag) — all of that state/logic is gone. Navigation is
  // now instant; the `beforeNavigate` prefetch below still fires but no
  // longer blocks navigation on it (see its own comment).
  const [editingFolder, setEditingFolder] = useState<ProjectFolder | null | "new">(null);
  const [editingProject, setEditingProject] = useState<Project | null | "new">(null);
  const [deleteTarget, setDeleteTarget] = useState<{ kind: "folder" | "project"; id: string; name: string } | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      // 2026-07-19: folders can now nest, so a folder's OWN sub-folders are
      // fetched the same way root folders are — just scoped to this
      // folder_id instead of root (same convention as projects).
      try {
        const [p, f] = await Promise.all([api.projects(folderId ?? undefined), api.folders(folderId ?? undefined)]);
        if (cancelled) return;
        setProjects(p);
        setFolders(f);
      } catch (e) {
        if (!cancelled) toast.showError(e instanceof ApiError ? e.message : "Laden fehlgeschlagen.");
      } finally {
        if (!cancelled) {
          setLoading(false);
          hasLoadedOnceRef.current = true;
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderId]);

  useEffect(() => {
    api.myTeams().then((teams) => setMyTeamId(teams[0]?.id ?? null)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createOrEditProject(
    name: string,
    color: string,
    emoji: string | null,
    modules: ProjectModules,
    members: ProjectMemberPick[],
    existing: Project | null,
    clientName: string | null
  ) {
    try {
      if (existing) {
        const updated = await api.patchProject(existing.id, { name, color, emoji, client_name: clientName, ...modules });
        setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      } else {
        const created = await api.createProject(name, color, emoji ?? undefined, modules, clientName);
        if (folderId) await api.patchProject(created.id, { folder_id: folderId });
        // 2026-07-17, Lino: "drückt man + Projekt muss man auch definieren
        // wer zu diesem Projekt hinzugefügt wird" — Einladungen laufen
        // NACH der Projekt-Erstellung (brauchen die neue project.id), ein
        // fehlgeschlagenes Einladen soll das frisch angelegte Projekt
        // nicht rückgängig machen, darum einzeln statt Promise.all mit
        // hartem Abbruch.
        for (const m of members) {
          try {
            await api.invite(created.id, m.email, m.role);
          } catch (e) {
            toast.showError(`Einladung an ${m.email} fehlgeschlagen: ${e instanceof ApiError ? e.message : "unbekannter Fehler"}`);
          }
        }
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
        folder = await api.createFolder(name, color, emoji ?? undefined, folders.length, folderId ?? undefined);
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

  // Which FOLDER a dragged project/folder is currently hovering over — the
  // only kind of drop that does anything now (manual reordering was removed
  // entirely, see tileCollisionDetection's doc comment above). Drives the
  // ring highlight on that folder tile/row, shared by grid AND list mode.
  const [dropTargetFolderId, setDropTargetFolderId] = useState<string | null>(null);
  // Which tile/row is being dragged, for the DragOverlay preview (2026-07-13,
  // Lino: "gezogenes Objekt schwebt nicht mit der Maus mit").
  const [activeId, setActiveId] = useState<string | null>(null);

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
    setDropTargetFolderId(null);
  }

  // tileCollisionDetection already only ever reports FOLDER ids as valid
  // hits, so `over` here is always either null or a folder — no need to
  // re-check the prefix.
  function handleDragOver(event: DragOverEvent) {
    setDropTargetFolderId(event.over ? String(event.over.id).slice("folder:".length) : null);
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

  // 2026-08-06, Lino: "ordner in ordner ziehen können" — folders could
  // previously only nest via explicit create/edit (parent_folder_id), never
  // by dragging one folder onto another. Mirrors handleProjectDropOnFolder's
  // optimistic shape exactly; the backend (patch_folder) already has the
  // cycle guard (can't nest a folder into its own descendant).
  async function handleFolderDropOnFolder(folderIdToMove: string, targetFolderId: string) {
    const folder = folders.find((f) => f.id === folderIdToMove);
    if (!folder || folderIdToMove === targetFolderId) return;
    setFolders((prev) =>
      prev.filter((f) => f.id !== folderIdToMove).map((f) => (f.id === targetFolderId ? { ...f, folder_count: f.folder_count + 1 } : f))
    );
    try {
      await api.patchFolder(folderIdToMove, { parent_folder_id: targetFolderId });
      toast.showSuccess("Ordner verschoben.");
    } catch (e) {
      setFolders((prev) => [...prev, folder].map((f) => (f.id === targetFolderId ? { ...f, folder_count: f.folder_count - 1 } : f)));
      toast.showError(e instanceof ApiError ? e.message : "Verschieben fehlgeschlagen.");
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const targetFolderId = dropTargetFolderId;
    setActiveId(null);
    setDropTargetFolderId(null);
    if (!targetFolderId) return;
    const activeId = String(event.active.id);
    if (activeId.startsWith("project:")) {
      handleProjectDropOnFolder(activeId.slice("project:".length), targetFolderId);
    } else if (activeId.startsWith("folder:")) {
      handleFolderDropOnFolder(activeId.slice("folder:".length), targetFolderId);
    }
  }

  function handleDragCancel() {
    setActiveId(null);
    setDropTargetFolderId(null);
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
    <>
      <div className="flex-1 max-w-[92rem] mx-auto w-full px-4 sm:px-6 py-8 flex gap-6 items-start">
      <div className="flex-1 min-w-0 max-w-6xl">
        <div className="flex items-center justify-between mb-8 gap-3 flex-wrap">
          <div>
            {folderId ? (
              <div className="text-sm text-white/40 mb-1 flex items-center gap-1 flex-wrap">
                <button onClick={() => router.push("/projects")} className="hover:text-white/70 transition-colors flex items-center gap-1">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m15 18-6-6 6-6" />
                  </svg>
                  {t("projects.allProjects")}
                </button>
                {breadcrumb.slice(0, -1).map((f) => (
                  <span key={f.id} className="flex items-center gap-1">
                    <span>/</span>
                    <button onClick={() => router.push(`/projects?folder=${f.id}`)} className="hover:text-white/70 transition-colors">
                      {f.emoji || "📁"} {f.name}
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              {currentFolder ? (
                <>
                  <span>{currentFolder.emoji || "📁"}</span> {currentFolder.name}
                </>
              ) : (
                t("projects.title")
              )}
            </h1>
          </div>
          <div className="flex gap-2">
            <div className="flex items-center rounded-lg bg-white/5 ring-1 ring-white/10 p-0.5 mr-1">
              <button
                type="button"
                onClick={() => changeViewMode("grid")}
                aria-label={t("projects.gridView")}
                title={t("projects.gridView")}
                className={`p-1.5 rounded-md transition-colors ${viewMode === "grid" ? "bg-white/15 text-white" : "text-white/40 hover:text-white/70"}`}
              >
                <GridIcon />
              </button>
              <button
                type="button"
                onClick={() => changeViewMode("list")}
                aria-label={t("projects.listView")}
                title={t("projects.listView")}
                className={`p-1.5 rounded-md transition-colors ${viewMode === "list" ? "bg-white/15 text-white" : "text-white/40 hover:text-white/70"}`}
              >
                <ListIcon />
              </button>
            </div>
            <Button variant="secondary" onClick={() => setEditingFolder("new")}>
              <PlusIcon /> {t("projects.newFolder")}
            </Button>
            <Button variant="primary" onClick={() => setEditingProject("new")}>
              <PlusIcon /> {t("projects.newProject")}
            </Button>
          </div>
        </div>

        {loading && !hasLoadedOnceRef.current ? (
          <GridSkeleton />
        ) : viewMode === "list" ? (
          <div className={`transition-opacity duration-150 ${loading ? "opacity-50 pointer-events-none" : "opacity-100"}`}>
            <DndContext
              sensors={dndSensors}
              collisionDetection={tileCollisionDetection}
              autoScroll={{ acceleration: 120, interval: 5 }}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              {folders.length > 0 && (
                <>
                  <SectionLabel>{t("projects.folders")}</SectionLabel>
                  <ListRows>
                    {folders.map((folder) => (
                      <DraggableFolderListRow
                        key={folder.id}
                        folder={folder}
                        filingHighlighted={dropTargetFolderId === folder.id}
                        onEdit={() => setEditingFolder(folder)}
                        onDelete={() => setDeleteTarget({ kind: "folder", id: folder.id, name: folder.name })}
                      />
                    ))}
                  </ListRows>
                </>
              )}
              {(folders.length > 0 || projects.length > 0) && <SectionLabel>{t("projects.projects")}</SectionLabel>}
              <ListRows>
                {projects.map((project) => (
                  <DraggableProjectListRow
                    key={project.id}
                    project={project}
                    onEdit={() => setEditingProject(project)}
                    onDelete={() => setDeleteTarget({ kind: "project", id: project.id, name: project.name })}
                  />
                ))}
              </ListRows>
              {projects.length === 0 && folders.length === 0 && (
                <div className="flex flex-col items-center justify-center py-24 text-center">
                  <span className="text-4xl mb-3">🎬</span>
                  <p className="text-white/40">{t("projects.emptyTitle")}</p>
                </div>
              )}
              {/* 2026-08-06, Lino: "das Projekt/der Ordner ist sehr weit weg
                  vom Mauszeiger beim draggen" — DragOverlay positions its
                  floating clone via `position: fixed` internally, which
                  stops being relative to the viewport the moment ANY
                  ancestor has a CSS `transform` (even an identity one) —
                  exactly what this page's own `motion.div` page-transition
                  wrapper carries. Same fix as the scene grid's identical bug
                  (projects/[id]/page.tsx): portal straight onto
                  document.body, sidestepping the transformed ancestor
                  entirely (still gets DndContext via React context, not a
                  prop, so the portal doesn't break anything). */}
              {typeof document !== "undefined" &&
                createPortal(
                  <DragOverlay>
                    {activeId?.startsWith("project:") &&
                      (() => {
                        const project = projects.find((p) => p.id === activeId.slice("project:".length));
                        if (!project) return null;
                        return (
                          <div className="shadow-2xl shadow-black/50 cursor-grabbing bg-[#1c1c1e] rounded-xl">
                            <ProjectListRow project={project} onEdit={() => {}} onDelete={() => {}} />
                          </div>
                        );
                      })()}
                    {activeId?.startsWith("folder:") &&
                      (() => {
                        const folder = folders.find((f) => f.id === activeId.slice("folder:".length));
                        if (!folder) return null;
                        return (
                          <div className="shadow-2xl shadow-black/50 cursor-grabbing bg-[#1c1c1e] rounded-xl">
                            <FolderListRow folder={folder} onEdit={() => {}} onDelete={() => {}} />
                          </div>
                        );
                      })()}
                  </DragOverlay>,
                  document.body
                )}
            </DndContext>
          </div>
        ) : (
          <div className={`transition-opacity duration-150 ${loading ? "opacity-50 pointer-events-none" : "opacity-100"}`}>
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
                <SectionLabel>{t("projects.folders")}</SectionLabel>
                <TileGrid key={`folders-${folderId ?? "root"}`}>
                  {folders.map((folder) => (
                    <DroppableFolderTile
                      key={folder.id}
                      folder={folder}
                      filingHighlighted={dropTargetFolderId === folder.id}
                      onEdit={() => setEditingFolder(folder)}
                      onDelete={() => setDeleteTarget({ kind: "folder", id: folder.id, name: folder.name })}
                    />
                  ))}
                </TileGrid>
              </>
            )}

            {(folders.length > 0 || projects.length > 0) && <SectionLabel>{t("projects.projects")}</SectionLabel>}
            <TileGrid key={`projects-${folderId ?? "root"}`}>
              {projects.map((project) => (
                <DraggableProjectTile
                  key={project.id}
                  project={project}
                  onEdit={() => setEditingProject(project)}
                  onDelete={() => setDeleteTarget({ kind: "project", id: project.id, name: project.name })}
                />
              ))}
            </TileGrid>

            {projects.length === 0 && folders.length === 0 && (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <span className="text-4xl mb-3">🎬</span>
                <p className="text-white/40">{t("projects.emptyTitle")}</p>
              </div>
            )}

            {/* Same transformed-ancestor DragOverlay fix as list mode above
                — see that block's doc comment. */}
            {typeof document !== "undefined" &&
              createPortal(
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
                </DragOverlay>,
                document.body
              )}
          </DndContext>
          </div>
        )}
      </div>
      <TodoSidebar />
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
        teamId={myTeamId}
        onSave={(name, color, emoji, modules, members, clientName) =>
          createOrEditProject(name, color, emoji, modules, members, editingProject === "new" ? null : editingProject, clientName)
        }
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        title={`${deleteTarget?.kind === "folder" ? "Ordner" : "Projekt"} löschen?`}
        message={`"${deleteTarget?.name}" wird endgültig gelöscht. Das kann nicht rückgängig gemacht werden.`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}

/** Walks parent_folder_id one fetch at a time from the current folder up to
 * the root, so nested folders (2026-07-19) get a real breadcrumb trail
 * instead of just a flat "back to Alle Projekte" link. Returns the chain
 * root-first; the last entry is always the current folder. Folder depth in
 * practice is a handful of levels, so sequential fetches (not a dedicated
 * batch endpoint) are fine. */
function useFolderBreadcrumb(folderId: string | null) {
  const api = useApi();
  const [chain, setChain] = useState<ProjectFolder[]>([]);
  useEffect(() => {
    if (!folderId) {
      setChain([]);
      return;
    }
    let cancelled = false;
    async function load() {
      const trail: ProjectFolder[] = [];
      let currentId: string | null = folderId;
      while (currentId) {
        const folder: ProjectFolder = await api.folder(currentId);
        trail.unshift(folder);
        currentId = folder.parent_folder_id;
      }
      if (!cancelled) setChain(trail);
    }
    load().catch(() => {
      if (!cancelled) setChain([]);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderId]);
  return chain;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wide mb-3 mt-2">{children}</h2>;
}

function TileGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 mb-8">
      {children}
    </div>
  );
}

function ListRows({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-1 mb-8">{children}</div>;
}

/** List-view counterpart to TileShell — same href/menu/edit/delete affordances,
 * a single horizontal row instead of a photo tile. Menu is always visible (not
 * hover-reveal like the grid tiles) since a row has no natural hover-only real
 * estate the way a square tile's corner does. */
function ListRowShell({
  href,
  color,
  thumbnail,
  emoji,
  label,
  subtitle,
  badge,
  menu,
  onBeforeNavigate,
}: {
  href: string;
  color: string;
  thumbnail?: React.ReactNode;
  emoji: string;
  label: string;
  subtitle?: string;
  badge?: React.ReactNode;
  menu: React.ReactNode;
  onBeforeNavigate?: (el: HTMLElement) => Promise<void>;
}) {
  const router = useRouter();
  return (
    <div className="group flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-white/5 transition-colors">
      <Link
        href={href}
        className="flex items-center gap-3 flex-1 min-w-0"
        onClick={
          onBeforeNavigate
            ? (e) => {
                e.preventDefault();
                const el = e.currentTarget;
                onBeforeNavigate(el).then(() => router.push(href));
              }
            : undefined
        }
      >
        <div
          style={{ backgroundColor: `${color}e6` }}
          className="w-10 h-10 shrink-0 rounded-lg overflow-hidden flex items-center justify-center ring-1 ring-white/10 [&>img]:w-full [&>img]:h-full [&>img]:object-cover"
        >
          {thumbnail ?? <span className="text-base">{emoji}</span>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold truncate">{label}</div>
          {subtitle && <div className="text-xs text-white/40 truncate">{subtitle}</div>}
        </div>
        {badge}
      </Link>
      {menu}
    </div>
  );
}

function TileShell({
  href,
  color,
  hasImage,
  titleEmoji,
  children,
  menu,
  badge,
  label,
  subtitle,
  onBeforeNavigate,
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
  /** 2026-07-17, Lino: "wenn man ein Emoji auswählt, verschwindet das
   * Thumbnail. das soll aber nicht so sein" — vorher war `children`
   * entweder das Bild ODER das Emoji (siehe ProjectTile weiter unten).
   * 2026-07-19, Lino korrigierte die Platzierung: mit Thumbnail wandert
   * das Emoji an den ANFANG DES TITELS statt zentriert auf dem Bild zu
   * schweben (vorher `overlayEmoji`, zentriert via eigenem `<span>` im
   * Bild-Layer — ersetzt durch dieses Präfix). Ohne Thumbnail bleibt das
   * Emoji wie bisher zentriert in der Kachel-Mitte (das ist `children`
   * selbst, siehe ProjectTile/FolderTile — kein Duplikat noetig). Caller
   * übergibt hier also NUR den Wert, wenn hasImage true ist. */
  titleEmoji?: string | null;
  children: React.ReactNode;
  menu: React.ReactNode;
  /** 2026-07-19 — Pipeline-Fortschritts-Badge (nur ProjectTile, siehe
   * dort); anders als `menu` immer sichtbar statt nur bei Hover, da es
   * Status auf einen Blick zeigen soll, nicht eine versteckte Aktion. */
  badge?: React.ReactNode;
  label: string;
  subtitle?: string;
  /** 2026-07-17, Lino: "smoothe transition animation zur ersten kachel" —
   * nur ProjectTile setzt das (siehe dort); FolderTile navigiert innerhalb
   * derselben Seite (nur ein Query-Param-Wechsel), da braucht's keinen
   * Cross-Route-Morph. Bekommt das eigentliche `<a>`-Element + darf die
   * Navigation per Promise verzögern, bis der Flug weit genug ist. */
  onBeforeNavigate?: (el: HTMLElement) => Promise<void>;
}) {
  const router = useRouter();
  return (
    <div className="group relative">
      {/* Picked-color ambient glow behind the tile — same cue as the iOS
          app's .shadow(color: Color(hex: color).opacity(0.55), radius: 10)
          on ProjectListView's tiles, which the web version never got. A
          blurred color layer (not a box-shadow) reads as a proper glow
          bleeding past the tile edges rather than a tight drop shadow.
          Opacity dimmed 0.40/0.60 -> 0.07/0.12 (2026-07-20, Lino: "der glow
          hinter den kacheln ist zu hell", then "immer noch viel zu stark,
          viel weniger machen" after an intermediate 0.15/0.28 pass), then
          nudged back up to 0.11/0.18 (2026-07-22, Lino: "der glow hinter
          den kacheln kann nun ein wenig stärker sein"). */}
      <div
        aria-hidden
        className="absolute inset-3 rounded-2xl blur-2xl opacity-[0.11] group-hover:opacity-[0.18] transition-opacity pointer-events-none -z-10"
        style={{ backgroundColor: color }}
      />
      <Link
        href={href}
        className="block"
        onClick={
          onBeforeNavigate
            ? (e) => {
                e.preventDefault();
                const el = e.currentTarget;
                onBeforeNavigate(el).then(() => router.push(href));
              }
            : undefined
        }
      >
        <div
          style={{ backgroundColor: `${color}e6` }}
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
          {badge && <div className="absolute top-1.5 left-1.5">{badge}</div>}
        </div>
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
        <div className="mt-2 text-sm font-semibold truncate">
          {titleEmoji && <span className="mr-1">{titleEmoji}</span>}
          {label}
        </div>
        {subtitle && <div className="text-xs text-white/40">{subtitle}</div>}
      </Link>
      <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">{menu}</div>
    </div>
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
  const api = useApi();
  const { t } = useLanguage();

  const pipelineLabel: Record<Project["pipeline_stage"], string> = {
    idea: t("pipeline.idea"),
    scripting: t("pipeline.scripting"),
    postproduction: t("pipeline.postproduction"),
    done: t("pipeline.done"),
  };

  // 2026-07-19, Lino: "auf den Projektkacheln soll man sehn wie weit im
  // Pipeline Verlauf das Projekt ist" — pipeline_stage kommt fertig
  // berechnet vom Server (_set_project_pipeline_stage in main.py), hier
  // nur Label+Farbe pro Stufe. Gleiche Semantik wie anderswo im Web-App:
  // gelb=Idee/Konzept (IDEAS_TINT-Goldton), blau=Scripting (Standard-
  // Akzentfarbe der App), violett=Postproduction, grün=Abgeschlossen
  // (matches the "Abgenommen"-grün, das überall sonst "fertig" bedeutet).
  // 2026-07-26, Lino: "die status batches an den projektkacheln [müssen]
  // besser sichtbar sein.. die kachel rechts unten kann man den status
  // batch kaum lesen" — a light/bright project thumbnail (e.g. a
  // grayscale mountain photo) behind the old translucent
  // `bg-{color}-500/20 text-{color}-300` + `backdrop-blur-md` pill left
  // near-zero contrast, since the blur only softens the image, it never
  // darkens it. Switched to a near-solid tinted pill (white text, a real
  // drop shadow) — legible against ANY thumbnail brightness, not just dark
  // ones, while keeping the same per-stage color coding.
  const stageStyle: Record<Project["pipeline_stage"], string> = {
    idea: "bg-amber-600/95 text-white",
    scripting: "bg-blue-600/95 text-white",
    postproduction: "bg-violet-600/95 text-white",
    done: "bg-emerald-600/95 text-white",
  };

  // 2026-08-26 — used to fire onNavigateStart (triggered the parent's exit-
  // swipe animation) and BLOCK navigation for 220ms–800ms so that animation
  // had time to play. No animation left to wait for, so navigation is no
  // longer gated at all: this only still exists to warm `navCache` before
  // the destination page mounts, fire-and-forget, same pure-optimization
  // path as before (a failed/slow prefetch just means the target page loads
  // its own data on mount, same as if this never ran).
  function beforeNavigate(_el: HTMLElement) {
    (async () => {
      try {
        const [detail, projectMembers, projectAnnotations] = await Promise.all([
          api.projectDetail(project.id), api.members(project.id), api.listAnnotations(project.id),
        ]);
        setNavCache(`scenes:${project.id}`, { project: detail, members: projectMembers, annotations: projectAnnotations });
      } catch {
        // Reiner Optimierungs-Pfad — schlägt der Prefetch fehl, lädt die
        // Zielseite beim Mounten einfach ganz normal selbst nach.
      }
    })();
    return Promise.resolve();
  }

  // 2026-07-26, Lino: "drückt man auf ein projekt was NUR die
  // postproductionpipeline aktiviert hat, springt er zuerst auf die
  // ideenseite ganz kurz und dann erst auf die postproduction seite.. er
  // soll aber DIREKT... springen" — `/projects/{id}/page.tsx` already
  // module-gate-redirects Postproduction-only projects (#251), but only
  // AFTER its own data fetch resolves client-side, so the Ideas/Scenes
  // page still paints for a frame before the redirect fires. Since this
  // tile already has the SAME `Project.module_*` flags in hand right now,
  // just link straight to the correct first-enabled stage instead of
  // always `/projects/{id}` — skips that whole detour for the by-far most
  // common navigation path (clicking a tile). The redirect logic on the
  // target page itself stays too, as a fallback for paths that don't go
  // through a tile click (back button, a bookmarked link, a notification
  // deep link) — see that page's own render-gate fix for how THAT path
  // avoids painting the wrong view too.
  const targetHref =
    project.module_concept || project.module_scripting
      ? `/projects/${project.id}`
      : project.module_postproduction
        ? `/projects/${project.id}/postproduction`
        : `/projects/${project.id}`;

  return (
    <TileShell
      href={targetHref}
      color={project.color}
      hasImage={Boolean(project.thumbnail_url)}
      titleEmoji={project.thumbnail_url ? project.emoji : null}
      label={project.name}
      onBeforeNavigate={beforeNavigate}
      badge={
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shadow-sm shadow-black/30 ring-1 ring-black/10 ${stageStyle[project.pipeline_stage]}`}>
          {pipelineLabel[project.pipeline_stage]}
        </span>
      }
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
      {/* 2026-07-18 (Todoist #193, Lino: "Thumbnails kommen ziemlich spät")
          — thumbnail_data_uri (a small pre-encoded JPEG, see
          _set_project_thumbnail in main.py) renders immediately with a
          plain <img>, no separate authenticated blob fetch needed for
          this low-res list-tile use. Falls back to the old AuthImage path
          only if that's missing (e.g. a corrupt source file) but
          thumbnail_url still resolved. */}
      {project.thumbnail_data_uri ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={project.thumbnail_data_uri} alt={project.name} className="w-full h-full object-cover" />
      ) : project.thumbnail_url ? (
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
      titleEmoji={folder.background_image_url ? folder.emoji : null}
      label={folder.name}
      subtitle={
        folder.folder_count > 0
          ? `${folder.folder_count} Ordner, ${folder.project_count} Projekt${folder.project_count === 1 ? "" : "e"}`
          : `${folder.project_count} Projekt${folder.project_count === 1 ? "" : "e"}`
      }
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

function ProjectListRow({
  project,
  onEdit,
  onDelete,
}: {
  project: Project;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const api = useApi();
  const { t } = useLanguage();

  const pipelineLabel: Record<Project["pipeline_stage"], string> = {
    idea: t("pipeline.idea"),
    scripting: t("pipeline.scripting"),
    postproduction: t("pipeline.postproduction"),
    done: t("pipeline.done"),
  };
  const stageStyle: Record<Project["pipeline_stage"], string> = {
    idea: "bg-amber-600/95 text-white",
    scripting: "bg-blue-600/95 text-white",
    postproduction: "bg-violet-600/95 text-white",
    done: "bg-emerald-600/95 text-white",
  };

  // 2026-08-26 — no longer blocks navigation, see ProjectTile's identical
  // beforeNavigate for why.
  function beforeNavigate(_el: HTMLElement) {
    (async () => {
      try {
        const [detail, projectMembers, projectAnnotations] = await Promise.all([
          api.projectDetail(project.id), api.members(project.id), api.listAnnotations(project.id),
        ]);
        setNavCache(`scenes:${project.id}`, { project: detail, members: projectMembers, annotations: projectAnnotations });
      } catch {
        // Reiner Optimierungs-Pfad, siehe ProjectTile's identische Stelle.
      }
    })();
    return Promise.resolve();
  }

  const targetHref =
    project.module_concept || project.module_scripting
      ? `/projects/${project.id}`
      : project.module_postproduction
        ? `/projects/${project.id}/postproduction`
        : `/projects/${project.id}`;

  return (
    <ListRowShell
      href={targetHref}
      color={project.color}
      emoji={project.emoji || "🎬"}
      label={project.name}
      subtitle={project.client_name || undefined}
      onBeforeNavigate={beforeNavigate}
      thumbnail={
        project.thumbnail_data_uri ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={project.thumbnail_data_uri} alt={project.name} />
        ) : project.thumbnail_url ? (
          <AuthImage path={project.thumbnail_url} alt={project.name} className="w-full h-full object-cover" />
        ) : undefined
      }
      badge={
        <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full shadow-sm shadow-black/30 ring-1 ring-black/10 ${stageStyle[project.pipeline_stage]}`}>
          {pipelineLabel[project.pipeline_stage]}
        </span>
      }
      menu={
        <Menu
          trigger={
            <IconButton size={28} className="text-white/40 hover:text-white/80">
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
    />
  );
}

function FolderListRow({
  folder,
  onEdit,
  onDelete,
}: {
  folder: ProjectFolder;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <ListRowShell
      href={`/projects?folder=${folder.id}`}
      color={folder.color}
      emoji={folder.emoji || "📁"}
      label={folder.name}
      subtitle={
        folder.folder_count > 0
          ? `${folder.folder_count} Ordner, ${folder.project_count} Projekt${folder.project_count === 1 ? "" : "e"}`
          : `${folder.project_count} Projekt${folder.project_count === 1 ? "" : "e"}`
      }
      thumbnail={
        folder.background_image_url ? (
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
        ) : undefined
      }
      menu={
        <Menu
          trigger={
            <IconButton size={28} className="text-white/40 hover:text-white/80">
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
    />
  );
}

/** 2026-08-06 — manual reordering removed (see tileCollisionDetection's doc
 * comment), so this is now plain `useDraggable` (not `useSortable` — there's
 * no sibling list to reflow/animate anymore, just "pick this row up"). The
 * dragged row itself stays in place at reduced opacity; DragOverlay below
 * shows the floating clone that actually follows the cursor. */
function DraggableProjectListRow({
  project,
  onEdit,
  onDelete,
}: {
  project: Project;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `project:${project.id}` });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ opacity: isDragging ? 0.4 : 1, touchAction: "none", cursor: "grab" }}
    >
      <ProjectListRow project={project} onEdit={onEdit} onDelete={onDelete} />
    </div>
  );
}

/** Draggable (onto another folder, to nest) AND droppable (receives a
 * dragged project OR another dragged folder) at once — same dual role as
 * DroppableFolderTile below, just for list mode's row shape. Two separate
 * dnd-kit hooks/refs merged via a shared callback ref, since `useDraggable`
 * and `useDroppable` don't share one. */
function DraggableFolderListRow({
  folder,
  filingHighlighted,
  onEdit,
  onDelete,
}: {
  folder: ProjectFolder;
  filingHighlighted: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({ id: `folder:${folder.id}` });
  const { setNodeRef: setDropRef } = useDroppable({ id: `folder:${folder.id}` });
  return (
    <div
      ref={(el) => {
        setDragRef(el);
        setDropRef(el);
      }}
      {...attributes}
      {...listeners}
      className={`rounded-xl ring-2 transition-all ${filingHighlighted ? "ring-blue-400 ring-offset-2 ring-offset-[#161616]" : "ring-transparent"}`}
      style={{ opacity: isDragging ? 0.4 : 1, touchAction: "none", cursor: "grab" }}
    >
      <FolderListRow folder={folder} onEdit={onEdit} onDelete={onDelete} />
    </div>
  );
}

/** 2026-08-06 — same simplification as DraggableProjectListRow: plain
 * useDraggable, no more insertion-line reordering. */
function DraggableProjectTile({
  project,
  onEdit,
  onDelete,
}: {
  project: Project;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `project:${project.id}` });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ opacity: isDragging ? 0.4 : 1, touchAction: "none", cursor: "grab" }}
    >
      <ProjectTile project={project} onEdit={onEdit} onDelete={onDelete} />
    </div>
  );
}

/** Draggable (onto another folder, to nest — new 2026-08-06) AND droppable
 * (receives a dragged project OR another dragged folder), ring highlight
 * driven by dropTargetFolderId rather than dnd-kit's own isOver (isOver
 * would also fire while a folder drag merely passes over without settling). */
function DroppableFolderTile({
  folder,
  filingHighlighted,
  onEdit,
  onDelete,
}: {
  folder: ProjectFolder;
  filingHighlighted: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({ id: `folder:${folder.id}` });
  const { setNodeRef: setDropRef } = useDroppable({ id: `folder:${folder.id}` });
  return (
    <div
      ref={(el) => {
        setDragRef(el);
        setDropRef(el);
      }}
      {...attributes}
      {...listeners}
      className={`rounded-2xl ring-2 transition-all ${filingHighlighted ? "ring-blue-400 ring-offset-2 ring-offset-[#161616]" : "ring-transparent"}`}
      style={{ opacity: isDragging ? 0.4 : 1, touchAction: "none", cursor: "grab" }}
    >
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

function GridIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h16M4 12h16M4 18h16" />
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
