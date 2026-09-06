"use client";

import { useEffect, useState } from "react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Input, Textarea, Label, FieldGroup } from "./ui/Field";
import { SegmentedControl } from "./ui/SegmentedControl";
import { ImageDropZone } from "./ui/ImageDropZone";
import { useApi } from "@/lib/useApi";
import { useToast } from "./ui/Toast";
import { useAutosave } from "@/lib/useAutosave";
import { ApiError } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import { PRIORITY_COLORS, type CameraSupport, type Priority, type Shot } from "@/lib/types";

// 2026-07-18, Lino: "fehlen noch die Auswahlmöglichkeiten bei den einzelnen
// Feldern... bei Framerate sollen schon vordefinierte Werte drin sein zum
// auswählen (recherchiere die typischen NTSC und PAL framerates)... bei
// Objektiv mm-Zahlen von 5-800... F-Stop 1.0-50... ISO in 50er-Schritten von
// 50-12000" — `<input list="…">` + `<datalist>` statt reiner `<select>`:
// gibt ein natives Dropdown mit den vordefinierten Werten, lässt aber (wie
// bisherige Freitextfelder) trotzdem einen abweichenden Custom-Wert zu, ohne
// eine neue Combobox-Komponente zu brauchen.
const FRAMERATE_OPTIONS = ["23.976", "24", "25", "29.97", "30", "48", "50", "59.94", "60", "100", "120", "180", "200", "240"];
const LENS_MM_OPTIONS = [
  5, 6, 8, 9, 10, 12, 14, 16, 18, 20, 24, 28, 32, 35, 40, 50, 55, 60, 70, 75, 85, 90, 100,
  105, 120, 135, 150, 180, 200, 210, 235, 250, 270, 300, 400, 500, 600, 700, 800,
].map(String);
const F_STOP_OPTIONS = ["1.0", "1.2", "1.4", "1.8", "2.0", "2.5", "2.8", "3.5", "4.0", "4.5", "5.6", "6.3", "8.0", "9.0", "11", "13", "16", "18", "22", "25", "32", "36", "45", "50"];
const ISO_OPTIONS: string[] = [];
for (let v = 50; v <= 12000; v += 50) ISO_OPTIONS.push(String(v));

export function ShotEditModal({
  open,
  onClose,
  shot,
  onUpdated,
}: {
  open: boolean;
  onClose: () => void;
  shot: Shot | null;
  onUpdated: (shot: Shot) => void;
}) {
  const api = useApi();
  const toast = useToast();
  const { t } = useLanguage();

  const CAMERA_SUPPORT_LABELS: Record<CameraSupport, string> = {
    gimbal: "Gimbal",
    handheld: "Handheld",
    tripod: t("shotEditModal.tripod"),
  };

  const [description, setDescription] = useState(shot?.description ?? "");
  const [priority, setPriority] = useState<Priority | null>(shot?.priority ?? null);
  const [goodTake, setGoodTake] = useState(shot?.good_take_filename ?? "");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  // 2026-07-15, Lino: no way to remove a shot's image, only replace it.
  const [imageRemoved, setImageRemoved] = useState(false);
  const [saving, setSaving] = useState(false);

  // Camera settings (2026-07-13, Lino) — a new shot's Shutterangle starts
  // pre-filled with "180" (his explicit default), everything else starts
  // empty rather than guessing a value.
  const [cameraAngle, setCameraAngle] = useState(shot?.camera_angle ?? "");
  const [lens, setLens] = useState(shot?.lens ?? "");
  const [fStop, setFStop] = useState(shot?.f_stop ?? "");
  const [frameRate, setFrameRate] = useState(shot?.frame_rate ?? "");
  const [shutterAngle, setShutterAngle] = useState(shot?.shutter_angle?.toString() ?? "180");
  const [iso, setIso] = useState(shot?.iso?.toString() ?? "");
  const [codec, setCodec] = useState(shot?.codec ?? "");
  const [cameraId, setCameraId] = useState(shot?.camera_id ?? "");
  const [cameraSupport, setCameraSupport] = useState<CameraSupport | null>(shot?.camera_support ?? null);

  const [openedFor, setOpenedFor] = useState(shot?.id ?? "");
  if (open && shot && openedFor !== shot.id) {
    setOpenedFor(shot.id);
    setDescription(shot.description ?? "");
    setPriority(shot.priority ?? null);
    setGoodTake(shot.good_take_filename ?? "");
    setImageFile(null);
    setImagePreview(null);
    setImageRemoved(false);
    setCameraAngle(shot.camera_angle ?? "");
    setLens(shot.lens ?? "");
    setFStop(shot.f_stop ?? "");
    setFrameRate(shot.frame_rate ?? "");
    setShutterAngle(shot.shutter_angle?.toString() ?? "180");
    setIso(shot.iso?.toString() ?? "");
    setCodec(shot.codec ?? "");
    setCameraId(shot.camera_id ?? "");
    setCameraSupport(shot.camera_support ?? null);
  }

  // shot.image_url is a presigned R2 URL since #248 (2026-07-22), directly
  // usable as the preview's src, no fetch needed (see AuthImage.tsx).
  useEffect(() => {
    if (!open || !shot?.image_url) return;
    setImagePreview(shot.image_url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, shot?.id, shot?.image_url]);

  async function persistShot() {
    if (!shot) return;
    let updated = await api.patchShot(shot.id, {
      description: description.trim() || null,
      priority: priority ?? null,
      clear_priority: priority === null,
      good_take_filename: goodTake.trim() || null,
      clear_good_take: !goodTake.trim(),
      camera_angle: cameraAngle.trim() || null,
      lens: lens.trim() || null,
      f_stop: fStop.trim() || null,
      frame_rate: frameRate.trim() || null,
      shutter_angle: shutterAngle.trim() ? Number(shutterAngle) : null,
      iso: iso.trim() ? parseInt(iso, 10) : null,
      codec: codec.trim() || null,
      camera_id: cameraId.trim() || null,
      camera_support: cameraSupport,
      clear_image: imageRemoved && !imageFile,
    });
    if (imageFile) updated = await api.uploadShotImage(shot.id, imageFile);
    onUpdated(updated);
  }

  // Autosave (2026-07-16, Lino: "es muss alles was man aendert in allen
  // Kacheln sofort gespeichert werden") — same debounced pattern as
  // SceneEditModal's own autosave, see useAutosave's doc comment.
  useAutosave(
    () => {
      persistShot().catch((e) => {
        toast.showError(e instanceof ApiError ? e.message : t("shotEditModal.autosaveFailed"));
      });
    },
    [
      description, priority, goodTake, cameraAngle, lens, fStop, frameRate,
      shutterAngle, iso, codec, cameraId, cameraSupport, imageFile, imageRemoved,
    ],
    shot?.id ?? null,
  );

  async function handleSave() {
    if (!shot) return;
    setSaving(true);
    try {
      await persistShot();
      onClose();
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("shotEditModal.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  if (!shot) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("shotEditModal.title")}
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
      <FieldGroup>
        <Label>{t("shotEditModal.image")}</Label>
        <ImageDropZone
          previewUrl={imagePreview}
          onFile={(file) => {
            setImageFile(file);
            setImagePreview(URL.createObjectURL(file));
            setImageRemoved(false);
          }}
          onRemove={() => {
            setImageFile(null);
            setImagePreview(null);
            setImageRemoved(true);
          }}
          className="h-36"
        />
      </FieldGroup>
      <FieldGroup>
        <Label>{t("shotEditModal.description")}</Label>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder={t("shotEditModal.descriptionPlaceholder")} autoFocus />
      </FieldGroup>
      <FieldGroup>
        <Label>{t("shotEditModal.priority")}</Label>
        <SegmentedControl
          value={priority ?? "none"}
          onChange={(v) => setPriority(v === "none" ? null : (v as Priority))}
          options={[
            { value: "none", label: t("shotEditModal.none"), color: PRIORITY_COLORS.none },
            { value: "must", label: t("priority.must"), color: PRIORITY_COLORS.must },
            { value: "should", label: t("priority.should"), color: PRIORITY_COLORS.should },
            { value: "optional", label: t("priority.optional"), color: PRIORITY_COLORS.optional },
          ]}
        />
      </FieldGroup>
      <FieldGroup>
        <Label>{t("shotEditModal.camera")}</Label>
        <div className="grid grid-cols-2 gap-2">
          <Input value={cameraId} onChange={(e) => setCameraId(e.target.value)} placeholder={t("shotEditModal.cameraIdPlaceholder")} />
          <Input value={cameraAngle} onChange={(e) => setCameraAngle(e.target.value)} placeholder={t("shotEditModal.anglePlaceholder")} />
          <Input list="shot-lens-options" value={lens} onChange={(e) => setLens(e.target.value)} placeholder={t("shotEditModal.lensPlaceholder")} />
          <Input list="shot-fstop-options" value={fStop} onChange={(e) => setFStop(e.target.value)} placeholder={t("shotEditModal.fstopPlaceholder")} />
          <Input list="shot-framerate-options" value={frameRate} onChange={(e) => setFrameRate(e.target.value)} placeholder={t("shotEditModal.frameratePlaceholder")} />
          <Input
            type="number"
            value={shutterAngle}
            onChange={(e) => setShutterAngle(e.target.value)}
            placeholder={t("shotEditModal.shutterAnglePlaceholder")}
          />
          <Input list="shot-iso-options" type="number" step={50} value={iso} onChange={(e) => setIso(e.target.value)} placeholder={t("shotEditModal.isoPlaceholder")} />
          <Input value={codec} onChange={(e) => setCodec(e.target.value)} placeholder={t("shotEditModal.codecPlaceholder")} />
          <datalist id="shot-lens-options">
            {LENS_MM_OPTIONS.map((v) => (
              <option key={v} value={v}>{v} mm</option>
            ))}
          </datalist>
          <datalist id="shot-fstop-options">
            {F_STOP_OPTIONS.map((v) => (
              <option key={v} value={v}>f/{v}</option>
            ))}
          </datalist>
          <datalist id="shot-framerate-options">
            {FRAMERATE_OPTIONS.map((v) => (
              <option key={v} value={v}>{v} fps</option>
            ))}
          </datalist>
          <datalist id="shot-iso-options">
            {ISO_OPTIONS.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </div>
        <div className="mt-2">
          <SegmentedControl
            value={cameraSupport ?? "none"}
            onChange={(v) => setCameraSupport(v === "none" ? null : (v as CameraSupport))}
            options={[
              { value: "none", label: t("shotEditModal.none") },
              { value: "tripod", label: CAMERA_SUPPORT_LABELS.tripod },
              { value: "handheld", label: CAMERA_SUPPORT_LABELS.handheld },
              { value: "gimbal", label: CAMERA_SUPPORT_LABELS.gimbal },
            ]}
          />
        </div>
      </FieldGroup>
      <FieldGroup className="mb-0">
        <Label>{t("scene.goodTake")}</Label>
        <Input value={goodTake} onChange={(e) => setGoodTake(e.target.value)} placeholder={t("shotEditModal.goodTakePlaceholder")} />
      </FieldGroup>
    </Modal>
  );
}
