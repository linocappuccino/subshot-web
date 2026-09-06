import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
};

// 2026-07-22 (reliability audit follow-up) — wraps the build to also
// upload source maps to Sentry (readable stack traces on real errors,
// not minified gibberish) and inject a few small monitoring endpoints.
// silent: true keeps the (optional, currently unset) SENTRY_AUTH_TOKEN's
// absence from failing the build — source-map upload just gets skipped.
export default withSentryConfig(nextConfig, {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
});
