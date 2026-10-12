"use client";

import { useState } from "react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { LocationPicker } from "./ui/LocationPicker";
import { useToast } from "./ui/Toast";
import { useApi } from "@/lib/useApi";
import { useLanguage } from "@/lib/i18n";
import { ApiError } from "@/lib/api";
import type { Section } from "@/lib/types";

// 2026-10-12, Lino: "ich finde nirgends ein feld wo ich die location eingeben kann" — the shotlist's
// own Drehort (Section.location_*, before only editable in the iOS SectionInfoBox) right in the open
// shotlist's toolbar. Every scene of this shotlist without its own location uses it (weather,
// callsheet, Drehreihenfolge optimieren — see _scenes_with_fallback_location in main.py).

export function SectionLocationButton({ section, onChange }: { section: Section; onChange: (updated: Section) => void }) {
  const api = useApi();
  const toast = useToast();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  async function save(address: string, lat: number | null, lng: number | null) {
    try {
      const updated = await api.patchSection(section.id, { location_address: address || null, location_lat: lat, location_lng: lng });
      onChange(updated);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("common.failed"));
    }
  }

  const label = section.location_address ? section.location_address.split(",")[0] : t("sectionLocation.button");
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} title={section.location_address ?? undefined}>
        📍 <span className="max-w-[220px] truncate">{label}</span>
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={t("sectionLocation.title")}>
        <div className="space-y-3">
          <p className="text-xs text-white/50">{t("sectionLocation.hint")}</p>
          <LocationPicker address={section.location_address ?? ""} lat={section.location_lat} lng={section.location_lng} onChange={save} />
          <div className="flex justify-end">
            <Button variant="primary" size="sm" onClick={() => setOpen(false)}>
              {t("common.done")}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
