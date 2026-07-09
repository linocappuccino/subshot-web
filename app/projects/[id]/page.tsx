"use client";

import { useEffect, useState, use as usePromise } from "react";
import Link from "next/link";
import { useApi } from "@/lib/useApi";
import type { ProjectDetail, Scene, Shot } from "@/lib/types";
import { SceneCard } from "@/app/components/SceneCard";

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const api = useApi();
  const [data, setData] = useState<ProjectDetail | null>(null);
  const [creatingScene, setCreatingScene] = useState(false);
  const [newSceneName, setNewSceneName] = useState("");
  const [shareLink, setShareLink] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.projectDetail(id).then((d) => {
      if (!cancelled) setData(d);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function updateData(updater: (data: ProjectDetail) => ProjectDetail) {
    setData((prev) => (prev ? updater(prev) : prev));
  }

  async function createScene() {
    const name = newSceneName.trim();
    if (!name || !data) return;
    const scene = await api.createScene(data.id, { name, color: data.color });
    updateData((d) => ({ ...d, scenes: [...d.scenes, scene] }));
    setNewSceneName("");
    setCreatingScene(false);
  }

  async function createShareLink() {
    const result = await api.shareLink(id);
    setShareLink(result.url);
  }

  if (!data) return <div className="flex-1 flex items-center justify-center text-white/50">Lädt…</div>;

  // Same "completed scenes always last within their group" rule as the iOS
  // app (ShotListViewModel.scenes(in:)) and the PDF/share-link exports.
  const scenesIn = (sectionId: string | null) =>
    data.scenes
      .filter((s) => s.section_id === sectionId)
      .sort((a, b) => Number(a.completed) - Number(b.completed));

  const shotsFor = (sceneId: string) => data.shots.filter((s) => s.scene_id === sceneId && s.status !== "deleted").sort((a, b) => a.sort_order - b.sort_order);

  const sections = [...data.sections].sort((a, b) => a.sort_order - b.sort_order);
  const unsectioned = scenesIn(null);

  return (
    <div className="flex-1 max-w-6xl mx-auto w-full px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/projects" className="text-sm text-white/40 hover:text-white/70">
            ← Projekte
          </Link>
          <h1 className="text-2xl font-semibold">{data.name}</h1>
        </div>
        <div className="flex gap-2 items-start">
          {shareLink ? (
            <input
              readOnly
              value={shareLink}
              onFocus={(e) => e.currentTarget.select()}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs w-64"
            />
          ) : (
            <button onClick={createShareLink} className="bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg px-3 py-2 text-sm">
              Link teilen
            </button>
          )}
        </div>
      </div>

      {sections.map((section) => {
        const group = scenesIn(section.id);
        if (group.length === 0) return null;
        return (
          <div key={section.id} className="mb-8">
            <h2 className="text-sm text-white/50 mb-3">{section.name}</h2>
            <SceneGrid scenes={group} shotsFor={shotsFor} onChange={updateData} />
          </div>
        );
      })}

      {unsectioned.length > 0 && (
        <div className="mb-8">
          {sections.length > 0 && <h2 className="text-sm text-white/50 mb-3">Ohne Abschnitt</h2>}
          <SceneGrid scenes={unsectioned} shotsFor={shotsFor} onChange={updateData} />
        </div>
      )}

      <div className="mt-4">
        {creatingScene ? (
          <div className="flex gap-2 max-w-sm">
            <input
              autoFocus
              value={newSceneName}
              onChange={(e) => setNewSceneName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createScene()}
              placeholder="Szenenname"
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 flex-1"
            />
            <button onClick={createScene} className="bg-blue-600 hover:bg-blue-500 rounded-lg px-4 py-2">
              Anlegen
            </button>
          </div>
        ) : (
          <button
            onClick={() => setCreatingScene(true)}
            className="bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg px-4 py-2 text-sm"
          >
            + Neue Szene
          </button>
        )}
      </div>
    </div>
  );
}

function SceneGrid({
  scenes,
  shotsFor,
  onChange,
}: {
  scenes: Scene[];
  shotsFor: (sceneId: string) => Shot[];
  onChange: (updater: (data: ProjectDetail) => ProjectDetail) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {scenes.map((scene) => (
        <SceneCard key={scene.id} scene={scene} shots={shotsFor(scene.id)} onChange={onChange} />
      ))}
    </div>
  );
}
