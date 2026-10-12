"use client";

import { useMemo, useState } from "react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { LocationPicker } from "./ui/LocationPicker";
import { Menu, MenuItem } from "./ui/Menu";
import { useToast } from "./ui/Toast";
import { useApi } from "@/lib/useApi";
import { useLanguage } from "@/lib/i18n";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { Scene, Section } from "@/lib/types";
import { PlacePill, PinGlyph } from "./PlacePill";
import { buildPlaces, shortPlace as short, type Place } from "@/lib/shotlistPlaces";

// 2026-10-12, Lino: "ich finde nirgends ein feld wo ich die location eingeben kann" — the shotlist's
// Drehorte right in the open shotlist's toolbar. Then: "wie kann man zb. szene 1-10 einer location
// zuweisen und dann szene 11-15 einer anderen" and "komplett unübersichtlich ... man soll immer den
// ort direkt ausgeschrieben anwählen können und er soll auch so dargestellt werden, die versch. orte
// können aber eine unterschiedliche farbe haben" — so:
// - "Orte": the shotlist's places as coloured pills, written out; the first one is the default
//   (Section.location_*) every scene without its own place uses (weather, callsheet, optimizer);
// - "Szenen": one row per scene with its place written out as a coloured pill — click it to pick
//   another place by name; tick several rows (shift = range) and click a place to assign them all.


export function SectionLocationButton({
  section,
  scenes,
  numbers,
  onChange,
  onScenesChange,
  open: openProp,
  onOpenChange,
}: {
  section: Section;
  /** this shotlist's scenes in their Szenen-Reihenfolge */
  scenes: Scene[];
  /** the number badge each scene shows in the shotlist */
  numbers: Map<string, number>;
  onChange: (updated: Section) => void;
  onScenesChange: (updated: Scene[]) => void;
  /** optional outside control (the board's place pill → "Orte verwalten …") */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const api = useApi();
  const toast = useToast();
  const { t } = useLanguage();
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (v: boolean) => (onOpenChange ? onOpenChange(v) : setOpenState(v));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [added, setAdded] = useState<Place[]>([]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  // intermediate steps (Fahrt, Umbau …) are between places — never get a location here
  const rows = useMemo(() => scenes.filter((s) => !s.is_project_info && !s.is_intermediate_step), [scenes]);

  // every place of this shotlist: the default first, then the scenes' own ones, then freshly added ones
  const places = useMemo(() => buildPlaces(section, rows, added), [section, rows, added]);
  const colorOf = (address: string | null | undefined) => places.find((p) => p.address === address)?.color ?? null;
  const isDefault = (address: string) => address === section.location_address;
  const placeOf = (s: Scene) => s.location_address ?? section.location_address ?? null;
  const count = (address: string) => rows.filter((s) => placeOf(s) === address).length;

  async function setDefault(p: Place | null) {
    try {
      const updated = await api.patchSection(section.id, { location_address: p?.address || null, location_lat: p?.lat ?? null, location_lng: p?.lng ?? null });
      onChange(updated);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("common.failed"));
    }
  }

  async function assign(ids: string[], p: Place) {
    if (!ids.length) return;
    setBusy(true);
    try {
      // the default place = no own location (follows the default if it ever changes)
      const own = isDefault(p.address) ? null : p;
      const updated = await api.assignSceneLocation(section.id, ids, own?.address ?? null, own?.lat ?? null, own?.lng ?? null);
      onScenesChange(updated);
      if (ids.length > 1) toast.showSuccess(t("sectionLocation.assigned", { n: ids.length, place: short(p.address) }));
      setSelected(new Set());
      setAnchor(null);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  function tick(id: string, shift: boolean) {
    const next = new Set(selected);
    if (shift && anchor) {
      const a = rows.findIndex((s) => s.id === anchor);
      const b = rows.findIndex((s) => s.id === id);
      const [from, to] = a < b ? [a, b] : [b, a];
      for (let i = from; i <= to; i++) next.add(rows[i].id);
    } else if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
    setAnchor(id);
  }

  const pill = (address: string | null, opts?: { muted?: boolean; big?: boolean }) => (
    <PlacePill address={address} color={colorOf(address)} emptyLabel={t("sectionLocation.noPlace")} muted={opts?.muted} size={opts?.big ? "md" : "sm"} />
  );

  const label = section.location_address ? short(section.location_address) : t("sectionLocation.button");
  const extra = places.length - (section.location_address ? 1 : 0);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} title={section.location_address ?? undefined}>
        📍 <span className="max-w-[220px] truncate">{label}</span>
        {extra > 0 && <span className="ml-1 rounded-full bg-white/15 px-1.5 text-[11px] tabular-nums">+{extra}</span>}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={t("sectionLocation.title")} wide>
        <div className="space-y-6 tracking-[-0.01em] [font-family:-apple-system,BlinkMacSystemFont,'SF_Pro_Text',system-ui,sans-serif]">
          {/* ── Orte ── */}
          <section>
            <h3 className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-[0.06em] text-white/40">{t("sectionLocation.placesTitle")}</h3>
            <div className="space-y-3 rounded-2xl bg-white/[0.05] p-3 ring-1 ring-inset ring-white/[0.06]">
              {places.length > 0 && (
                <ul className="divide-y divide-white/[0.06]">
                  {places.map((p) => (
                    <li key={p.address} className="flex items-center gap-3 px-1 py-2">
                      <PinGlyph color={colorOf(p.address) ?? "#888"} size={18} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] text-white">{short(p.address)}</span>
                        <span className="block truncate text-xs text-white/40">{p.address}</span>
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-white/40">{t("sectionLocation.sceneCount", { n: count(p.address) })}</span>
                      {isDefault(p.address) ? (
                        <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/70">{t("sectionLocation.default")}</span>
                      ) : (
                        <button type="button" onClick={() => setDefault(p)} className="shrink-0 text-xs text-[#0a84ff] hover:opacity-80">
                          {t("sectionLocation.makeDefault")}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {adding || places.length === 0 ? (
                <LocationPicker
                  address=""
                  lat={null}
                  lng={null}
                  onChange={(address, lat, lng) => {
                    if (!address || lat === null) return; // only a picked suggestion, not every keystroke
                    if (!section.location_address) setDefault({ address, lat, lng });
                    else setAdded((a) => [...a, { address, lat, lng }]);
                    setAdding(false);
                  }}
                />
              ) : (
                <button type="button" onClick={() => setAdding(true)} className="px-1 text-[14px] text-[#0a84ff] hover:opacity-80">
                  + {t("sectionLocation.addPlace")}
                </button>
              )}
            </div>
            <p className="mt-1.5 px-1 text-xs text-white/40">{t("sectionLocation.hint")}</p>
          </section>

          {/* ── Szenen ── */}
          {rows.length > 0 && places.length > 0 && (
            <section>
              <div className="mb-1.5 flex items-center justify-between px-1">
                <h3 className="text-[11px] font-medium uppercase tracking-[0.06em] text-white/40">{t("sectionLocation.scenesTitle")}</h3>
                <button
                  type="button"
                  className="text-xs text-[#0a84ff] hover:opacity-80"
                  onClick={() => setSelected(selected.size === rows.length ? new Set() : new Set(rows.map((s) => s.id)))}
                >
                  {selected.size === rows.length ? t("sectionLocation.none") : t("sectionLocation.all")}
                </button>
              </div>
              <ul className="max-h-[46vh] divide-y divide-white/[0.06] overflow-y-auto rounded-2xl bg-white/[0.05] ring-1 ring-inset ring-white/[0.06]">
                {rows.map((s) => {
                  const on = selected.has(s.id);
                  const own = !!s.location_address;
                  return (
                    <li key={s.id} className={cn("flex items-center gap-3 px-3 py-2 transition-colors", on && "bg-[#0a84ff]/15")}>
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={(e) => tick(s.id, e.shiftKey)}
                        className={cn(
                          "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full transition-colors",
                          on ? "bg-[#0a84ff] text-white" : "ring-[1.5px] ring-inset ring-white/25 hover:ring-white/50"
                        )}
                      >
                        {on && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M5 12.5l4.5 4.5L19 7.5" />
                          </svg>
                        )}
                      </button>
                      <button type="button" onClick={(e) => tick(s.id, e.shiftKey)} className="min-w-0 flex-1 text-left">
                        <span className="mr-2 text-[13px] tabular-nums text-white/40">{numbers.get(s.id) ?? ""}</span>
                        <span className="truncate text-[15px] text-white">{s.name || "–"}</span>
                      </button>
                      <Menu trigger={<button type="button" className="shrink-0 cursor-pointer">{pill(placeOf(s), { muted: !own })}</button>}>
                        {(close) => (
                          <>
                            {places.map((p) => (
                              <MenuItem
                                key={p.address}
                                onClick={() => {
                                  close();
                                  assign([s.id], p);
                                }}
                              >
                                <span className="flex items-center gap-2 whitespace-nowrap">
                                  <PinGlyph color={colorOf(p.address) ?? "#888"} />
                                  {short(p.address)}
                                  {isDefault(p.address) && <span className="text-white/40">· {t("sectionLocation.default")}</span>}
                                </span>
                              </MenuItem>
                            ))}
                          </>
                        )}
                      </Menu>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-1.5 px-1 text-xs text-white/40">{t("sectionLocation.assignHint")}</p>

              {/* several rows ticked → assign them all by clicking a place */}
              {selected.size > 0 && (
                <div className="sticky bottom-0 mt-3 rounded-2xl bg-[#2c2c2e]/95 p-3 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.7)] ring-1 ring-inset ring-white/[0.08] backdrop-blur-xl">
                  <div className="mb-2 text-[13px] text-white/60">{t("sectionLocation.moveTo", { n: selected.size })}</div>
                  <div className="flex flex-wrap gap-2">
                    {places.map((p) => (
                      <button key={p.address} type="button" disabled={busy} onClick={() => assign([...selected], p)} className="transition-transform active:scale-95 disabled:opacity-50">
                        {pill(p.address, { big: true })}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          <div className="flex justify-end">
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
              {t("common.done")}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
