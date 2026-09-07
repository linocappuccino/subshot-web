import type { Annotation, Member, Scene, Shot } from "@/lib/types";
import { PublicSceneMedia } from "./PublicSceneMedia";
import { PublicMapThumb } from "./PublicMapThumb";
import { wrapHighlights } from "./PublicHighlightedText";
import { useLanguage, type TranslationKey } from "@/lib/i18n";

const PRIORITY_COLORS: Record<string, string> = { must: "#d1504f", should: "#e08a3c", optional: "#3d84d8" };
const PRIORITY_LABEL_KEYS: Record<string, TranslationKey> = { must: "priority.must", should: "priority.should", optional: "priority.optional" };
const STATUS_LABEL_KEYS: Record<string, TranslationKey> = { open: "annotationsPanel.statusOpen", done: "annotationsPanel.statusResolved" };
// Same swatch set as the authenticated app's own SceneCard.tsx (lib/types.ts
// PALETTE) and iOS/backend's identical dialogue-line palette — kept
// identical across all three so a given line's Nth-index color reads the
// same everywhere.
const DIALOGUE_PALETTE = ["#3875bd", "#0f7e55", "#4e4295", "#d1504f", "#b9507b", "#a64c22"];

function memberName(m: Member | undefined): string | null {
  if (!m) return null;
  return m.name || m.email;
}

/** shot.description's own highlight field — see PublicSceneCard's own doc
 * comment below for why this isn't just "description" (that's the SCENE's
 * own description field, reused per-shot would cross-wrap between a shot's
 * text and its parent scene's). New field convention, no backward-
 * compatibility concern (the old page never let a shot's description be
 * highlighted at all — see share_view.py's _shot_html, no data-field there). */
export function shotDescriptionField(shotId: string): string {
  return `shot:${shotId}:description`;
}

function ShotRow({
  shot, annotations, onMarkClick,
}: {
  shot: Shot;
  annotations: Annotation[];
  onMarkClick: (annotation: Annotation) => void;
}) {
  const { t } = useLanguage();
  const meta: string[] = [];
  if (shot.camera_angle) meta.push(shot.camera_angle);
  if (shot.duration_seconds) meta.push(`${shot.duration_seconds}s`);
  if (shot.priority) meta.push(shot.priority in PRIORITY_LABEL_KEYS ? t(PRIORITY_LABEL_KEYS[shot.priority]) : shot.priority);

  return (
    <div className="flex gap-2.5 items-center p-2 rounded-lg bg-white/[0.03]">
      {shot.image_url ? (
        <PublicSceneMedia
          imageUrl={shot.image_url}
          className="w-[60px] h-[46px] object-cover rounded-md shrink-0"
        />
      ) : (
        <div className="w-[60px] h-[46px] rounded-md shrink-0 bg-[#2c2c2c] flex items-center justify-center text-white/30">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="10" r="1.7" /><path d="m21 16-5-5-9 9" />
          </svg>
        </div>
      )}
      <div className="min-w-0">
        <div className="text-[13px] font-semibold" data-field={shotDescriptionField(shot.id)}>
          {wrapHighlights(shot.description || t("shot.noDescription"), annotations, onMarkClick)}
        </div>
        <div className="text-[11px] text-white/50 mt-0.5 flex items-center gap-1 flex-wrap">
          {meta.join(" · ")}
          {shot.status === "done" && (
            <span className="text-emerald-400 inline-flex items-center gap-1">
              {meta.length > 0 && "· "}
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 6 9 17l-5-5" /></svg>
              {t(STATUS_LABEL_KEYS.done)}
            </span>
          )}
          {shot.status !== "done" && meta.length === 0 && t(STATUS_LABEL_KEYS.open)}
          {shot.good_take_filename && (
            <span className="text-emerald-400 inline-flex items-center gap-1 ml-1.5">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 6 9 17l-5-5" /></svg>
              {shot.good_take_filename}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** One scene tile — React counterpart to share_view.py's _scene_html, with
 * pen-annotation rendering entirely dropped (Lino's explicit #268 scope
 * decision, see the module-level task doc) and no editing affordances
 * (read-only except for the highlight-annotation flow the parent page wires
 * up via data-field/data-scene-id attributes + onMarkClick). `annotations`
 * is already filtered to this one scene's OPEN highlight annotations by the
 * caller (mirrors _scene_html's own `ann.status == "open"` filter — the
 * public page never shows resolved/rejected annotations as marks, only in
 * status changes which never happen here anyway since triage is app-only).
 *
 * 2026-09-07 fix, Lino: "in der preview von einer shotlist soll man NICHT
 * pro kachel eine kommentar box haben!" — used to render its own
 * PublicSceneComments (name/textarea/send, plus the round-grouped comment
 * list) at the bottom of every single tile, on top of the section-level
 * comment sidebar (preview-scenes/[token]/page.tsx) that now covers
 * feedback for the whole opened shotlist. Removed entirely — inline
 * highlight-annotation MARKUP (the yellow-underline "select text, leave a
 * note" flow via wrapHighlights/onMarkClick above) is untouched, that's a
 * completely separate mechanism from the comment box this dropped. */
export function PublicSceneCard({
  scene, shots, annotations, memberById, token, unlockToken, onMarkClick,
}: {
  scene: Scene;
  shots: Shot[];
  annotations: Annotation[];
  memberById: Map<string, Member>;
  token: string;
  unlockToken: string | null;
  onMarkClick: (annotation: Annotation) => void;
}) {
  const { t } = useLanguage();
  const color = scene.priority ? PRIORITY_COLORS[scene.priority] : "#7a7a7a";
  const byField = (field: string) => annotations.filter((a) => a.field === field);

  const assigneeNames = scene.assignee_ids.map((id) => memberName(memberById.get(id))).filter(Boolean) as string[];
  const scheduled = scene.scheduled_at
    ? `${t("previewPage.startLabel", { date: new Date(scene.scheduled_at).toLocaleString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) })}${
        scene.duration_minutes ? ` · ${t("sceneEditModal.minutesShort", { count: scene.duration_minutes })}` : ""
      }`
    : null;

  const sortedShots = [...shots].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div data-scene-id={scene.id} className="relative rounded-2xl bg-[#212121] border border-white/[0.06] p-4 shadow-sm">
      <div className="flex items-center gap-2 flex-wrap mb-2.5">
        <span className="text-[11px] font-bold text-white rounded-full px-2.5 py-1 whitespace-nowrap" style={{ background: color }}>
          {scene.number}
          {scene.letter || ""}
        </span>
        <h3 className="text-[15px] font-bold flex-1 min-w-0" data-field="name">
          {wrapHighlights(scene.name || t("scene.unnamed"), byField("name"), onMarkClick)}
        </h3>
        {scene.priority && (
          <span className="text-[11px] font-bold text-white rounded-full px-2.5 py-1 whitespace-nowrap" style={{ background: color }}>
            {t(PRIORITY_LABEL_KEYS[scene.priority])}
          </span>
        )}
        {scene.completed && (
          <span className="text-[11px] font-bold text-emerald-400 bg-emerald-500/15 rounded-full px-2.5 py-1 inline-flex items-center gap-1 whitespace-nowrap">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 6 9 17l-5-5" /></svg>
            {t("publicSceneCard.inTheCan")}
          </span>
        )}
      </div>

      {(sortedShots.length > 0 || scene.good_take_filename) && !scene.is_intermediate_step && (
        <div className="flex flex-wrap gap-1.5 mb-2.5">
          {sortedShots.length > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-white/60 bg-white/[0.06] rounded-full px-2.5 py-1">
              {sortedShots.length === 1
                ? t("publicSceneCard.shotsCountSingular", { count: sortedShots.length })
                : t("publicSceneCard.shotsCountPlural", { count: sortedShots.length })}
            </span>
          )}
          {scene.good_take_filename && (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-400 bg-emerald-500/[0.14] rounded-full px-2.5 py-1">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 6 9 17l-5-5" /></svg>
              {scene.good_take_filename}
            </span>
          )}
        </div>
      )}

      {(scheduled || assigneeNames.length > 0) && (
        <div className="flex flex-wrap gap-1.5 mb-2.5">
          {scheduled && (
            <span className="inline-flex items-center gap-1.5 text-xs text-white/60 bg-white/[0.06] rounded-full px-2.5 py-1">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
              {scheduled}
            </span>
          )}
          {assigneeNames.length > 0 && (
            <span className="inline-flex items-center gap-1.5 text-xs text-white/60 bg-white/[0.06] rounded-full px-2.5 py-1">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
              </svg>
              {assigneeNames.join(", ")}
            </span>
          )}
        </div>
      )}

      {scene.image_url && (
        <PublicSceneMedia
          imageUrl={scene.image_url}
          className="w-full aspect-video object-cover rounded-xl mb-3 block"
        />
      )}

      {scene.description && (
        <div className="text-sm leading-relaxed mb-2 whitespace-pre-line" data-field="description">
          {wrapHighlights(scene.description, byField("description"), onMarkClick)}
        </div>
      )}

      {scene.dialogue && scene.dialogues.length === 0 && (
        <div className="text-sm italic text-white/70 mb-1.5 whitespace-pre-line" data-field="dialogue">
          „{wrapHighlights(scene.dialogue, byField("dialogue"), onMarkClick)}“
        </div>
      )}

      {scene.dialogues.length > 0 && (
        <div className="rounded-lg bg-white/[0.04] p-2.5 my-2">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-white/50 uppercase tracking-wide mb-1.5">
            {t("sceneEditModal.dialog")}
          </div>
          <ul className="text-sm text-white/85 flex flex-col gap-1" data-field="dialogue">
            {[...scene.dialogues]
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((d, i) => {
                const lineColor = DIALOGUE_PALETTE[i % DIALOGUE_PALETTE.length];
                return (
                  <li
                    key={d.id}
                    className={`flex items-start gap-1.5 rounded px-1.5 py-1 border-l-2 ${d.done ? "line-through text-white/40" : ""}`}
                    style={{ backgroundColor: `${lineColor}14`, borderLeftColor: `${lineColor}80` }}
                  >
                    <span
                      className={`w-3.5 h-3.5 mt-0.5 rounded-full border shrink-0 flex items-center justify-center ${
                        d.done ? "border-emerald-500 bg-emerald-500" : "border-white/40"
                      }`}
                    >
                      {d.done && (
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      )}
                    </span>
                    <span className="flex-1 min-w-0 whitespace-pre-line">{wrapHighlights(d.text, byField("dialogue"), onMarkClick)}</span>
                  </li>
                );
              })}
          </ul>
        </div>
      )}

      <PublicMapThumb token={token} unlockToken={unlockToken} address={scene.location_address} lat={scene.location_lat} lng={scene.location_lng} compact />

      {sortedShots.length > 0 && (
        <div className="flex flex-col gap-2 mt-2.5">
          {sortedShots.map((shot) => (
            <ShotRow
              key={shot.id}
              shot={shot}
              annotations={byField(shotDescriptionField(shot.id))}
              onMarkClick={onMarkClick}
            />
          ))}
        </div>
      )}

    </div>
  );
}
