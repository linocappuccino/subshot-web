"use client";

import { useApi } from "@/lib/useApi";
import { ApiError } from "@/lib/api";
import { PRIORITY_COLORS, PRIORITY_LABELS, type Member, type Scene, type Shot } from "@/lib/types";
import { ColorBadge, Pill } from "./ui/Badge";
import { Avatar } from "./ui/Avatar";
import { useToast } from "./ui/Toast";

/** Compact alternative to the card grid — same data, one row per scene, for
 * scanning a long shot list quickly instead of scrolling past photos. */
export function SceneTable({
  scenes,
  shotsFor,
  members,
  onEditScene,
  onChange,
}: {
  scenes: Scene[];
  shotsFor: (sceneId: string) => Shot[];
  members: Member[];
  onEditScene: (scene: Scene) => void;
  onChange: (updater: (d: { scenes: Scene[]; shots: Shot[] }) => { scenes: Scene[]; shots: Shot[] }) => void;
}) {
  const api = useApi();
  const toast = useToast();

  async function toggleCompleted(scene: Scene) {
    try {
      const updated = await api.patchScene(scene.id, { completed: !scene.completed });
      onChange((d) => ({ ...d, scenes: d.scenes.map((s) => (s.id === updated.id ? updated : s)) }));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Fehlgeschlagen.");
    }
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-white/8 mb-2">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-white/[0.04] text-left text-[11px] font-semibold text-white/40 uppercase tracking-wide">
            <th className="px-3 py-2.5 font-semibold">Nr.</th>
            <th className="px-3 py-2.5 font-semibold">Name</th>
            <th className="px-3 py-2.5 font-semibold">Priorität</th>
            <th className="px-3 py-2.5 font-semibold">Start</th>
            <th className="px-3 py-2.5 font-semibold">Standort</th>
            <th className="px-3 py-2.5 font-semibold">Zuständig</th>
            <th className="px-3 py-2.5 font-semibold text-center">Einst.</th>
            <th className="px-3 py-2.5 font-semibold text-center">Im Kasten</th>
          </tr>
        </thead>
        <tbody>
          {scenes.map((scene) => {
            const color = PRIORITY_COLORS[scene.priority ?? "none"];
            const assignee = members.find((m) => m.user_id === scene.assignee_id);
            const shots = shotsFor(scene.id);
            return (
              <tr
                key={scene.id}
                onClick={() => onEditScene(scene)}
                className={`border-t border-white/6 cursor-pointer transition-colors hover:bg-white/[0.05] ${
                  scene.completed ? "bg-emerald-500/[0.06]" : ""
                }`}
              >
                <td className="px-3 py-2.5">
                  <ColorBadge label={`${scene.number}${scene.letter ?? ""}`} color={color} />
                </td>
                <td className="px-3 py-2.5 font-medium max-w-[220px] truncate">{scene.name || "Unbenannte Szene"}</td>
                <td className="px-3 py-2.5">
                  {scene.priority ? <ColorBadge label={PRIORITY_LABELS[scene.priority]} color={color} /> : <span className="text-white/25">—</span>}
                </td>
                <td className="px-3 py-2.5 text-white/70 whitespace-nowrap">
                  {scene.scheduled_at ? (
                    <>
                      {new Date(scene.scheduled_at).toLocaleString("de-CH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      {scene.duration_minutes ? ` · ${scene.duration_minutes} Min.` : ""}
                    </>
                  ) : (
                    <span className="text-white/25">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-white/60 max-w-[180px] truncate">{scene.location_address || <span className="text-white/25">—</span>}</td>
                <td className="px-3 py-2.5">
                  {assignee ? (
                    <div className="flex items-center gap-1.5">
                      <Avatar name={assignee.name} email={assignee.email} avatarUrl={assignee.avatar_url} size={20} />
                      <span className="text-xs text-white/60 truncate max-w-[100px]">{assignee.name || assignee.email}</span>
                    </div>
                  ) : (
                    <span className="text-white/25">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-center text-white/60">{scene.is_intermediate_step ? "—" : shots.length}</td>
                <td className="px-3 py-2.5 text-center">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleCompleted(scene);
                    }}
                  >
                    <span
                      className="inline-flex w-5 h-5 rounded-full border-[1.5px] items-center justify-center transition-colors"
                      style={{
                        borderColor: scene.completed ? "#4caf6d" : "rgba(255,255,255,0.3)",
                        backgroundColor: scene.completed ? "#4caf6d" : "transparent",
                      }}
                    >
                      {scene.completed && (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      )}
                    </span>
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {scenes.some((s) => s.good_take_filename) && (
        <div className="px-3 py-2 border-t border-white/6 flex flex-wrap gap-1.5">
          {scenes
            .filter((s) => s.good_take_filename)
            .map((s) => (
              <Pill key={s.id} tone="good">
                {s.number}
                {s.letter ?? ""}: {s.good_take_filename}
              </Pill>
            ))}
        </div>
      )}
    </div>
  );
}
