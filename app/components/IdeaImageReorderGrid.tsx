"use client";

import { useState } from "react";
import {
  DndContext, type DragEndEvent, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AuthImage } from "./AuthImage";
import { AuthVideo } from "./AuthVideo";
import { Button } from "./ui/Button";
import { isVideoUrl } from "@/lib/media";
import { useLanguage } from "@/lib/i18n";
import type { IdeaImage } from "@/lib/types";

function ReorderTile({ image, onDelete }: { image: IdeaImage; onDelete: (imageId: string) => void }) {
  const { t } = useLanguage();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: image.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      {...attributes}
      {...listeners}
      className="relative group aspect-square rounded-xl overflow-hidden bg-white/5 cursor-grab active:cursor-grabbing"
    >
      {image.status === "generating" || !image.image_url ? (
        <div className="w-full h-full flex items-center justify-center text-white/30 text-xs">…</div>
      ) : isVideoUrl(image.image_url) ? (
        <AuthVideo path={image.image_url} className="w-full h-full object-cover pointer-events-none" />
      ) : (
        <AuthImage path={image.image_url} alt="" className="w-full h-full object-cover pointer-events-none" />
      )}
      {/* 2026-07-30, Lino: "wieso ist kein X bei der Anordnen Funktion
          vorhanden?" then "das x in der diashow soll verschwinden, man soll
          nur in der anordnen ansicht bilder löschen können" — deletion is
          now EXCLUSIVELY reachable from here (the slideshow's own × was
          removed, see IdeaFloatingCard's handleDeleteImage). Always visible
          (not hover-only) since this is the sole way to delete an image now
          — hiding the only delete affordance behind hover would be a real
          regression on touch. onPointerDown stopPropagation so this doesn't
          also start a drag (dnd-kit's PointerSensor listens from the
          tile's own {...listeners} on the outer div, which this button
          sits inside). */}
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onDelete(image.id);
        }}
        aria-label={t("ideaCard.removeImage")}
        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 hover:bg-red-500/80 text-white text-xs flex items-center justify-center transition-colors ring-1 ring-white/30 shadow-md shadow-black/50"
      >
        ×
      </button>
    </div>
  );
}

/** Drag-to-reorder tile grid for an idea's images (2026-07-17, Lino: bis zu
 * 10 Bilder hochladen, "als Kacheln in der Kachel dargestellt damit man
 * sie verschieben kann um die Reihenfolge anzupassen" — then "Reihenfolge
 * speichern" persists it via POST /ideas/{id}/images/reorder). Shown
 * in place of the big single-image display while active. */
export function IdeaImageReorderGrid({
  images,
  onSave,
  onCancel,
  onDeleteImage,
}: {
  images: IdeaImage[];
  onSave: (orderedIds: string[]) => Promise<void>;
  onCancel: () => void;
  /** 2026-07-30, Lino: "wieso ist kein X bei der Anordnen Funktion
   * vorhanden?" — parent owns the actual DELETE call + idea state refresh
   * (same api.deleteIdeaImage the main slideshow's × already used); this
   * component just also removes it from its OWN local `order` so the grid
   * updates immediately without waiting on the parent's `images` prop to
   * flow back down. */
  onDeleteImage: (imageId: string) => Promise<void>;
}) {
  const { t } = useLanguage();
  const [order, setOrder] = useState(images);
  const [saving, setSaving] = useState(false);

  async function handleDelete(imageId: string) {
    const previousOrder = order;
    setOrder((prev) => prev.filter((i) => i.id !== imageId));
    try {
      await onDeleteImage(imageId);
    } catch {
      // Reverts the optimistic local removal — onDeleteImage's own catch
      // already shows an error toast, this just keeps the grid honest.
      setOrder(previousOrder);
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setOrder((prev) => {
      const next = [...prev];
      const fromIndex = next.findIndex((i) => i.id === active.id);
      const toIndex = next.findIndex((i) => i.id === over.id);
      if (fromIndex === -1 || toIndex === -1) return prev;
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(order.map((i) => i.id));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="w-full h-full rounded-2xl bg-black/20 p-3 flex flex-col">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={order.map((i) => i.id)} strategy={rectSortingStrategy}>
          <div className="flex-1 min-h-0 overflow-y-auto grid grid-cols-4 sm:grid-cols-5 gap-2">
            {order.map((image) => (
              <ReorderTile key={image.id} image={image} onDelete={handleDelete} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <div className="shrink-0 flex gap-2 justify-end pt-2">
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={saving}>{t("common.cancel")}</Button>
        <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
          {saving ? t("common.saving") : t("ideaReorderGrid.saveOrder")}
        </Button>
      </div>
    </div>
  );
}
