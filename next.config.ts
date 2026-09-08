import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
  // 2026-09-08 security audit fix (Medium) — no clickjacking protection
  // anywhere. The public no-login preview/deliver pages have real
  // state-changing buttons (delete annotation/comment, submit feedback)
  // reachable by anyone with a share link, so they were iframe-able: an
  // attacker could embed a preview URL and overlay a decoy UI to trick a
  // link-holder into an unintended click. Nothing in this app is meant to
  // be embedded by a third party, so a blanket same-origin frame policy is
  // safe everywhere, not just on the public routes.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        ],
      },
    ];
  },
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
