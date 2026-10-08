"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IdeaFeedbackPanel } from "./IdeaFeedbackPanel";
import { IdeaBoard, type BoardPin } from "./board/IdeaBoard";
import { authorColor } from "@/lib/authorColor";
import { BoardTodoContext, type BoardTodoApi } from "./board/BoardTodo";
import { boardHtmlToPlain } from "./board/BoardElementView";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { useToast } from "./ui/Toast";
import { useApi } from "@/lib/useApi";
import { ApiError } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import { coverSrcOf, forSave, type BoardData } from "@/lib/board";
import type { Annotation, Idea, IdeaFeedback, Member, TodoList } from "@/lib/types";

/** Full-screen view for one idea at a time, opened from a tile or "+ Idee" in
 * the overview (IdeaGrid, unchanged). 2026-10-08, Lino: the old title/text/
 * slideshow card is replaced by a Milanote-style board (board/IdeaBoard.tsx)
 * filling the whole screen under a slim top bar that keeps everything the
 * card used to offer around the content: title, previous/next idea, internal
 * review, client approve/reject, the client feedback thread (side panel) and
 * delete. The board autosaves; the iOS app still edits title/text/images
 * through the old endpoints. */
export function IdeaFocusView({
  ideas,
  index,
  autoFocusTitleId,
  onIndexChange,
  onCreateNext,
  onUpdated,
  onDeleted,
  onSilentlyRemoved,
  onClose,
  annotations,
  highlightedAnnotationId,
  onDeleteAnnotation,
  onAnnotationUpdated,
  myRole,
  canDeleteComments,
}: {
  ideas: Idea[];
  index: number;
  autoFocusTitleId: string | null;
  onIndexChange: (index: number) => void;
  onCreateNext: () => void;
  onUpdated: (idea: Idea) => void;
  onDeleted: (id: string) => void;
  /** Fires when a freshly created idea is left without any board content —
   * it gets deleted again (2026-09-18 rule, kept for the board). */
  onSilentlyRemoved: (id: string) => void;
  onClose: () => void;
  annotations?: Annotation[];
  highlightedAnnotationId?: string | null;
  onDeleteAnnotation?: (annotation: Annotation) => void;
  onAnnotationUpdated?: (annotation: Annotation) => void;
  myRole?: Member["role"] | null;
  canDeleteComments?: boolean;
}) {
  const creatingRef = useRef(false);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    creatingRef.current = false;
  }, [ideas.length]);

  const idea = ideas[index];
  if (typeof document === "undefined" || !idea) return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] bg-[#161616]">
      <IdeaBoardScreen
        key={idea.id}
        idea={idea}
        isNew={idea.id === autoFocusTitleId}
        hasPrev={index > 0}
        hasNext={index < ideas.length - 1}
        onPrev={() => onIndexChange(index - 1)}
        onNext={() => onIndexChange(index + 1)}
        onCreateNext={() => {
          if (creatingRef.current) return;
          creatingRef.current = true;
          onCreateNext();
        }}
        onUpdated={onUpdated}
        onDeleted={(id) => {
          onDeleted(id);
          if (ideas.length <= 1) onClose();
        }}
        onSilentlyRemoved={onSilentlyRemoved}
        onClose={onClose}
        annotations={annotations}
        highlightedAnnotationId={highlightedAnnotationId}
        onDeleteAnnotation={onDeleteAnnotation}
        onAnnotationUpdated={onAnnotationUpdated}
        myRole={myRole}
        canDeleteComments={canDeleteComments}
      />
    </div>,
    document.body,
  );
}

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

/** What the overview tile needs from a board, computed the same way the
 * backend does (app/idea_board.py: text_for_idea / cover_and_preview). */
function boardSummary(data: BoardData) {
  const order = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.round(a.y / 48) - Math.round(b.y / 48) || a.x - b.x;
  const texts = data.elements.filter((el) => el.type === "text").sort(order);
  // the image chosen via "Als Thumbnail verwenden" wins over the top-left one
  const chosen = coverSrcOf(data.elements.find((el) => el.id === data.cover));
  const images = data.elements.filter((el) => el.type === "image" || (el.type === "scene" && el.image_src)).sort(order);
  const nonEmpty = texts.filter((el) => el.type === "text" && boardHtmlToPlain(el.html));
  const first = nonEmpty[0];
  return {
    text: nonEmpty.map((el) => (el.type === "text" ? el.html : "")).join("<div><br></div>"),
    board_text_preview: first && first.type === "text" ? boardHtmlToPlain(first.html).slice(0, 400) : "",
    board_cover_url: chosen ?? coverSrcOf(images[0]),
  };
}

function IdeaBoardScreen({
  idea,
  isNew,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onCreateNext,
  onUpdated,
  onDeleted,
  onSilentlyRemoved,
  onClose,
  annotations,
  highlightedAnnotationId,
  onDeleteAnnotation,
  onAnnotationUpdated,
  myRole,
  canDeleteComments,
}: {
  idea: Idea;
  isNew: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onCreateNext: () => void;
  onUpdated: (idea: Idea) => void;
  onDeleted: (id: string) => void;
  onSilentlyRemoved: (id: string) => void;
  onClose: () => void;
  annotations?: Annotation[];
  highlightedAnnotationId?: string | null;
  onDeleteAnnotation?: (annotation: Annotation) => void;
  onAnnotationUpdated?: (annotation: Annotation) => void;
  myRole?: Member["role"] | null;
  canDeleteComments?: boolean;
}) {
  const api = useApi();
  const toast = useToast();
  const { t } = useLanguage();

  const [board, setBoard] = useState<{ data: BoardData; editable: boolean } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [boardKey, setBoardKey] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [title, setTitle] = useState(idea.title);
  const [feedbackOpen, setFeedbackOpen] = useState(!!highlightedAnnotationId);
  // 2026-10-08, Lino: Feedback-Pins — pinned client comments show on the
  // board; a pin opens its comment in the sidebar, "📍" in the sidebar zooms
  // the board to the node
  const [feedbackList, setFeedbackList] = useState<IdeaFeedback[]>([]);
  const [activePinId, setActivePinId] = useState<string | null>(null);
  const [pinFocus, setPinFocus] = useState<{ elementId: string; nonce: number } | null>(null);
  const boardPins: BoardPin[] = feedbackList
    .filter((f) => f.board_element_id && f.pin_x != null && f.pin_y != null && f.comment)
    .map((f) => ({
      id: f.id,
      elementId: f.board_element_id!,
      x: f.pin_x!,
      y: f.pin_y!,
      color: authorColor(f.author_name),
      label: (f.author_name.trim()[0] ?? "?").toUpperCase(),
      resolved: f.resolved,
      active: f.id === activePinId,
      title: `${f.author_name}: ${f.comment}`,
    }));
  const [allFeedbackResolved, setAllFeedbackResolved] = useState(true);
  const [busy, setBusy] = useState<null | "approve" | "reject" | "internalApprove" | "internalReject" | "delete">(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const ideaRef = useRef(idea);
  ideaRef.current = idea;
  const versionRef = useRef(0);
  const pendingRef = useRef<BoardData | null>(null);
  const latestRef = useRef<BoardData | null>(null);
  const savingRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const explicitlyDeleted = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);

  const approved = idea.status === "approved";
  const rejected = idea.status === "rejected";
  const canInternalReview = myRole === "projektleiter" || myRole === "owner";
  const editable = board?.editable ?? false;

  /** Server responses for the idea don't carry the board summary — keep the
   * one the tile already shows. */
  const withBoardSummary = useCallback(
    (updated: Idea): Idea => ({
      ...updated,
      has_board: ideaRef.current.has_board,
      board_cover_url: ideaRef.current.board_cover_url,
      board_text_preview: ideaRef.current.board_text_preview,
    }),
    [],
  );

  const loadBoard = useCallback(() => {
    setLoadError(false);
    api
      .getIdeaBoard(idea.id)
      .then((res) => {
        versionRef.current = res.version;
        latestRef.current = res.data;
        setBoard({ data: res.data, editable: !!res.editable });
        setBoardKey((k) => k + 1);
      })
      .catch(() => setLoadError(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idea.id]);

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  // ── to-do nodes (2026-10-08): the idea's project to-do lists + the people
  // who can be @-assigned. Edits show instantly; a failed request reloads.
  const [todoLists, setTodoLists] = useState<Record<string, TodoList>>({});
  const [members, setMembers] = useState<Member[]>([]);
  const loadTodos = useCallback(() => {
    api
      .ideaTodoLists(idea.id)
      .then((ls) => setTodoLists(Object.fromEntries(ls.map((l) => [l.id, l]))))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idea.id]);
  useEffect(() => {
    loadTodos();
    api.members(idea.project_id).then(setMembers).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idea.id]);
  const todoApi = useMemo<BoardTodoApi>(() => {
    const fail = (e: unknown) => {
      toast.showError(e instanceof ApiError ? e.message : t("ideaBoard.saveFailed"));
      loadTodos();
    };
    const setList = (id: string, fn: (l: TodoList) => TodoList) =>
      setTodoLists((prev) => (prev[id] ? { ...prev, [id]: fn(prev[id]) } : prev));
    return {
      lists: todoLists,
      members,
      createList: async (name) => {
        const list = await api.createIdeaTodoList(idea.id, name);
        setTodoLists((prev) => ({ ...prev, [list.id]: list }));
        return list;
      },
      renameList: async (id, name) => {
        setList(id, (l) => ({ ...l, name }));
        await api.patchTodoList(id, { name }).catch(fail);
      },
      addItem: async (listId, text, assigneeId) => {
        try {
          const order = todoLists[listId]?.items.length ?? 0;
          const item = await api.createTodoItem(listId, text, assigneeId ?? undefined, order);
          setList(listId, (l) => ({ ...l, items: [...l.items, item] }));
        } catch (e) {
          fail(e);
        }
      },
      patchItem: async (item, patch) => {
        setList(item.todo_list_id, (l) => ({ ...l, items: l.items.map((i) => (i.id === item.id ? { ...i, ...patch } : i)) }));
        try {
          const updated = await api.patchTodoItem(item.id, patch);
          setList(item.todo_list_id, (l) => ({ ...l, items: l.items.map((i) => (i.id === item.id ? updated : i)) }));
        } catch (e) {
          fail(e);
        }
      },
      deleteItem: async (item) => {
        setList(item.todo_list_id, (l) => ({ ...l, items: l.items.filter((i) => i.id !== item.id) }));
        await api.deleteTodoItem(item.id).catch(fail);
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todoLists, members, idea.id]);

  useEffect(() => {
    if (isNew) {
      titleRef.current?.focus();
      titleRef.current?.select();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flush = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const data = pendingRef.current;
    if (!data || savingRef.current) return;
    pendingRef.current = null;
    savingRef.current = true;
    setSaveState("saving");
    try {
      const res = await api.saveIdeaBoard(idea.id, versionRef.current, forSave(data));
      versionRef.current = res.version;
      const summary = boardSummary(data);
      onUpdated({ ...ideaRef.current, ...summary, has_board: true });
      setSaveState(pendingRef.current ? "dirty" : "saved");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast.showError(t("ideaBoard.conflict"));
        pendingRef.current = null;
        loadBoard();
        setSaveState("idle");
      } else {
        pendingRef.current = pendingRef.current ?? data;
        setSaveState("error");
        saveTimer.current = setTimeout(() => void flush(), 4000);
      }
    } finally {
      savingRef.current = false;
      if (pendingRef.current && !saveTimer.current) saveTimer.current = setTimeout(() => void flush(), 600);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idea.id, loadBoard]);

  const handleBoardChange = useCallback(
    (data: BoardData) => {
      latestRef.current = data;
      pendingRef.current = data;
      setSaveState("dirty");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void flush(), 800);
    },
    [flush],
  );

  // Leaving this idea (close, previous/next, unmount): save what's pending
  // right away, and drop a brand-new idea that never got any content.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    function beforeUnload(e: BeforeUnloadEvent) {
      if (pendingRef.current || savingRef.current) {
        void flushRef.current();
        e.preventDefault();
      }
    }
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      if (titleTimer.current) {
        clearTimeout(titleTimer.current);
        void api.patchIdea(idea.id, { title: titleRef.current?.value ?? idea.title }).catch(() => {});
      }
      void flushRef.current();
      if (!isNew || explicitlyDeleted.current) return;
      const empty = (latestRef.current?.elements.length ?? 0) === 0;
      if (empty && !pendingRef.current) {
        api.deleteIdea(idea.id).then(() => onSilentlyRemoved(idea.id)).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function changeTitle(value: string) {
    setTitle(value);
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(async () => {
      titleTimer.current = null;
      try {
        const updated = await api.patchIdea(idea.id, { title: value.trim() || t("ideaGrid.newIdeaTitle") });
        onUpdated(withBoardSummary(updated));
      } catch (e) {
        toast.showError(e instanceof ApiError ? e.message : t("ideaBoard.saveFailed"));
      }
    }, 600);
  }

  async function run(kind: NonNullable<typeof busy>, fn: () => Promise<Idea>, failKey: Parameters<typeof t>[0], successKey?: Parameters<typeof t>[0]) {
    setBusy(kind);
    try {
      await flush();
      const updated = await fn();
      onUpdated(withBoardSummary(updated));
      if (successKey) toast.showSuccess(t(successKey));
      if (kind === "approve" || kind === "reject") loadBoard();
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t(failKey));
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    setConfirmDelete(false);
    explicitlyDeleted.current = true;
    setBusy("delete");
    try {
      pendingRef.current = null;
      await api.deleteIdea(idea.id);
      onDeleted(idea.id);
    } catch (e) {
      explicitlyDeleted.current = false;
      toast.showError(e instanceof ApiError ? e.message : t("ideaCard.deleteFailed"));
      setBusy(null);
    }
  }

  const saveLabel =
    saveState === "saving" || saveState === "dirty"
      ? t("ideaBoard.saving")
      : saveState === "saved"
        ? t("ideaBoard.saved")
        : saveState === "error"
          ? t("ideaBoard.saveFailed")
          : "";

  return (
    <div className="absolute inset-0 flex flex-col">
      {/* top bar */}
      <div className="relative z-30 shrink-0 flex items-center gap-2 sm:gap-3 px-2 sm:px-4 h-14 border-b border-white/10 bg-[#161616]/95 backdrop-blur">
        <IconButton label={t("ideaFocusView.close")} onClick={onClose}>
          <path d="M18 6 6 18M6 6l12 12" />
        </IconButton>
        <div className="flex items-center">
          <IconButton label={t("ideaFocusView.previousIdea")} onClick={onPrev} disabled={!hasPrev}>
            <path d="m15 18-6-6 6-6" />
          </IconButton>
          {hasNext ? (
            <IconButton label={t("ideaFocusView.nextIdea")} onClick={onNext}>
              <path d="m9 18 6-6-6-6" />
            </IconButton>
          ) : (
            <IconButton label={t("ideaFocusView.newIdea")} onClick={onCreateNext}>
              <path d="M12 5v14M5 12h14" />
            </IconButton>
          )}
        </div>
        <input
          ref={titleRef}
          value={title}
          onChange={(e) => changeTitle(e.target.value)}
          disabled={!editable}
          placeholder={t("ideaBoard.titlePlaceholder")}
          className="min-w-0 flex-1 bg-transparent text-base sm:text-lg font-semibold outline-none rounded-lg px-2 py-1 focus:bg-white/5 disabled:opacity-100"
        />
        <span className={`hidden md:inline text-xs whitespace-nowrap ${saveState === "error" ? "text-red-400" : "text-white/40"}`}>{saveLabel}</span>

        {/* internal review (PL/Admin), unchanged rules from the old card */}
        {(idea.status === "open" || idea.internal_status) && (
          <div className="hidden lg:flex items-center gap-1.5">
            {idea.internal_status === "approved" ? (
              <span className="text-xs font-semibold text-emerald-400 bg-emerald-500/10 rounded-full px-3 py-1.5 whitespace-nowrap">
                ✓ {t("ideaBoard.internalApproved")}
              </span>
            ) : idea.internal_status === "rejected" ? (
              <span className="text-xs font-semibold text-red-400 bg-red-500/10 rounded-full px-3 py-1.5 whitespace-nowrap">
                ✗ {t("ideaBoard.internalRejected")}
              </span>
            ) : canInternalReview ? (
              <>
                <Pill onClick={() => run("internalReject", () => api.internalRejectIdea(idea.id), "ideaCard.internalRejectFailed")} disabled={!!busy} tone="red">
                  {t("ideaCard.internalReject")}
                </Pill>
                <Pill onClick={() => run("internalApprove", () => api.internalApproveIdea(idea.id), "ideaCard.internalApproveFailed")} disabled={!!busy} tone="green">
                  {t("ideaCard.internalApprove")}
                </Pill>
              </>
            ) : (
              <span className="text-xs text-white/40 whitespace-nowrap">{t("ideaCard.internalReviewPending")}</span>
            )}
          </div>
        )}

        {approved ? (
          <span className="text-xs font-semibold text-emerald-400 bg-emerald-500/10 rounded-full px-3 py-1.5 whitespace-nowrap">✓ {t("ideaCard.approvedBadge")}</span>
        ) : rejected ? (
          <span className="text-xs font-semibold text-red-400 bg-red-500/10 rounded-full px-3 py-1.5 whitespace-nowrap">✗ {t("ideaCard.rejected")}</span>
        ) : (
          editable && (
            <div className="flex items-center gap-1.5">
              <Pill onClick={() => run("reject", () => api.rejectIdea(idea.id), "ideaCard.rejectFailed", "ideaCard.rejectedToast")} disabled={!!busy} tone="red">
                {t("ideaCard.rejected")}
              </Pill>
              <Pill
                onClick={() => {
                  if (!allFeedbackResolved) {
                    toast.showError(t("ideaCard.resolveFeedbackFirst"));
                    return;
                  }
                  void run("approve", () => api.approveIdea(idea.id), "ideaCard.approveFailed", "ideaCard.approvedToast");
                }}
                disabled={!!busy}
                tone="green"
                dim={!allFeedbackResolved}
                title={allFeedbackResolved ? undefined : t("ideaCard.approveDisabledTitle")}
              >
                {t("ideaCard.approveButton")}
              </Pill>
            </div>
          )
        )}

        <button
          onClick={() => setFeedbackOpen((v) => !v)}
          className={`relative h-9 px-3 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${feedbackOpen ? "bg-white/20 text-white" : "bg-white/10 text-white/80 hover:bg-white/15"}`}
        >
          💬 <span className="hidden sm:inline">{t("ideaBoard.feedback")}</span>
          {idea.open_feedback_count > 0 && (
            <span className="ml-1.5 inline-flex min-w-5 h-5 px-1 items-center justify-center rounded-full bg-blue-600 text-white text-[11px]">{idea.open_feedback_count}</span>
          )}
        </button>
        {editable && (
          <IconButton label={t("ideaBoard.deleteIdea")} onClick={() => setConfirmDelete(true)} disabled={busy === "delete"}>
            <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
          </IconButton>
        )}
      </div>

      {/* board + feedback side panel */}
      <div className="relative flex-1 min-h-0">
        {board ? (
          <BoardTodoContext.Provider value={{ api: todoApi }}>
          <IdeaBoard
            key={boardKey}
            className="absolute inset-0"
            initial={board.data}
            editable={board.editable}
            onChange={handleBoardChange}
            onError={(msg) => toast.showError(msg)}
            onEscape={onClose}
            uploadFile={async (file, mime, onProgress) => {
              const ticket = await api.createIdeaBoardUpload(idea.id, { filename: file.name, content_type: mime, size: file.size });
              await uploadWithType(ticket.upload_url, file, mime, onProgress);
              return { key: ticket.key, src: ticket.url };
            }}
            fetchLinkPreview={(url) => api.ideaBoardLinkPreview(idea.id, url)}
            pins={boardPins}
            onPinClick={(id) => {
              setActivePinId(id);
              setFeedbackOpen(true);
            }}
            focusRequest={pinFocus}
            createLocationMap={async (lat, lng) => {
              const r = await api.boardLocationMap(idea.id, lat, lng);
              return { key: r.key, src: r.url };
            }}
            extractPalette={async (key) => (await api.boardPalette(idea.id, key)).colors}
            generateImage={async (prompt, style, aspect) => {
              const { job_id } = await api.createBoardImageJob(idea.id, { prompt, style, aspect_ratio: aspect });
              // Gemini usually needs 10–40 s; give up after ~4 minutes
              for (let i = 0; i < 80; i++) {
                await new Promise((r) => setTimeout(r, 3000));
                const job = await api.boardImageJob(idea.id, job_id);
                if (job.status === "ready" && job.key && job.url) return { key: job.key, src: job.url };
                if (job.status === "failed") throw new Error(job.error || t("ideaBoard.aiFailed"));
              }
              throw new Error(t("ideaBoard.aiFailed"));
            }}
          />
          </BoardTodoContext.Provider>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/40">
            {loadError ? (
              <button onClick={loadBoard} className="underline hover:text-white/70">
                {t("ideaBoard.loadFailed")}
              </button>
            ) : (
              <span className="animate-pulse">…</span>
            )}
          </div>
        )}

        <aside
          className={`absolute top-0 right-0 bottom-0 z-40 w-full sm:w-[420px] bg-[#1c1c1e] border-l border-white/10 shadow-2xl flex flex-col transition-transform duration-300 ${feedbackOpen ? "translate-x-0" : "translate-x-full pointer-events-none invisible"}`}
          aria-hidden={!feedbackOpen}
        >
          <div className="shrink-0 flex items-center justify-between px-5 h-12 border-b border-white/10">
            <span className="text-sm font-semibold">{t("ideaBoard.feedback")}</span>
            <IconButton label={t("ideaFocusView.close")} onClick={() => setFeedbackOpen(false)}>
              <path d="M18 6 6 18M6 6l12 12" />
            </IconButton>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-6">
            <IdeaFeedbackPanel
              idea={idea}
              onAllResolvedChange={setAllFeedbackResolved}
              annotations={annotations}
              highlightedAnnotationId={activePinId ?? highlightedAnnotationId}
              onDeleteAnnotation={onDeleteAnnotation}
              onAnnotationUpdated={onAnnotationUpdated}
              canDeleteComments={canDeleteComments}
              onFeedbackChange={setFeedbackList}
              onLocate={(f) => {
                if (!f.board_element_id) return;
                setActivePinId(f.id);
                setPinFocus({ elementId: f.board_element_id, nonce: Date.now() });
                // on a phone the drawer covers the board — get it out of the way
                if (window.innerWidth < 640) setFeedbackOpen(false);
              }}
            />
            {idea.feedback_count === 0 && <p className="text-sm text-white/40 mt-5">{t("ideaBoard.noFeedback")}</p>}
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={t("ideaGrid.deleteTitle")}
        message={t("ideaGrid.deleteMessage", { title: idea.title })}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

/** Direct PUT to the presigned R2 URL. The Content-Type must match the one
 * the URL was signed for (guessMime may have filled in an empty file.type). */
function uploadWithType(url: string, file: File, mime: string, onProgress: (f: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", mime);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.send(file);
  });
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-white/65 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-25 disabled:hover:bg-transparent"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  );
}

function Pill({
  onClick,
  disabled,
  tone,
  dim,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  tone: "red" | "green";
  dim?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-full px-3 h-8 text-xs font-semibold whitespace-nowrap transition-colors disabled:opacity-50 ${dim ? "opacity-50" : ""} ${
        tone === "red" ? "text-white/80 bg-white/10 hover:bg-red-500/20 hover:text-red-300" : "text-white/80 bg-white/10 hover:bg-emerald-500/20 hover:text-emerald-300"
      }`}
    >
      {children}
    </button>
  );
}
