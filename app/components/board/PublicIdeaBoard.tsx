"use client";

import { useEffect, useState } from "react";
import { IdeaBoard } from "./IdeaBoard";
import { BoardTodoContext } from "./BoardTodo";
import { publicIdeasPreviewApi } from "@/lib/publicIdeasPreviewApi";
import { useLanguage } from "@/lib/i18n";
import type { BoardData, PublicBoardTodoList } from "@/lib/board";

/** 2026-10-08, Lino: "Board nur ansehen" — the client preview shows an idea's
 * board read-only (pan/zoom, play media, open links), in place of the old
 * slideshow + text, for every idea that has a board. */
export function PublicIdeaBoard({ token, unlockToken, ideaId }: { token: string; unlockToken: string | null; ideaId: string }) {
  const { t } = useLanguage();
  const [data, setData] = useState<BoardData | null>(null);
  const [failed, setFailed] = useState(false);
  const [todoLists, setTodoLists] = useState<Record<string, PublicBoardTodoList>>({});

  useEffect(() => {
    let cancelled = false;
    publicIdeasPreviewApi
      .fetchIdeaBoard(token, unlockToken, ideaId)
      .then((res) => !cancelled && setData(res.data))
      .catch(() => !cancelled && setFailed(true));
    publicIdeasPreviewApi
      .fetchIdeaTodoLists(token, unlockToken, ideaId)
      .then((ls) => !cancelled && setTodoLists(Object.fromEntries(ls.map((l) => [l.id, l]))))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [token, unlockToken, ideaId]);

  if (!data) {
    return (
      <div className="absolute inset-0 flex items-center justify-center text-sm text-white/40 bg-[#161616]">
        {failed ? t("ideaBoard.loadFailed") : <span className="animate-pulse">…</span>}
      </div>
    );
  }
  return (
    <BoardTodoContext.Provider value={{ publicLists: todoLists }}>
      <IdeaBoard key={ideaId} className="absolute inset-0" initial={data} editable={false} />
    </BoardTodoContext.Provider>
  );
}
