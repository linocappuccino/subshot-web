"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
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

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const projectId = String(active.id).replace("project:", "");
    const targetFolderId = String(over.id).replace("folder:", "");
    handleProjectDropOnFolder(projectId, targetFolderId);
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
          <DndContext sensors={dndSensors} onDragEnd={handleDragEnd}>
            {folders.length > 0 && (
              <>
                <SectionLabel>Ordner</SectionLabel>
                <TileGrid>
                  {folders.map((folder) => (
                    <DroppableFolderTile
                      key={folder.id}
                      folder={folder}
                      onEdit={() => setEditingFolder(folder)}
                      onDelete={() => setDeleteTarget({ kind: "folder", id: folder.id, name: folder.name })}
                    />
                  ))}
                </TileGrid>
              </>
            )}

            {(folders.length > 0 || projects.length > 0) && <SectionLabel>Projekte</SectionLabel>}
            <TileGrid>
              {projects.map((project) => (
                <DraggableProjectTile
                  key={project.id}
                  project={project}
                  draggable={folders.length > 0}
                  onEdit={() => setEditingProject(project)}
                  onDelete={() => setDeleteTarget({ kind: "project", id: project.id, name: project.name })}
                />
              ))}
            </TileGrid>

            {projects.length === 0 && folders.length === 0 && (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <span className="text-4xl mb-3">🎬</span>
                <p className="text-white/40">Noch keine Projekte — leg dein erstes an.</p>
              </div>
            )}
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

/** Draggable wrapper — only active when there's at least one folder to drop
 * onto, so a project with no folders around doesn't pay for pointer-capture
 * overhead (and a plain tap stays a plain tap, no activation-distance dance)
 * for a gesture that couldn't do anything anyway. */
function DraggableProjectTile({
  project,
  draggable,
  onEdit,
  onDelete,
}: {
  project: Project;
  draggable: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `project:${project.id}`,
    disabled: !draggable,
  });
  return (
    <div
      ref={setNodeRef}
      {...(draggable ? attributes : {})}
      {...(draggable ? listeners : {})}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        opacity: isDragging ? 0.4 : 1,
        zIndex: isDragging ? 20 : "auto",
        touchAction: draggable ? "none" : undefined,
        cursor: draggable ? "grab" : undefined,
      }}
    >
      <ProjectTile project={project} onEdit={onEdit} onDelete={onDelete} />
    </div>
  );
}

/** Droppable wrapper - highlights while a project tile is being dragged
 * over it, matching the iOS app's draggable=/dropDestination visual (drop
 * a project onto a folder to file it there). */
function DroppableFolderTile({
  folder,
  onEdit,
  onDelete,
}: {
  folder: ProjectFolder;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `folder:${folder.id}` });
  return (
    <div
      ref={setNodeRef}
      className={isOver ? "rounded-2xl ring-2 ring-blue-400 ring-offset-2 ring-offset-[#161616] transition-all" : "rounded-2xl ring-2 ring-transparent transition-all"}
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

function GridSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="aspect-[4/3] rounded-2xl bg-white/5 animate-pulse" />
      ))}
    </div>
  );
}
