"use client";

/* 2026-11-16 (contract v1.9) — the seat's connected Macs for DaVinci Resolve: max. 2, one online at a time.
   «Mac ersetzen/freigeben» once per 30 days (the admin can reset any time). manage_url of the plugin errors points here. */

import { DavinciDownload } from "@/app/components/DavinciDownload";
import { useEffect, useState } from "react";
import { AppShell } from "@/app/components/AppShell";
import { useApi } from "@/lib/useApi";

type Mac = { id: string; machine_name: string | null; since: string | null; last_seen: string | null; online: boolean };
type Macs = { max: number; machines: Mac[]; can_release: boolean; next_release: string | null };

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "–");

function MacsSection() {
  const api = useApi();
  const [macs, setMacs] = useState<Macs | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => api.seatStatus().then((s) => setMacs(s.macs)).catch(() => setErr("Konnte nicht geladen werden."));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);
  if (!macs) return <p className="text-sm text-white/50">{err ?? "…"}</p>;
  return (
    <section id="macs" className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <h2 className="text-lg font-semibold">Verbundene Macs (DaVinci Resolve)</h2>
      <p className="mt-1 text-sm text-white/55">Pro Seat bis zu {macs.max} Macs, online ist immer nur einer. Jede Person braucht einen eigenen Seat.</p>
      <ul className="mt-4 flex flex-col gap-2">
        {macs.machines.length === 0 && <li className="text-sm text-white/50">Noch kein Mac verbunden.</li>}
        {macs.machines.map((m) => (
          <li key={m.id} data-mac className="flex flex-wrap items-center gap-3 rounded-lg bg-white/[0.04] px-3 py-2 text-sm">
            <span className={`h-2 w-2 rounded-full ${m.online ? "bg-emerald-400" : "bg-white/25"}`} title={m.online ? "online" : "offline"} />
            <span className="font-semibold">{m.machine_name || "Mac"}</span>
            <span className="text-white/50">seit {fmt(m.since)} · zuletzt {fmt(m.last_seen)}</span>
            <button type="button" disabled={!macs.can_release}
              onClick={async () => {
                if (!window.confirm(`«${m.machine_name || "Mac"}» freigeben? Danach kann ein anderer Mac verbunden werden. Das geht nur einmal alle 30 Tage.`)) return;
                try { setMacs(await api.releaseMac(m.id)); } catch (e) { setErr(e instanceof Error ? e.message : "Fehlgeschlagen."); }
              }}
              className="ml-auto rounded-md bg-white/10 px-2.5 py-1 text-xs hover:bg-white/15 disabled:opacity-40">
              Mac ersetzen / freigeben
            </button>
          </li>
        ))}
      </ul>
      {macs.next_release && <p className="mt-3 text-xs text-white/45">Nächste Freigabe möglich ab {fmt(macs.next_release)}.</p>}
      {err && <p className="mt-3 text-xs text-amber-200">{err}</p>}
    </section>
  );
}

export default function AccountPage() {
  return (
    <AppShell>
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10">
        <h1 className="text-2xl font-semibold">Account</h1>
        <MacsSection />
        <DavinciDownload />
      </div>
    </AppShell>
  );
}
