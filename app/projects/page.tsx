"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { useApi } from "@/lib/useApi";
import type { Project, ProjectFolder } from "@/lib/types";
import { AuthImage } from "@/app/components/AuthImage";

export default function ProjectsPage() {
  // useSearchParams() requires a Suspense boundary in the App Router.
  return (
    <Suspense fallback={<div className="flex-1 max-w-6xl mx-auto w-full px-6 py-8 text-white/50">Lädt…</div>}>
      <ProjectsPageContent />
    </Suspense>
  );
}

function ProjectsPageContent() {
  const api = useApi();
  const searchParams = useSearchParams();
  const folderId = searchParams.get("folder");
  const [projects, setProjects] = useState<Project[]>([]);
  const [folders, setFolders] = useState<ProjectFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Folder tiles only make sense at the root — inside a folder it's just
    // that folder's projects, same as ProjectListView.swift on iOS (a
    // folder never nests another folder).
    Promise.all([api.projects(folderId ?? undefined), folderId ? Promise.resolve([]) : api.folders()]).then(
      ([p, f]) => {
        if (cancelled) return;
        setProjects(p);
        setFolders(f);
        setLoading(false);
      }
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderId]);

  async function createProject() {
    const name = newName.trim();
    if (!name) return;
    const project = await api.createProject(name);
    setProjects((prev) => [project, ...prev]);
    setNewName("");
    setCreating(false);
  }

  return (
    <div className="flex-1 max-w-6xl mx-auto w-full px-6 py-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-semibold">Subshot</h1>
        <UserButton />
      </div>

      {loading ? (
        <p className="text-white/50">Lädt…</p>
      ) : (
        <>
          <div className="mb-6">
            {creating ? (
              <div className="flex gap-2">
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && createProject()}
                  placeholder="Projektname"
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 flex-1"
                />
                <button onClick={createProject} className="bg-blue-600 hover:bg-blue-500 rounded-lg px-4 py-2">
                  Anlegen
                </button>
                <button onClick={() => setCreating(false)} className="text-white/50 px-2">
                  Abbrechen
                </button>
              </div>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg px-4 py-2 text-sm"
              >
                + Neues Projekt
              </button>
            )}
          </div>

          {folders.length > 0 && (
            <>
              <h2 className="text-sm text-white/50 mb-3">Ordner</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 mb-8">
                {folders.map((folder) => (
                  <FolderTile key={folder.id} folder={folder} />
                ))}
              </div>
            </>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {projects.map((project) => (
              <ProjectTile key={project.id} project={project} />
            ))}
          </div>

          {projects.length === 0 && folders.length === 0 && (
            <p className="text-white/40 text-center py-20">Noch keine Projekte — leg dein erstes an.</p>
          )}
        </>
      )}
    </div>
  );
}

function ProjectTile({ project }: { project: Project }) {
  return (
    <Link href={`/projects/${project.id}`} className="group">
      <div
        className="aspect-[4/3] rounded-2xl overflow-hidden relative flex items-center justify-center"
        style={{ backgroundColor: `${project.color}e6` }}
      >
        {project.thumbnail_url ? (
          <AuthImage path={project.thumbnail_url} alt={project.name} className="w-full h-full object-cover" />
        ) : (
          <span className="text-3xl">🎬</span>
        )}
      </div>
      <div className="mt-2 text-sm font-medium truncate">{project.name}</div>
    </Link>
  );
}

function FolderTile({ folder }: { folder: ProjectFolder }) {
  return (
    <Link href={`/projects?folder=${folder.id}`} className="group">
      <div
        className="aspect-[4/3] rounded-2xl overflow-hidden flex items-center justify-center"
        style={{ backgroundColor: `${folder.color}e6` }}
      >
        <span className="text-3xl">{folder.emoji || "📁"}</span>
      </div>
      <div className="mt-2 text-sm font-medium truncate">{folder.name}</div>
      <div className="text-xs text-white/40">{folder.project_count} Projekte</div>
    </Link>
  );
}
