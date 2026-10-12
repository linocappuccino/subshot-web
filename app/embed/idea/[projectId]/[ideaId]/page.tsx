"use client";

import { use, useEffect, useState } from "react";
import { IdeaFocusView } from "@/app/components/IdeaFocusView";
import { useApi } from "@/lib/useApi";
import type { Idea, Member } from "@/lib/types";

// 2026-10-12 — the idea board for the iOS app's embedded web view (Lino chose "Web-Board
// eingebettet"): just the idea window (IdeaFocusView: title, status, Fassungen, feedback, board,
// live collaboration) full screen. Closing / leaving tells the app via the "subshot" message handler.

type IOSBridge = { webkit?: { messageHandlers?: { subshot?: { postMessage: (m: unknown) => void } } } };
const tellApp = (message: Record<string, unknown>) => (window as unknown as IOSBridge).webkit?.messageHandlers?.subshot?.postMessage(message);

export default function EmbedIdeaPage({ params }: { params: Promise<{ projectId: string; ideaId: string }> }) {
  const { projectId, ideaId } = use(params);
  const api = useApi();
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [index, setIndex] = useState(0);
  const [myRole, setMyRole] = useState<Member["role"] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([api.listIdeas(projectId), api.members(projectId), api.me()])
      .then(([list, members, me]) => {
        if (!alive) return;
        setIdeas(list);
        setIndex(Math.max(0, list.findIndex((i) => i.id === ideaId)));
        setMyRole(members.find((m) => m.user_id === me.id)?.role ?? null);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [api, projectId, ideaId]);

  if (failed) return <div className="flex min-h-screen items-center justify-center bg-[#161616] text-sm text-white/50">Idee konnte nicht geladen werden.</div>;
  if (!ideas) return <div className="flex min-h-screen items-center justify-center bg-[#161616] text-sm text-white/40 animate-pulse">…</div>;
  if (ideas.length === 0) {
    tellApp({ type: "close" });
    return null;
  }
  return (
    <div className="min-h-screen bg-[#161616]">
      <IdeaFocusView
        ideas={ideas}
        index={Math.min(index, ideas.length - 1)}
        autoFocusTitleId={null}
        onIndexChange={setIndex}
        onCreateNext={() => {}}
        onUpdated={(idea) => {
          setIdeas((all) => (all ? all.map((x) => (x.id === idea.id ? idea : x)) : all));
          tellApp({ type: "updated", id: idea.id });
        }}
        onDeleted={(id) => {
          setIdeas((all) => (all ? all.filter((x) => x.id !== id) : all));
          tellApp({ type: "deleted", id });
        }}
        onSilentlyRemoved={(id) => setIdeas((all) => (all ? all.filter((x) => x.id !== id) : all))}
        onClose={() => tellApp({ type: "close" })}
        myRole={myRole}
      />
    </div>
  );
}
