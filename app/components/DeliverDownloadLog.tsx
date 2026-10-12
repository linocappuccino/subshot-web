"use client";

import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/lib/useApi";
import { useLanguage } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import type { DeliverDownloadLog as Log } from "@/lib/types";

// 2026-10-12, Lino: "Download-Protokoll — wer hat wann welche Datei geladen". Every download over
// the Deliver link is recorded server-side (_log_deliver_download; devices told apart by a salted
// hash, no IP stored); the first one also notifies the owner. Shown on the admin Deliver page.

const PREVIEW = 8;

/** "Safari · Mac" from a user agent — enough to tell devices apart, no fingerprinting */
function deviceOf(ua: string | null): string {
  if (!ua) return "";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  const br = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return [br, os].filter(Boolean).join(" · ");
}

export function DeliverDownloadLog({ projectId, fetchLog }: { projectId: string; /** tests only */ fetchLog?: () => Promise<Log> }) {
  const api = useApi();
  const { t, language } = useLanguage();
  const [log, setLog] = useState<Log | null>(null);
  const [all, setAll] = useState(false);

  const load = useCallback(() => {
    (fetchLog ? fetchLog() : api.deliverDownloads(projectId)).then(setLog).catch(() => {});
  }, [api, projectId, fetchLog]);
  useEffect(() => {
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [load]);

  if (!log) return null;
  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(language === "en" ? "en-GB" : "de-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  // a stable colour per device, so the same device is recognisable down the list
  const tint = (v: string | null) => (v ? `hsl(${parseInt(v.slice(0, 6), 16) % 360} 70% 62%)` : "rgba(255,255,255,0.3)");
  const events = all ? log.events : log.events.slice(0, PREVIEW);

  return (
    <div className="bg-white/[0.03] border border-white/8 rounded-2xl p-5 mb-6">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
        <h2 className="text-sm font-semibold text-white">{t("deliverLog.title")}</h2>
        {log.total > 0 && (
          <span className="text-xs text-white/50">
            {t("deliverLog.summary", { first: fmt(log.first_at), count: log.total, devices: log.visitors })}
          </span>
        )}
      </div>
      {log.total === 0 ? (
        <p className="text-sm text-amber-300/80">{t("deliverLog.none")}</p>
      ) : (
        <>
          <ul className="divide-y divide-white/6">
            {events.map((e) => (
              <li key={e.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: tint(e.visitor) }} title={t("deliverLog.device")} />
                <span className="w-32 shrink-0 tabular-nums text-xs text-white/45">{fmt(e.created_at)}</span>
                <span className="min-w-0 flex-1 truncate text-white/85">
                  <span className="text-white/50">{t(`deliverLog.kind.${e.kind}` as never)}</span>
                  {e.label ? ` · ${e.label}` : ""}
                </span>
                <span className="hidden sm:block shrink-0 text-xs text-white/35">{deviceOf(e.user_agent)}</span>
              </li>
            ))}
          </ul>
          {log.events.length > PREVIEW && (
            <button type="button" onClick={() => setAll((x) => !x)} className={cn("mt-2 text-xs text-white/50 hover:text-white")}>
              {all ? t("deliverLog.less") : t("deliverLog.all", { count: log.events.length })}
            </button>
          )}
        </>
      )}
    </div>
  );
}
