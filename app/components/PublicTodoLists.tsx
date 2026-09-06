import { useLanguage } from "@/lib/i18n";
import type { TodoList, Member } from "@/lib/types";

/** Read-only todo-list cards for the public "Szenenpreview" page (#268) —
 * React counterpart to share_view.py's _todo_lists_html. Same "only show
 * lists that actually have items" rule as the Python version. */
export function PublicTodoLists({ todoLists, memberById }: { todoLists: TodoList[]; memberById: Map<string, Member> }) {
  const { t } = useLanguage();
  const lists = [...todoLists].filter((l) => l.items.length > 0).sort((a, b) => a.sort_order - b.sort_order);
  if (lists.length === 0) return null;

  return (
    <div className="rounded-2xl bg-[#212121] border border-white/[0.06] p-3.5">
      <div className="flex items-center gap-1.5 text-xs font-bold text-white/50 uppercase tracking-wide mb-2.5">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
        </svg>
        {t("todoLists.title")}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {lists.map((list) => {
          const items = [...list.items].sort((a, b) => a.sort_order - b.sort_order);
          const doneCount = items.filter((i) => i.done).length;
          return (
            <div key={list.id} className="rounded-xl bg-white/[0.03] p-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-semibold">{list.name}</span>
                <span className="text-[11px] font-semibold text-white/50 bg-white/10 rounded-full px-2 py-0.5">
                  {doneCount}/{items.length}
                </span>
              </div>
              <ul className="flex flex-col">
                {items.map((item) => {
                  const assignee = item.assignee_id ? memberById.get(item.assignee_id) : undefined;
                  return (
                    <li key={item.id} className="flex items-center gap-2 text-xs py-1 border-t border-white/[0.05] first:border-t-0">
                      <span
                        className={`w-3.5 h-3.5 rounded-full border shrink-0 flex items-center justify-center ${
                          item.done ? "border-emerald-500 bg-emerald-500" : "border-white/40"
                        }`}
                      >
                        {item.done && (
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                        )}
                      </span>
                      <span className={`flex-1 min-w-0 ${item.done ? "line-through text-white/40" : ""}`}>{item.text}</span>
                      {item.due_at && (
                        <span className="text-[10px] font-medium text-blue-400 bg-blue-500/10 rounded-full px-1.5 py-0.5 whitespace-nowrap">
                          {new Date(item.due_at).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" })}
                          {" · "}
                          {new Date(item.due_at).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      )}
                      {assignee && <span className="text-[11px] text-white/40 whitespace-nowrap">{assignee.name || assignee.email}</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
