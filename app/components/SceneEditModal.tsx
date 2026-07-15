"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Input, Textarea, Label, FieldGroup } from "./ui/Field";
import { Switch } from "./ui/Switch";
import { SegmentedControl } from "./ui/SegmentedControl";
import { ImageDropZone } from "./ui/ImageDropZone";
import { DateTimePicker } from "./ui/DateTimePicker";
import { LocationPicker } from "./ui/LocationPicker";
import { useApi } from "@/lib/useApi";
import { useToast } from "./ui/Toast";
import { ApiError } from "@/lib/api";
import { PRIORITY_COLORS, PRIORITY_LABELS, type Member, type Priority, type Scene, type SceneDialogue } from "@/lib/types";

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
  onCreated,
  onUpdated,
  isIntermediateStep = false,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  existing: Scene | null;
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
  /** "Zwischenschritt" (mirrors the iOS app's SceneEditSheet): a lighter
   * connective beat, not a shootable scene — creation-time choice only (an
   * existing scene's `existing.is_intermediate_step` decides this instead,
   * never toggled after creation), hides Bild/Priorität/Dialog since none
   * of those apply. */
  isIntermediateStep?: boolean;
}) {
  const api = useApi();
  const toast = useToast();

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
  const [generatingStyle, setGeneratingStyle] = useState<"realistic" | "sketch" | null>(null);
  /** 2026-07-15, Lino: "man muss noch auswählen könnne in welchem format
   * man das Bild haben will... 16:9 oder 9:16". Defaults to 16:9 (matches
   * actual camera footage aspect — the more likely default for a scene
   * reference/storyboard image); 9:16 is there for anyone framing a
   * vertical/mobile shot instead. Either way the app's own image display
   * already handles both ratios (see ImageDropZone's lockAspectRatio). */
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16">("16:9");

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
    setImageFile(null);
    setImagePreview(null);
    setImageRemoved(false);
  }

  // Existing cover photo needs the same authenticated fetch as everywhere
  // else (see AuthImage) - a plain <img src> can't attach the Bearer token,
  // so this loads it once as a blob URL for the drop zone to preview.
  useEffect(() => {
    if (!open || !existing?.image_url) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    api.fetchImageBlobUrl(existing.image_url).then((url) => {
      if (cancelled) {
        URL.revokeObjectURL(url);
        return;
      }
      objectUrl = url;
      setImagePreview(url);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
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
        toast.showError(e instanceof ApiError ? e.message : "Dialog konnte nicht hinzugefügt werden.");
      }
    } else {
      setDraftDialogues((prev) => [...prev, text]);
    }
    setNewDialogueText("");
  }

  async function toggleDialogueLine(d: SceneDialogue) {
    setDialogues((prev) => prev.map((x) => (x.id === d.id ? { ...x, done: !x.done } : x)));
    try {
      await api.patchDialogue(d.id, { done: !d.done });
    } catch (e) {
      setDialogues((prev) => prev.map((x) => (x.id === d.id ? { ...x, done: d.done } : x)));
      toast.showError(e instanceof ApiError ? e.message : "Konnte nicht aktualisiert werden.");
    }
  }

  async function deleteDialogueLine(d: SceneDialogue) {
    setDialogues((prev) => prev.filter((x) => x.id !== d.id));
    try {
      await api.deleteDialogue(d.id);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Löschen fehlgeschlagen.");
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
      toast.showError(e instanceof ApiError ? e.message : "Konnte nicht gespeichert werden.");
    }
  }

  async function handleSave() {
    const trimmedName = name.trim();
    setSaving(true);
    try {
      const body = {
        name: trimmedName || null,
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

      let scene: Scene;
      if (existing) {
        scene = await api.patchScene(existing.id, { ...body, clear_image: imageRemoved && !imageFile });
      } else {
        scene = await api.createScene(projectId, {
          color: "#3875bd", is_intermediate_step: isIntermediateStep, sort_order: nextSortOrder, ...body,
        });
        for (const text of draftDialogues) {
          const d = await api.addDialogue(scene.id, text);
          scene = { ...scene, dialogues: [...scene.dialogues, d] };
        }
      }

      if (imageFile) {
        scene = existing ? await api.uploadSceneImage(existing.id, imageFile) : await api.uploadSceneImage(scene.id, imageFile);
      }

      if (existing) onUpdated({ ...scene, dialogues });
      else onCreated(scene);
      onClose();
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Speichern fehlgeschlagen.");
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
  async function generateImage(style: "realistic" | "sketch") {
    if (!existing || !description.trim()) return;
    setGeneratingStyle(style);
    try {
      await api.generateSceneImage(existing.id, style, aspectRatio);
      toast.showSuccess("KI-Bild wird erstellt — landet automatisch im Bildfeld, du kannst weiterarbeiten.");
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "KI-Bild konnte nicht gestartet werden.");
    } finally {
      setGeneratingStyle(null);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={existing ? "Szene bearbeiten" : effectiveIsIntermediateStep ? "Neuer Zwischenschritt" : "Neue Szene"}
      wide
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? "Speichert…" : "Fertig"}
          </Button>
        </div>
      }
    >
      {!effectiveIsIntermediateStep && (
        <FieldGroup>
          <Label>Bild</Label>
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
              saved scene (needs a real id), and only once there's a
              description to generate FROM (the whole point: no separate
              prompt field, it's sourced straight from that text). */}
          {existing && (
            <div className="mt-3">
              <p className="text-xs font-medium text-white/50 mb-2">KI-Bild aus Beschreibung erstellen</p>
              <div className="flex flex-wrap items-center gap-2">
                <SegmentedControl
                  value={aspectRatio}
                  onChange={(v) => setAspectRatio(v)}
                  options={[
                    { value: "16:9", label: "16:9" },
                    { value: "9:16", label: "9:16" },
                  ]}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!description.trim() || generatingStyle !== null}
                  onClick={() => generateImage("realistic")}
                >
                  {generatingStyle === "realistic" ? "Erstellt…" : "✨ Realistisch"}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!description.trim() || generatingStyle !== null}
                  onClick={() => generateImage("sketch")}
                >
                  {generatingStyle === "sketch" ? "Erstellt…" : "✨ Sketch"}
                </Button>
              </div>
              {!description.trim() && (
                <span className="text-xs text-white/40">Erst eine Beschreibung eintragen</span>
              )}
            </div>
          )}
          {/* 2026-07-15, Lino: cold-start on the RunPod side (kept at 0
              idle cost, see runpod_image_client.py) can genuinely take a
              couple minutes on the first generation after a quiet spell —
              decided to keep that cost tradeoff and just say so up front
              instead of leaving a bare spinner that reads as hung. */}
          {generatingStyle && (
            <p className="text-xs text-white/40 mt-1.5">
              Kann bis zu 2-3 Minuten dauern, falls der KI-Server gerade "kalt" ist (länger nicht genutzt wurde).
            </p>
          )}
        </FieldGroup>
      )}

      <FieldGroup>
        <Label>Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Küche, Aussen Tag 1" autoFocus />
      </FieldGroup>

      {!effectiveIsIntermediateStep && (
        <FieldGroup>
          <Label>Priorität</Label>
          <SegmentedControl
            value={priority ?? "none"}
            onChange={(v) => setPriority(v === "none" ? null : (v as Priority))}
            options={[
              { value: "none", label: "Keine", color: PRIORITY_COLORS.none },
              { value: "must", label: PRIORITY_LABELS.must, color: PRIORITY_COLORS.must },
              { value: "should", label: PRIORITY_LABELS.should, color: PRIORITY_COLORS.should },
              { value: "optional", label: PRIORITY_LABELS.optional, color: PRIORITY_COLORS.optional },
            ]}
          />
        </FieldGroup>
      )}

      <FieldGroup>
        <Label>Beschreibung</Label>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="z.B. Handlung, Notizen" />
      </FieldGroup>

      {!effectiveIsIntermediateStep && (
      <FieldGroup>
        <Label>Dialog</Label>
        <div className="space-y-1.5">
          <AnimatePresence initial={false}>
            {dialogues.map((d) => (
              <motion.div
                key={d.id}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
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
                      aria-label="Dialogzeile speichern"
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
                  Löschen
                </button>
              </motion.div>
            ))}
            {draftDialogues.map((text, i) => (
              <motion.div key={`draft-${i}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 group">
                <CheckCircle done={false} />
                <span className="text-sm flex-1 whitespace-pre-wrap text-white/80">{text}</span>
                <button
                  onClick={() => setDraftDialogues((prev) => prev.filter((_, idx) => idx !== i))}
                  className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-red-400 transition-opacity text-xs"
                >
                  Löschen
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
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
              placeholder="Neuer Dialog (Shift+Enter für Zeilenumbruch)"
              rows={2}
              className="py-1.5 text-sm"
            />
          ) : (
            <button
              onClick={() => setAddingDialogue(true)}
              className="text-xs font-semibold text-blue-400 hover:text-blue-300 flex items-center gap-1 pt-1"
            >
              + Dialog
            </button>
          )}
        </div>
      </FieldGroup>
      )}

      <FieldGroup>
        <Switch checked={hasStart} onChange={setHasStart} label="Start festlegen" />
        {hasStart && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-3 flex gap-2">
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
                  {d ? `${d} Min.` : "–"}
                </option>
              ))}
            </select>
          </motion.div>
        )}
      </FieldGroup>

      <FieldGroup>
        <Label>Standort</Label>
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
        <Label>Zuständig</Label>
        <div className="flex flex-col gap-1 bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5">
          {members.length === 0 && <span className="text-sm text-white/40">Keine Mitglieder im Projekt.</span>}
          {members.map((m) => {
            const isAssigned = assigneeIds.includes(m.user_id);
            return (
              <button
                key={m.user_id}
                type="button"
                onClick={() =>
                  setAssigneeIds((prev) => (prev.includes(m.user_id) ? prev.filter((id) => id !== m.user_id) : [...prev, m.user_id]))
                }
                className="flex items-center gap-2.5 text-left text-sm py-1"
              >
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
              </button>
            );
          })}
        </div>
      </FieldGroup>

      {!effectiveIsIntermediateStep && (
        <FieldGroup className="mb-0">
          <Label>Good Take</Label>
          <Input value={goodTake} onChange={(e) => setGoodTake(e.target.value)} placeholder="Dateiname, z.B. A003_C012" />
        </FieldGroup>
      )}
    </Modal>
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
