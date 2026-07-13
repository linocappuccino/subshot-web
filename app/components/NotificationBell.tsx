"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useApi } from "@/lib/useApi";
import type { Notification } from "@/lib/types";

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "gerade eben";
  if (mins < 60) return `vor ${mins} Min.`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  return `vor ${Math.round(hours / 24)} Tg.`;
}

/** Global bell in the AppShell header — same "batched per (user, project,
 * kind)" notifications the iOS app already gets as push (todo assignment,
 * annotation mentions, etc.), just with no web equivalent until now. Polls
 * like every other "live" list in this app (project page's 12s scene poll,
 * TeamPanel's on-open fetch) rather than a websocket, same reasoning: this
 * doesn't need sub-second freshness. */
export function NotificationBell() {
  const api = useApi();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    function poll() {
      api.notifications(true).then((n) => {
        if (!cancelled) setNotifications(n);
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

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function openNotification(n: Notification) {
    setNotifications((prev) => prev.filter((x) => x.id !== n.id));
    setOpen(false);
    api.markNotificationRead(n.id).catch(() => {});
  }

  async function markAllRead() {
    const previous = notifications;
    setNotifications([]);
    api.markAllNotificationsRead().catch(() => setNotifications(previous));
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative p-1.5 -m-1.5 text-white/60 hover:text-white transition-colors"
        aria-label="Benachrichtigungen"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {notifications.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {notifications.length}
          </span>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute right-0 mt-2.5 z-50 w-80 max-h-[70vh] overflow-y-auto rounded-2xl bg-[#242426] border border-white/10 shadow-2xl"
          >
            <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-white/8 sticky top-0 bg-[#242426]">
              <span className="text-sm font-semibold">Benachrichtigungen</span>
              {notifications.length > 0 && (
                <button onClick={markAllRead} className="text-xs text-white/40 hover:text-white/70 transition-colors">
                  Alle gelesen
                </button>
              )}
            </div>
            {notifications.length === 0 ? (
              <p className="text-sm text-white/40 px-3.5 py-4">Keine neuen Benachrichtigungen.</p>
            ) : (
              <div className="py-1">
                {notifications.map((n) => (
                  <Link
                    key={n.id}
                    href={`/projects/${n.project_id}`}
                    onClick={() => openNotification(n)}
                    className="block px-3.5 py-2.5 hover:bg-white/8 transition-colors border-b border-white/5 last:border-0"
                  >
                    <div className="text-sm font-medium truncate">
                      {n.title}
                      {n.count > 1 && <span className="text-white/40"> ×{n.count}</span>}
                    </div>
                    <div className="text-xs text-white/50 line-clamp-2 mt-0.5">{n.body}</div>
                    <div className="text-[11px] text-white/30 mt-1">{timeAgo(n.updated_at)}</div>
                  </Link>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
