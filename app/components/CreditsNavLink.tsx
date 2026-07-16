"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useApi } from "@/lib/useApi";

/** AI-Credits balance in the AppShell header (2026-07-16, Lino: "credits
 * soll man oben in der subshot navigation kaufen können") — always visible,
 * links to /credits. Polls like NotificationBell (same reasoning: no
 * sub-second freshness needed, a purchase redirects through Stripe and back
 * anyway so the balance only really changes between page loads). Shows the
 * number itself, never a CHF/Rappen amount — see /credits page's own doc
 * comment for why. */
export function CreditsNavLink() {
  const api = useApi();
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    function poll() {
      api.creditBalance().then(({ balance }) => {
        if (!cancelled) setBalance(balance);
      }).catch(() => {});
    }
    poll();
    const interval = setInterval(poll, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Link
      href="/credits"
      className="hidden sm:flex items-center gap-1.5 text-sm text-white/60 hover:text-white transition-colors"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="8" /><path d="M12 8v8M9 10.5a2.5 2.5 0 0 1 2.5-2.5h1a2 2 0 0 1 0 4h-1a2 2 0 0 0 0 4h1a2.5 2.5 0 0 0 2.5-2.5" />
      </svg>
      {balance === null ? "Credits" : `${balance} Credits`}
    </Link>
  );
}
