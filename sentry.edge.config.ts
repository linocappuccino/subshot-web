// 2026-07-22 (reliability audit follow-up) — Edge runtime (proxy.ts's
// Clerk middleware) error monitoring. Registered via instrumentation.ts's
// register(). No-ops cleanly if SENTRY_DSN isn't set.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
  sendDefaultPii: false,
  tracesSampleRate: 0.1,
});
