// 2026-07-22 (reliability audit follow-up) — server-side (Node runtime)
// error monitoring for Server Components/Route Handlers/Server Actions.
// Registered via instrumentation.ts's register(), per Sentry's own Next.js
// App Router setup. No-ops cleanly if SENTRY_DSN isn't set.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
  sendDefaultPii: false,
  tracesSampleRate: 0.1,
  // 2026-07-22 (follow-up security check, same day) — sendDefaultPii is a
  // SEPARATE toggle from this; @sentry/node's localVariablesIntegration is
  // unconditionally in the SDK's default integration list and snapshots
  // local variable VALUES into every captured server-side stack trace.
  // Filtered out explicitly — same reasoning/fix as main.py's backend
  // Sentry.init (CLERK_SECRET_KEY and other secrets can appear as local
  // variables in server-side request-handling code).
  // Matches by prefix since the SDK picks between "LocalVariables" (sync,
  // debugger-based) and "LocalVariablesAsync" depending on the Node.js
  // runtime — filtering both defensively rather than guessing which one
  // this deployment's Node version resolves to.
  integrations: (defaultIntegrations) => defaultIntegrations.filter((i) => !i.name.startsWith("LocalVariables")),
});
