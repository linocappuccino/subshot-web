"use client";

/* 2026-10-09, Lino: "Szenen" like Apple Freeform — zoom/pan to an area,
 * save it under a name; the saved scenes sit at the bottom of the screen,
 * and a click flies the board back to exactly that spot.
 * A scene stores the board area that was on screen (world coordinates), so
 * it frames the same area on any screen size. Its thumbnail is a live
 * miniature of that area (it stays current when the board changes). */

import { useEffect, useMemo, useRef, useState } from "react";
import { useLanguage } from "@/lib/i18n";
import {
  STICKY_STYLES,
  MB_HEADER,
  MB_PAD,
  hiddenElementIds,
  mbInnerH,
  mbInnerW,
  moodboardItems,
  mosaicBoxes,
  type BoardElement,
  type BoardView,
} from "@/lib/board";
import { strokePath } from "./BoardElementView";

const THUMB_H = 56;

function Thumb({ view, elements }: { view: BoardView; elements: BoardElement[] }) {
  const shown = useMemo(() => {
    const hidden = hiddenElementIds(elements);
    const pad = Math.max(view.w, view.h) * 0.05;
    return elements
      .filter((el) => !hidden.has(el.id))
      .filter((el) => el.x < view.x + view.w + pad && el.x + el.w > view.x - pad && el.y < view.y + view.h + pad && el.y + el.h > view.y - pad)
      .sort((a, b) => a.z - b.z);
  }, [elements, view]);
  const w = Math.round(Math.min(150, Math.max(THUMB_H * 0.75, (THUMB_H * view.w) / view.h)));
  return (
    <svg width={w} height={THUMB_H} viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} preserveAspectRatio="xMidYMid slice" className="block rounded-md bg-[#141415]">
      {shown.map((el) => (
        <ThumbEl key={el.id} el={el} />
      ))}
    </svg>
  );
}

function ThumbEl({ el }: { el: BoardElement }) {
  const r = Math.min(10, el.w / 10);
  const card = <rect x={el.x} y={el.y} width={el.w} height={el.h} rx={r} fill="#232325" />;
  switch (el.type) {
    case "image":
      return el.thumb_src || el.src ? (
        <image href={el.thumb_src || el.src || ""} x={el.x} y={el.y} width={el.w} height={el.h} preserveAspectRatio="xMidYMid slice" />
      ) : card;
    case "video":
      return el.thumb_src ? <image href={el.thumb_src} x={el.x} y={el.y} width={el.w} height={el.h} preserveAspectRatio="xMidYMid slice" /> : card;
    case "scene": {
      const imgH = el.image_src ? Math.min(el.h * 0.7, (el.w - 24) / Math.min(3, Math.max(0.5, el.image_ratio ?? 16 / 9))) : 0;
      return (
        <g>
          {card}
          {el.image_src && (
            <image href={el.image_thumb_src || el.image_src} x={el.x + 12} y={el.y + 48} width={el.w - 24} height={imgH} preserveAspectRatio="xMidYMid slice" />
          )}
        </g>
      );
    }
    case "moodboard": {
      const items = moodboardItems(el);
      if (!el.row_h || !items.length) return card;
      const { boxes } = mosaicBoxes(items, mbInnerW(el.w), mbInnerH(el.h), el.row_h);
      const ox = el.x + 1 + MB_PAD;
      const oy = el.y + 1 + MB_PAD + MB_HEADER;
      const byId = new Map(items.map((it) => [it.id, it]));
      return (
        <g>
          {card}
          {boxes.map((b) => {
            const it = byId.get(b.id);
            const src = it?.thumb_src || it?.src;
            return src ? (
              <image key={b.id} href={src} x={ox + b.x} y={oy + b.y} width={b.w} height={b.h} preserveAspectRatio="xMidYMid slice" />
            ) : (
              <rect key={b.id} x={ox + b.x} y={oy + b.y} width={b.w} height={b.h} fill="#333" />
            );
          })}
        </g>
      );
    }
    case "sticky":
      return <rect x={el.x} y={el.y} width={el.w} height={el.h} fill={STICKY_STYLES[el.color]?.paper ?? "#fff383"} />;
    case "color":
      return <rect x={el.x} y={el.y} width={el.w} height={el.h} rx={r} fill={el.hex} />;
    case "palette":
      return (
        <g>
          {card}
          {el.colors.map((c, i) => (
            <rect key={i} x={el.x + (el.w / Math.max(1, el.colors.length)) * i} y={el.y} width={el.w / Math.max(1, el.colors.length)} height={el.h * 0.7} fill={c} />
          ))}
        </g>
      );
    case "location":
      return (
        <g>
          {card}
          <rect x={el.x} y={el.y} width={el.w} height={(el.w * 34) / 64} fill="#e8e4dc" />
        </g>
      );
    case "drawing":
      return <path transform={`translate(${el.x} ${el.y})`} d={strokePath(el.points)} fill="none" stroke={el.color} strokeWidth={el.stroke_width} strokeLinecap="round" strokeLinejoin="round" />;
    case "text":
      return (
        <g>
          {[0, 1, 2].filter((i) => (i + 1) * 22 < el.h + 10).map((i) => (
            <rect key={i} x={el.x} y={el.y + 6 + i * 22} width={el.w * (i === 2 ? 0.55 : 0.9)} height={9} rx={4} fill="#ffffff55" />
          ))}
        </g>
      );
    case "group":
      return el.collapsed ? card : <rect x={el.x} y={el.y} width={el.w} height={el.h} rx={r} fill="#ffffff08" stroke="#ffffff30" strokeWidth={2} />;
    default:
      return card;
  }
}

export function BoardScenesBar({
  views,
  elements,
  editable,
  activeId,
  onCapture,
  onRename,
  onDelete,
  onGo,
}: {
  views: BoardView[];
  elements: BoardElement[];
  editable: boolean;
  activeId: string | null;
  onCapture: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onGo: (view: BoardView) => void;
}) {
  const { t } = useLanguage();
  const [naming, setNaming] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // the name is selected once when the field opens (typing replaces it)
  const open = naming !== null ? "new" : renaming?.id ?? null;
  useEffect(() => {
    if (open) inputRef.current?.select();
  }, [open]);

  if (!views.length && !editable) return null;

  const saveNew = () => {
    const name = (naming ?? "").trim() || `${t("ideaBoard.scenes.default")} ${views.length + 1}`;
    onCapture(name);
    setNaming(null);
  };
  const saveRename = () => {
    if (renaming) onRename(renaming.id, renaming.name.trim() || t("ideaBoard.scenes.default"));
    setRenaming(null);
  };

  return (
    <div className="absolute z-30 bottom-3 left-[76px] right-[262px] flex justify-center pointer-events-none">
      <div data-board-ui className="pointer-events-auto relative flex items-end gap-1.5 max-w-full p-1.5 rounded-xl bg-[#1c1c1e]/95 border border-white/10 shadow-xl backdrop-blur text-white/80">
        {naming !== null && (
          // name the new scene: above the bar
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveNew();
            }}
            className="absolute bottom-full mb-2 left-0 flex items-center gap-1.5 p-1.5 rounded-xl bg-[#1c1c1e] border border-white/10 shadow-xl"
          >
            <input
              ref={inputRef}
              value={naming}
              onChange={(e) => setNaming(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setNaming(null)}
              maxLength={80}
              placeholder={t("ideaBoard.scenes.namePlaceholder")}
              className="w-48 h-8 px-2.5 rounded-lg bg-white/10 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button type="submit" className="h-8 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white">
              {t("ideaBoard.scenes.save")}
            </button>
            <button type="button" onClick={() => setNaming(null)} className="h-8 w-8 rounded-lg hover:bg-white/10 text-white/60" aria-label="×">
              ×
            </button>
          </form>
        )}
        {editable && (
          <button
            title={t("ideaBoard.scenes.captureHint")}
            onClick={() => setNaming(`${t("ideaBoard.scenes.default")} ${views.length + 1}`)}
            className={`shrink-0 flex flex-col items-center justify-center gap-1 rounded-lg hover:bg-white/10 text-[10px] font-semibold text-white/70 ${views.length ? "w-14" : "px-3 py-1.5 flex-row gap-2 text-xs"}`}
            style={views.length ? { height: THUMB_H + 18 } : undefined}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
            {views.length ? t("ideaBoard.scenes.add") : t("ideaBoard.scenes.capture")}
          </button>
        )}
        {views.length > 0 && (
          <div className="flex items-end gap-1.5 overflow-x-auto overscroll-contain [scrollbar-width:thin]">
            {views.map((v) => (
              <div key={v.id} className="group/scene relative shrink-0">
                <button
                  title={t("ideaBoard.scenes.go")}
                  onClick={() => onGo(v)}
                  className={`block rounded-lg p-0.5 text-left transition-colors ${activeId === v.id ? "bg-blue-600/80" : "hover:bg-white/10"}`}
                >
                  <Thumb view={v} elements={elements} />
                </button>
                {renaming?.id === v.id ? (
                  <input
                    ref={inputRef}
                    value={renaming.name}
                    onChange={(e) => setRenaming({ id: v.id, name: e.target.value })}
                    onBlur={saveRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveRename();
                      if (e.key === "Escape") setRenaming(null);
                    }}
                    maxLength={80}
                    className="mt-0.5 w-full h-4 px-1 rounded bg-white/10 text-[11px] text-white outline-none"
                  />
                ) : (
                  <div
                    title={editable ? t("ideaBoard.scenes.renameHint") : v.name}
                    onClick={() => onGo(v)}
                    onDoubleClick={() => editable && setRenaming({ id: v.id, name: v.name })}
                    className="mt-0.5 h-4 px-1 text-[11px] leading-4 text-white/75 truncate max-w-[150px] cursor-pointer select-none"
                  >
                    {v.name}
                  </div>
                )}
                {editable && (
                  <button
                    title={t("ideaBoard.scenes.delete")}
                    onClick={() => onDelete(v.id)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black/80 border border-white/20 text-white text-xs leading-none opacity-0 group-hover/scene:opacity-100 [@media(hover:none)]:opacity-70 hover:bg-red-600 transition-opacity"
                    aria-label="×"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
