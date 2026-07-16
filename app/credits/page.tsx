"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/app/components/AppShell";
import { Button } from "@/app/components/ui/Button";
import { Label, FieldGroup } from "@/app/components/ui/Field";
import { Slider } from "@/app/components/ui/Slider";
import { useApi } from "@/lib/useApi";
import { ApiError } from "@/lib/api";
import { useToast } from "@/app/components/ui/Toast";
import { MIN_CREDIT_PURCHASE, MAX_CREDIT_PURCHASE, creditsToImages } from "@/lib/credits";

/** AI-Credits balance + top-up (2026-07-16, Lino) — separate from the
 * Team/Seats subscription (/team), for AI-Bildgenerierung specifically.
 * Deliberately NEVER shows a CHF/Rappen amount anywhere on this page — the
 * user only ever sees that once handed off to Stripe's own hosted checkout
 * (startCheckout below), which this app has no control over the styling
 * of. Reachable from the AppShell nav link (always) and from
 * InsufficientCreditsDialog's "Credits kaufen" button (only when a
 * generation attempt just got blocked). */
export default function CreditsPage() {
  return (
    <Suspense fallback={null}>
      <CreditsPageInner />
    </Suspense>
  );
}

function CreditsPageInner() {
  const api = useApi();
  const toast = useToast();
  const searchParams = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState<number | null>(null);
  const [credits, setCredits] = useState(MIN_CREDIT_PURCHASE);
  const [checkingOut, setCheckingOut] = useState(false);

  useEffect(() => {
    const checkout = searchParams.get("checkout");
    if (checkout === "success") toast.showSuccess("Zahlung erfolgreich — deine Credits werden gleich angezeigt.");
    if (checkout === "cancel") toast.showError("Kauf abgebrochen.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    try {
      const { balance } = await api.creditBalance();
      setBalance(balance);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Laden fehlgeschlagen.");
    } finally {
      setLoading(false);
    }
  }

  async function startCheckout() {
    setCheckingOut(true);
    try {
      const { url } = await api.creditCheckout(credits);
      window.location.href = url;
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Checkout fehlgeschlagen.");
      setCheckingOut(false);
    }
  }

  return (
    <AppShell>
      <div className="max-w-lg mx-auto w-full px-4 sm:px-6 py-8">
        <h1 className="text-xl font-semibold mb-1">AI Credits</h1>
        <p className="text-sm text-white/50 mb-6">
          Credits werden für die KI-Bildgenerierung bei Szenen verbraucht — unabhängig von deinem Subshot-Abo, kein Verfallsdatum.
        </p>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-6">
          <div className="text-xs text-white/50 mb-1">Aktuelles Guthaben</div>
          <div className="text-3xl font-semibold">
            {loading ? "…" : `${balance ?? 0} Credits`}
          </div>
        </div>

        <FieldGroup>
          <Label>Credits kaufen</Label>
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-2xl font-semibold">{credits} Credits</span>
            <span className="text-sm text-white/50">≈ {creditsToImages(credits)} Bilder</span>
          </div>
          <Slider
            value={credits}
            min={MIN_CREDIT_PURCHASE}
            max={MAX_CREDIT_PURCHASE}
            step={100}
            onChange={setCredits}
          />
          <div className="flex justify-between text-xs text-white/40 mt-1">
            <span>{MIN_CREDIT_PURCHASE}</span>
            <span>{MAX_CREDIT_PURCHASE}</span>
          </div>
        </FieldGroup>

        <Button variant="primary" className="w-full mt-5" onClick={startCheckout} disabled={checkingOut}>
          {checkingOut ? "Weiterleiten…" : "Weiter zur Zahlung"}
        </Button>
      </div>
    </AppShell>
  );
}
