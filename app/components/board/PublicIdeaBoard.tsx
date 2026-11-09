"use client";

import { useEffect, useState } from "react";
import { IdeaBoard, type BoardPin, type BoardPinAnchor } from "./IdeaBoard";
import { type BoardVote } from "@/lib/board";
import { useBoardCollab } from "@/lib/collab";
import { BoardTodoContext } from "./BoardTodo";
import { publicIdeasPreviewApi } from "@/lib/publicIdeasPreviewApi";
import { useLanguage } from "@/lib/i18n";
import type { BoardData, PublicBoardTodoList } from "@/lib/board";

/** 2026-10-08, Lino: "Board nur ansehen" — the client preview shows an idea's
 * board read-only (pan/zoom, play media, open links), in place of the old
 * slideshow + text, for every idea that has a board. */
export function PublicIdeaBoard({
  token,
  unlockToken,
  ideaId,
  pins,
  onPinClick,
  pinPlacing,
  onPlacePin,
  pendingPin,
  focusRequest,
  voterName = "",
  onNeedName,
  onVoteError,
}: {
  /** 2026-10-08 — 👍🏼 votes are cast under the visitor's feedback name */
  voterName?: string;
  /** no name yet: ask for it, then `retry(name)` casts the vote (2026-11-09) */
  onNeedName?: (retry: (name: string) => void) => void;
  onVoteError?: (message: string) => void;
  token: string;
  unlockToken: string | null;
  ideaId: string;
  /** 2026-10-08 — Feedback-Pins (see PublicIdeaLightbox) */
  pins?: BoardPin[];
  onPinClick?: (id: string) => void;
  pinPlacing?: boolean;
  onPlacePin?: (anchor: BoardPinAnchor) => void;
  pendingPin?: (BoardPinAnchor & { color?: string }) | null;
  focusRequest?: { elementId: string; nonce: number } | null;
}) {
  const { t } = useLanguage();
  const [data, setData] = useState<BoardData | null>(null);
  const [failed, setFailed] = useState(false);
  const [todoLists, setTodoLists] = useState<Record<string, PublicBoardTodoList>>({});
  const [votes, setVotes] = useState<BoardVote[]>([]);
  // 2026-10-08 — the client watches the board live (read-only)
  const collab = useBoardCollab({
    enabled: !!data,
    docKey: ideaId,
    initial: data,
    getSession: () => publicIdeasPreviewApi.boardCollab(token, unlockToken, ideaId),
    presign: (keys) => publicIdeasPreviewApi.boardPresign(token, unlockToken, ideaId, keys),
  });

  // the visitor's own votes come back as voter_key "me" (no names on share links, 2026-11-09);
  // re-read shortly after the name changes so the own 👍🏼 highlight follows it
  const nameForVotes = voterName.trim();
  useEffect(() => {
    let cancelled = false;
    const id = window.setTimeout(() => {
      publicIdeasPreviewApi
        .fetchBoardVotes(token, unlockToken, ideaId, nameForVotes)
        .then((r) => !cancelled && setVotes(r.votes))
        .catch(() => {});
    }, nameForVotes ? 500 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [token, unlockToken, ideaId, nameForVotes]);

  function vote(groupId: string, elementId: string, nameOverride?: string) {
    const name = (nameOverride ?? voterName).trim();
    // 2026-11-09, Lino: "der Vote-Button auf der Preview-Seite geht nicht" — without a name nothing
    // visible happened (the name field + hint sit in the closed comments panel); now the page asks
    if (!name) return onNeedName?.((n) => vote(groupId, elementId, n));
    publicIdeasPreviewApi
      .toggleBoardVote(token, unlockToken, ideaId, groupId, elementId, name)
      .then((r) => setVotes(r.votes))
      .catch((e) => onVoteError?.(e instanceof Error ? e.message : "…"));
  }

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
      <IdeaBoard
        key={ideaId}
        className="absolute inset-0"
        initial={data}
        editable={false}
        pins={pins}
        onPinClick={onPinClick}
        pinPlacing={pinPlacing}
        onPlacePin={onPlacePin}
        pendingPin={pendingPin}
        focusRequest={focusRequest}
        externalData={collab.remote}
        // 2026-10-09, Lino: clients can't download anything from the board —
        // no downloadFile here = no download buttons, no "open file" links,
        // no save-image / video-download menus (see BoardDownloadContext)
        // 2026-10-09, Lino: no presentation mode on the client page
        allowPresentation={false}
        votes={votes}
        myVoterKey={voterName.trim() ? "me" : null}
        onVote={vote}
      />
    </BoardTodoContext.Provider>
  );
}
