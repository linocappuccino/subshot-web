"use client";

import { useState } from "react";
import { useApi } from "@/lib/useApi";
import { ApiError } from "@/lib/api";
import type { Member, TodoList } from "@/lib/types";
import { Avatar } from "./ui/Avatar";
import { Menu, MenuItem } from "./ui/Menu";
import { IconButton, Button } from "./ui/Button";
import { useToast } from "./ui/Toast";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { DateTimePicker } from "./ui/DateTimePicker";
import { useLanguage } from "@/lib/i18n";

export function TodoListsPanel({
  projectId,
  sectionId,
  sceneId,
  todoLists,
  members,
  onChange,
  noMargin,
}: {
  projectId: string;
  /** Old attached-to-section mechanism (2026-07-10: superseded by sceneId
   * below), kept only for any pre-existing section-owned lists. */
  sectionId?: string;
  /** When set, new lists are created scoped to this "Projektinfo" scene
   * tile's own todo section — see api.createSceneTodoList. */
  sceneId?: string;
  todoLists: TodoList[];
  members: Member[];
  onChange: (updater: (lists: TodoList[]) => TodoList[]) => void;
  /** Drops the outer bottom margin when nested inside ProjectInfoBox rather
   * than standing on its own as a top-level page section. */
  noMargin?: boolean;
}) {
  const api = useApi();
  const toast = useToast();
  const { t } = useLanguage();
  const [addingList, setAddingList] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ kind: "list" | "item"; id: string; parentId?: string } | null>(null);

  async function addList() {
    const name = newListName.trim();
    setAddingList(false);
    if (!name) return;
    try {
      const list = sceneId
        ? await api.createSceneTodoList(sceneId, name, todoLists.length)
        : sectionId
          ? await api.createSectionTodoList(sectionId, name, todoLists.length)
          : await api.createTodoList(projectId, name, todoLists.length);
      onChange((prev) => [...prev, list]);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("common.failed"));
    }
    setNewListName("");
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.kind === "list") {
        await api.deleteTodoList(deleteTarget.id);
        onChange((prev) => prev.filter((l) => l.id !== deleteTarget.id));
      } else {
        await api.deleteTodoItem(deleteTarget.id);
        onChange((prev) =>
          prev.map((l) => (l.id === deleteTarget.parentId ? { ...l, items: l.items.filter((i) => i.id !== deleteTarget.id) } : l))
        );
      }
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("common.failed"));
    } finally {
      setDeleteTarget(null);
    }
  }

  return (
    <div className={noMargin ? "" : "mb-10"}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wide">{t("todoLists.title")}</h2>
        {!addingList && (
          <button onClick={() => setAddingList(true)} className="text-xs font-semibold text-blue-400 hover:text-blue-300">
            {t("todoLists.addList")}
          </button>
        )}
      </div>

      {(todoLists.length > 0 || addingList) && (
        // 2026-07-21, Lino: "drückt man + Liste wird die erste Todoliste
        // links platziert, richtig, drückt man nochmals + Liste soll das
        // eingabefeld für den name der Liste Rechts neben der Ersten liste
        // erscheinen... drückt man nochmals erscheint das eingabefeld rechts
        // neben der 2. Liste" — war eine eigene volle Zeile ÜBER dem Grid,
        // jetzt ein normales Grid-Item NACH den bestehenden Listen, damit es
        // im CSS-Grid-Flow natürlich rechts neben der zuletzt erstellten
        // Liste landet (bzw. in die nächste Zeile umbricht, sobald die Reihe
        // voll ist) statt immer fix oben-links zu stehen.
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {todoLists.map((list) => (
              <TodoListCard
                key={list.id}
                list={list}
                members={members}
                onChange={onChange}
                onDeleteList={() => setDeleteTarget({ kind: "list", id: list.id })}
                onDeleteItem={(itemId) => setDeleteTarget({ kind: "item", id: itemId, parentId: list.id })}
              />
          ))}
          {addingList && (
            <div className="bg-white/[0.045] border border-white/8 rounded-2xl p-4 flex flex-col gap-2">
              <input
                autoFocus
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addList()}
                onBlur={() => !newListName.trim() && setAddingList(false)}
                placeholder={t("todoLists.listNamePlaceholder")}
                className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              />
              <Button size="sm" variant="primary" onClick={addList}>
                {t("todoLists.create")}
              </Button>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={deleteTarget?.kind === "list" ? t("todoLists.deleteListTitle") : t("todoLists.deleteItemTitle")}
        message={t("todoLists.deleteMessage")}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function TodoListCard({
  list,
  members,
  onChange,
  onDeleteList,
  onDeleteItem,
}: {
  list: TodoList;
  members: Member[];
  onChange: (updater: (lists: TodoList[]) => TodoList[]) => void;
  onDeleteList: () => void;
  onDeleteItem: (itemId: string) => void;
}) {
  const api = useApi();
  const toast = useToast();
  const { t } = useLanguage();
  const [addingItem, setAddingItem] = useState(false);
  const [newItemText, setNewItemText] = useState("");
  // 2026-07-22, Lino: "todolisten... müssen mit rein klicken bearbeitbar
  // sein auch der titel der liste muss mit reinklicken änderbar sein" —
  // click straight into the text (list title or an item's own text) to
  // edit it, same optimistic-update-then-persist/revert-on-failure shape
  // as toggleItem/assignItem above, mirrors VideoTile.tsx's inline-rename
  // blur/Enter/Escape handling.
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(list.name);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [itemTextDraft, setItemTextDraft] = useState("");

  const items = [...list.items].sort((a, b) => a.sort_order - b.sort_order);
  const doneCount = items.filter((i) => i.done).length;

  async function renameList(name: string) {
    onChange((lists) => lists.map((l) => (l.id === list.id ? { ...l, name } : l)));
    try {
      await api.patchTodoList(list.id, { name });
    } catch (e) {
      onChange((lists) => lists.map((l) => (l.id === list.id ? { ...l, name: list.name } : l)));
      toast.showError(e instanceof ApiError ? e.message : t("common.failed"));
    }
  }

  async function renameItem(itemId: string, text: string) {
    const original = items.find((i) => i.id === itemId)?.text;
    onChange((lists) =>
      lists.map((l) => (l.id === list.id ? { ...l, items: l.items.map((i) => (i.id === itemId ? { ...i, text } : i)) } : l))
    );
    try {
      await api.patchTodoItem(itemId, { text });
    } catch (e) {
      onChange((lists) =>
        lists.map((l) => (l.id === list.id ? { ...l, items: l.items.map((i) => (i.id === itemId ? { ...i, text: original ?? i.text } : i)) } : l))
      );
      toast.showError(e instanceof ApiError ? e.message : t("common.failed"));
    }
  }

  async function toggleItem(itemId: string, done: boolean) {
    onChange((lists) =>
      lists.map((l) => (l.id === list.id ? { ...l, items: l.items.map((i) => (i.id === itemId ? { ...i, done: !done } : i)) } : l))
    );
    try {
      await api.patchTodoItem(itemId, { done: !done });
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("common.failed"));
    }
  }

  async function assignItem(itemId: string, userId: string | null) {
    onChange((lists) =>
      lists.map((l) => (l.id === list.id ? { ...l, items: l.items.map((i) => (i.id === itemId ? { ...i, assignee_id: userId } : i)) } : l))
    );
    try {
      await api.patchTodoItem(itemId, { assignee_id: userId });
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("common.failed"));
    }
  }

  // 2026-07-22, Lino: "neben dem user hinzufügen symbol noch ein kleines
  // uhr symbol... so kann man einzelne todos auch timen" — same
  // optimistic-update-then-persist shape as assignItem above, one field
  // over (due_at instead of assignee_id).
  async function setItemDueDate(itemId: string, dueAt: Date | null) {
    const iso = dueAt ? dueAt.toISOString() : null;
    onChange((lists) =>
      lists.map((l) => (l.id === list.id ? { ...l, items: l.items.map((i) => (i.id === itemId ? { ...i, due_at: iso } : i)) } : l))
    );
    try {
      await api.patchTodoItem(itemId, { due_at: iso });
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("common.failed"));
    }
  }

  async function addItem() {
    const text = newItemText.trim();
    setAddingItem(false);
    if (!text) return;
    try {
      const item = await api.createTodoItem(list.id, text, undefined, items.length);
      onChange((lists) => lists.map((l) => (l.id === list.id ? { ...l, items: [...l.items, item] } : l)));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("common.failed"));
    }
    setNewItemText("");
  }

  return (
    <div className="bg-white/[0.045] border border-white/8 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-2.5 gap-2">
        {isEditingTitle ? (
          <input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => {
              const trimmed = titleDraft.trim();
              if (trimmed && trimmed !== list.name) renameList(trimmed);
              else setTitleDraft(list.name);
              setIsEditingTitle(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setTitleDraft(list.name);
                setIsEditingTitle(false);
              }
            }}
            className="font-semibold text-sm bg-white/10 rounded px-1.5 py-0.5 -mx-1.5 min-w-0 flex-1 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
          />
        ) : (
          <h3
            onClick={() => {
              setTitleDraft(list.name);
              setIsEditingTitle(true);
            }}
            className="font-semibold text-sm cursor-text truncate rounded px-1.5 py-0.5 -mx-1.5 hover:bg-white/5 transition-colors"
          >
            {list.name}
          </h3>
        )}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] font-semibold text-white/40 bg-white/8 px-2 py-0.5 rounded-full">
            {doneCount}/{items.length}
          </span>
          <Menu
            trigger={
              <IconButton size={26}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="5" cy="12" r="1.6" />
                  <circle cx="12" cy="12" r="1.6" />
                  <circle cx="19" cy="12" r="1.6" />
                </svg>
              </IconButton>
            }
          >
            {(close) => (
              <MenuItem
                danger
                onClick={() => {
                  onDeleteList();
                  close();
                }}
              >
                {t("todoLists.deleteList")}
              </MenuItem>
            )}
          </Menu>
        </div>
      </div>

      <div className="space-y-1">
          {items.map((item) => {
            const assignee = members.find((m) => m.user_id === item.assignee_id);
            return (
              <div
                key={item.id}
                className="flex items-start gap-2 group py-1 border-t border-white/5 first:border-t-0"
              >
                <button onClick={() => toggleItem(item.id, item.done)} className="shrink-0 mt-0.5">
                  <span
                    className="w-4 h-4 rounded-full border-[1.5px] flex items-center justify-center transition-colors"
                    style={{
                      borderColor: item.done ? "#4caf6d" : "rgba(255,255,255,0.3)",
                      backgroundColor: item.done ? "#4caf6d" : "transparent",
                    }}
                  >
                    {item.done && (
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                  </span>
                </button>
                {editingItemId === item.id ? (
                  <input
                    autoFocus
                    value={itemTextDraft}
                    onChange={(e) => setItemTextDraft(e.target.value)}
                    onBlur={() => {
                      const trimmed = itemTextDraft.trim();
                      if (trimmed && trimmed !== item.text) renameItem(item.id, trimmed);
                      setEditingItemId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setEditingItemId(null);
                    }}
                    className="text-sm flex-1 min-w-0 bg-white/10 rounded px-1 py-0.5 -mx-1 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                  />
                ) : (
                  // 2026-07-22, Lino: "todos einträge sollen auch mehrere
                  // zeilen anzeigen können" — was `truncate` (single-line
                  // ellipsis, silently cut off anything longer), now wraps
                  // normally across as many lines as the text needs.
                  <span
                    onClick={() => {
                      setItemTextDraft(item.text);
                      setEditingItemId(item.id);
                    }}
                    className={`text-sm flex-1 min-w-0 whitespace-normal break-words cursor-text rounded px-1 py-0.5 -mx-1 hover:bg-white/5 transition-colors ${item.done ? "line-through text-white/35" : "text-white/80"}`}
                  >
                    {item.text}
                  </span>
                )}
                <div className="flex items-center gap-2 shrink-0 mt-0.5">
                {item.due_at && (
                  <span className="text-[10px] font-medium text-blue-400 bg-blue-500/10 rounded-full px-1.5 py-0.5 shrink-0 whitespace-nowrap">
                    {new Date(item.due_at).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" })}
                    {" · "}
                    {new Date(item.due_at).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
                <DateTimePicker
                  compact
                  value={item.due_at ? new Date(item.due_at) : null}
                  onChange={(d) => setItemDueDate(item.id, d)}
                  placeholder={t("todoLists.setDueDate")}
                />
                {item.due_at && (
                  <button
                    onClick={() => setItemDueDate(item.id, null)}
                    aria-label={t("todoLists.removeDueDate")}
                    className="text-white/25 hover:text-red-400 transition-colors shrink-0 -ml-1"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                )}
                <Menu
                  align="end"
                  trigger={
                    assignee ? (
                      <Avatar name={assignee.name} email={assignee.email} avatarUrl={assignee.avatar_url} size={20} className="cursor-pointer" />
                    ) : (
                      <button className="text-white/25 hover:text-white/60 transition-colors shrink-0" title={t("todoLists.assignAria")}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                          <circle cx="12" cy="8" r="4" />
                          <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
                        </svg>
                      </button>
                    )
                  }
                >
                  {(close) => (
                    <>
                      {assignee && (
                        <MenuItem
                          onClick={() => {
                            assignItem(item.id, null);
                            close();
                          }}
                        >
                          {t("todoLists.unassigned")}
                        </MenuItem>
                      )}
                      {members.map((m) => (
                        <MenuItem
                          key={m.user_id}
                          onClick={() => {
                            assignItem(item.id, m.user_id);
                            close();
                          }}
                        >
                          {m.name || m.email}
                        </MenuItem>
                      ))}
                    </>
                  )}
                </Menu>
                <button
                  onClick={() => onDeleteItem(item.id)}
                  className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-red-400 transition-opacity shrink-0"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
                </div>
              </div>
            );
          })}
      </div>

      {addingItem ? (
        <input
          autoFocus
          value={newItemText}
          onChange={(e) => setNewItemText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addItem()}
          onBlur={addItem}
          placeholder={t("todoLists.newItemPlaceholder")}
          className="bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-sm w-full mt-2 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
        />
      ) : (
        <button onClick={() => setAddingItem(true)} className="text-xs font-semibold text-blue-400 hover:text-blue-300 mt-2">
          {t("todoLists.addItem")}
        </button>
      )}
    </div>
  );
}
