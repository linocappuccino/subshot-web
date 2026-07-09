"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
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

  async function createOrEditFolder(name: string, color: string, emoji: string | null, existing: ProjectFolder | null) {
    try {
      if (existing) {
        const updated = await api.patchFolder(existing.id, { name, color, emoji });
        setFolders((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
      } else {
        const created = await api.createFolder(name, color, emoji ?? undefined, folders.length);
        setFolders((prev) => [...prev, created]);
        toast.showSuccess("Ordner angelegt.");
      }
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Speichern fehlgeschlagen.");
    }
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
                + Ordner
              </Button>
            )}
            <Button variant="primary" onClick={() => setEditingProject("new")}>
              + Projekt
            </Button>
          </div>
        </div>

        {loading ? (
          <GridSkeleton />
        ) : (
          <>
            {folders.length > 0 && (
              <>
                <SectionLabel>Ordner</SectionLabel>
                <TileGrid>
                  {folders.map((folder) => (
                    <FolderTile
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
                <ProjectTile
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
                <p className="text-white/40">Noch keine Projekte — leg dein erstes an.</p>
              </div>
            )}
          </>
        )}
      </div>

      <FolderEditModal
        open={editingFolder !== null}
        onClose={() => setEditingFolder(null)}
        existing={editingFolder === "new" ? null : editingFolder}
        onSave={(name, color, emoji) =>
          createOrEditFolder(name, color, emoji, editingFolder === "new" ? null : editingFolder)
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
  children,
  menu,
  label,
  subtitle,
}: {
  href: string;
  color: string;
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
      <Link href={href}>
        <div
          className="aspect-[4/3] rounded-2xl overflow-hidden relative flex items-center justify-center shadow-lg shadow-black/20 ring-1 ring-white/10 transition-shadow group-hover:shadow-xl group-hover:shadow-black/30"
          style={{ backgroundColor: `${color}e6` }}
        >
          {children}
          <div className="absolute inset-0 bg-gradient-to-br from-white/15 to-transparent pointer-events-none" />
        </div>
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
  return (
    <TileShell
      href={`/projects/${project.id}`}
      color={project.color}
      label={project.name}
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
      <span className="text-3xl">{folder.emoji || "📁"}</span>
    </TileShell>
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
