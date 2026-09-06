"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/app/components/AppShell";
import { Button } from "@/app/components/ui/Button";
import { Label, FieldGroup } from "@/app/components/ui/Field";
import { Slider } from "@/app/components/ui/Slider";
import { useApi } from "@/lib/useApi";
import { useLanguage } from "@/lib/i18n";
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
  const { t } = useLanguage();
  const searchParams = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState<number | null>(null);
  const [credits, setCredits] = useState(MIN_CREDIT_PURCHASE);
  const [checkingOut, setCheckingOut] = useState(false);

  useEffect(() => {
    const checkout = searchParams.get("checkout");
    if (checkout === "success") {
      toast.showSuccess(t("creditsPage.paymentSuccess"));
      // 2026-07-18, Lino: "wenn man Credits auflädt muss dies direkt
      // übernommen und in den Credits korrekt angezeigt werden" — ein
      // einzelnes load() direkt nach dem Stripe-Redirect kann noch den
      // ALTEN Stand zeigen, wenn Stripes Webhook den Kauf serverseitig
      // noch nicht verbucht hat. Statt uns auf den ersten Fetch zu
      // verlassen: still ein paar Sekunden im Hintergrund nachpollen (ohne
      // den "…"-Ladezustand erneut zu triggern), bis der Webhook
      // durchgelaufen ist.
      pollForFreshBalance();
    }
    if (checkout === "cancel") toast.showError(t("creditsPage.purchaseCanceled"));
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
      toast.showError(e instanceof ApiError ? e.message : t("common.failed"));
    } finally {
      setLoading(false);
    }
  }

  async function pollForFreshBalance() {
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const { balance } = await api.creditBalance();
        setBalance(balance);
      } catch {
        // transient — next tick retries anyway
      }
    }
  }

  async function startCheckout() {
    setCheckingOut(true);
    try {
      const { url } = await api.creditCheckout(credits);
      window.location.href = url;
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("creditsPage.checkoutFailed"));
      setCheckingOut(false);
    }
  }

  return (
    <AppShell>
      <div className="max-w-lg mx-auto w-full px-4 sm:px-6 py-8">
        <h1 className="text-xl font-semibold mb-1">AI Credits</h1>
        <p className="text-sm text-white/50 mb-6">{t("creditsPage.description")}</p>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-6">
          <div className="text-xs text-white/50 mb-1">{t("creditsPage.currentBalance")}</div>
          <div className="text-3xl font-semibold">
            {loading ? "…" : t("creditsPage.creditsCount", { count: balance ?? 0 })}
          </div>
        </div>

        <FieldGroup>
          <Label>{t("creditsPage.buyCredits")}</Label>
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-2xl font-semibold">{t("creditsPage.creditsCount", { count: credits })}</span>
            <span className="text-sm text-white/50">≈ {t("creditsPage.imagesCount", { count: creditsToImages(credits) })}</span>
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
          {checkingOut ? t("creditsPage.redirecting") : t("creditsPage.continueToPayment")}
        </Button>
      </div>
    </AppShell>
  );
}
