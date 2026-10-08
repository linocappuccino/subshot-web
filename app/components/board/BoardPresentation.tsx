"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "@/lib/i18n";
import { PRIORITY_COLORS } from "@/lib/types";
import type { SceneElement } from "@/lib/board";
import { sanitizeBoardHtml } from "./BoardElementView";

/** 2026-10-08, Lino: presentation mode — the board's scene cards one by one
 * in number order, full screen (image, number in its priority color, title,
 * text, dialogue lines). Arrow keys / Space / swipe / the side buttons to
 * step, Esc or ✕ to leave. Used in the editor and in the client's read-only
 * board alike. */
export function BoardPresentation({ scenes, startIndex = 0, onClose }: { scenes: SceneElement[]; startIndex?: number; onClose: (index: number) => void }) {
  const { t } = useLanguage();
  const [index, setIndex] = useState(Math.min(startIndex, Math.max(0, scenes.length - 1)));
  const touch = useRef<{ x: number; y: number } | null>(null);
  const indexRef = useRef(index);
  indexRef.current = index;

  const go = (d: number) => setIndex((i) => Math.max(0, Math.min(scenes.length - 1, i + d)));

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose(indexRef.current);
      else if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " " || e.key === "PageDown") go(1);
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "PageUp") go(-1);
      else if (e.key === "Home") setIndex(0);
      else if (e.key === "End") setIndex(scenes.length - 1);
      else {
        // nothing else may reach the board underneath (Delete, ⌘Z, …)
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenes.length]);

  const sc = scenes[index];
  if (!sc || typeof document === "undefined") return null;
  const color = PRIORITY_COLORS[sc.priority ?? "none"];
  const html = sanitizeBoardHtml(sc.html || "");

  return createPortal(
    <div
      data-board-presentation
      className="fixed inset-0 z-[95] bg-[#0b0b0c] text-white flex flex-col select-none"
      onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
      onTouchEnd={(e) => {
        const s = touch.current;
        touch.current = null;
        if (!s) return;
        const dx = e.changedTouches[0].clientX - s.x;
        const dy = e.changedTouches[0].clientY - s.y;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
      }}
    >
      {/* top bar */}
      <div className="flex items-center gap-3 px-5 h-14 shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wider text-white/40">{t("ideaBoard.present.title")}</span>
        <span className="text-xs tabular-nums text-white/50">
          {index + 1} / {scenes.length}
        </span>
        <div className="flex-1" />
        <button
          onClick={() => onClose(index)}
          aria-label={t("ideaBoard.present.close")}
          title={t("ideaBoard.present.close")}
          className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-lg"
        >
          ✕
        </button>
      </div>

      {/* slide */}
      <div key={sc.id} className="flex-1 min-h-0 flex flex-col lg:flex-row items-stretch gap-6 lg:gap-10 px-6 sm:px-16 pb-6 animate-[subshot-present-in_.25s_ease]">
        <div className="flex-1 min-h-0 flex items-center justify-center">
          {sc.image_src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={sc.image_src} alt="" className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" draggable={false} />
          ) : (
            <div className="w-full max-w-3xl aspect-video rounded-lg border border-dashed border-white/15 flex items-center justify-center text-white/25 text-sm">
              {t("ideaBoard.present.noImage")}
            </div>
          )}
        </div>
        <div className="lg:w-[34%] shrink-0 overflow-y-auto lg:py-6">
          <div className="flex items-center gap-3 mb-3">
            <span className="h-9 min-w-9 px-2.5 rounded-md text-base font-bold flex items-center justify-center tabular-nums" style={{ background: color }}>
              {sc.number}
            </span>
            {sc.priority && (
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color }}>
                {t(`priority.${sc.priority}`)}
              </span>
            )}
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold leading-tight">{sc.title || `${t("ideaBoard.scene")} ${sc.number}`}</h2>
          {html && <div className="board-text mt-4 text-base text-white/80" dangerouslySetInnerHTML={{ __html: html }} />}
          {(sc.dialogues ?? []).length > 0 && (
            <div className="mt-5 space-y-2">
              {(sc.dialogues ?? []).map((line, i) => (
                <div key={i} className="flex gap-2 rounded-md bg-white/[0.06] border border-white/10 px-3 py-2 text-sm italic text-white/85">
                  <span className="not-italic">🗣️</span>
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* step buttons + dots */}
      <button
        onClick={() => go(-1)}
        disabled={index === 0}
        aria-label={t("ideaBoard.present.prev")}
        className="absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-0 flex items-center justify-center text-xl"
      >
        ‹
      </button>
      <button
        onClick={() => go(1)}
        disabled={index === scenes.length - 1}
        aria-label={t("ideaBoard.present.next")}
        className="absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-0 flex items-center justify-center text-xl"
      >
        ›
      </button>
      <div className="shrink-0 flex justify-center gap-1.5 pb-5 flex-wrap px-6">
        {scenes.map((s, i) => (
          <button
            key={s.id}
            onClick={() => setIndex(i)}
            aria-label={`${t("ideaBoard.scene")} ${s.number}`}
            className={`h-1.5 rounded-full transition-all ${i === index ? "w-6 bg-white" : "w-1.5 bg-white/25 hover:bg-white/50"}`}
          />
        ))}
      </div>
    </div>,
    document.body,
  );
}
