"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useApi } from "@/lib/useApi";
import { ApiError } from "@/lib/api";
import type { Member, TodoList } from "@/lib/types";
import { Avatar } from "./ui/Avatar";
import { Menu, MenuItem } from "./ui/Menu";
import { IconButton, Button } from "./ui/Button";
import { useToast } from "./ui/Toast";
import { ConfirmDialog } from "./ui/ConfirmDialog";

export function TodoListsPanel({
  projectId,
  todoLists,
  members,
  onChange,
  noMargin,
}: {
  projectId: string;
  todoLists: TodoList[];
  members: Member[];
  onChange: (updater: (lists: TodoList[]) => TodoList[]) => void;
  /** Drops the outer bottom margin when nested inside ProjectInfoBox rather
   * than standing on its own as a top-level page section. */
  noMargin?: boolean;
}) {
  const api = useApi();
  const toast = useToast();
  const [addingList, setAddingList] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ kind: "list" | "item"; id: string; parentId?: string } | null>(null);

  async function addList() {
    const name = newListName.trim();
    setAddingList(false);
    if (!name) return;
    try {
      const list = await api.createTodoList(projectId, name, todoLists.length);
      onChange((prev) => [...prev, list]);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Fehlgeschlagen.");
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
      toast.showError(e instanceof ApiError ? e.message : "Löschen fehlgeschlagen.");
    } finally {
      setDeleteTarget(null);
    }
  }

  return (
    <div className={noMargin ? "" : "mb-10"}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wide">Todo-Listen</h2>
        {!addingList && (
          <button onClick={() => setAddingList(true)} className="text-xs font-semibold text-blue-400 hover:text-blue-300">
            + Liste
          </button>
        )}
      </div>

      {addingList && (
        <div className="flex gap-2 mb-3 max-w-sm">
          <input
            autoFocus
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addList()}
            placeholder="Listenname"
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          />
          <Button size="sm" variant="primary" onClick={addList}>
            Anlegen
          </Button>
        </div>
      )}

      {todoLists.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          <AnimatePresence mode="popLayout">
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
          </AnimatePresence>
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={deleteTarget?.kind === "list" ? "Liste löschen?" : "Eintrag löschen?"}
        message="Das kann nicht rückgängig gemacht werden."
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
  const [addingItem, setAddingItem] = useState(false);
  const [newItemText, setNewItemText] = useState("");

  const items = [...list.items].sort((a, b) => a.sort_order - b.sort_order);
  const doneCount = items.filter((i) => i.done).length;

  async function toggleItem(itemId: string, done: boolean) {
    onChange((lists) =>
      lists.map((l) => (l.id === list.id ? { ...l, items: l.items.map((i) => (i.id === itemId ? { ...i, done: !done } : i)) } : l))
    );
    try {
      await api.patchTodoItem(itemId, { done: !done });
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Fehlgeschlagen.");
    }
  }

  async function assignItem(itemId: string, userId: string | null) {
    onChange((lists) =>
      lists.map((l) => (l.id === list.id ? { ...l, items: l.items.map((i) => (i.id === itemId ? { ...i, assignee_id: userId } : i)) } : l))
    );
    try {
      await api.patchTodoItem(itemId, { assignee_id: userId });
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Fehlgeschlagen.");
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
      toast.showError(e instanceof ApiError ? e.message : "Fehlgeschlagen.");
    }
    setNewItemText("");
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="bg-white/[0.045] border border-white/8 rounded-2xl p-4"
    >
      <div className="flex items-center justify-between mb-2.5">
        <h3 className="font-semibold text-sm">{list.name}</h3>
        <div className="flex items-center gap-2">
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
                Liste löschen
              </MenuItem>
            )}
          </Menu>
        </div>
      </div>

      <div className="space-y-1">
        <AnimatePresence initial={false}>
          {items.map((item) => {
            const assignee = members.find((m) => m.user_id === item.assignee_id);
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-center gap-2 group py-1 border-t border-white/5 first:border-t-0"
              >
                <button onClick={() => toggleItem(item.id, item.done)} className="shrink-0">
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
                <span className={`text-sm flex-1 min-w-0 truncate ${item.done ? "line-through text-white/35" : "text-white/80"}`}>
                  {item.text}
                </span>
                <Menu
                  align="end"
                  trigger={
                    assignee ? (
                      <Avatar name={assignee.name} email={assignee.email} avatarUrl={assignee.avatar_url} size={20} className="cursor-pointer" />
                    ) : (
                      <button className="text-white/25 hover:text-white/60 transition-colors shrink-0" title="Zuweisen">
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
                          Niemand zugewiesen
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
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {addingItem ? (
        <input
          autoFocus
          value={newItemText}
          onChange={(e) => setNewItemText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addItem()}
          onBlur={addItem}
          placeholder="Neuer Eintrag"
          className="bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-sm w-full mt-2 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
        />
      ) : (
        <button onClick={() => setAddingItem(true)} className="text-xs font-semibold text-blue-400 hover:text-blue-300 mt-2">
          + Eintrag
        </button>
      )}
    </motion.div>
  );
}
