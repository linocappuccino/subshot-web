"use client";

import { useEffect, useState } from "react";
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
  members,
  onCreated,
  onUpdated,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  existing: Scene | null;
  previousScene: Scene | null;
  members: Member[];
  onCreated: (scene: Scene) => void;
  onUpdated: (scene: Scene) => void;
}) {
  const api = useApi();
  const toast = useToast();

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
  const [assigneeId, setAssigneeId] = useState(existing?.assignee_id ?? "");
  const [goodTake, setGoodTake] = useState(existing?.good_take_filename ?? "");
  const [dialogues, setDialogues] = useState<SceneDialogue[]>(existing?.dialogues ?? []);
  const [draftDialogues, setDraftDialogues] = useState<string[]>([]);
  const [newDialogueText, setNewDialogueText] = useState("");
  const [addingDialogue, setAddingDialogue] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (open && openedFor !== (existing?.id ?? "new")) {
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
    setAssigneeId(existing?.assignee_id ?? "");
    setGoodTake(existing?.good_take_filename ?? "");
    setDialogues(existing?.dialogues ?? []);
    setDraftDialogues([]);
    setImageFile(null);
    setImagePreview(null);
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

  async function handleSave() {
    const trimmedName = name.trim();
    setSaving(true);
    try {
      const body = {
        name: trimmedName || null,
        priority: priority ?? null,
        clear_priority: priority === null,
        description: description.trim() || null,
        scheduled_at: hasStart ? start.toISOString() : null,
        duration_minutes: hasStart ? duration : null,
        location_address: locationAddress.trim() || null,
        location_lat: locationLat,
        location_lng: locationLng,
        clear_location: !locationAddress.trim(),
        assignee_id: assigneeId || null,
        clear_assignee: !assigneeId,
        good_take_filename: goodTake.trim() || null,
        clear_good_take: !goodTake.trim(),
      };

      let scene: Scene;
      if (existing) {
        scene = await api.patchScene(existing.id, body);
      } else {
        scene = await api.createScene(projectId, { color: "#3875bd", ...body });
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

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={existing ? "Szene bearbeiten" : "Neue Szene"}
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
      <FieldGroup>
        <Label>Bild</Label>
        <ImageDropZone
          previewUrl={imagePreview}
          onFile={(file) => {
            setImageFile(file);
            setImagePreview(URL.createObjectURL(file));
          }}
          lockAspectRatio
        />
      </FieldGroup>

      <FieldGroup>
        <Label>Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Küche, Aussen Tag 1" autoFocus />
      </FieldGroup>

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

      <FieldGroup>
        <Label>Beschreibung</Label>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="z.B. Handlung, Notizen" />
      </FieldGroup>

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
                <button onClick={() => toggleDialogueLine(d)} className="shrink-0">
                  <CheckCircle done={d.done} />
                </button>
                <span className={`text-sm flex-1 ${d.done ? "line-through text-white/40" : "text-white/80"}`}>{d.text}</span>
                <button
                  onClick={() => deleteDialogueLine(d)}
                  className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-red-400 transition-opacity text-xs"
                >
                  Löschen
                </button>
              </motion.div>
            ))}
            {draftDialogues.map((text, i) => (
              <motion.div key={`draft-${i}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 group">
                <CheckCircle done={false} />
                <span className="text-sm flex-1 text-white/80">{text}</span>
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
            <Input
              autoFocus
              value={newDialogueText}
              onChange={(e) => setNewDialogueText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addDialogueLine()}
              onBlur={addDialogueLine}
              placeholder="Neuer Dialog"
              className="py-1.5"
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
        <select
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
          className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
        >
          <option value="">Niemand zugewiesen</option>
          {members.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.name || m.email}
            </option>
          ))}
        </select>
      </FieldGroup>

      <FieldGroup className="mb-0">
        <Label>Good Take</Label>
        <Input value={goodTake} onChange={(e) => setGoodTake(e.target.value)} placeholder="Dateiname, z.B. A003_C012" />
      </FieldGroup>
    </Modal>
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
