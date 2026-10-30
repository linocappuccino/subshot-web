"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/lib/i18n";
import { useApi } from "@/lib/useApi";

/** 2026-10-30, Lino: «Speicher voll → klarer Hinweis + direkt upgraden».
 * - "subshot:storage-limit" (lib/api.ts, a 413 `storage_limit_reached`): ONE centred dialog per page load
 *   («Speicher voll (X von Y GB)»); the team owner gets «Speicher erweitern» → /team#storage (the existing
 *   storage-tier picker, PATCH /teams/{id}/storage-tier — no new payment flow), members the hint to ask the owner.
 * - "subshot:storage-warning" (an upload response at ≥ 90 %): a small dismissible bar at the bottom, at most
 *   once per team and browser session — not intrusive. Same event pattern as InsufficientCreditsDialog. */
type Detail = { used_bytes?: number; limit_bytes?: number; team_id?: string };

const gb = (b?: number) => ((b ?? 0) / 1024 / 1024 / 1024).toFixed(1);

export function StorageLimitDialog() {
  const { t } = useLanguage();
  const api = useApi();
  const router = useRouter();
  const [full, setFull] = useState<Detail | null>(null);
  const [warn, setWarn] = useState<Detail | null>(null);
  const [isOwner, setIsOwner] = useState<boolean | null>(null);
  const shownRef = useRef(false);
  const apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  });

  useEffect(() => {
    async function ownerOf(teamId?: string) {
      try {
        const [me, teams] = await Promise.all([apiRef.current.me(), apiRef.current.myTeams()]);
        const team = teams.find((x) => x.id === teamId) ?? teams[0];
        setIsOwner(!!team && team.owner_id === me.id);
      } catch {
        setIsOwner(false);
      }
    }
    function onLimit(e: Event) {
      if (shownRef.current) return;
      shownRef.current = true;
      const d = (e as CustomEvent<Detail>).detail ?? {};
      setWarn(null);
      setFull(d);
      setIsOwner(null);
      ownerOf(d.team_id);
    }
    function onWarning(e: Event) {
      const d = (e as CustomEvent<Detail>).detail ?? {};
      const key = `subshot-storage-warning-${d.team_id ?? ""}`;
      try {
        if (sessionStorage.getItem(key)) return;
        sessionStorage.setItem(key, "1");
      } catch {
        // storage blocked: show it anyway (still only once per page load below)
      }
      if (shownRef.current) return;
      setWarn(d);
      ownerOf(d.team_id);
    }
    window.addEventListener("subshot:storage-limit", onLimit);
    window.addEventListener("subshot:storage-warning", onWarning);
    return () => {
      window.removeEventListener("subshot:storage-limit", onLimit);
      window.removeEventListener("subshot:storage-warning", onWarning);
    };
  }, []);

  if (typeof document === "undefined") return null;

  if (full) {
    const limitGb = full.limit_bytes ? Math.round(full.limit_bytes / 1024 / 1024 / 1024) : 0;
    return createPortal(
      <div className="fixed inset-0 z-[120] flex items-center justify-center p-4" role="dialog" aria-modal="true">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setFull(null)} />
        <div className="relative w-full max-w-sm bg-[#1c1c1e] border border-white/10 rounded-2xl shadow-2xl p-5">
          <h3 className="font-semibold mb-1.5">{t("storageLimit.title")}</h3>
          <p className="text-sm text-white/60 mb-2">{t("storageLimit.message", { used: gb(full.used_bytes), limit: limitGb })}</p>
          {isOwner === false && <p className="text-sm text-amber-300/90 mb-2">{t("storageLimit.askOwner")}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={() => setFull(null)}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white/70 hover:bg-white/5 transition-colors"
            >
              {isOwner ? t("storageLimit.later") : t("storageLimit.ok")}
            </button>
            {isOwner && (
              <button
                onClick={() => {
                  setFull(null);
                  router.push("/team#storage");
                }}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors"
              >
                {t("storageLimit.upgrade")}
              </button>
            )}
          </div>
        </div>
      </div>,
      document.body
    );
  }

  if (warn) {
    return createPortal(
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[110] w-[calc(100vw-32px)] max-w-md rounded-xl border border-amber-400/25 bg-[#2a2418] shadow-2xl px-4 py-3 flex items-center gap-3 text-sm">
        <span aria-hidden>⚠️</span>
        <span className="flex-1 text-amber-100/90">
          {t("storageWarning.message", { used: gb(warn.used_bytes), limit: Math.round((warn.limit_bytes ?? 0) / 1024 / 1024 / 1024) })}
          {isOwner === false && <span className="text-amber-100/60"> {t("storageLimit.askOwner")}</span>}
        </span>
        {isOwner && (
          <button
            onClick={() => {
              setWarn(null);
              router.push("/team#storage");
            }}
            className="shrink-0 rounded-lg bg-amber-400/20 px-2.5 py-1 text-xs font-semibold text-amber-100 hover:bg-amber-400/30"
          >
            {t("storageWarning.upgrade")}
          </button>
        )}
        <button onClick={() => setWarn(null)} aria-label={t("storageWarning.dismiss")} className="shrink-0 text-amber-100/60 hover:text-amber-100">
          ✕
        </button>
      </div>,
      document.body
    );
  }
  return null;
}
