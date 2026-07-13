"use client";

import { useEffect, useState } from "react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Input, Textarea, Label, FieldGroup } from "./ui/Field";
import { SegmentedControl } from "./ui/SegmentedControl";
import { ImageDropZone } from "./ui/ImageDropZone";
import { useApi } from "@/lib/useApi";
import { useToast } from "./ui/Toast";
import { ApiError } from "@/lib/api";
import { PRIORITY_COLORS, PRIORITY_LABELS, type CameraSupport, type Priority, type Shot } from "@/lib/types";

const CAMERA_SUPPORT_LABELS: Record<CameraSupport, string> = {
  gimbal: "Gimbal",
  handheld: "Handheld",
  tripod: "Stativ",
};

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

  const [description, setDescription] = useState(shot?.description ?? "");
  const [priority, setPriority] = useState<Priority | null>(shot?.priority ?? null);
  const [goodTake, setGoodTake] = useState(shot?.good_take_filename ?? "");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
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

  useEffect(() => {
    if (!open || !shot?.image_url) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    api.fetchImageBlobUrl(shot.image_url).then((url) => {
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
  }, [open, shot?.id, shot?.image_url]);

  async function handleSave() {
    if (!shot) return;
    setSaving(true);
    try {
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
      });
      if (imageFile) updated = await api.uploadShotImage(shot.id, imageFile);
      onUpdated(updated);
      onClose();
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  if (!shot) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Einstellung bearbeiten"
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
          className="h-36"
        />
      </FieldGroup>
      <FieldGroup>
        <Label>Beschreibung</Label>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="z.B. Weitwinkel Establishing Shot" autoFocus />
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
        <Label>Kamera</Label>
        <div className="grid grid-cols-2 gap-2">
          <Input value={cameraId} onChange={(e) => setCameraId(e.target.value)} placeholder="Kamera-ID (A, B, C…)" />
          <Input value={cameraAngle} onChange={(e) => setCameraAngle(e.target.value)} placeholder="Winkel" />
          <Input value={lens} onChange={(e) => setLens(e.target.value)} placeholder="Objektiv" />
          <Input value={fStop} onChange={(e) => setFStop(e.target.value)} placeholder="F-Stop" />
          <Input value={frameRate} onChange={(e) => setFrameRate(e.target.value)} placeholder="Framerate" />
          <Input
            type="number"
            value={shutterAngle}
            onChange={(e) => setShutterAngle(e.target.value)}
            placeholder="Shutterangle"
          />
          <Input type="number" value={iso} onChange={(e) => setIso(e.target.value)} placeholder="ISO" />
          <Input value={codec} onChange={(e) => setCodec(e.target.value)} placeholder="Codec" />
        </div>
        <div className="mt-2">
          <SegmentedControl
            value={cameraSupport ?? "none"}
            onChange={(v) => setCameraSupport(v === "none" ? null : (v as CameraSupport))}
            options={[
              { value: "none", label: "Keine" },
              { value: "tripod", label: CAMERA_SUPPORT_LABELS.tripod },
              { value: "handheld", label: CAMERA_SUPPORT_LABELS.handheld },
              { value: "gimbal", label: CAMERA_SUPPORT_LABELS.gimbal },
            ]}
          />
        </div>
      </FieldGroup>
      <FieldGroup className="mb-0">
        <Label>Good Take</Label>
        <Input value={goodTake} onChange={(e) => setGoodTake(e.target.value)} placeholder="Dateiname, z.B. A003_C012" />
      </FieldGroup>
    </Modal>
  );
}
