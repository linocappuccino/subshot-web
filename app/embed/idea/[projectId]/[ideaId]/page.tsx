"use client";

import { use, useEffect, useState } from "react";
import { IdeaFocusView } from "@/app/components/IdeaFocusView";
import { useApi } from "@/lib/useApi";
import type { Idea, Member } from "@/lib/types";
import { boardImageConfig } from "@/lib/board";

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
  // 2026-11-01 (iOS «out of memory»): the iPhone's 3× screen made every card ask for the 2048-px image — in the app
  // the board plans for at most 2× (looks the same on a phone); after a crash the app reloads with ?lite=1
  // (Speichersparmodus): only the ≤1000-px R2 thumbs, 1×. Originals stay untouched for downloads.
  // 2026-11-01, 2nd round (crash stayed): the app's board is ALWAYS in saving mode now — images planned for 1×
  // (≤1000-px R2 thumb at normal zoom, mid only when zoomed in), and no backdrop-filter blur (below): on iOS the
  // frosted group frame of the Apfelkiste board (2308×2318 board px) became one huge CoreAnimation backdrop layer.
  const [lite] = useState(() => {
    const on = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("lite") === "1";
    boardImageConfig.densityCap = 1;
    boardImageConfig.thumbOnly = on;
    boardImageConfig.cull = true; // only nodes in / near the visible area are rendered
    return on;
  });
  const [liteNote, setLiteNote] = useState(lite);
  useEffect(() => {
    document.documentElement.classList.add("embed-lite");
    return () => document.documentElement.classList.remove("embed-lite");
  }, []);

  // the page itself never scrolls — iOS scrolled the whole web view when a text field on the board
  // got focus, which pushed the idea header out of sight
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prev = [html.style.overflow, body.style.overflow, body.style.position, body.style.inset, html.style.overscrollBehavior];
    html.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.inset = "0";
    const keepTop = () => {
      if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
    };
    window.addEventListener("scroll", keepTop, { passive: true });
    window.visualViewport?.addEventListener("resize", keepTop);
    return () => {
      [html.style.overflow, body.style.overflow, body.style.position, body.style.inset, html.style.overscrollBehavior] = prev;
      window.removeEventListener("scroll", keepTop);
      window.visualViewport?.removeEventListener("resize", keepTop);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([api.listIdeas(projectId), api.members(projectId), api.me()])
      .then(([list, members, me]) => {
        if (!alive) return;
        setIdeas(list);
        setIndex(Math.max(0, list.findIndex((i) => i.id === ideaId)));
        setMyRole(members.find((m) => m.user_id === me.id)?.role ?? null);
        // the app hides its loading spinner now (the auth page got here by a client-side redirect,
        // so the web view never saw a page load finish on this URL)
        tellApp({ type: "ready" });
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
    <div className="fixed inset-0 bg-[#161616]">
      {/* (the idea window renders through a portal into <body> — the class sits on <html>, see the effect above).
          No transitions inside board nodes: a tap sets :hover on iOS, the fading download button / connector dots
          became animated layers and pulled the whole board into one giant composited layer (WebKit: 530 → 1120 MB). */}
      <style>{`.embed-lite *{-webkit-backdrop-filter:none!important;backdrop-filter:none!important}.embed-lite [data-group-body]{background:rgba(28,28,30,0.88)!important}.embed-lite [data-el-id] *{transition:none!important}`}</style>
      {liteNote && (
        <button
          onClick={() => setLiteNote(false)}
          className="absolute left-1/2 top-14 z-[90] -translate-x-1/2 whitespace-nowrap rounded-full bg-amber-500/90 px-3 py-1.5 text-[12px] font-semibold text-black shadow-lg"
        >
          Dieses Board ist gross – Speichersparmodus aktiv ✕
        </button>
      )}
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
