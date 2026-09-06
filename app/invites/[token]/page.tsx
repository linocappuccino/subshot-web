"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useClerk } from "@clerk/nextjs";
import { AppShell } from "@/app/components/AppShell";
import { Button } from "@/app/components/ui/Button";
import { useApi } from "@/lib/useApi";
import { useLanguage } from "@/lib/i18n";
import { ApiError } from "@/lib/api";
import type { InvitePreview } from "@/lib/types";
import { moduleAwareProjectHref } from "@/lib/projectLink";

// 2026-08-06 — destination of a project-invite email's link. The link used
// to point straight at POST /invites/{token}/accept, a Clerk-authenticated
// endpoint requiring the accepting account's email to match the invite —
// a browser click is always a GET, so it always 405'd (never worked, since
// this feature's original introduction). This page is the missing middle
// step: proxy.ts already forces sign-in before this route renders (not in
// its public-route list), so by the time the effect below runs there's
// always a session — it just needs to fire the real POST and handle the
// invite-specific failure modes (wrong account signed in, already used,
// token doesn't exist).
type State = "loading" | "ready" | "wrongEmail" | "alreadyUsed" | "notFound" | "accepting" | "accepted" | "error";

export default function InviteAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const api = useApi();
  const { t } = useLanguage();
  const clerk = useClerk();

  const [state, setState] = useState<State>("loading");
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [currentEmail, setCurrentEmail] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function load() {
    try {
      const [inv, me] = await Promise.all([api.invitePreview(token), api.me()]);
      setPreview(inv);
      setCurrentEmail(me.email);
      if (inv.accepted_at) setState("alreadyUsed");
      else if (inv.email.toLowerCase() !== me.email.toLowerCase()) setState("wrongEmail");
      else setState("ready");
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setState("notFound");
      else {
        setErrorMessage(e instanceof ApiError ? e.message : t("invitePage.acceptFailed"));
        setState("error");
      }
    }
  }

  async function accept() {
    setState("accepting");
    try {
      await api.acceptInvite(token);
      setState("accepted");
      setTimeout(() => router.push(moduleAwareProjectHref(preview!.project_id, preview!)), 1200);
    } catch (e) {
      if (e instanceof ApiError && e.status === 410) { setState("alreadyUsed"); return; }
      if (e instanceof ApiError && e.status === 403) { setState("wrongEmail"); return; }
      setErrorMessage(e instanceof ApiError ? e.message : t("invitePage.acceptFailed"));
      setState("error");
    }
  }

  return (
    <AppShell>
      <div className="max-w-md mx-auto w-full px-4 sm:px-6 py-20 text-center">
        {state === "loading" && <p className="text-white/50">{t("invitePage.loading")}</p>}
        {state === "notFound" && <p className="text-white/70">{t("invitePage.notFound")}</p>}
        {state === "alreadyUsed" && <p className="text-white/70">{t("invitePage.alreadyUsed")}</p>}
        {state === "error" && <p className="text-red-400 text-sm">{errorMessage}</p>}

        {state === "wrongEmail" && preview && (
          <div className="space-y-4">
            <p className="text-white/70 text-sm">
              {t("invitePage.wrongEmail", { invitedEmail: preview.email, currentEmail })}
            </p>
            <Button variant="secondary" onClick={() => clerk.signOut({ redirectUrl: `/invites/${token}` })}>
              {t("invitePage.signOutAndSwitch")}
            </Button>
          </div>
        )}

        {(state === "ready" || state === "accepting") && preview && (
          <div className="space-y-2">
            <h1 className="text-xl font-semibold">{t("invitePage.projectTitle", { name: preview.project_name })}</h1>
            <p className="text-white/50 text-sm mb-6">{t("invitePage.projectSubtitle", { role: preview.role })}</p>
            <Button variant="primary" onClick={accept} disabled={state === "accepting"}>
              {state === "accepting" ? t("invitePage.accepting") : t("invitePage.accept")}
            </Button>
          </div>
        )}

        {state === "accepted" && <p className="text-white/70">{t("invitePage.acceptedGoToProject")}</p>}
      </div>
    </AppShell>
  );
}
