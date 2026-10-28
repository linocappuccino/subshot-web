"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useApi } from "@/lib/useApi";
import { useLanguage } from "@/lib/i18n";
import type { OAuthConnection } from "@/lib/api";

// 2026-10-28 — Subshot MCP connector: the AI apps connected to this account (avatar menu →
// «KI-Apps»), each can be disconnected (revokes its tokens, app/mcp/oauth.py).

export default function OAuthConnectionsPage() {
  const api = useApi();
  const { t, language } = useLanguage();
  const [rows, setRows] = useState<OAuthConnection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api.oauthConnections().then(setRows).catch((e: Error) => setError(e.message));
  }, [api]);

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(language === "de" ? "de-CH" : "en-GB", { day: "numeric", month: "short", year: "numeric" }) : "–";

  async function revoke(id: string) {
    setBusy(id);
    try {
      await api.revokeOauthConnection(id);
      setRows((r) => (r ?? []).filter((c) => c.id !== id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#0b0b0c] px-5 py-16 text-white [font-family:-apple-system,BlinkMacSystemFont,'SF_Pro_Text',system-ui,sans-serif]">
      <div className="mx-auto w-full max-w-lg">
        <Link href="/projects" className="text-sm text-white/50 transition-colors hover:text-white">
          ← {t("oauth.back")}
        </Link>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">{t("oauth.connectionsTitle")}</h1>
        <p className="mt-2 text-sm leading-relaxed text-white/55">{t("oauth.connectionsIntro")}</p>
        {error && <p className="mt-6 text-sm text-[#ff6b61]">{error}</p>}
        {rows === null && !error && <p className="mt-6 animate-pulse text-sm text-white/40">…</p>}
        {rows?.length === 0 && <p className="mt-8 text-sm text-white/40">{t("oauth.connectionsEmpty")}</p>}
        <ul className="mt-6 space-y-3">
          {rows?.map((c) => (
            <li key={c.id} className="flex items-center gap-4 rounded-2xl bg-white/[0.04] px-4 py-3 ring-1 ring-white/10">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium">{c.client_name}</p>
                <p className="mt-0.5 truncate text-xs text-white/45">
                  {c.scopes.includes("subshot.write") ? t("oauth.readWrite") : t("oauth.readOnly")} · {c.redirect_host}
                </p>
                <p className="mt-0.5 text-xs text-white/35">
                  {t("oauth.connectedAt", { date: fmt(c.created_at) })}
                  {c.last_used_at ? ` · ${t("oauth.lastUsed", { date: fmt(c.last_used_at) })}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => revoke(c.id)}
                disabled={busy === c.id}
                className="shrink-0 rounded-full bg-white/10 px-4 py-1.5 text-sm font-medium transition-colors hover:bg-[#ff453a]/30 disabled:opacity-50"
              >
                {t("oauth.revoke")}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
