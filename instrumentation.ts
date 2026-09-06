// 2026-07-22 (reliability audit follow-up) — registers the right Sentry
// config for whichever runtime this process actually is (Node server vs
// Edge), per Sentry's own Next.js App Router setup docs. instrumentation-
// client.ts (browser) is loaded automatically by Next.js itself, no wiring
// needed here.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}
