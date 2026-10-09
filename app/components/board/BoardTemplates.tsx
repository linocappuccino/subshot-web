"use client";

/* 2026-10-09, Lino: board templates — "Templates erstellen, die man immer
 * wieder für neue Projekte laden kann. Templates können nur mit leeren Nodes
 * geöffnet werden, der Content in den Nodes wird NICHT im Template
 * gespeichert (die Namen oder Texte schon)."
 * The panel saves the board (or the selection) as a template and lists the
 * saved ones with a miniature; "Laden" places one on the board. What is kept
 * is decided server-side (idea_board.make_template). */

import { useEffect, useMemo, useRef, useState } from "react";
import { useLanguage } from "@/lib/i18n";
import { boundsOf, hiddenElementIds, type BoardTemplate } from "@/lib/board";
import { ThumbEl } from "./BoardScenes";

export interface BoardTemplateApi {
  list: () => Promise<BoardTemplate[]>;
  /** data = the board or the selected part of it (the server strips content) */
  save: (name: string, data: BoardTemplate["data"]) => Promise<BoardTemplate>;
  rename: (id: string, name: string) => Promise<BoardTemplate>;
  remove: (id: string) => Promise<void>;
}

function TemplateThumb({ tpl }: { tpl: BoardTemplate }) {
  const shown = useMemo(() => {
    const hidden = hiddenElementIds(tpl.data.elements);
    return tpl.data.elements.filter((el) => !hidden.has(el.id)).sort((a, b) => a.z - b.z);
  }, [tpl]);
  const b = boundsOf(shown);
  if (!b) return <div className="w-full aspect-[16/10] rounded-lg bg-[#141415]" />;
  const pad = Math.max(b.w, b.h) * 0.06;
  return (
    <svg viewBox={`${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}`} preserveAspectRatio="xMidYMid meet" className="block w-full aspect-[16/10] rounded-lg bg-[#141415]">
      {shown.map((el) => (
        <ThumbEl key={el.id} el={el} />
      ))}
    </svg>
  );
}

export function BoardTemplatesPanel({
  api,
  canSave,
  selectionCount,
  hasContent,
  onSave,
  onUse,
  onClose,
  onError,
  onSaved,
}: {
  api: BoardTemplateApi;
  /** the board is editable (loading needs that too) */
  canSave: boolean;
  selectionCount: number;
  hasContent: boolean;
  /** build the document to save — whole board or only the selection */
  onSave: (selectionOnly: boolean) => BoardTemplate["data"] | null;
  onUse: (tpl: BoardTemplate) => void;
  onClose: () => void;
  onError?: (message: string) => void;
  onSaved?: (name: string) => void;
}) {
  const { t } = useLanguage();
  const [templates, setTemplates] = useState<BoardTemplate[] | null>(null);
  const [name, setName] = useState("");
  const [selectionOnly, setSelectionOnly] = useState(selectionCount > 0);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    api
      .list()
      .then((list) => alive && setTemplates(list))
      .catch(() => {
        if (alive) setTemplates([]);
        onError?.(t("ideaBoard.templates.failed"));
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !renaming) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, renaming]);

  async function save() {
    const n = name.trim();
    if (!n || busy) return;
    const doc = onSave(selectionOnly && selectionCount > 0);
    if (!doc || !doc.elements.length) {
      onError?.(t("ideaBoard.templates.emptyBoardNothing"));
      return;
    }
    setBusy(true);
    try {
      const tpl = await api.save(n, doc);
      setTemplates((list) => [tpl, ...(list ?? [])]);
      setName("");
      onSaved?.(tpl.name);
    } catch (e) {
      onError?.(e instanceof Error && e.message ? e.message : t("ideaBoard.templates.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function rename(tpl: BoardTemplate, value: string) {
    setRenaming(null);
    const n = value.trim();
    if (!n || n === tpl.name) return;
    try {
      const next = await api.rename(tpl.id, n);
      setTemplates((list) => (list ?? []).map((x) => (x.id === tpl.id ? next : x)));
    } catch {
      onError?.(t("ideaBoard.templates.failed"));
    }
  }

  async function remove(tpl: BoardTemplate) {
    if (!window.confirm(t("ideaBoard.templates.deleteConfirm", { name: tpl.name }))) return;
    try {
      await api.remove(tpl.id);
      setTemplates((list) => (list ?? []).filter((x) => x.id !== tpl.id));
    } catch {
      onError?.(t("ideaBoard.templates.failed"));
    }
  }

  return (
    <div
      data-board-ui
      className="absolute inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-4"
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      onWheel={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div ref={rootRef} className="w-full max-w-2xl max-h-full flex flex-col rounded-2xl bg-[#1c1c1e] border border-white/10 shadow-2xl overflow-hidden select-text">
        <div className="flex items-center justify-between px-5 pt-4 pb-3">
          <h2 className="text-base font-semibold text-white">{t("ideaBoard.templates.title")}</h2>
          <button onClick={onClose} className="h-8 w-8 flex items-center justify-center rounded-lg text-white/50 hover:text-white hover:bg-white/10" aria-label="Close">
            ✕
          </button>
        </div>

        {canSave && (
          <form
            className="px-5 pb-4 border-b border-white/10"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            {selectionCount > 0 && (
              <div className="flex gap-1 mb-2 p-0.5 rounded-lg bg-white/5 w-fit text-xs">
                <button type="button" onClick={() => setSelectionOnly(false)} className={`px-2.5 py-1 rounded-md ${!selectionOnly ? "bg-white/15 text-white" : "text-white/55"}`}>
                  {t("ideaBoard.templates.saveBoard")}
                </button>
                <button type="button" onClick={() => setSelectionOnly(true)} className={`px-2.5 py-1 rounded-md ${selectionOnly ? "bg-white/15 text-white" : "text-white/55"}`}>
                  {t("ideaBoard.templates.saveSelection", { count: selectionCount })}
                </button>
              </div>
            )}
            <div className="flex gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                placeholder={t("ideaBoard.templates.namePlaceholder")}
                className="flex-1 min-w-0 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
              />
              <button
                type="submit"
                disabled={!name.trim() || busy || !hasContent}
                className="rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:hover:bg-blue-600 px-4 text-sm font-semibold text-white whitespace-nowrap"
              >
                {selectionCount > 0 && selectionOnly ? t("ideaBoard.templates.save") : t("ideaBoard.templates.saveBoard")}
              </button>
            </div>
            <p className="mt-2 text-[11px] leading-snug text-white/40">{t("ideaBoard.templates.note")}</p>
          </form>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto p-5">
          {templates === null ? (
            <div className="text-sm text-white/40">…</div>
          ) : templates.length === 0 ? (
            <div className="text-sm text-white/45 text-center py-6">{t("ideaBoard.templates.empty")}</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {templates.map((tpl) => (
                <div key={tpl.id} className="group rounded-xl border border-white/10 bg-white/[0.03] p-2 flex flex-col gap-2">
                  <button type="button" onClick={() => onUse(tpl)} className="block rounded-lg overflow-hidden hover:ring-2 hover:ring-blue-500" title={t("ideaBoard.templates.use")}>
                    <TemplateThumb tpl={tpl} />
                  </button>
                  {renaming === tpl.id ? (
                    <input
                      autoFocus
                      defaultValue={tpl.name}
                      maxLength={120}
                      onBlur={(e) => void rename(tpl, e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void rename(tpl, e.currentTarget.value);
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      className="w-full rounded-md bg-white/5 border border-blue-500 px-2 py-1 text-sm text-white outline-none"
                    />
                  ) : (
                    <div className="px-0.5">
                      <div className="text-sm font-semibold text-white/90 truncate" title={tpl.name}>
                        {tpl.name}
                      </div>
                      <div className="text-[11px] text-white/40">{t("ideaBoard.templates.nodes", { count: tpl.data.elements.length })}</div>
                    </div>
                  )}
                  <div className="flex gap-1.5">
                    {canSave && (
                      <button type="button" onClick={() => onUse(tpl)} className="flex-1 rounded-md bg-blue-600 hover:bg-blue-500 py-1.5 text-xs font-semibold text-white">
                        {t("ideaBoard.templates.use")}
                      </button>
                    )}
                    <button type="button" onClick={() => setRenaming(tpl.id)} title={t("ideaBoard.templates.rename")} className="rounded-md border border-white/10 px-2 text-xs text-white/60 hover:text-white hover:bg-white/10">
                      ✎
                    </button>
                    <button type="button" onClick={() => void remove(tpl)} title={t("ideaBoard.templates.delete")} className="rounded-md border border-white/10 px-2 text-xs text-white/60 hover:text-red-300 hover:bg-white/10">
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
