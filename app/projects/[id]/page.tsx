"use client";

import { useEffect, useState, use as usePromise } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { useApi } from "@/lib/useApi";
import { ApiError } from "@/lib/api";
import type { Member, ProjectDetail, Scene, Shot } from "@/lib/types";
import { SortableSceneCard } from "@/app/components/SortableSceneCard";
import { SceneEditModal } from "@/app/components/SceneEditModal";
import { TodoListsPanel } from "@/app/components/TodoListsPanel";
import { TeamPanel } from "@/app/components/TeamPanel";
import { NotionImportModal } from "@/app/components/NotionImportModal";
import { AppShell } from "@/app/components/AppShell";
import { Button } from "@/app/components/ui/Button";
import { ConfirmDialog } from "@/app/components/ui/ConfirmDialog";
import { useToast } from "@/app/components/ui/Toast";
import { Input } from "@/app/components/ui/Field";

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
              Team
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setShowNotion(true)}>
              Notion-Import
            </Button>
            <Button variant="secondary" size="sm" onClick={exportPdf} disabled={exportingPdf}>
              {exportingPdf ? "Exportiert…" : "PDF"}
            </Button>
            <Button variant="secondary" size="sm" onClick={createShareLink} disabled={creatingLink}>
              {shareLink ? "Link erneuern" : "Link teilen"}
            </Button>
          </div>
        </div>

        {shareLink && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mb-6">
            <Input readOnly value={shareLink} onFocus={(e) => e.currentTarget.select()} className="text-xs max-w-md" />
          </motion.div>
        )}

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
          />
        )}

        <div className="flex flex-wrap gap-3 mt-2 mb-10">
          <Button variant="primary" onClick={() => setCreatingScene(true)}>
            + Neue Szene
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
              + Abschnitt
            </Button>
          )}
        </div>

        <TodoListsPanel
          projectId={data.id}
          todoLists={data.todo_lists}
          members={members}
          onChange={(updater) => setData((prev) => (prev ? { ...prev, todo_lists: updater(prev.todo_lists) } : prev))}
        />
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
        projectId={data.id}
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
}: {
  title?: string;
  scenes: Scene[];
  shotsFor: (sceneId: string) => Shot[];
  members: Member[];
  onChange: (updater: (d: { scenes: Scene[]; shots: Shot[] }) => { scenes: Scene[]; shots: Shot[] }) => void;
  onEditScene: (scene: Scene) => void;
  onDeleteScene: (scene: Scene) => void;
  onReorder: (ordered: Scene[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = scenes.findIndex((s) => s.id === active.id);
    const newIndex = scenes.findIndex((s) => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    onReorder(arrayMove(scenes, oldIndex, newIndex));
  }

  return (
    <div className="mb-8">
      {title && <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wide mb-3">{title}</h2>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={scenes.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
            <AnimatePresence mode="popLayout">
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
      </DndContext>
    </div>
  );
}
