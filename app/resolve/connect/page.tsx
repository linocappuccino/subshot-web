"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useApi } from "@/lib/useApi";

// 2026-10-13 — "Subshot × DaVinci Resolve": the Resolve tool shows a short code and opens this page;
// one click connects that Resolve installation to the signed-in account (device-code flow, see
// app/resolve_bridge.py). German only like the rest of the tool.

type Phase = "loading" | "ask" | "working" | "done" | "error";

function Connect() {
  const api = useApi();
  const params = useSearchParams();
  const raw = (params.get("code") ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const code = raw.length === 6 ? `${raw.slice(0, 3)}-${raw.slice(3)}` : raw;
  const [phase, setPhase] = useState<Phase>(raw ? "loading" : "error");
  const [label, setLabel] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(raw ? null : "Kein Code gefunden. Bitte in Resolve nochmals auf «Mit Subshot verbinden» klicken.");

  useEffect(() => {
    if (!raw) return;
    api
      .resolveDeviceInfo(raw)
      .then((r) => {
        setLabel(r.label);
        setPhase(r.approved ? "done" : "ask");
      })
      .catch((e: Error) => {
        setPhase("error");
        setMessage(e.message);
      });
  }, [api, raw]);

  async function approve() {
    setPhase("working");
    try {
      await api.resolveDeviceApprove(raw);
      setPhase("done");
    } catch (e) {
      setPhase("error");
      setMessage((e as Error).message);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0b0c] px-5 text-white [font-family:-apple-system,BlinkMacSystemFont,'SF_Pro_Text',system-ui,sans-serif]">
      <div className="w-full max-w-sm rounded-3xl bg-white/[0.04] p-8 text-center ring-1 ring-white/10">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#ff453a] to-[#ff9f0a] text-3xl shadow-lg shadow-[#ff453a]/30">
          🎬
        </div>
        <h1 className="text-xl font-semibold tracking-tight">DaVinci Resolve verbinden</h1>
        {phase === "loading" && <p className="mt-4 animate-pulse text-sm text-white/50">…</p>}
        {(phase === "ask" || phase === "working") && (
          <>
            <p className="mt-3 text-sm leading-relaxed text-white/60">
              Stimmt dieser Code mit dem im Subshot-Fenster in Resolve überein?
            </p>
            <p className="mt-5 font-mono text-3xl font-semibold tracking-[0.2em]">{code}</p>
            {label && <p className="mt-2 text-xs text-white/40">{label}</p>}
            <button
              type="button"
              onClick={approve}
              disabled={phase === "working"}
              className="mt-7 w-full rounded-full bg-white py-3 text-[15px] font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {phase === "working" ? "Verbinde …" : "Ja, verbinden"}
            </button>
            <p className="mt-4 text-xs leading-relaxed text-white/35">
              Resolve kann danach deine Shotlists, Take-Marker und das Kunden-Feedback lesen. Trennen geht jederzeit im Tool.
            </p>
          </>
        )}
        {phase === "done" && (
          <>
            <p className="mt-4 text-4xl">✓</p>
            <p className="mt-2 text-sm leading-relaxed text-white/70">Verbunden! Du kannst dieses Fenster schliessen und zurück zu Resolve wechseln.</p>
          </>
        )}
        {phase === "error" && <p className="mt-4 text-sm leading-relaxed text-[#ff6b61]">{message}</p>}
      </div>
    </div>
  );
}

export default function ResolveConnectPage() {
  return (
    <Suspense fallback={null}>
      <Connect />
    </Suspense>
  );
}
