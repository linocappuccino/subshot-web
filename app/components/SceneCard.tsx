"use client";

import { useState } from "react";
import { useApi } from "@/lib/useApi";
import type { ProjectDetail, Scene, Shot } from "@/lib/types";
import { AuthImage } from "./AuthImage";

const PRIORITY_COLORS: Record<string, string> = {
  must: "#d1504f",
  should: "#e08a3c",
  optional: "#c9a227",
  none: "#7a7a7a",
};

export function SceneCard({
  scene,
  shots,
  onChange,
}: {
  scene: Scene;
  shots: Shot[];
  onChange: (updater: (data: ProjectDetail) => ProjectDetail) => void;
}) {
  const api = useApi();
  const [addingShot, setAddingShot] = useState(false);
  const [newShotText, setNewShotText] = useState("");
  const [addingDialogue, setAddingDialogue] = useState(false);
  const [newDialogueText, setNewDialogueText] = useState("");

  async function toggleCompleted() {
    const updated = await api.patchScene(scene.id, { completed: !scene.completed });
    onChange((data) => ({ ...data, scenes: data.scenes.map((s) => (s.id === updated.id ? updated : s)) }));
  }

  async function toggleShotDone(shot: Shot) {
    const updated = await api.patchShot(shot.id, { status: shot.status === "done" ? "open" : "done" });
    onChange((data) => ({ ...data, shots: data.shots.map((s) => (s.id === updated.id ? updated : s)) }));
  }

  async function addShot() {
    const description = newShotText.trim();
    if (!description) return;
    const shot = await api.createShot(scene.project_id, { scene_id: scene.id, description });
    onChange((data) => ({ ...data, shots: [...data.shots, shot] }));
    setNewShotText("");
    setAddingShot(false);
  }

  async function addDialogue() {
    const text = newDialogueText.trim();
    if (!text) return;
    const dialogue = await api.addDialogue(scene.id, text);
    onChange((data) => ({
      ...data,
      scenes: data.scenes.map((s) => (s.id === scene.id ? { ...s, dialogues: [...s.dialogues, dialogue] } : s)),
    }));
    setNewDialogueText("");
    setAddingDialogue(false);
  }

  async function toggleDialogue(dialogueId: string, done: boolean) {
    const updated = await api.patchDialogue(dialogueId, { done: !done });
    onChange((data) => ({
      ...data,
      scenes: data.scenes.map((s) =>
        s.id === scene.id ? { ...s, dialogues: s.dialogues.map((d) => (d.id === updated.id ? updated : d)) } : s
      ),
    }));
  }

  const metaParts: string[] = [];
  if (scene.scheduled_at) {
    metaParts.push(
      new Date(scene.scheduled_at).toLocaleString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    );
    if (scene.duration_minutes) metaParts.push(`${scene.duration_minutes} Min.`);
  }
  if (scene.location_address) metaParts.push(scene.location_address);

  return (
    <div className={`rounded-2xl p-4 ${scene.completed ? "bg-green-900/20" : "bg-white/[0.06]"}`}>
      <div className="flex items-center gap-2 mb-1">
        <span
          className="text-xs font-bold text-white px-2 py-0.5 rounded-full"
          style={{ backgroundColor: PRIORITY_COLORS[scene.priority ?? "none"] }}
        >
          {scene.number}
          {scene.letter ?? ""}
        </span>
        <h3 className="font-semibold flex-1">{scene.name || "Unbenannte Szene"}</h3>
        {scene.completed && (
          <span className="text-xs font-bold text-white px-2 py-0.5 rounded-full bg-green-700">IM KASTEN</span>
        )}
      </div>

      {metaParts.length > 0 && <div className="text-xs text-white/50 mb-2">{metaParts.join(" · ")}</div>}

      {scene.image_url && (
        <AuthImage path={scene.image_url} alt={scene.name ?? "Szene"} className="w-full max-h-64 object-cover rounded-lg mb-2" />
      )}

      {scene.description && <p className="text-sm mb-1">{scene.description}</p>}
      {scene.dialogue && <p className="text-sm italic text-white/60 mb-1">„{scene.dialogue}“</p>}

      {scene.dialogues.map((d) => (
        <div
          key={d.id}
          onClick={() => toggleDialogue(d.id, d.done)}
          className={`text-sm cursor-pointer mb-0.5 ${d.done ? "line-through text-white/40" : "text-white/80"}`}
        >
          {d.done ? "☑" : "☐"} {d.text}
        </div>
      ))}
      {addingDialogue ? (
        <input
          autoFocus
          value={newDialogueText}
          onChange={(e) => setNewDialogueText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addDialogue()}
          onBlur={addDialogue}
          placeholder="Neuer Dialog"
          className="bg-white/5 border border-white/10 rounded px-2 py-1 text-sm w-full mt-1"
        />
      ) : (
        <button onClick={() => setAddingDialogue(true)} className="text-xs text-white/40 hover:text-white/70 mt-1">
          + Dialog
        </button>
      )}

      {shots.length > 0 && (
        <div className="mt-3 space-y-2">
          {shots.map((shot) => (
            <div key={shot.id} className="flex gap-2 items-start border-t border-white/10 pt-2">
              <button onClick={() => toggleShotDone(shot)} className="mt-0.5 shrink-0">
                {shot.status === "done" ? "✅" : "⬜️"}
              </button>
              {shot.image_url && (
                <AuthImage path={shot.image_url} alt="" className="w-16 h-12 object-cover rounded shrink-0" />
              )}
              <div className="text-sm">
                <div className={shot.status === "done" ? "line-through text-white/40" : ""}>
                  {shot.description || "Ohne Beschreibung"}
                </div>
                {shot.good_take_filename && (
                  <div className="text-xs text-green-400">Good Take: {shot.good_take_filename}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!scene.is_intermediate_step && (
        <div className="mt-2">
          {addingShot ? (
            <input
              autoFocus
              value={newShotText}
              onChange={(e) => setNewShotText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addShot()}
              onBlur={addShot}
              placeholder="Neue Einstellung"
              className="bg-white/5 border border-white/10 rounded px-2 py-1 text-sm w-full"
            />
          ) : (
            <button onClick={() => setAddingShot(true)} className="text-xs text-white/40 hover:text-white/70">
              + Einstellung hinzufügen
            </button>
          )}
        </div>
      )}

      <div className="flex justify-end mt-3">
        <button
          onClick={toggleCompleted}
          className={`text-xs font-semibold px-3 py-1.5 rounded-full ${
            scene.completed ? "bg-green-700/30 text-green-400" : "bg-white/10 text-white/60"
          }`}
        >
          Im Kasten
        </button>
      </div>
    </div>
  );
}
