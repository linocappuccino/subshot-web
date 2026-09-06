"use client";

import { useEffect, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Input, Textarea, Label, FieldGroup } from "./ui/Field";
import { Switch } from "./ui/Switch";
import { SegmentedControl } from "./ui/SegmentedControl";
import { ImageDropZone } from "./ui/ImageDropZone";
import { ImageGeneratePopup } from "./ImageGeneratePopup";
import { DateTimePicker } from "./ui/DateTimePicker";
import { LocationPicker } from "./ui/LocationPicker";
import { ShotEditModal } from "./ShotEditModal";
import { SortableShotRow, ShotRowContent, computeShotReorder } from "./SceneCard";
import { Avatar } from "./ui/Avatar";
import { Menu, MenuItem } from "./ui/Menu";
import { useApi } from "@/lib/useApi";
import { useToast } from "./ui/Toast";
import { useAutosave } from "@/lib/useAutosave";
import { ApiError } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import { PRIORITY_COLORS, type Member, type Priority, type Scene, type SceneDialogue, type Shot } from "@/lib/types";

const DURATIONS = [null, ...Array.from({ length: 48 }, (_, i) => (i + 1) * 5)];

/** Full-parity editor with the iOS app's SceneEditSheet: name, priority,
 * description, dialogue (checkable multi-line list, added one at a time via
 * "+ Dialog" - no free-text box here, only the individually-checkable
 * lines), Start date/time + duration (auto-suggested from the previous
 * scene's Start+duration when creating a new one), location, good-take
 * filename, and a cover photo. */
export function SceneEditModal({
  open,
  onClose,
  projectId,
  existing,
  previousScene,
  nextSortOrder,
  members,
  shots,
  onCreated,
  onUpdated,
  onShotCreated,
  onShotUpdated,
  isIntermediateStep = false,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  existing: Scene | null;
  /** This scene's own shots, already filtered+sorted by the caller (same
   * `shotsFor(scene.id)` page.tsx already computes for SceneCard) — 2026-
   * 07-17, Lino: viewing/reordering moves into this modal too, not just
   * adding (see onShotCreated's own doc comment on why adding lives here). */
  shots: Shot[];
  previousScene: Scene | null;
  /** sort_order to send when CREATING a scene — always "one past the
   * project's current highest sort_order" (see page.tsx), so a new scene
   * always lands at the very end instead of colliding with an existing one.
   * See its own doc comment at the call site for why this matters: without
   * it the backend defaulted every new scene to sort_order 0, which made
   * scene NUMBERING (a completely separate concept from sort_order, see
   * _assign_scene_number in main.py) resolve every second/third/... new
   * scene as a lettered variant of the first scene's number instead of its
   * own next integer (Lino: "die erste Szene ist 1, die zweite 1A, dann
   * 1B"). */
  nextSortOrder: number;
  members: Member[];
  onCreated: (scene: Scene) => void;
  onUpdated: (scene: Scene) => void;
  /** 2026-07-17, Lino: "+ Einstellung hinzufügen" moved out of the always-
   * visible tile (SceneCard) into here, under Dialog — only reachable once
   * the scene is actually open, not from the grid overview. Only fires for
   * an EXISTING scene (see the gate at the JSX below) since a shot needs a
   * real scene_id; there's nothing to add it to while still creating one. */
  onShotCreated?: (shot: Shot) => void;
  /** Reorder (drag-and-drop, see the shots section below) and ShotEditModal
   * edits both go through here — same shape as SceneCard's own onChange
   * shots-updater, just scoped to a single shot at a time. */
  onShotUpdated?: (shot: Shot) => void;
  /** "Zwischenschritt" (mirrors the iOS app's SceneEditSheet): a lighter
   * connective beat, not a shootable scene — creation-time choice only (an
   * existing scene's `existing.is_intermediate_step` decides this instead,
   * never toggled after creation), hides Bild/Priorität/Dialog since none
   * of those apply. */
  isIntermediateStep?: boolean;
}) {
  const api = useApi();
  const toast = useToast();
  const { t } = useLanguage();

  // An existing scene's own field wins once it's been created — the prop is
  // only meaningful for the not-yet-created case (see the prop's doc comment).
  const effectiveIsIntermediateStep = existing ? existing.is_intermediate_step : isIntermediateStep;

  const suggestedStart = (): Date => {
    if (!existing && previousScene?.scheduled_at && previousScene.duration_minutes) {
      const start = new Date(previousScene.scheduled_at);
      start.setMinutes(start.getMinutes() + previousScene.duration_minutes);
      return start;
    }
    return new Date();
  };

  const [openedFor, setOpenedFor] = useState(existing?.id ?? "new");
  const [name, setName] = useState(existing?.name ?? "");
  const [priority, setPriority] = useState<Priority | null>(existing?.priority ?? null);
  const [description, setDescription] = useState(existing?.description ?? "");
  const [hasStart, setHasStart] = useState(Boolean(existing?.scheduled_at));
  const [start, setStart] = useState<Date>(existing?.scheduled_at ? new Date(existing.scheduled_at) : suggestedStart());
  const [duration, setDuration] = useState<number | null>(existing?.duration_minutes ?? null);
  const [locationAddress, setLocationAddress] = useState(existing?.location_address ?? "");
  const [locationLat, setLocationLat] = useState<number | null>(existing?.location_lat ?? null);
  const [locationLng, setLocationLng] = useState<number | null>(existing?.location_lng ?? null);
  // 2026-07-14, Lino: "mehrere Personen auswählen können" — replaces the
  // old single assigneeId string with a list, mirroring Scene.assignee_ids.
  const [assigneeIds, setAssigneeIds] = useState<string[]>(existing?.assignee_ids ?? []);
  const [goodTake, setGoodTake] = useState(existing?.good_take_filename ?? "");
  const [dialogues, setDialogues] = useState<SceneDialogue[]>(existing?.dialogues ?? []);
  const [draftDialogues, setDraftDialogues] = useState<string[]>([]);
  const [newDialogueText, setNewDialogueText] = useState("");
  const [addingDialogue, setAddingDialogue] = useState(false);
  // Which existing dialogue line is being edited inline (2026-07-11, Lino:
  // dialog lines must be correctable, not just add/toggle/delete) — id of
  // the SceneDialogue, plus its own draft text so typing doesn't mutate
  // `dialogues` (and thus the checkbox/strike-through render) until saved.
  const [editingDialogueId, setEditingDialogueId] = useState<string | null>(null);
  const [editingDialogueText, setEditingDialogueText] = useState("");
  const [addingShot, setAddingShot] = useState(false);
  const [newShotText, setNewShotText] = useState("");
  const [editingShot, setEditingShot] = useState<Shot | null>(null);
  const [draggingShotId, setDraggingShotId] = useState<string | null>(null);
  const shotSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } })
  );
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  // 2026-07-15, Lino: no way to remove a scene's image, only replace it.
  const [imageRemoved, setImageRemoved] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Which AI style is currently generating (null = idle) — 2026-07-15,
   * Lino: button on an existing scene generates an image straight from its
   * description text, no separate prompt field. Only ever meaningful for
   * an already-saved scene (needs a real scene id to call the endpoint
   * against), same reasoning as uploadSceneImage's own existing-only path
   * for a brand-new, not-yet-created scene. */
  const [generatingStyle, setGeneratingStyle] = useState<"realistic" | "sketch" | "funny_sketch" | null>(null);
  /** 2026-07-17, Lino: "unter der Bild box soll ein Button 'AI Bild
   * generieren' sein, drückt man darauf kommt ein Pop up" — replaces the
   * old permanently-visible aspect-ratio/style switches + button row with
   * a single trigger button opening ImageGeneratePopup (own prompt/format/
   * style/Generieren all in one place). */
  const [showGeneratePopup, setShowGeneratePopup] = useState(false);

  // This component never unmounts (the page renders it once, unconditionally,
  // and toggles `open` — see Modal, which only hides/shows its CHILDREN, not
  // this component itself), so every useState above keeps whatever value it
  // last had across opens. The `openedFor !== (existing?.id ?? "new")` check
  // below used to be the only reset trigger — fine for switching between two
  // DIFFERENT existing scenes (their ids differ), but every brand-new scene
  // shares the same "new" sentinel, so creating one scene, closing, then
  // creating a second one saw "new" === "new" and skipped the reset entirely
  // — the second scene silently inherited the first one's name/image/dialog/
  // every other field until manually overwritten. Tracking the false→true
  // open transition catches that case too: any time the modal is freshly
  // opened for creation (not just for a genuinely different existing scene),
  // it resets.
  const wasOpenRef = useRef(false);
  const justOpened = open && !wasOpenRef.current;
  wasOpenRef.current = open;

  if (open && (justOpened || openedFor !== (existing?.id ?? "new"))) {
    setOpenedFor(existing?.id ?? "new");
    setName(existing?.name ?? "");
    setPriority(existing?.priority ?? null);
    setDescription(existing?.description ?? "");
    setHasStart(Boolean(existing?.scheduled_at));
    setStart(existing?.scheduled_at ? new Date(existing.scheduled_at) : suggestedStart());
    setDuration(existing?.duration_minutes ?? null);
    setLocationAddress(existing?.location_address ?? "");
    setLocationLat(existing?.location_lat ?? null);
    setLocationLng(existing?.location_lng ?? null);
    setAssigneeIds(existing?.assignee_ids ?? []);
    setGoodTake(existing?.good_take_filename ?? "");
    setDialogues(existing?.dialogues ?? []);
    setDraftDialogues([]);
    setAddingShot(false);
    setNewShotText("");
    setEditingShot(null);
    setImageFile(null);
    setImagePreview(null);
    setImageRemoved(false);
  }

  // Existing cover photo — image_url is a presigned R2 URL since #248
  // (2026-07-22), directly usable as the drop zone preview's src, no fetch
  // needed anymore (see AuthImage.tsx's updated doc comment).
  useEffect(() => {
    if (!open || !existing?.image_url) return;
    setImagePreview(existing.image_url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing?.id, existing?.image_url]);

  async function addDialogueLine() {
    const text = newDialogueText.trim();
    setAddingDialogue(false);
    if (!text) return;
    if (existing) {
      try {
        const created = await api.addDialogue(existing.id, text);
        setDialogues((prev) => [...prev, created]);
      } catch (e) {
        toast.showError(e instanceof ApiError ? e.message : t("sceneEditModal.addDialogueFailed"));
      }
    } else {
      setDraftDialogues((prev) => [...prev, text]);
    }
    setNewDialogueText("");
  }

  async function addShot() {
    const description = newShotText.trim();
    setAddingShot(false);
    if (!description || !existing) return;
    try {
      const shot = await api.createShot(existing.project_id, { scene_id: existing.id, description });
      onShotCreated?.(shot);
      // 2026-07-17, Lino: "dann geht direkt das Fenster auf wo man die
      // Einstellungen für die neue erweiterte Einstellung machen kann" —
      // straight into ShotEditModal right after naming it, same flow the
      // iOS app's commitNewShot already has (camera settings etc.
      // immediately enterable instead of having to find/reopen the shot
      // afterward).
      setEditingShot(shot);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("common.failed"));
    }
    setNewShotText("");
  }

  async function toggleShotDone(shot: Shot) {
    try {
      const updated = await api.patchShot(shot.id, { status: shot.status === "done" ? "open" : "done" });
      onShotUpdated?.(updated);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("common.failed"));
    }
  }

  /** Simplified compared to SceneCard's own handleShotDragOver/-End pair —
   * no debounced live-reorder preview, just a direct final-order
   * computation on drop. This modal's shot list is small/contained enough
   * that the extra complexity SceneCard needs (a full-page grid, dozens of
   * shots, drag sweeps across many rows) doesn't apply here. */
  async function handleShotDragEnd(event: DragEndEvent) {
    setDraggingShotId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const reordered = computeShotReorder(shots, activeId, overId);
    if (!reordered) return;
    reordered.forEach((s) => onShotUpdated?.(s));
    const idx = reordered.findIndex((s) => s.id === activeId);
    const beforeId = reordered[idx + 1]?.id ?? null;
    try {
      await api.moveShot(activeId, beforeId);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("sceneEditModal.reorderFailed"));
    }
  }

  async function toggleDialogueLine(d: SceneDialogue) {
    setDialogues((prev) => prev.map((x) => (x.id === d.id ? { ...x, done: !x.done } : x)));
    try {
      await api.patchDialogue(d.id, { done: !d.done });
    } catch (e) {
      setDialogues((prev) => prev.map((x) => (x.id === d.id ? { ...x, done: d.done } : x)));
      toast.showError(e instanceof ApiError ? e.message : t("sceneEditModal.updateFailed"));
    }
  }

  async function deleteDialogueLine(d: SceneDialogue) {
    setDialogues((prev) => prev.filter((x) => x.id !== d.id));
    try {
      await api.deleteDialogue(d.id);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("sceneEditModal.deleteDialogueFailed"));
    }
  }

  function startEditingDialogue(d: SceneDialogue) {
    setEditingDialogueId(d.id);
    setEditingDialogueText(d.text);
  }

  async function saveEditedDialogue(d: SceneDialogue) {
    const text = editingDialogueText.trim();
    setEditingDialogueId(null);
    if (!text || text === d.text) return;
    setDialogues((prev) => prev.map((x) => (x.id === d.id ? { ...x, text } : x)));
    try {
      await api.patchDialogue(d.id, { text });
    } catch (e) {
      setDialogues((prev) => prev.map((x) => (x.id === d.id ? { ...x, text: d.text } : x)));
      toast.showError(e instanceof ApiError ? e.message : t("sceneEditModal.dialogueSaveFailed"));
    }
  }

  function buildPatchBody() {
    return {
      name: name.trim() || null,
      priority: priority ?? null,
      clear_priority: priority === null,
      description: description.trim() || null,
      clear_description: !description.trim(),
      scheduled_at: hasStart ? start.toISOString() : null,
      duration_minutes: hasStart ? duration : null,
      location_address: locationAddress.trim() || null,
      location_lat: locationLat,
      location_lng: locationLng,
      clear_location: !locationAddress.trim(),
      assignee_ids: assigneeIds,
      good_take_filename: goodTake.trim() || null,
      clear_good_take: !goodTake.trim(),
    };
  }

  // Split out of handleSave (2026-07-16) so generateImage can persist the
  // field state — description above all — WITHOUT closing the modal first.
  // Before this split, clicking "✨ Realistisch" right after typing a new
  // description (without hitting "Fertig" first) generated from whatever
  // description was last SAVED, not what's currently in the textarea — the
  // backend sources the prompt from scene.description in the DB (see
  // generate_scene_image_endpoint in main.py), which this component's local
  // `description` state hadn't reached yet. Only meaningful for an existing
  // scene — a brand-new one can't call generate-image anyway (needs a real
  // id), same reasoning as the AI section's own existing-only render guard.
  async function persistExisting(): Promise<Scene | null> {
    if (!existing) return null;
    let scene = await api.patchScene(existing.id, { ...buildPatchBody(), clear_image: imageRemoved && !imageFile });
    if (imageFile) scene = await api.uploadSceneImage(existing.id, imageFile);
    scene = { ...scene, dialogues };
    onUpdated(scene);
    return scene;
  }

  // Autosave (2026-07-16, Lino: "es muss alles was man aendert in allen
  // Kacheln sofort gespeichert werden") — debounced ~600ms after the last
  // field change, reusing persistExisting so it's the exact same PATCH
  // "Fertig" already sent, just fired automatically instead of waiting for
  // the button. Only for an already-created scene (existing != null) — a
  // brand-new one has no id to PATCH against yet, stays create-on-Fertig.
  // See useAutosave's own doc comment for why `existing?.id ?? null` (not
  // just `Boolean(existing)`) is passed as the reset key: it's what tells
  // the hook "a DIFFERENT scene just got loaded into these fields" so it
  // doesn't mistake that reset for a user edit and re-save the freshly
  // opened scene's own unchanged data back at itself.
  useAutosave(
    () => {
      persistExisting().catch((e) => {
        toast.showError(e instanceof ApiError ? e.message : t("sceneEditModal.autosaveFailed"));
      });
    },
    [
      name, priority, description, hasStart, start.getTime(), duration,
      locationAddress, locationLat, locationLng, assigneeIds.join(","), goodTake,
      imageFile, imageRemoved,
    ],
    existing?.id ?? null,
  );

  async function handleSave() {
    setSaving(true);
    try {
      if (existing) {
        await persistExisting();
      } else {
        let scene = await api.createScene(projectId, {
          color: "#3875bd", is_intermediate_step: isIntermediateStep, sort_order: nextSortOrder, ...buildPatchBody(),
        });
        for (const text of draftDialogues) {
          const d = await api.addDialogue(scene.id, text);
          scene = { ...scene, dialogues: [...scene.dialogues, d] };
        }
        if (imageFile) scene = await api.uploadSceneImage(scene.id, imageFile);
        onCreated(scene);
      }
      onClose();
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("sceneEditModal.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  // Fire-and-forget (2026-07-15, Lino: "man muss die möglichkeit haben die
  // seite zu schliessen und die generierung läuft im hintergrund weiter
  // und wenn sie fertig ist fügt sie automatisch das bild in die szene
  // ein") — the POST returns as soon as the backend has queued the job
  // (202), not once the image is actually ready. Closing this modal right
  // after starting generation is safe: the scene's image_url updates
  // server-side once RunPod finishes, and the project page's existing 12s
  // poll (see page.tsx) picks it up on its own, whether or not this modal
  // is still open by then.
  //
  // Two 2026-07-16 fixes bundled in here (Lino): 1) persistExisting() first
  // so the backend generates from whatever's actually in the description
  // textarea right now, not the last-saved value (see persistExisting's own
  // doc comment). 2) generatingStyle is deliberately NOT cleared in a
  // `finally` here anymore — the POST resolving only means the job was
  // queued, not that it's done. It now stays set until the effect below
  // observes existing.image_generating flip back to false via the 12s poll,
  // which is also what backs the button's disabled state so a second
  // click — or the same scene reopened in another tab — can't fire a
  // duplicate job while one's already running.
  async function generateImage(prompt: string, style: "realistic" | "sketch" | "funny_sketch", aspectRatioArg: "16:9" | "9:16") {
    if (!existing || generatingStyle || existing.image_generating) return;
    setGeneratingStyle(style);
    try {
      await persistExisting();
      await api.generateSceneImage(existing.id, style, aspectRatioArg, prompt);
      toast.showSuccess(t("sceneEditModal.aiImageStarted"));
    } catch (e) {
      // 2026-07-16, Lino: the insufficient-credits case needs to be ONE
      // clear centered popup (see InsufficientCreditsDialog), not that PLUS
      // a competing corner toast saying the same thing — api.ts already
      // dispatched the dialog's event before this catch even runs, so skip
      // the redundant toast here (same reasoning would apply to
      // trial_expired, not touched here since Lino only flagged credits).
      if (!(e instanceof ApiError && e.code === "insufficient_credits")) {
        toast.showError(e instanceof ApiError ? e.message : t("sceneEditModal.aiImageFailed"));
      }
      setGeneratingStyle(null);
    }
  }

  // Clears the optimistic local lock once the backend's own persistent flag
  // (survives modal close/reopen + reload, see Scene.image_generating)
  // confirms the job actually finished, not just that it was queued.
  //
  // 2026-07-16 fix (Lino: "wenn man ein zweites Bild erstellt passiert gar
  // nichts mehr"): depending on just `existing?.image_generating` (a single
  // boolean) meant this effect only re-ran when THAT VALUE changed between
  // two 12s polls. If a generation finishes faster than 12s (e.g. a warm
  // RunPod worker right after a first generation) no single poll ever
  // observes it flip true, so the boolean sits at false→false the whole
  // time from React's point of view — the effect never re-fires and
  // generatingStyle (thus the disabled button) stays stuck forever, exactly
  // matching the reported "second click does nothing" symptom. Depending on
  // the whole `existing` object instead re-checks the live values on EVERY
  // poll tick (page.tsx's setData(d) replaces scenes with brand-new object
  // references from a fresh fetch every 12s, regardless of whether any
  // field actually changed) instead of only when React thinks the one field
  // it's watching changed.
  useEffect(() => {
    if (generatingStyle && existing && !existing.image_generating) setGeneratingStyle(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing]);

  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      title={existing ? t("sceneEditModal.editTitle") : effectiveIsIntermediateStep ? t("sceneEditModal.newIntermediateTitle") : t("sceneEditModal.newTitle")}
      wide
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? t("common.saving") : t("common.done")}
          </Button>
        </div>
      }
    >
      {!effectiveIsIntermediateStep && (
        <FieldGroup>
          <Label>{t("sceneEditModal.image")}</Label>
          <ImageDropZone
            previewUrl={imagePreview}
            onFile={(file) => {
              setImageFile(file);
              setImagePreview(URL.createObjectURL(file));
              setImageRemoved(false);
            }}
            onRemove={
              imagePreview
                ? () => {
                    setImageFile(null);
                    setImagePreview(null);
                    setImageRemoved(true);
                  }
                : undefined
            }
            lockAspectRatio
          />
          {/* AI image generation (2026-07-15, Lino) — only for an already-
              saved scene (needs a real id). 2026-07-17: single trigger
              button, opens ImageGeneratePopup (own prompt/format/style/
              Generieren all in one place) instead of a permanently-visible
              switches row. */}
          {existing && (
            <div className="mt-3">
              <Button
                variant="secondary"
                size="sm"
                disabled={generatingStyle !== null || Boolean(existing?.image_generating)}
                onClick={() => setShowGeneratePopup(true)}
              >
                {generatingStyle ? t("sceneEditModal.generating") : t("sceneEditModal.generateAiImage")}
              </Button>
            </div>
          )}
        </FieldGroup>
      )}

      <FieldGroup>
        <Label>{t("sceneEditModal.name")}</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("sceneEditModal.namePlaceholder")} autoFocus />
      </FieldGroup>

      {!effectiveIsIntermediateStep && (
        <FieldGroup>
          <Label>{t("sceneEditModal.priority")}</Label>
          <SegmentedControl
            value={priority ?? "none"}
            onChange={(v) => setPriority(v === "none" ? null : (v as Priority))}
            options={[
              { value: "none", label: t("sceneEditModal.none"), color: PRIORITY_COLORS.none },
              { value: "must", label: t("priority.must"), color: PRIORITY_COLORS.must },
              { value: "should", label: t("priority.should"), color: PRIORITY_COLORS.should },
              { value: "optional", label: t("priority.optional"), color: PRIORITY_COLORS.optional },
            ]}
          />
        </FieldGroup>
      )}

      <FieldGroup>
        <Label>{t("sceneEditModal.description")}</Label>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder={t("sceneEditModal.descriptionPlaceholder")} />
      </FieldGroup>

      {!effectiveIsIntermediateStep && (
      <FieldGroup>
        <Label>{t("sceneEditModal.dialog")}</Label>
        <div className="space-y-1.5">
            {dialogues.map((d) => (
              <div
                key={d.id}
                className="flex items-center gap-2 group"
              >
                <button onClick={() => toggleDialogueLine(d)} className="shrink-0 mt-0.5">
                  <CheckCircle done={d.done} />
                </button>
                {editingDialogueId === d.id ? (
                  <>
                    <Textarea
                      autoFocus
                      value={editingDialogueText}
                      onChange={(e) => setEditingDialogueText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          saveEditedDialogue(d);
                        } else if (e.key === "Escape") {
                          setEditingDialogueId(null);
                        }
                      }}
                      onBlur={() => saveEditedDialogue(d)}
                      rows={2}
                      className="flex-1 text-sm py-1"
                    />
                    {/* Explicit save button (2026-07-11) — not just onBlur.
                        onBlur only fires if the textarea actually held real
                        focus in the first place, which isn't guaranteed
                        (autofocus timing varies across browsers/input
                        methods) — a visible, always-clickable "Fertig"
                        removes that dependency entirely, same reasoning the
                        section-rename modal already uses an explicit
                        Speichern button rather than relying on blur alone. */}
                    <button
                      onClick={() => saveEditedDialogue(d)}
                      className="shrink-0 text-white/40 hover:text-emerald-400 transition-colors"
                      aria-label={t("sceneEditModal.saveDialogueLineAria")}
                    >
                      <CheckIcon />
                    </button>
                  </>
                ) : (
                  <span
                    onClick={() => startEditingDialogue(d)}
                    className={`text-sm flex-1 whitespace-pre-wrap cursor-text ${d.done ? "line-through text-white/40" : "text-white/80"}`}
                  >
                    {d.text}
                  </span>
                )}
                <button
                  onClick={() => deleteDialogueLine(d)}
                  className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-red-400 transition-opacity text-xs shrink-0"
                >
                  {t("common.delete")}
                </button>
              </div>
            ))}
            {draftDialogues.map((text, i) => (
              <div key={`draft-${i}`} className="flex items-center gap-2 group">
                <CheckCircle done={false} />
                <span className="text-sm flex-1 whitespace-pre-wrap text-white/80">{text}</span>
                <button
                  onClick={() => setDraftDialogues((prev) => prev.filter((_, idx) => idx !== i))}
                  className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-red-400 transition-opacity text-xs"
                >
                  {t("common.delete")}
                </button>
              </div>
            ))}
          {addingDialogue ? (
            <Textarea
              autoFocus
              value={newDialogueText}
              onChange={(e) => setNewDialogueText(e.target.value)}
              onKeyDown={(e) => {
                // Shift+Enter inserts a real line break (Lino, 2026-07-11) —
                // plain Enter still submits the line, matching every other
                // single-line-by-default input in this app. A bare <Input>
                // (single-line <input>) can never hold a newline at all,
                // which is why this switched to <Textarea>.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  addDialogueLine();
                }
              }}
              onBlur={addDialogueLine}
              placeholder={t("sceneEditModal.newDialoguePlaceholder")}
              rows={2}
              className="py-1.5 text-sm"
            />
          ) : (
            <button
              onClick={() => setAddingDialogue(true)}
              className="text-xs font-semibold text-blue-400 hover:text-blue-300 flex items-center gap-1 pt-1"
            >
              {t("sceneEditModal.addDialogueButton")}
            </button>
          )}
        </div>
      </FieldGroup>
      )}

      {/* 2026-07-17, Lino: "+ Einstellung hinzufügen" gehört nicht mehr in
          die Kachelübersicht, sondern hierhin — nur sichtbar wenn die
          Kachel geöffnet ist (existing != null, keine neue Szene), direkt
          unter Dialog. Die vorhandenen Einstellungen selbst bleiben zum
          schnellen Überblick weiterhin auf der Kachel sichtbar — nur das
          Hinzufügen ist jetzt hier. */}
      {existing && !effectiveIsIntermediateStep && (
        <FieldGroup>
          <Label>{t("sceneEditModal.shots")}</Label>
          {shots.length > 0 && (
            <DndContext
              sensors={shotSensors}
              collisionDetection={closestCenter}
              onDragStart={(e) => setDraggingShotId(String(e.active.id))}
              onDragEnd={handleShotDragEnd}
              onDragCancel={() => setDraggingShotId(null)}
            >
              <SortableContext items={shots.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-1.5 mb-2">
                  {shots.map((shot) => (
                    <SortableShotRow
                      key={shot.id}
                      shot={shot}
                      onToggleDone={() => toggleShotDone(shot)}
                      onEdit={() => setEditingShot(shot)}
                    />
                  ))}
                </div>
              </SortableContext>
              <DragOverlay>
                {draggingShotId && (() => {
                  const s = shots.find((x) => x.id === draggingShotId);
                  return s ? (
                    <div className="shadow-2xl shadow-black/50 cursor-grabbing rounded-lg overflow-hidden">
                      <ShotRowContent shot={s} onToggleDone={() => {}} onEdit={() => {}} />
                    </div>
                  ) : null;
                })()}
              </DragOverlay>
            </DndContext>
          )}
          {addingShot ? (
            <Input
              autoFocus
              value={newShotText}
              onChange={(e) => setNewShotText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addShot()}
              onBlur={addShot}
              placeholder={t("sceneEditModal.newShotPlaceholder")}
            />
          ) : (
            <button onClick={() => setAddingShot(true)} className="text-xs font-semibold text-blue-400 hover:text-blue-300">
              {t("sceneEditModal.addShotButton")}
            </button>
          )}
        </FieldGroup>
      )}

      <FieldGroup>
        <Switch checked={hasStart} onChange={setHasStart} label={t("sceneEditModal.setStart")} />
        {hasStart && (
          <div className="mt-3 flex gap-2">
            <div className="flex-1">
              <DateTimePicker value={start} onChange={setStart} />
            </div>
            <select
              value={duration ?? ""}
              onChange={(e) => setDuration(e.target.value ? Number(e.target.value) : null)}
              className="bg-white/5 border border-white/10 rounded-xl px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            >
              {DURATIONS.map((d) => (
                <option key={d ?? "none"} value={d ?? ""}>
                  {d ? t("sceneEditModal.minutesShort", { count: d }) : "–"}
                </option>
              ))}
            </select>
          </div>
        )}
      </FieldGroup>

      <FieldGroup>
        <Label>{t("sceneEditModal.location")}</Label>
        <LocationPicker
          address={locationAddress}
          lat={locationLat}
          lng={locationLng}
          onChange={(addr, lat, lng) => {
            setLocationAddress(addr);
            setLocationLat(lat);
            setLocationLng(lng);
          }}
        />
      </FieldGroup>

      <FieldGroup>
        <Label>{t("sceneEditModal.assignee")}</Label>
        {/* 2026-07-18 (Todoist #188, Lino: "zeigt bei mehreren zugewiesenen
            Personen aktuell eine lange, unschöne Liste") — this field used
            to render every project member as its own always-expanded
            checkbox row, growing tall with the team size regardless of how
            many were actually assigned. Replaced with the same collapsible
            avatar-stack + dropdown pattern SceneCard.tsx's own "Zuständig"
            trigger already uses on the tile itself, so both places behave
            consistently. `portal` is needed here (unlike SceneCard's) since
            this field lives inside Modal.tsx's own scrollable body, which
            would otherwise clip a tall member list — the exact bug already
            fixed once before for the emoji field, see Menu.tsx's own doc
            comment on that prop. */}
        <Menu
          align="start"
          portal
          trigger={
            <div className="flex items-center justify-between gap-2 bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5 cursor-pointer hover:bg-white/[0.07] transition-colors">
              {assigneeIds.length === 0 ? (
                <span className="text-sm text-white/40">{t("sceneEditModal.noneAssigned")}</span>
              ) : (
                <div className="flex items-center" style={{ paddingRight: Math.min(assigneeIds.length - 1, 2) * 14 }}>
                  {members
                    .filter((m) => assigneeIds.includes(m.user_id))
                    .slice(0, 5)
                    .map((m, i) => (
                      <div key={m.user_id} style={{ marginLeft: i === 0 ? 0 : -14, zIndex: i }}>
                        <Avatar name={m.name} email={m.email} avatarUrl={m.avatar_url} size={26} className="ring-2 ring-[#1c1c1e]" />
                      </div>
                    ))}
                  {assigneeIds.length > 5 && (
                    <div
                      className="flex items-center justify-center rounded-full bg-white/15 text-[10px] font-semibold text-white/70 ring-2 ring-[#1c1c1e]"
                      style={{ width: 26, height: 26, marginLeft: -14 }}
                    >
                      +{assigneeIds.length - 5}
                    </div>
                  )}
                </div>
              )}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/40 shrink-0">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </div>
          }
        >
          {() => (
            <>
              {members.length === 0 && <div className="px-3.5 py-2 text-sm text-white/40">{t("sceneEditModal.noMembers")}</div>}
              {members.map((m) => {
                const isAssigned = assigneeIds.includes(m.user_id);
                return (
                  <MenuItem
                    key={m.user_id}
                    onClick={() =>
                      setAssigneeIds((prev) => (prev.includes(m.user_id) ? prev.filter((id) => id !== m.user_id) : [...prev, m.user_id]))
                    }
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={`flex items-center justify-center w-4 h-4 rounded border shrink-0 ${
                          isAssigned ? "bg-blue-500 border-blue-500" : "border-white/25"
                        }`}
                      >
                        {isAssigned && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                        )}
                      </span>
                      {m.name || m.email}
                    </span>
                  </MenuItem>
                );
              })}
            </>
          )}
        </Menu>
      </FieldGroup>

      {!effectiveIsIntermediateStep && (
        <FieldGroup className="mb-0">
          <Label>{t("scene.goodTake")}</Label>
          <Input value={goodTake} onChange={(e) => setGoodTake(e.target.value)} placeholder={t("sceneEditModal.goodTakePlaceholder")} />
        </FieldGroup>
      )}
    </Modal>
    {existing && (
      <ImageGeneratePopup
        open={showGeneratePopup}
        onClose={() => setShowGeneratePopup(false)}
        initialPrompt={description}
        onGenerate={(prompt, style, aspectRatio) => generateImage(prompt, style, aspectRatio)}
      />
    )}
    <ShotEditModal
      open={editingShot !== null}
      onClose={() => setEditingShot(null)}
      shot={editingShot}
      onUpdated={(updated) => onShotUpdated?.(updated)}
    />
    </>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function CheckCircle({ done }: { done: boolean }) {
  return (
    <span
      className="w-4 h-4 rounded-full border-[1.5px] flex items-center justify-center transition-colors"
      style={{ borderColor: done ? "#4caf6d" : "rgba(255,255,255,0.35)", backgroundColor: done ? "#4caf6d" : "transparent" }}
    >
      {done && (
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      )}
    </span>
  );
}
