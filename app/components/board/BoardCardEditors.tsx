"use client";

import { useEffect, useState } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Input, Label, FieldGroup } from "../ui/Field";
import { LocationPicker } from "../ui/LocationPicker";
import { useLanguage } from "@/lib/i18n";

/** 2026-10-08, Lino: editors for the board's palette and location cards —
 * a popup instead of inline fields, so they work the same at any zoom and on
 * the iPad. Rendered by IdeaBoard inside its event-isolating wrapper. */

const DEFAULT_COLORS = ["#1f2933", "#e4dccf", "#c8553d", "#f2a541", "#2e6f95"];

export function PaletteEditor({
  open,
  initialTitle,
  initialColors,
  onClose,
  onSave,
}: {
  open: boolean;
  initialTitle: string;
  initialColors: string[];
  onClose: () => void;
  onSave: (title: string, colors: string[]) => void;
}) {
  const { t } = useLanguage();
  const [title, setTitle] = useState(initialTitle);
  const [colors, setColors] = useState<string[]>(initialColors.length ? initialColors : DEFAULT_COLORS);

  useEffect(() => {
    if (!open) return;
    setTitle(initialTitle);
    setColors(initialColors.length ? initialColors : DEFAULT_COLORS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function setColor(i: number, value: string) {
    setColors((cs) => cs.map((c, j) => (j === i ? value : c)));
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("ideaBoard.palette.editTitle")}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={() => onSave(title.trim(), colors.filter((c) => /^#[0-9a-f]{6}$/i.test(c)))}>
            {t("common.save")}
          </Button>
        </div>
      }
    >
      <FieldGroup>
        <Label>{t("ideaBoard.palette.name")}</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("ideaBoard.palette.namePlaceholder")} maxLength={200} />
      </FieldGroup>
      <FieldGroup>
        <Label>{t("ideaBoard.palette.colors")}</Label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {colors.map((c, i) => (
            <div key={i} className="flex items-center gap-2 rounded-lg bg-white/5 border border-white/10 p-1.5">
              <label className="relative w-9 h-9 shrink-0 rounded-md overflow-hidden border border-white/15 cursor-pointer" style={{ background: c }}>
                <input type="color" value={c} onChange={(e) => setColor(i, e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
              </label>
              <input
                value={c}
                onChange={(e) => setColor(i, e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`)}
                maxLength={7}
                className="min-w-0 flex-1 bg-transparent text-sm font-mono uppercase outline-none"
              />
              <button
                type="button"
                onClick={() => setColors((cs) => cs.filter((_, j) => j !== i))}
                aria-label={t("common.delete")}
                className="w-6 h-6 shrink-0 rounded-md text-white/40 hover:text-white hover:bg-white/10"
              >
                ×
              </button>
            </div>
          ))}
          {colors.length < 16 && (
            <button
              type="button"
              onClick={() => setColors((cs) => [...cs, "#888888"])}
              className="rounded-lg border border-dashed border-white/20 text-white/50 hover:text-white/80 hover:border-white/40 text-sm py-2"
            >
              + {t("ideaBoard.palette.addColor")}
            </button>
          )}
        </div>
      </FieldGroup>
    </Modal>
  );
}

export function LocationEditor({
  open,
  initialTitle,
  initialAddress,
  initialLat,
  initialLng,
  initialStyle = "satellite",
  busy,
  onClose,
  onSave,
}: {
  open: boolean;
  initialTitle: string;
  initialAddress: string;
  initialLat: number | null;
  initialLng: number | null;
  initialStyle?: "satellite" | "map";
  busy: boolean;
  onClose: () => void;
  onSave: (title: string, address: string, lat: number | null, lng: number | null, style: "satellite" | "map") => void;
}) {
  const { t } = useLanguage();
  const [title, setTitle] = useState(initialTitle);
  const [style, setStyle] = useState<"satellite" | "map">(initialStyle);
  const [loc, setLoc] = useState({ address: initialAddress, lat: initialLat, lng: initialLng });

  useEffect(() => {
    if (!open) return;
    setTitle(initialTitle);
    setStyle(initialStyle);
    setLoc({ address: initialAddress, lat: initialLat, lng: initialLng });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("ideaBoard.location.editTitle")}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={busy || (!loc.address.trim() && !title.trim())} onClick={() => onSave(title.trim(), loc.address.trim(), loc.lat, loc.lng, style)}>
            {busy ? "…" : t("common.save")}
          </Button>
        </div>
      }
    >
      <FieldGroup>
        <Label>{t("ideaBoard.location.name")}</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("ideaBoard.location.namePlaceholder")} maxLength={200} />
      </FieldGroup>
      <FieldGroup>
        <Label>{t("ideaBoard.location.address")}</Label>
        {open && (
          <LocationPicker
            address={loc.address}
            lat={loc.lat}
            lng={loc.lng}
            onChange={(address, lat, lng) => setLoc({ address, lat, lng })}
          />
        )}
      </FieldGroup>
      <FieldGroup>
        <Label>{t("ideaBoard.location.view")}</Label>
        <div className="inline-flex rounded-lg bg-white/5 border border-white/10 p-0.5">
          {(["satellite", "map"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStyle(s)}
              className={`px-3 py-1.5 rounded-md text-sm font-semibold ${style === s ? "bg-white/15 text-white" : "text-white/55 hover:text-white"}`}
            >
              {s === "satellite" ? t("ideaBoard.location.satellite") : t("ideaBoard.location.streetMap")}
            </button>
          ))}
        </div>
      </FieldGroup>
    </Modal>
  );
}

export function ColorEditor({
  open,
  initialHex,
  initialName,
  onClose,
  onSave,
}: {
  open: boolean;
  initialHex: string;
  initialName: string;
  onClose: () => void;
  onSave: (hex: string, name: string) => void;
}) {
  const { t } = useLanguage();
  const [hex, setHex] = useState(initialHex || "#3b82f6");
  const [name, setName] = useState(initialName);

  useEffect(() => {
    if (!open) return;
    setHex(initialHex || "#3b82f6");
    setName(initialName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // accepts "ff8800", "#FF8800" and the short "#f80"
  const normalized = (() => {
    let v = hex.trim().replace(/^#?/, "#").toLowerCase();
    if (/^#[0-9a-f]{3}$/.test(v)) v = "#" + [...v.slice(1)].map((c) => c + c).join("");
    return /^#[0-9a-f]{6}$/.test(v) ? v : null;
  })();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("ideaBoard.color.editTitle")}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!normalized} onClick={() => normalized && onSave(normalized, name.trim())}>
            {t("common.save")}
          </Button>
        </div>
      }
    >
      <div className="flex gap-4 items-start">
        <label className="relative w-24 h-24 shrink-0 rounded-lg overflow-hidden border border-white/15 cursor-pointer" style={{ background: normalized ?? "#000" }}>
          <input type="color" value={normalized ?? "#000000"} onChange={(e) => setHex(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
        </label>
        <div className="flex-1 min-w-0">
          <FieldGroup>
            <Label>{t("ideaBoard.color.hex")}</Label>
            <Input value={hex} onChange={(e) => setHex(e.target.value)} placeholder="#FF8800" maxLength={7} className="font-mono uppercase" />
          </FieldGroup>
          <FieldGroup>
            <Label>{t("ideaBoard.color.name")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("ideaBoard.color.namePlaceholder")} maxLength={200} />
          </FieldGroup>
        </div>
      </div>
    </Modal>
  );
}
