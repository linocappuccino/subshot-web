"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useApi } from "@/lib/useApi";
import { ApiError } from "@/lib/api";
import { useLanguage, type TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { Pill } from "./ui/Badge";
import { useToast } from "./ui/Toast";
import { STATUS_TONE } from "./VideoTile";
import type { MyTodo, PostproductionStatus, PostproductionVideoDeadline, Project, TodoSidebarData } from "@/lib/types";
import { moduleAwareProjectHref } from "@/lib/projectLink";

/** Right-hand sidebar on the Projektübersicht (#305, 2026-07-22, Lino:
 * "rechte Seitenpalte fuer 'meine Todos' (projekt-uebergreifend)... dort
 * muss auch jeweils die deadline von den einzelnen videos in der
 * postproduction zu sehen sein"). Two independent feeds, both cross-
 * project: open TodoItems assigned to the current user, and every Video
 * whose parent Section is in postproduction with a deadline set — see
 * GET /me/todo-sidebar. Polls like NotificationBell (20s) rather than a
 * websocket, same "doesn't need sub-second freshness" reasoning. */
export function TodoSidebar() {
  const api = useApi();
  const toast = useToast();
  const { t } = useLanguage();
  const [data, setData] = useState<TodoSidebarData | null>(null);
  // 2026-08-06, Lino: "soll mit einer Animation zuerst durchgestrichen
  // werden und dann mit einer Animation verschwinden" — which todo ids are
  // mid-check (strikethrough showing, not yet removed from `data.todos`).
  const [checkingTodoIds, setCheckingTodoIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    function poll() {
      api.todoSidebar().then((d) => {
        if (!cancelled) setData(d);
      }).catch(() => {});
    }
    poll();
    const interval = setInterval(poll, 20000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The list only ever shows OPEN todos (backend filters done=false), so
  // checking one off here is a one-way "complete" action, not a toggle —
  // it just drops out of the list once done, same as it would on the next
  // poll anyway. Reverts (re-adds it back) if the PATCH fails.
  //
  // 2026-08-06, Lino: "soll mit einer Animation zuerst durchgestrichen
  // werden und dann mit einer Animation verschwinden" — mark it "checking"
  // (strikethrough shows immediately via checkingTodoIds), wait for that to
  // actually be visible, THEN remove it from data.todos. 2026-08-26: it used
  // to then fade+collapse out via AnimatePresence too; now it's just
  // instantly removed (see [[project_subshot_web_speed_and_correctness_2026-08-25]]).
  async function completeTodo(todo: MyTodo) {
    if (checkingTodoIds.has(todo.id)) return;
    setCheckingTodoIds((prev) => new Set(prev).add(todo.id));
    await new Promise((resolve) => setTimeout(resolve, 450));
    setData((prev) => (prev ? { ...prev, todos: prev.todos.filter((t) => t.id !== todo.id) } : prev));
    setCheckingTodoIds((prev) => {
      const next = new Set(prev);
      next.delete(todo.id);
      return next;
    });
    try {
      await api.patchTodoItem(todo.id, { done: true });
    } catch (e) {
      setData((prev) => (prev ? { ...prev, todos: [...prev.todos, todo] } : prev));
      toast.showError(e instanceof ApiError ? e.message : t("common.failed"));
    }
  }

  function isOverdue(iso: string): boolean {
    return new Date(iso).getTime() < Date.now();
  }

  // 2026-08-05, Lino: "ist in der todoliste ein deadline auf einen Tag
  // gesetzt, und man ist im Tag von dieser Deadline, soll dieser
  // todolist punkt auf der startseite rötlich dargestellt werden, einen
  // tag vor der deadline gelb" — deliberately a CALENDAR-day comparison
  // (local browser timezone, same as formatDateTime below), not a rolling
  // 24h/48h window: a deadline at 23:00 tonight is "today" the instant the
  // clock hits 00:00 today, not merely once it's <24h away. Independent of
  // isOverdue above (that one still only flags the small timestamp text
  // once the deadline's exact time has actually passed) — a due-today item
  // gets BOTH the reddish row tint from here AND red overdue text once its
  // time-of-day passes, reinforcing rather than conflicting.
  // 2026-08-06: extended with "overdue" (any past calendar day, not just
  // today) — used to fall through to `null` (no tint at all) once a full
  // day had passed, same red treatment as "today" via urgencyRowClass.
  // Applied to BOTH lists below (was Meine Todos only).
  function dueUrgency(iso: string): "overdue" | "today" | "tomorrow" | null {
    const due = new Date(iso);
    const now = new Date();
    const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const diffDays = Math.round((dueDay - today) / 86400000);
    if (diffDays < 0) return "overdue";
    if (diffDays === 0) return "today";
    if (diffDays === 1) return "tomorrow";
    return null;
  }

  function urgencyRowClass(urgency: "overdue" | "today" | "tomorrow" | null): string {
    if (urgency === "today" || urgency === "overdue") return "bg-red-500/10 hover:bg-red-500/15";
    if (urgency === "tomorrow") return "bg-amber-500/10 hover:bg-amber-500/15";
    return "hover:bg-white/8";
  }

  function formatDateTime(iso: string): string {
    const d = new Date(iso);
    return `${d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })} · ${d.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" })}`;
  }

  // 2026-08-06, Lino: "der status vom video wird dort auch immer angezeigt"
  // — re-added (was dropped in the earlier 3-line redesign), same
  // key/label mapping VideoTile.tsx's own status Pill uses.
  function statusLabel(status: PostproductionStatus): string {
    const key: Record<PostproductionStatus, TranslationKey> = {
      wartend: "postproductionStatus.wartend",
      in_bearbeitung: "postproductionStatus.inBearbeitung",
      wartet_auf_feedback: "postproductionStatus.wartetAufFeedback",
      abgeschlossen: "postproductionStatus.abgeschlossen",
      abgelehnt: "postproductionStatus.abgelehnt",
    };
    return t(key[status]);
  }

  // 2026-08-06, Lino: "auf der todoliste soll auch zu sehen sein, in
  // welcher pipeline die todo ist, also Idee, Script/Shotlist,
  // Postproduction, diese info über der deadline darstellen" — same
  // label/color scheme as the project-tile pipeline badge (projects/
  // page.tsx's own pipelineLabel/stageStyle), duplicated locally rather
  // than shared/exported since that's the existing convention there too
  // (that file itself defines the same two maps twice, once per tile
  // variant).
  const pipelineLabel: Record<Project["pipeline_stage"], string> = {
    idea: t("pipeline.idea"),
    scripting: t("pipeline.scripting"),
    postproduction: t("pipeline.postproduction"),
    done: t("pipeline.done"),
  };
  const pipelineStyle: Record<Project["pipeline_stage"], string> = {
    idea: "bg-amber-600/95 text-white",
    scripting: "bg-blue-600/95 text-white",
    postproduction: "bg-violet-600/95 text-white",
    done: "bg-emerald-600/95 text-white",
  };

  // 2026-08-06, Lino: "zuerst kommt der eintrag des todolisten eintrages,
  // darunter kommt auftraggeber: Projekt" — was just project_name (deadlines
  // also tacked on section_name). client_name is optional (not every
  // project has an Auftraggeber set), falls back to the bare project name.
  // 2026-08-06, later same day: "soll auch die textfarbe vom Auftraggeber
  // wieder übernommen werden" — same treatment as the pipeline header (see
  // projects/[id]/page.tsx): only the client-name PORTION gets the
  // project's own color, the ": Projekt" suffix stays the neutral gray this
  // whole line already used, so returns JSX now instead of a plain string.
  function clientProjectLine(clientName: string | null, projectName: string, projectColor: string) {
    if (!clientName) return <>{projectName}</>;
    return (
      <>
        <span style={{ color: projectColor }}>{clientName}</span>
        {`: ${projectName}`}
      </>
    );
  }

  return (
    // 2026-07-22, Lino: "posproduction kachel soll über die todos kachel" —
    // Postproduction-Deadlines block first, Meine Todos second.
    <aside className="hidden xl:flex flex-col gap-4 w-80 shrink-0 sticky top-8 self-start">
      <div className="rounded-2xl bg-[#242426] border border-white/10 overflow-hidden">
        <div className="px-4 py-3 border-b border-white/8">
          <h2 className="text-sm font-semibold">{t("todoSidebar.deadlinesTitle")}</h2>
        </div>
        {!data || data.postproduction_deadlines.length === 0 ? (
          <p className="text-sm text-white/40 px-4 py-4">{t("todoSidebar.deadlinesEmpty")}</p>
        ) : (
          <div className="max-h-[38vh] overflow-y-auto divide-y divide-white/5">
            {data.postproduction_deadlines.map((v: PostproductionVideoDeadline) => {
              const urgency = dueUrgency(v.postproduction_deadline);
              return (
              <Link
                key={v.video_id}
                href={`/projects/${v.project_id}/postproduction?openVideo=${v.video_id}`}
                className={cn("block px-4 py-2.5 transition-colors", urgencyRowClass(urgency))}
              >
                <div className="text-sm font-medium truncate">{v.video_title}</div>
                {/* 2026-08-06, Lino: "zuerst kommt der eintrag... darunter
                    kommt auftraggeber: Projekt... darunter links der
                    pipeline batch und rechts dann die deadline" — exact
                    3-line spec, replaces the old project_name/section_name
                    line + status pill. Status is still readable via the
                    tile's own colored dot elsewhere (VideoTile), not
                    re-added here since he didn't ask for it back. */}
                <div className="text-xs text-white/40 truncate mt-0.5">
                  {clientProjectLine(v.project_client_name, v.project_name, v.project_color)}
                </div>
                {/* 2026-08-06, Lino: "der status vom video wird dort auch
                    immer angezeigt und die versionsnummer" — status pill was
                    dropped in the earlier 3-line redesign ("nicht re-added,
                    da er's nicht zurück wollte"), now explicitly asked back
                    plus version/open-comment-count, same v{n}/💬{n} badge
                    convention VideoTile.tsx's own thumbnail corner already
                    uses (reused verbatim, not reinvented). */}
                {/* 2026-08-07, Lino: "in der projektübersicht die
                    postproduction liste bitte den pipelinebadge entfernen,
                    die versionszahl und kommentaranzahl bitte rechts
                    bündig" — pipeline-stage badge dropped from this list
                    (still shown on the "Meine Todos" block below, wasn't
                    asked to go there too); v{n}/💬{n} moved into their own
                    right-aligned group instead of trailing the status pill
                    left-packed. */}
                <div className="flex items-center justify-between gap-1.5 mt-1">
                  {v.postproduction_status ? (
                    <Pill tone={STATUS_TONE[v.postproduction_status]}>{statusLabel(v.postproduction_status)}</Pill>
                  ) : (
                    <span />
                  )}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {v.video_version_number != null && (
                      <span className="text-[11px] font-mono text-white/60 bg-white/5 rounded-full px-2 py-0.5">
                        v{v.video_version_number}
                      </span>
                    )}
                    {v.open_comment_count > 0 && (
                      <span className="flex items-center gap-1 text-[11px] text-white/60 bg-white/5 rounded-full px-2 py-0.5">
                        💬 {v.open_comment_count}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-end mt-1.5">
                  <span className={cn("text-[11px] font-medium shrink-0", isOverdue(v.postproduction_deadline) ? "text-red-400" : "text-white/50")}>
                    {formatDateTime(v.postproduction_deadline)}
                  </span>
                </div>
              </Link>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-2xl bg-[#242426] border border-white/10 overflow-hidden">
        <div className="px-4 py-3 border-b border-white/8">
          <h2 className="text-sm font-semibold">{t("todoSidebar.myTodosTitle")}</h2>
        </div>
        {!data || data.todos.length === 0 ? (
          <p className="text-sm text-white/40 px-4 py-4">{t("todoSidebar.myTodosEmpty")}</p>
        ) : (
          <div className="max-h-[38vh] divide-y divide-white/5 overflow-y-auto">
            {/* 2026-08-26 — this used to be wrapped in AnimatePresence +
                framer-motion `layout`/exit animations (a fade+collapse when
                an item is checked off), plus a `suppressTodoScrollbar` hack
                that force-hid the scrollbar for the animation's duration to
                paper over a scrollHeight/clientHeight flicker THAT animation
                itself caused. Both gone (see
                [[project_subshot_web_speed_and_correctness_2026-08-25]]) —
                a checked-off item is just instantly removed from `data.todos`
                (see completeTodo), which reflows normally with no flicker to
                work around in the first place. */}
            {data.todos.map((todo: MyTodo) => {
              const urgency = todo.due_at ? dueUrgency(todo.due_at) : null;
              const checking = checkingTodoIds.has(todo.id);
              return (
              <div
                key={todo.id}
                className={cn("flex items-start gap-2.5 px-4 py-2.5 transition-colors overflow-hidden", urgencyRowClass(urgency))}
              >
                <button
                  onClick={() => completeTodo(todo)}
                  disabled={checking}
                  className="shrink-0 mt-0.5"
                  aria-label={t("todoSidebar.markDone")}
                >
                  <span
                    className={cn(
                      "w-4 h-4 rounded-full border-[1.5px] flex items-center justify-center transition-colors",
                      checking ? "bg-emerald-500 border-emerald-500" : "border-white/30 hover:border-emerald-400"
                    )}
                  />
                </button>
                <Link href={moduleAwareProjectHref(todo.project_id, todo)} className={cn("flex-1 min-w-0", checking && "pointer-events-none")}>
                  {/* 2026-07-22, Lino: "todos einträge sollen auch mehrere
                      zeilen anzeigen können" — was truncate (single-line
                      ellipsis), now wraps across as many lines as needed. */}
                  <div
                    className={cn(
                      "text-sm font-medium whitespace-normal break-words transition-all duration-300",
                      checking && "line-through opacity-50"
                    )}
                  >
                    {todo.text}
                  </div>
                  {/* 2026-08-06, Lino: "zuerst kommt der eintrag... darunter
                      kommt auftraggeber: Projekt... darunter links der
                      pipeline batch und rechts dann die deadline". */}
                  <div className="text-xs text-white/40 truncate mt-0.5">
                    {clientProjectLine(todo.project_client_name, todo.project_name, todo.project_color)}
                  </div>
                  <div className="flex items-center justify-between mt-1 gap-2">
                    <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0", pipelineStyle[todo.pipeline_stage])}>
                      {pipelineLabel[todo.pipeline_stage]}
                    </span>
                    {todo.due_at && (
                      <span className={cn("text-[11px] font-medium shrink-0", isOverdue(todo.due_at) ? "text-red-400" : "text-white/50")}>
                        {formatDateTime(todo.due_at)}
                      </span>
                    )}
                  </div>
                </Link>
              </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 2026-08-09, Lino: "Kommentare die in der Ideenseite gemacht wurden
          und noch offen sind, sollen auch in der Todoliste... angezeigt
          werden, das gleiche bei offenen Kommentaren auf der Szenenseite" —
          third, independent feed from GET /me/todo-sidebar's new
          open_comments (no assignee to personalize by like the two blocks
          above, scoped server-side to projects the caller is at least
          "projektleiter" on instead). Same row shape (client/project line,
          pipeline badge) as the "Meine Todos" block. */}
      <div className="rounded-2xl bg-[#242426] border border-white/10 overflow-hidden">
        <div className="px-4 py-3 border-b border-white/8">
          <h2 className="text-sm font-semibold">{t("todoSidebar.openCommentsTitle")}</h2>
        </div>
        {!data || data.open_comments.length === 0 ? (
          <p className="text-sm text-white/40 px-4 py-4">{t("todoSidebar.openCommentsEmpty")}</p>
        ) : (
          <div className="max-h-[38vh] overflow-y-auto divide-y divide-white/5">
            {data.open_comments.map((c) => (
              <Link
                key={c.id}
                href={
                  c.kind === "idea"
                    ? `/projects/${c.project_id}?openIdea=${c.entity_id}`
                    : `/projects/${c.project_id}?openScene=${c.entity_id}`
                }
                className="block px-4 py-2.5 transition-colors hover:bg-white/5"
              >
                <div className="text-sm font-medium truncate">{c.entity_title}</div>
                <div className="text-xs text-white/40 truncate mt-0.5">
                  {clientProjectLine(c.project_client_name, c.project_name, c.project_color)}
                </div>
                <div className="text-xs text-white/60 truncate mt-1">
                  <span className="font-medium">{c.author_name}:</span> {c.comment_preview}
                </div>
                <div className="flex items-center justify-between mt-1 gap-2">
                  <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0", pipelineStyle[c.pipeline_stage])}>
                    {pipelineLabel[c.pipeline_stage]}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
