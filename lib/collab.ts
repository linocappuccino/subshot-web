"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import type { BoardData, BoardElement, Connector } from "./board";

/** 2026-10-08, Lino: live collaboration on the idea board ("direkte
 * Zusammenarbeit — jede Änderung live mitverfolgen").
 *
 * The board is mirrored into a Yjs document on the Subshot collab server
 * (Hocuspocus, /opt/subshot-collab, wss://subshot.ch/collab):
 *   Y.Map "elements"   id -> element (plain JSON, no presigned URLs)
 *   Y.Map "connectors" id -> connector
 *   Y.Map "meta"       "cover" -> element id | null
 * One element is one map entry, so two people editing different nodes never
 * conflict; the same node edited at once: the later change wins.
 *
 * The board component stays the editor: every committed change goes through
 * `pushLocal` (diffed per element into the Y doc, origin LOCAL), every change
 * from someone else (or from undo/redo) comes back as `remote` — a full
 * BoardData with presigned URLs filled in. Undo/redo use a Y.UndoManager that
 * only tracks LOCAL changes, so undo never takes back someone else's work.
 * Cursors and selections travel through Hocuspocus awareness. The server
 * stores the document through the Subshot API (debounced), so the REST save
 * is switched off while live. If no live connection comes up within 10 s the
 * hook reports "off" and the caller keeps saving the old way. */

const LOCAL = Symbol("local");
const PEER_COLORS = ["#f43f5e", "#f59e0b", "#10b981", "#3b82f6", "#a855f7", "#ec4899", "#14b8a6", "#f97316"];

export type CollabStatus = "connecting" | "live" | "offline" | "off";
export type CollabSession = { token: string; url: string; document: string; readonly: boolean; name: string; uid: string };
export type CollabPeer = { clientId: number; name: string; color: string; cursor: { x: number; y: number } | null; selection: string[] };

export function peerColor(uid: string): string {
  let h = 0;
  for (const ch of uid) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PEER_COLORS[h % PEER_COLORS.length];
}

/** an element as stored in the shared doc: no presigned URLs */
function plain(el: BoardElement): BoardElement {
  const copy = { ...el } as Record<string, unknown>;
  delete copy.src;
  delete copy.image_src;
  delete copy.thumb_src;
  delete copy.image_thumb_src;
  if (el.type === "moodboard") copy.items = el.items.map(({ src: _s, thumb_src: _t, ...it }) => it);
  return copy as unknown as BoardElement;
}

function keysOf(el: BoardElement): string[] {
  const out: string[] = [];
  const r = el as unknown as Record<string, unknown>;
  if (typeof r.asset_key === "string") out.push(r.asset_key);
  if (typeof r.image_key === "string") out.push(r.image_key);
  if (el.type === "moodboard") for (const it of el.items) out.push(it.asset_key);
  return out;
}

export function useBoardCollab({
  enabled,
  docKey,
  initial,
  getSession,
  presign,
}: {
  enabled: boolean;
  /** which board (idea id) — a new one reconnects */
  docKey: string;
  /** the board as loaded over REST (with URLs) — seeds the URL cache */
  initial: BoardData | null;
  getSession: () => Promise<CollabSession>;
  presign: (keys: string[]) => Promise<{ urls: Record<string, string>; thumbs?: Record<string, string> }>;
}) {
  const [status, setStatus] = useState<CollabStatus>(enabled ? "connecting" : "off");
  const [remote, setRemote] = useState<{ data: BoardData; nonce: number } | null>(null);
  const [peers, setPeers] = useState<CollabPeer[]>([]);
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const [readonly, setReadonly] = useState(false);

  const docRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<HocuspocusProvider | null>(null);
  const undoRef = useRef<Y.UndoManager | null>(null);
  const syncedRef = useRef(false);
  const pendingLocal = useRef<BoardData | null>(null);
  const lastJson = useRef(new Map<string, string>()); // "e:<id>" / "c:<id>" -> JSON in the doc
  const urls = useRef(new Map<string, string>());
  const thumbs = useRef(new Map<string, string>());
  const asked = useRef(new Set<string>());
  const presignRef = useRef(presign);
  presignRef.current = presign;
  const getSessionRef = useRef(getSession);
  getSessionRef.current = getSession;

  // seed the URL cache from what the REST load already presigned
  useEffect(() => {
    if (!initial) return;
    for (const el of initial.elements) {
      const r = el as unknown as Record<string, unknown>;
      if (typeof r.asset_key === "string" && typeof r.src === "string") urls.current.set(r.asset_key, r.src);
      if (typeof r.image_key === "string" && typeof r.image_src === "string") urls.current.set(r.image_key, r.image_src);
      if (typeof r.asset_key === "string" && typeof r.thumb_src === "string") thumbs.current.set(r.asset_key, r.thumb_src);
      if (typeof r.image_key === "string" && typeof r.image_thumb_src === "string") thumbs.current.set(r.image_key, r.image_thumb_src);
      if (el.type === "moodboard")
        for (const it of el.items) {
          if (it.src) urls.current.set(it.asset_key, it.src);
          if (it.thumb_src) thumbs.current.set(it.asset_key, it.thumb_src);
        }
    }
  }, [initial]);

  const hydrate = useCallback((el: BoardElement): BoardElement => {
    const r = { ...el } as Record<string, unknown>;
    if (typeof r.asset_key === "string") {
      r.src = urls.current.get(r.asset_key) ?? null;
      r.thumb_src = thumbs.current.get(r.asset_key) ?? null;
    }
    if (typeof r.image_key === "string") {
      r.image_src = urls.current.get(r.image_key) ?? null;
      r.image_thumb_src = thumbs.current.get(r.image_key) ?? null;
    }
    if (el.type === "moodboard") r.items = el.items.map((it) => ({ ...it, src: urls.current.get(it.asset_key) ?? null, thumb_src: thumbs.current.get(it.asset_key) ?? null }));
    return r as unknown as BoardElement;
  }, []);

  const emit = useCallback(() => {
    const doc = docRef.current;
    if (!doc) return;
    const els = [...(doc.getMap("elements").values() as IterableIterator<BoardElement>)].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
    const cons = [...(doc.getMap("connectors").values() as IterableIterator<Connector>)];
    const json = new Map<string, string>();
    for (const el of els) json.set(`e:${el.id}`, JSON.stringify(el));
    for (const c of cons) json.set(`c:${c.id}`, JSON.stringify(c));
    lastJson.current = json;
    // files someone else just added: fetch their URLs, then show again
    const missing = els.flatMap(keysOf).filter((k) => !urls.current.has(k) && !asked.current.has(k));
    if (missing.length) {
      missing.forEach((k) => asked.current.add(k));
      presignRef
        .current(missing)
        .then((res) => {
          for (const [k, v] of Object.entries(res.urls)) urls.current.set(k, v);
          for (const [k, v] of Object.entries(res.thumbs ?? {})) thumbs.current.set(k, v);
          emitSoon();
        })
        .catch(() => missing.forEach((k) => asked.current.delete(k)));
    }
    setRemote({ data: { elements: els.map(hydrate), connectors: cons, cover: (doc.getMap("meta").get("cover") as string | null) ?? null }, nonce: Date.now() + Math.random() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrate]);

  const emitTimer = useRef<number | null>(null);
  const emitSoon = useCallback(() => {
    if (emitTimer.current != null) return;
    emitTimer.current = requestAnimationFrame(() => {
      emitTimer.current = null;
      emit();
    });
  }, [emit]);

  /** write the board's committed state into the shared doc (only what changed) */
  const writeDiff = useCallback((data: BoardData) => {
    const doc = docRef.current;
    if (!doc) return;
    for (const el of data.elements) {
      for (const k of keysOf(el)) {
        const r = el as unknown as Record<string, unknown>;
        const src = (r.asset_key === k ? r.src : r.image_key === k ? r.image_src : undefined) as string | undefined;
        if (src) urls.current.set(k, src);
      }
      if (el.type === "moodboard") for (const it of el.items) if (it.src) urls.current.set(it.asset_key, it.src);
    }
    doc.transact(() => {
      const elMap = doc.getMap("elements");
      const conMap = doc.getMap("connectors");
      const seenE = new Set<string>();
      for (const el of data.elements) {
        seenE.add(el.id);
        const p = plain(el);
        const j = JSON.stringify(p);
        if (lastJson.current.get(`e:${el.id}`) !== j) {
          elMap.set(el.id, p);
          lastJson.current.set(`e:${el.id}`, j);
        }
      }
      for (const id of [...elMap.keys()]) if (!seenE.has(id)) {
        elMap.delete(id);
        lastJson.current.delete(`e:${id}`);
      }
      const seenC = new Set<string>();
      for (const c of data.connectors) {
        seenC.add(c.id);
        const j = JSON.stringify(c);
        if (lastJson.current.get(`c:${c.id}`) !== j) {
          conMap.set(c.id, c);
          lastJson.current.set(`c:${c.id}`, j);
        }
      }
      for (const id of [...conMap.keys()]) if (!seenC.has(id)) {
        conMap.delete(id);
        lastJson.current.delete(`c:${id}`);
      }
      const meta = doc.getMap("meta");
      if ((meta.get("cover") ?? null) !== (data.cover ?? null)) meta.set("cover", data.cover ?? null);
    }, LOCAL);
  }, []);

  const pushLocal = useCallback(
    (data: BoardData) => {
      if (!syncedRef.current) {
        pendingLocal.current = data;
        return;
      }
      writeDiff(data);
    },
    [writeDiff],
  );

  useEffect(() => {
    if (!enabled) {
      setStatus("off");
      return;
    }
    let cancelled = false;
    let socket: HocuspocusProviderWebsocket | null = null;
    setStatus("connecting");
    const giveUp = window.setTimeout(() => {
      if (!syncedRef.current && !cancelled) {
        setStatus("off");
        providerRef.current?.destroy();
        socket?.destroy();
      }
    }, 10000);

    getSessionRef
      .current()
      .then((session) => {
        if (cancelled) return;
        setReadonly(session.readonly);
        const doc = new Y.Doc();
        docRef.current = doc;
        socket = new HocuspocusProviderWebsocket({ url: session.url });
        const provider = new HocuspocusProvider({
          websocketProvider: socket,
          name: session.document,
          document: doc,
          token: session.token,
          onSynced: () => {
            if (cancelled) return;
            const first = !syncedRef.current;
            syncedRef.current = true;
            window.clearTimeout(giveUp);
            setStatus("live");
            if (first && pendingLocal.current) {
              writeDiff(pendingLocal.current);
              pendingLocal.current = null;
            }
            emit();
          },
          onStatus: ({ status: s }) => {
            if (cancelled || !syncedRef.current) return;
            setStatus(s === "connected" ? "live" : "offline");
          },
          onAuthenticationFailed: () => {
            if (!cancelled) setStatus("off");
          },
        });
        provider.attach();
        providerRef.current = provider;
        if (session.name) provider.setAwarenessField("user", { name: session.name, color: peerColor(session.uid), uid: session.uid });

        doc.on("afterTransaction", (tr: Y.Transaction) => {
          if (tr.origin === LOCAL || !syncedRef.current) return;
          emitSoon();
        });
        const um = new Y.UndoManager([doc.getMap("elements"), doc.getMap("connectors"), doc.getMap("meta")], {
          trackedOrigins: new Set([LOCAL]),
          captureTimeout: 500,
        });
        const refresh = () => setHistory({ canUndo: um.undoStack.length > 0, canRedo: um.redoStack.length > 0 });
        um.on("stack-item-added", refresh);
        um.on("stack-item-popped", refresh);
        um.on("stack-cleared", refresh);
        undoRef.current = um;

        const onAwareness = () => {
          const me = provider.awareness?.clientID;
          const list: CollabPeer[] = [];
          provider.awareness?.getStates().forEach((st, clientId) => {
            const u = st.user as { name?: string; color?: string } | undefined;
            if (clientId === me || !u?.name) return;
            list.push({ clientId, name: u.name, color: u.color ?? "#3b82f6", cursor: (st.cursor as CollabPeer["cursor"]) ?? null, selection: (st.selection as string[]) ?? [] });
          });
          setPeers(list);
        };
        provider.awareness?.on("change", onAwareness);
      })
      .catch(() => {
        if (!cancelled) setStatus("off");
      });

    return () => {
      cancelled = true;
      window.clearTimeout(giveUp);
      undoRef.current?.destroy();
      providerRef.current?.destroy();
      socket?.destroy();
      docRef.current?.destroy();
      undoRef.current = null;
      providerRef.current = null;
      docRef.current = null;
      syncedRef.current = false;
      pendingLocal.current = null;
      lastJson.current = new Map();
      setRemote(null);
      setPeers([]);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, docKey]);

  // cursor updates: at most ~20/s, and the LAST position always goes out
  // (a trailing send), so a cursor never gets stuck where it was throttled
  const lastCursor = useRef(0);
  const trailing = useRef<{ timer: number | null; value: { x: number; y: number } | null }>({ timer: null, value: null });
  const setPresence = useCallback((p: { cursor?: { x: number; y: number } | null; selection?: string[] }) => {
    const provider = providerRef.current;
    if (!provider || !syncedRef.current) return;
    if (p.cursor !== undefined) {
      const send = (c: { x: number; y: number } | null) => {
        lastCursor.current = performance.now();
        providerRef.current?.setAwarenessField("cursor", c ? { x: Math.round(c.x), y: Math.round(c.y) } : null);
      };
      const wait = 50 - (performance.now() - lastCursor.current);
      if (wait <= 0) {
        if (trailing.current.timer != null) window.clearTimeout(trailing.current.timer);
        trailing.current.timer = null;
        send(p.cursor);
      } else {
        trailing.current.value = p.cursor;
        if (trailing.current.timer == null)
          trailing.current.timer = window.setTimeout(() => {
            trailing.current.timer = null;
            send(trailing.current.value);
          }, wait);
      }
    }
    if (p.selection !== undefined) provider.setAwarenessField("selection", p.selection);
  }, []);

  return {
    status,
    readonly,
    remote,
    peers,
    pushLocal,
    setPresence,
    history: {
      undo: () => undoRef.current?.undo(),
      redo: () => undoRef.current?.redo(),
      canUndo: history.canUndo,
      canRedo: history.canRedo,
    },
  };
}
