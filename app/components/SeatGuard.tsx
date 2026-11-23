"use client";

/* 2026-11-16, Lino: «vermeiden, dass Firmen einen Account sharen» — one seat = one person.
   - remembers the current Clerk session id, so the sign-in page can tell «you were signed out because the account
     was opened on another device» (GET /auth/kicked)
   - shows the owner a friendly hint when the account looks shared (blue «Seat hinzufügen», never red) */

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "@clerk/nextjs";
import { useApi } from "@/lib/useApi";
import { useLanguage } from "@/lib/i18n";

const SID_KEY = "subshot-last-session-id";
const API = process.env.NEXT_PUBLIC_API_BASE_URL;

export function SeatGuard() {
  const { session } = useSession();
  const api = useApi();
  const { language } = useLanguage();
  const [suspected, setSuspected] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!session?.id) return;
    try { localStorage.setItem(SID_KEY, session.id); } catch { /* private mode */ }
    api.seatStatus().then((s) => setSuspected(!!s.sharing_suspected)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  if (!suspected || hidden) return null;
  const de = language !== "en";
  return (
    <div data-seat-banner className="mx-auto mt-3 flex max-w-5xl flex-wrap items-center gap-3 rounded-xl border border-[#1f6feb]/40 bg-[#1f6feb]/10 px-4 py-2.5 text-sm text-white/85">
      <span className="flex-1 min-w-[14rem]">
        {de ? "Dieser Account wird anscheinend von mehreren Personen genutzt – jede Person braucht einen eigenen Seat."
            : "This account seems to be used by several people – every person needs their own seat."}
      </span>
      <Link href="/team" className="rounded-md bg-[#1f6feb] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#388bfd]">
        {de ? "Seat hinzufügen" : "Add a seat"}
      </Link>
      <button type="button" onClick={() => setHidden(true)} className="text-white/50 hover:text-white" aria-label={de ? "Schliessen" : "Close"}>×</button>
    </div>
  );
}

/** on the sign-in page: was the last session ended because the account was opened elsewhere? */
export function KickedNotice() {
  const de = useLanguage().language !== "en";
  const [kicked, setKicked] = useState(false);
  useEffect(() => {
    let sid: string | null = null;
    try { sid = localStorage.getItem(SID_KEY); } catch { /* ignore */ }
    if (!sid || !API) return;
    fetch(`${API}/auth/kicked?sid=${encodeURIComponent(sid)}`)
      .then((r) => r.json())
      .then((d) => { if (d?.kicked) setKicked(true); })
      .catch(() => {})
      .finally(() => { try { localStorage.removeItem(SID_KEY); } catch { /* ignore */ } });
  }, []);
  if (!kicked) return null;
  return (
    <div data-kicked-notice className="mx-auto mb-6 max-w-md rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
      <p className="font-semibold">{de ? "Dein Account wurde auf einem anderen Gerät geöffnet." : "Your account was opened on another device."}</p>
      <p className="mt-1 text-amber-100/80">{de ? "Jede Person braucht einen eigenen Seat." : "Every person needs their own seat."} <Link href="/team" className="underline">{de ? "Seats verwalten" : "Manage seats"}</Link></p>
    </div>
  );
}
