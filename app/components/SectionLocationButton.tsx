"use client";

import { useMemo, useState } from "react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { LocationPicker } from "./ui/LocationPicker";
import { useToast } from "./ui/Toast";
import { useApi } from "@/lib/useApi";
import { useLanguage } from "@/lib/i18n";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { Scene, Section } from "@/lib/types";

// 2026-10-12, Lino: "ich finde nirgends ein feld wo ich die location eingeben kann" — the shotlist's
// own Drehort (Section.location_*, before only editable in the iOS SectionInfoBox) right in the open
// shotlist's toolbar. Every scene of this shotlist without its own location uses it (weather,
// callsheet, Drehreihenfolge optimieren — see _scenes_with_fallback_location in main.py).
// Same day, Lino: "wie kann man zb. szene 1-10 einer location zuweisen und dann szene 11-15 einer
// anderen" — plus a bulk assignment: scene chips (click, shift-click = range), pick an address,
// "Zuweisen". Each location gets its own colour so you see at a glance which scene is where.

const PALETTE = [
  "#0a84ff",
  "#30d158",
  "#ff9f0a",
  "#bf5af2",
  "#ff375f",
  "#64d2ff",
  "#ffd60a",
  "#ac8e68",
];

export function SectionLocationButton({
  section,
  scenes,
  numbers,
  onChange,
  onScenesChange,
}: {
  section: Section;
  /** this shotlist's scenes in their Szenen-Reihenfolge */
  scenes: Scene[];
  /** the number badge each scene shows in the shotlist */
  numbers: Map<string, number>;
  onChange: (updated: Section) => void;
  onScenesChange: (updated: Scene[]) => void;
}) {
  const api = useApi();
  const toast = useToast();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [pick, setPick] = useState<{
    address: string;
    lat: number | null;
    lng: number | null;
  }>({ address: "", lat: null, lng: null });
  const [busy, setBusy] = useState(false);

  // intermediate steps (Fahrt, Umbau …) are between places — never get a location here
  const assignable = useMemo(
    () => scenes.filter((s) => !s.is_project_info && !s.is_intermediate_step),
    [scenes],
  );
  const places = useMemo(() => {
    const m = new Map<
      string,
      {
        address: string;
        lat: number | null;
        lng: number | null;
        ids: string[];
        color: string;
      }
    >();
    for (const s of assignable) {
      if (!s.location_address) continue;
      const hit = m.get(s.location_address);
      if (hit) hit.ids.push(s.id);
      else
        m.set(s.location_address, {
          address: s.location_address,
          lat: s.location_lat,
          lng: s.location_lng,
          ids: [s.id],
          color: PALETTE[m.size % PALETTE.length],
        });
    }
    return [...m.values()];
  }, [assignable]);
  const colorOf = (s: Scene) =>
    s.location_address
      ? places.find((p) => p.address === s.location_address)?.color
      : undefined;

  async function saveDefault(
    address: string,
    lat: number | null,
    lng: number | null,
  ) {
    try {
      const updated = await api.patchSection(section.id, {
        location_address: address || null,
        location_lat: lat,
        location_lng: lng,
      });
      onChange(updated);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("common.failed"));
    }
  }

  function clickChip(id: string, shift: boolean) {
    const next = new Set(selected);
    if (shift && anchor) {
      const a = assignable.findIndex((s) => s.id === anchor);
      const b = assignable.findIndex((s) => s.id === id);
      const [from, to] = a < b ? [a, b] : [b, a];
      for (let i = from; i <= to; i++) next.add(assignable[i].id);
    } else if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
    setAnchor(id);
  }

  async function assign(clear: boolean) {
    if (!selected.size) return;
    setBusy(true);
    try {
      const ids = assignable.filter((s) => selected.has(s.id)).map((s) => s.id);
      const updated = await api.assignSceneLocation(
        section.id,
        ids,
        clear ? null : pick.address,
        clear ? null : pick.lat,
        clear ? null : pick.lng,
      );
      onScenesChange(updated);
      toast.showSuccess(
        t(clear ? "sectionLocation.cleared" : "sectionLocation.assigned", {
          n: ids.length,
        }),
      );
      setSelected(new Set());
      setAnchor(null);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  const label = section.location_address
    ? section.location_address.split(",")[0]
    : t("sectionLocation.button");
  const own = assignable.filter((s) => s.location_address).length;
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
        title={section.location_address ?? undefined}
      >
        📍 <span className="max-w-[220px] truncate">{label}</span>
        {places.length > 0 && (
          <span className="ml-1 rounded-full bg-white/15 px-1.5 text-[11px] tabular-nums">
            +{places.length}
          </span>
        )}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t("sectionLocation.title")}
        wide
      >
        <div className="space-y-6 tracking-[-0.01em] [font-family:-apple-system,BlinkMacSystemFont,'SF_Pro_Text',system-ui,sans-serif]">
          <section>
            <h3 className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-[0.06em] text-white/40">
              {t("sectionLocation.defaultTitle")}
            </h3>
            <div className="rounded-2xl bg-white/[0.05] p-3 ring-1 ring-inset ring-white/[0.06]">
              <LocationPicker
                address={section.location_address ?? ""}
                lat={section.location_lat}
                lng={section.location_lng}
                onChange={saveDefault}
              />
            </div>
            <p className="mt-1.5 px-1 text-xs text-white/40">
              {t("sectionLocation.hint")}
            </p>
          </section>

          {assignable.length > 0 && (
            <section>
              <h3 className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-[0.06em] text-white/40">
                {t("sectionLocation.assignTitle")}
              </h3>
              <div className="space-y-4 rounded-2xl bg-white/[0.05] p-4 ring-1 ring-inset ring-white/[0.06]">
                <div className="flex flex-wrap gap-2">
                  {assignable.map((s) => {
                    const c = colorOf(s);
                    const on = selected.has(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={(e) => clickChip(s.id, e.shiftKey)}
                        title={`${numbers.get(s.id) ?? ""} · ${s.name || "–"}${s.location_address ? `\n📍 ${s.location_address}` : ""}`}
                        className={cn(
                          "flex h-10 min-w-10 select-none items-center justify-center rounded-full px-2.5 text-[15px] font-semibold tabular-nums transition-all duration-200 ease-out active:scale-90",
                          on
                            ? "scale-105 bg-white text-black shadow-[0_4px_14px_-4px_rgba(255,255,255,0.5)]"
                            : "text-white hover:brightness-125",
                        )}
                        style={
                          on
                            ? undefined
                            : {
                                background: c
                                  ? `${c}2e`
                                  : "rgba(255,255,255,0.07)",
                                boxShadow: c
                                  ? `inset 0 0 0 2px ${c}`
                                  : undefined,
                              }
                        }
                      >
                        {numbers.get(s.id) ?? "·"}
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-[13px]">
                  <button
                    type="button"
                    className="text-[#0a84ff] hover:opacity-80"
                    onClick={() =>
                      setSelected(new Set(assignable.map((s) => s.id)))
                    }
                  >
                    {t("sectionLocation.all")}
                  </button>
                  {selected.size > 0 && (
                    <button
                      type="button"
                      className="text-[#0a84ff] hover:opacity-80"
                      onClick={() => setSelected(new Set())}
                    >
                      {t("sectionLocation.none")}
                    </button>
                  )}
                  <span className="ml-auto text-white/40">
                    {t("sectionLocation.selected", { n: selected.size })}
                  </span>
                </div>

                {places.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {places.map((p) => (
                      <button
                        key={p.address}
                        type="button"
                        onClick={() => {
                          setSelected(new Set(p.ids));
                          setPick({
                            address: p.address,
                            lat: p.lat,
                            lng: p.lng,
                          });
                        }}
                        className="flex max-w-full items-center gap-2 rounded-full bg-white/[0.07] py-1.5 pl-2 pr-3 text-[13px] text-white/85 transition-colors hover:bg-white/[0.12]"
                        title={t("sectionLocation.selectPlace")}
                      >
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ background: p.color }}
                        />
                        <span className="truncate">
                          {p.address.split(",")[0]}
                        </span>
                        <span className="tabular-nums text-white/40">
                          {p.ids.length}
                        </span>
                      </button>
                    ))}
                    {own < assignable.length && (
                      <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-white/40">
                        <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
                        {section.location_address
                          ? section.location_address.split(",")[0]
                          : t("sectionLocation.noPlace")}{" "}
                        {assignable.length - own}
                      </span>
                    )}
                  </div>
                )}

                <div className="space-y-3 border-t border-white/[0.08] pt-4">
                  <LocationPicker
                    address={pick.address}
                    lat={pick.lat}
                    lng={pick.lng}
                    onChange={(address, lat, lng) =>
                      setPick({ address, lat, lng })
                    }
                  />
                  <div className="flex flex-wrap justify-end gap-2">
                    {selected.size > 0 &&
                      assignable.some(
                        (s) => selected.has(s.id) && s.location_address,
                      ) && (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busy}
                          onClick={() => assign(true)}
                        >
                          {t("sectionLocation.clear")}
                        </Button>
                      )}
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={busy || !selected.size || !pick.address}
                      onClick={() => assign(false)}
                    >
                      {t("sectionLocation.assign", { n: selected.size })}
                    </Button>
                  </div>
                </div>
              </div>
              <p className="mt-1.5 px-1 text-xs text-white/40">
                {t("sectionLocation.assignHint")}
              </p>
            </section>
          )}

          <div className="flex justify-end">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setOpen(false)}
            >
              {t("common.done")}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
