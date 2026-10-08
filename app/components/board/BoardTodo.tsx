"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { Member, TodoItem, TodoList } from "@/lib/types";
import type { PublicBoardTodoList, TodoElement } from "@/lib/board";

/** 2026-10-08, Lino: to-do list node on the idea board. The list is a real
 * project TodoList (created via POST /ideas/{id}/todo-lists); this file only
 * renders and edits it. Whoever renders the board provides the data:
 * IdeaFocusView the editable API + project members, the client preview the
 * read-only lists. */
export interface BoardTodoApi {
  lists: Record<string, TodoList>;
  members: Member[];
  createList: (name: string) => Promise<TodoList>;
  renameList: (listId: string, name: string) => Promise<void>;
  addItem: (listId: string, text: string, assigneeId: string | null) => Promise<void>;
  patchItem: (item: TodoItem, patch: Partial<{ text: string; done: boolean; assignee_id: string | null }>) => Promise<void>;
  deleteItem: (item: TodoItem) => Promise<void>;
}

export const BoardTodoContext = createContext<{ api?: BoardTodoApi; publicLists?: Record<string, PublicBoardTodoList> } | null>(null);

export interface TodoLabels {
  todoDefaultName: string;
  todoAddPlaceholder: string;
  todoMissing: string;
  todoUnassign: string;
  todoDelete: string;
  todoNoMatch: string;
}

function displayName(m: Member): string {
  return m.name?.trim() || m.email.split("@")[0];
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

const AVATAR_COLORS = ["#3b82f6", "#a855f7", "#ec4899", "#f97316", "#10b981", "#eab308", "#06b6d4", "#ef4444"];
function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function Chip({ name, id, onRemove, removeLabel }: { name: string; id: string; onRemove?: () => void; removeLabel?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white/10 pl-0.5 pr-2 py-0.5 text-xs text-white/85 max-w-full">
      <span className="w-5 h-5 shrink-0 rounded-full text-[9px] font-bold text-white flex items-center justify-center" style={{ background: colorFor(id) }}>
        {initials(name)}
      </span>
      <span className="truncate">@{name}</span>
      {onRemove && (
        <button data-no-drag onMouseDown={(e) => e.preventDefault()} onClick={onRemove} title={removeLabel} aria-label={removeLabel} className="ml-0.5 text-white/40 hover:text-white">
          ×
        </button>
      )}
    </span>
  );
}

/** Text input where typing "@" opens a member picker; choosing someone sets
 * the assignee (shown as a chip) and removes the "@query" from the text. */
function MentionInput({
  members,
  initialText = "",
  initialAssignee = null,
  placeholder,
  labels,
  autoFocus,
  onSubmit,
  onCancel,
  submitOnBlur,
}: {
  members: Member[];
  initialText?: string;
  initialAssignee?: string | null;
  placeholder: string;
  labels: TodoLabels;
  autoFocus?: boolean;
  onSubmit: (text: string, assigneeId: string | null) => void;
  onCancel?: () => void;
  submitOnBlur?: boolean;
}) {
  const [text, setText] = useState(initialText);
  const [assignee, setAssignee] = useState<string | null>(initialAssignee);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const choosing = useRef(false);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const mention = text.match(/(?:^|\s)@([^\s@]*)$/);
  const query = mention ? mention[1].toLowerCase() : null;
  const matches =
    query === null
      ? []
      : members.filter((m) => displayName(m).toLowerCase().includes(query) || m.email.toLowerCase().includes(query)).slice(0, 6);

  function pick(m: Member) {
    choosing.current = true;
    setAssignee(m.user_id);
    setText((t) => t.replace(/(^|\s)@[^\s@]*$/, "$1").replace(/\s+$/, " ").trimStart());
    setActive(0);
    requestAnimationFrame(() => {
      choosing.current = false;
      inputRef.current?.focus({ preventScroll: true });
    });
  }

  function submit() {
    const clean = text.replace(/(^|\s)@[^\s@]*$/, "$1").trim();
    if (!clean) return;
    onSubmit(clean, assignee);
  }

  const assigneeMember = members.find((m) => m.user_id === assignee);
  return (
    <div data-no-drag className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {assigneeMember && <Chip name={displayName(assigneeMember)} id={assigneeMember.user_id} onRemove={() => setAssignee(null)} removeLabel={labels.todoUnassign} />}
        <input
          ref={inputRef}
          value={text}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (matches.length > 0 && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              setActive((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
            } else if (matches.length > 0 && (e.key === "Enter" || e.key === "Tab")) {
              e.preventDefault();
              pick(matches[Math.min(active, matches.length - 1)]);
            } else if (e.key === "Enter") {
              e.preventDefault();
              submit();
              if (!initialText) {
                setText("");
                setAssignee(null);
              }
            } else if (e.key === "Escape") {
              e.stopPropagation();
              onCancel?.();
            } else if (e.key === "Backspace" && !text && assignee) {
              setAssignee(null);
            }
          }}
          onBlur={() => {
            if (choosing.current) return;
            if (submitOnBlur) submit();
          }}
          className="min-w-[8rem] flex-1 bg-transparent text-sm text-white/90 outline-none placeholder:text-white/30 select-text"
        />
      </div>
      {query !== null && (
        <div className="mt-1.5 rounded-lg border border-white/10 bg-[#1c1c1e] p-1 shadow-xl">
          {matches.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-white/40">{labels.todoNoMatch}</div>
          ) : (
            matches.map((m, i) => (
              <button
                key={m.user_id}
                data-no-drag
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(m);
                }}
                className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${i === active ? "bg-white/10" : "hover:bg-white/5"}`}
              >
                <span className="w-6 h-6 shrink-0 rounded-full text-[10px] font-bold text-white flex items-center justify-center" style={{ background: colorFor(m.user_id) }}>
                  {initials(displayName(m))}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-white/90">{displayName(m)}</span>
                  <span className="block truncate text-[11px] text-white/40">{m.email}</span>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function TodoNode({ el, editable, labels }: { el: TodoElement; editable: boolean; labels: TodoLabels }) {
  const ctx = useContext(BoardTodoContext);
  const api = ctx?.api;
  const list = api?.lists[el.list_id];
  const pub = ctx?.publicLists?.[el.list_id];
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);

  const name = list?.name ?? pub?.name ?? el.title ?? labels.todoDefaultName;
  const items = list
    ? [...list.items].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
    : null;
  const total = items?.length ?? pub?.items.length ?? 0;
  const done = items ? items.filter((i) => i.done).length : pub?.items.filter((i) => i.done).length ?? 0;
  const canEdit = editable && !!api && !!list;

  return (
    <div className="rounded-xl bg-[#232325] border border-white/10 shadow-[0_2px_10px_rgba(0,0,0,0.35)]">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <div className="w-7 h-7 shrink-0 rounded-lg bg-emerald-500/20 text-emerald-300 flex items-center justify-center">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m9 11 3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
        </div>
        {canEdit && editingTitle ? (
          <input
            data-no-drag
            autoFocus
            defaultValue={name}
            onBlur={(e) => {
              setEditingTitle(false);
              const v = e.currentTarget.value.trim();
              if (v && v !== name) void api!.renameList(el.list_id, v);
            }}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold text-white/90 outline-none select-text"
          />
        ) : (
          <button
            data-no-drag={canEdit ? true : undefined}
            onClick={() => canEdit && setEditingTitle(true)}
            className="min-w-0 flex-1 truncate text-left text-[15px] font-semibold text-white/90"
          >
            {name}
          </button>
        )}
        <span className="shrink-0 text-xs text-white/40 tabular-nums">
          {done}/{total}
        </span>
      </div>

      {!list && !pub ? (
        <div className="px-3 pb-3 text-xs text-white/40">{labels.todoMissing}</div>
      ) : (
        <div className="px-2 pb-2 flex flex-col">
          {items
            ? items.map((item) => {
                const member = api!.members.find((m) => m.user_id === item.assignee_id);
                return (
                  <div key={item.id} className="group/todo flex items-start gap-2 rounded-lg px-1.5 py-1.5 hover:bg-white/[0.04]">
                    <button
                      data-no-drag
                      disabled={!canEdit}
                      onClick={() => void api!.patchItem(item, { done: !item.done })}
                      className={`mt-0.5 w-[18px] h-[18px] shrink-0 rounded-md border flex items-center justify-center transition-colors ${
                        item.done ? "bg-emerald-500 border-emerald-500 text-white" : "border-white/30 hover:border-white/60"
                      }`}
                    >
                      {item.done && (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                      )}
                    </button>
                    {canEdit && editingItem === item.id ? (
                      <MentionInput
                        members={api!.members}
                        initialText={item.text}
                        initialAssignee={item.assignee_id}
                        placeholder={labels.todoAddPlaceholder}
                        labels={labels}
                        autoFocus
                        submitOnBlur
                        onSubmit={(text, assigneeId) => {
                          setEditingItem(null);
                          if (text !== item.text || assigneeId !== item.assignee_id) void api!.patchItem(item, { text, assignee_id: assigneeId });
                        }}
                        onCancel={() => setEditingItem(null)}
                      />
                    ) : (
                      <div className="min-w-0 flex-1 flex flex-wrap items-center gap-1.5">
                        <span
                          data-no-drag={canEdit ? true : undefined}
                          onClick={() => canEdit && setEditingItem(item.id)}
                          className={`text-sm break-words ${item.done ? "line-through text-white/35" : "text-white/85"} ${canEdit ? "cursor-text" : ""}`}
                        >
                          {item.text}
                        </span>
                        {member && (
                          <Chip
                            name={displayName(member)}
                            id={member.user_id}
                            onRemove={canEdit ? () => void api!.patchItem(item, { assignee_id: null }) : undefined}
                            removeLabel={labels.todoUnassign}
                          />
                        )}
                      </div>
                    )}
                    {canEdit && editingItem !== item.id && (
                      <button
                        data-no-drag
                        onClick={() => void api!.deleteItem(item)}
                        title={labels.todoDelete}
                        aria-label={labels.todoDelete}
                        className="mt-0.5 w-5 h-5 shrink-0 rounded-md text-white/30 hover:text-white hover:bg-white/10 opacity-0 group-hover/todo:opacity-100 flex items-center justify-center"
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })
            : pub!.items.map((item) => (
                <div key={item.id} className="flex items-start gap-2 px-1.5 py-1.5">
                  <span className={`mt-0.5 w-[18px] h-[18px] shrink-0 rounded-md border flex items-center justify-center ${item.done ? "bg-emerald-500 border-emerald-500 text-white" : "border-white/30"}`}>
                    {item.done && (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                    )}
                  </span>
                  <span className={`text-sm break-words ${item.done ? "line-through text-white/35" : "text-white/85"}`}>
                    {item.text}
                    {item.assignee_name && <span className="ml-1.5 text-xs text-white/50">@{item.assignee_name}</span>}
                  </span>
                </div>
              ))}

          {canEdit && (
            <div className="flex items-start gap-2 rounded-lg px-1.5 py-1.5 mt-0.5 border-t border-white/5">
              <span className="mt-0.5 w-[18px] h-[18px] shrink-0 rounded-md border border-dashed border-white/20" />
              <MentionInput
                members={api!.members}
                placeholder={labels.todoAddPlaceholder}
                labels={labels}
                onSubmit={(text, assigneeId) => void api!.addItem(el.list_id, text, assigneeId)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
