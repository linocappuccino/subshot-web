"use client";

import { useEffect, useState, use as usePromise } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { useApi } from "@/lib/useApi";
import { ApiError } from "@/lib/api";
import type { Member, ProjectDetail, Scene, Shot } from "@/lib/types";
import { SortableSceneCard } from "@/app/components/SortableSceneCard";
import { SceneCard } from "@/app/components/SceneCard";
import { SceneEditModal } from "@/app/components/SceneEditModal";
import { SceneTable } from "@/app/components/SceneTable";
import { ProjectInfoBox } from "@/app/components/ProjectInfoBox";
import { TeamPanel } from "@/app/components/TeamPanel";
import { NotionImportModal } from "@/app/components/NotionImportModal";
import { AppShell } from "@/app/components/AppShell";
import { Button } from "@/app/components/ui/Button";
import { ConfirmDialog } from "@/app/components/ui/ConfirmDialog";
import { useToast } from "@/app/components/ui/Toast";
import { Input } from "@/app/components/ui/Field";
import { Collapsible } from "@/app/components/ui/Collapsible";

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const api = useApi();
  const toast = useToast();

  const [data, setData] = useState<ProjectDetail | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [creatingScene, setCreatingScene] = useState(false);
  const [editingScene, setEditingScene] = useState<Scene | null>(null);
  const [deleteScene, setDeleteScene] = useState<Scene | null>(null);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [creatingSection, setCreatingSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  const [showTeam, setShowTeam] = useState(false);
  const [showNotion, setShowNotion] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [creatingLink, setCreatingLink] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "table">(() =>
    typeof window !== "undefined" && window.localStorage.getItem("subshotSceneViewMode") === "table" ? "table" : "grid"
  );

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

  async function createShareLink() {
    if (!data) return;
    setCreatingLink(true);
    try {
      const result = await api.shareLink(data.id);
      setShareLink(result.url);
      await navigator.clipboard.writeText(result.url).catch(() => {});
      toast.showSuccess("Link kopiert.");
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Fehlgeschlagen.");
    } finally {
      setCreatingLink(false);
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

  // Same "completed scenes always last within their group" rule as the iOS
  // app (ShotListViewModel.scenes(in:)) and the PDF/share-link exports.
  const scenesIn = (sectionId: string | null) =>
    data.scenes.filter((s) => s.section_id === sectionId).sort((a, b) => Number(a.completed) - Number(b.completed));

  const shotsFor = (sceneId: string) => data.shots.filter((s) => s.scene_id === sceneId && s.status !== "deleted").sort((a, b) => a.sort_order - b.sort_order);

  const sections = [...data.sections].sort((a, b) => a.sort_order - b.sort_order);
  const unsectioned = scenesIn(null);
  const lastScene = [...data.scenes].sort((a, b) => a.sort_order - b.sort_order).at(-1) ?? null;

  return (
    <AppShell>
      <div className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 py-8">
        <div className="flex items-start justify-between mb-6 gap-3 flex-wrap">
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
            <Button variant="secondary" size="sm" onClick={createShareLink} disabled={creatingLink}>
              <LinkIcon /> {shareLink ? "Link erneuern" : "Link teilen"}
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

        {shareLink && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mb-6">
            <Input readOnly value={shareLink} onFocus={(e) => e.currentTarget.select()} className="text-xs max-w-md" />
          </motion.div>
        )}

        <ProjectInfoBox
          project={data}
          members={members}
          onProjectChange={(updater) => setData((prev) => (prev ? { ...prev, ...updater(prev) } : prev))}
          onOpenTeam={() => setShowTeam(true)}
          todoLists={data.todo_lists}
          onTodoListsChange={(updater) => setData((prev) => (prev ? { ...prev, todo_lists: updater(prev.todo_lists) } : prev))}
        />

        {sections.map((section) => {
          const group = scenesIn(section.id);
          if (group.length === 0) return null;
          return (
            <SectionBlock
              key={section.id}
              title={section.name}
              scenes={group}
              shotsFor={shotsFor}
              members={members}
              onChange={updateScenesShots}
              onEditScene={setEditingScene}
              onDeleteScene={setDeleteScene}
              onReorder={(ordered) => reorderScenes(api, ordered, setData)}
              viewMode={viewMode}
            />
          );
        })}

        {unsectioned.length > 0 && (
          <SectionBlock
            title={sections.length > 0 ? "Ohne Abschnitt" : undefined}
            scenes={unsectioned}
            shotsFor={shotsFor}
            members={members}
            onChange={updateScenesShots}
            onEditScene={setEditingScene}
            onDeleteScene={setDeleteScene}
            onReorder={(ordered) => reorderScenes(api, ordered, setData)}
            viewMode={viewMode}
          />
        )}

        <div className="flex flex-wrap gap-3 mt-2 mb-10">
          <Button variant="primary" onClick={() => setCreatingScene(true)}>
            <PlusIcon /> Neue Szene
          </Button>
          {creatingSection ? (
            <div className="flex gap-2">
              <Input
                autoFocus
                value={newSectionName}
                onChange={(e) => setNewSectionName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createSection()}
                onBlur={createSection}
                placeholder="Abschnittsname"
                className="w-48"
              />
            </div>
          ) : (
            <Button variant="secondary" onClick={() => setCreatingSection(true)}>
              <PlusIcon /> Abschnitt
            </Button>
          )}
        </div>
      </div>

      <SceneEditModal
        open={editingScene !== null || creatingScene}
        onClose={() => {
          setEditingScene(null);
          setCreatingScene(false);
        }}
        projectId={data.id}
        existing={editingScene}
        previousScene={creatingScene ? lastScene : null}
        members={members}
        onCreated={handleSceneCreated}
        onUpdated={handleSceneUpdated}
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
        members={members}
        onChange={(updater) => setMembers(updater)}
      />
      <NotionImportModal
        open={showNotion}
        onClose={() => setShowNotion(false)}
        project={data}
        onImported={() => api.projectDetail(data.id).then(setData)}
      />
    </AppShell>
  );
}

async function reorderScenes(
  api: ReturnType<typeof useApi>,
  ordered: Scene[],
  setData: React.Dispatch<React.SetStateAction<ProjectDetail | null>>
) {
  setData((prev) => {
    if (!prev) return prev;
    const others = prev.scenes.filter((s) => !ordered.some((o) => o.id === s.id));
    return { ...prev, scenes: [...others, ...ordered] };
  });
  // Backend renumbers via move-before-neighbor, one call per moved scene is
  // unavoidable (no bulk-reorder endpoint - see moveScene in ShotListViewModel
  // on iOS for the same constraint). Only the scene that actually moved needs
  // the call; the rest just shifted index because of it.
  for (let i = 0; i < ordered.length - 1; i++) {
    try {
      await api.moveScene(ordered[i].id, ordered[i + 1].id);
    } catch {
      // best-effort; a full reload will fix any drift
    }
  }
}

function SectionBlock({
  title,
  scenes,
  shotsFor,
  members,
  onChange,
  onEditScene,
  onDeleteScene,
  onReorder,
  viewMode,
}: {
  title?: string;
  scenes: Scene[];
  shotsFor: (sceneId: string) => Shot[];
  members: Member[];
  onChange: (updater: (d: { scenes: Scene[]; shots: Shot[] }) => { scenes: Scene[]; shots: Shot[] }) => void;
  onEditScene: (scene: Scene) => void;
  onDeleteScene: (scene: Scene) => void;
  onReorder: (ordered: Scene[]) => void;
  viewMode: "grid" | "table";
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  // A short press delay (not distance) on touch keeps a plain tap from ever
  // registering as a drag attempt, while still letting a real press-and-hold
  // start one immediately - distance-based activation felt "off" on touch
  // because scrolling the page also moves the finger past the threshold.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } })
  );

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = scenes.findIndex((s) => s.id === active.id);
    const newIndex = scenes.findIndex((s) => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    onReorder(arrayMove(scenes, oldIndex, newIndex));
  }

  const activeScene = activeId ? scenes.find((s) => s.id === activeId) ?? null : null;
  const doneCount = scenes.filter((s) => s.completed).length;

  const grid = (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        {/* rectSortingStrategy (not verticalListSortingStrategy) - the grid
            below wraps into 2-3 columns depending on viewport, and the
            vertical-list strategy assumes a single column, which is what
            made reordering look broken/jumpy in anything but one column. */}
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
        </SortableContext>
        <DragOverlay>
          {activeScene && (
            <div className="rotate-2 shadow-2xl shadow-black/50 cursor-grabbing">
              <SceneCard scene={activeScene} shots={shotsFor(activeScene.id)} members={members} onEdit={() => {}} onDelete={() => {}} onChange={() => {}} />
            </div>
          )}
        </DragOverlay>
      </DndContext>
  );

  const content =
    viewMode === "table" ? (
      <SceneTable scenes={scenes} shotsFor={shotsFor} members={members} onEditScene={onEditScene} onChange={onChange} onReorder={onReorder} />
    ) : (
      grid
    );

  if (!title) {
    return <div className="mb-8">{content}</div>;
  }

  return (
    <div className="mb-8">
      <Collapsible title={title} subtitle={`${doneCount}/${scenes.length}`}>
        {content}
      </Collapsible>
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
function LinkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.5 1.5" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.5-1.5" />
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
