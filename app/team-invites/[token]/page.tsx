"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useClerk } from "@clerk/nextjs";
import { AppShell } from "@/app/components/AppShell";
import { Button } from "@/app/components/ui/Button";
import { useApi } from "@/lib/useApi";
import { useLanguage } from "@/lib/i18n";
import { ApiError } from "@/lib/api";
import type { TeamInvitePreview } from "@/lib/types";

// 2026-08-06 — team-membership counterpart of app/invites/[token]/page.tsx,
// same root cause and fix (see that file's own doc comment): the emailed
// link used to point straight at POST /team-invites/{token}/accept, which
// only ever accepted a POST, so a browser click always 405'd.
type State = "loading" | "ready" | "wrongEmail" | "alreadyUsed" | "notFound" | "accepting" | "accepted" | "error";

export default function TeamInviteAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const api = useApi();
  const { t } = useLanguage();
  const clerk = useClerk();

  const [state, setState] = useState<State>("loading");
  const [preview, setPreview] = useState<TeamInvitePreview | null>(null);
  const [currentEmail, setCurrentEmail] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function load() {
    try {
      const [inv, me] = await Promise.all([api.teamInvitePreview(token), api.me()]);
      setPreview(inv);
      setCurrentEmail(me.email);
      if (inv.status === "active") setState("alreadyUsed");
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
      await api.acceptTeamInvite(token);
      setState("accepted");
      // 2026-08-06, Lino: an invited member (esp. editor role) must never
      // land on /team — that page is for managing the subscription/seats/
      // roles, not something a freshly-invited non-admin should ever be
      // routed to automatically. /projects is the actual app home (same
      // destination "/" itself redirects a signed-in visitor to).
      setTimeout(() => router.push("/projects"), 1200);
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
            <Button variant="secondary" onClick={() => clerk.signOut({ redirectUrl: `/team-invites/${token}` })}>
              {t("invitePage.signOutAndSwitch")}
            </Button>
          </div>
        )}

        {(state === "ready" || state === "accepting") && preview && (
          <div className="space-y-2">
            <h1 className="text-xl font-semibold">{t("invitePage.teamTitle", { name: preview.team_name })}</h1>
            <p className="text-white/50 text-sm mb-6">{t("invitePage.teamSubtitle", { role: preview.role })}</p>
            <Button variant="primary" onClick={accept} disabled={state === "accepting"}>
              {state === "accepting" ? t("invitePage.accepting") : t("invitePage.accept")}
            </Button>
          </div>
        )}

        {state === "accepted" && <p className="text-white/70">{t("invitePage.acceptedGoToTeam")}</p>}
      </div>
    </AppShell>
  );
}
