// 2026-07-22 (reliability audit follow-up) — client-side error monitoring,
// previously nonexistent (a crash was only ever discovered when a user
// reported it). Sends real front-end exceptions/console errors to Sentry.
// No-ops cleanly if NEXT_PUBLIC_SENTRY_DSN isn't set (e.g. local dev).
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  sendDefaultPii: false,
  tracesSampleRate: 0.1,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
