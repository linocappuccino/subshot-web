"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useAuth, useClerk, useSignIn } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";

// 2026-10-12 — the iOS app embeds the web idea board (WKWebView). It gets a one-time Clerk sign-in
// token from the API (POST /me/web-ticket) and opens /embed/auth?ticket=…&uid=…&next=/embed/idea/…:
// already signed in as that user → straight on; signed in as someone else → sign out first; then
// sign in with the ticket and go to `next` (only same-site /embed/ paths).

function EmbedAuth() {
  const params = useSearchParams();
  const router = useRouter();
  const { isLoaded, isSignedIn, userId } = useAuth();
  const clerk = useClerk();
  const { signIn } = useSignIn();
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (!isLoaded || started.current) return;
    started.current = true;
    const next = params.get("next") ?? "";
    const target = next.startsWith("/embed/") && !next.startsWith("//") ? next : "/";
    const ticket = params.get("ticket");
    const uid = params.get("uid");
    (async () => {
      try {
        if (isSignedIn && (!uid || uid === userId)) {
          router.replace(target);
          return;
        }
        if (isSignedIn) await clerk.signOut();
        if (!ticket || !signIn) throw new Error("no ticket");
        const r = await signIn.ticket({ ticket });
        if (r.error) throw r.error;
        const f = await signIn.finalize();
        if (f.error) throw f.error;
        router.replace(target);
      } catch {
        setFailed(true);
      }
    })();
  }, [isLoaded, isSignedIn, userId, clerk, signIn, params, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#161616] text-sm text-white/50">
      {failed ? "Anmeldung fehlgeschlagen – bitte das Board in der App nochmals öffnen." : <span className="animate-pulse">…</span>}
    </div>
  );
}

export default function EmbedAuthPage() {
  return (
    <Suspense fallback={null}>
      <EmbedAuth />
    </Suspense>
  );
}
