"use client";

import { Suspense, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { useApi } from "@/lib/useApi";
import { useLanguage } from "@/lib/i18n";
import type { OAuthConsentRequest } from "@/lib/api";

// 2026-10-28 — Subshot MCP connector: an AI app (Claude, ChatGPT …) sends the person here from
// subshot.ch/oauth/authorize; one click allows or denies, then the API hands back the redirect
// to the AI app with the one-time code (app/mcp/oauth.py). Same look as /resolve/connect.

type Phase = "loading" | "ask" | "working" | "done" | "denied" | "error";

const WRITE = "subshot.write";

function Consent() {
  const api = useApi();
  const { t } = useLanguage();
  const params = useSearchParams();
  const requestId = params.get("request") ?? "";
  const [phase, setPhase] = useState<Phase>(requestId ? "loading" : "error");
  const [info, setInfo] = useState<OAuthConsentRequest | null>(null);
  const [allowWrite, setAllowWrite] = useState(true);
  const [message, setMessage] = useState<string | null>(requestId ? null : t("oauth.noRequest"));

  const { isLoaded, isSignedIn } = useAuth();

  // public route (proxy.ts): signed-out visitors log in first and come back here
  useEffect(() => {
    if (isLoaded && !isSignedIn) window.location.replace(`/sign-in?redirect_url=${encodeURIComponent(window.location.href)}`);
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    if (!requestId || !isSignedIn) return;
    api
      .oauthRequest(requestId)
      .then((r) => {
        setInfo(r);
        if (r.decided) {
          setPhase("error");
          setMessage(t("oauth.already"));
        } else {
          setPhase("ask");
        }
      })
      .catch((e: Error) => {
        setPhase("error");
        setMessage(e.message);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, requestId, isSignedIn]);

  async function decide(allow: boolean) {
    if (!info) return;
    setPhase("working");
    try {
      const scopes = allow ? info.scopes.filter((s) => s !== WRITE || allowWrite) : undefined;
      const { redirect_to } = await api.oauthDecision(requestId, allow, scopes);
      setPhase(allow ? "done" : "denied");
      window.location.assign(redirect_to);
    } catch (e) {
      setPhase("error");
      setMessage((e as Error).message);
    }
  }

  const client = info?.client_name ?? "";
  const asksWrite = info?.scopes.includes(WRITE) ?? false;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0b0c] px-5 text-white [font-family:-apple-system,BlinkMacSystemFont,'SF_Pro_Text',system-ui,sans-serif]">
      <div className="w-full max-w-sm rounded-3xl bg-white/[0.04] p-8 ring-1 ring-white/10">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#ff453a] to-[#ff9f0a] text-3xl shadow-lg shadow-[#ff453a]/30">
          ✦
        </div>
        {phase === "loading" && <p className="mt-4 animate-pulse text-center text-sm text-white/50">…</p>}
        {info && (phase === "ask" || phase === "working") && (
          <>
            <h1 className="text-center text-xl font-semibold tracking-tight">{t("oauth.title", { client })}</h1>
            <p className="mt-3 text-center text-sm leading-relaxed text-white/60">{t("oauth.intro", { client })}</p>
            {info.verified ? (
              <p className="mt-3 text-center text-xs text-emerald-400/90">✓ {t("oauth.verified", { host: info.redirect_host })}</p>
            ) : (
              <p className="mt-4 rounded-xl bg-[#ff453a]/10 px-3 py-2 text-xs leading-relaxed text-[#ff8a80] ring-1 ring-[#ff453a]/30">
                {t("oauth.unverified", { host: info.redirect_host })}
              </p>
            )}
            <ul className="mt-6 space-y-3 text-sm">
              <li className="flex items-start gap-3">
                <span className="mt-0.5 text-emerald-400">✓</span>
                <span className="text-white/80">{t("oauth.scopeRead")}</span>
              </li>
              {asksWrite && (
                <li>
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      checked={allowWrite}
                      onChange={(e) => setAllowWrite(e.target.checked)}
                      className="mt-1 h-4 w-4 accent-white"
                    />
                    <span className="text-white/80">{t("oauth.scopeWrite")}</span>
                  </label>
                </li>
              )}
            </ul>
            <div className="mt-7 flex gap-3">
              <button
                type="button"
                onClick={() => decide(false)}
                disabled={phase === "working"}
                className="flex-1 rounded-full bg-white/10 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-white/15 disabled:opacity-50"
              >
                {t("oauth.deny")}
              </button>
              <button
                type="button"
                onClick={() => decide(true)}
                disabled={phase === "working"}
                className="flex-1 rounded-full bg-white py-3 text-[15px] font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {phase === "working" ? t("oauth.working") : t("oauth.allow")}
              </button>
            </div>
            <p className="mt-5 text-center text-xs leading-relaxed text-white/35">
              {t("oauth.signedInAs", { user: info.user.name || info.user.email })} · {t("oauth.revokeHint")}
            </p>
          </>
        )}
        {phase === "done" && <p className="mt-4 text-center text-sm leading-relaxed text-white/70">{t("oauth.done")}</p>}
        {phase === "denied" && <p className="mt-4 text-center text-sm leading-relaxed text-white/70">{t("oauth.denied")}</p>}
        {phase === "error" && <p className="mt-4 text-center text-sm leading-relaxed text-[#ff6b61]">{message}</p>}
      </div>
    </div>
  );
}

export default function OAuthConsentPage() {
  return (
    <Suspense fallback={null}>
      <Consent />
    </Suspense>
  );
}
