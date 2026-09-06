import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// "/" itself is public too — it's not a real page, just a signed-in?/projects
// :/sign-in redirect (see app/page.tsx). Without this, auth.protect() 404s
// unauthenticated requests to "/" instead of letting that redirect run,
// since there's no NEXT_PUBLIC_CLERK_SIGN_IN_URL configured to fall back to.
//
// /devlog is public too (2026-07-14, Lino: "devlog für alle") — it fetches
// via a plain fetch() with no Clerk token already (see app/devlog/page.tsx),
// but this middleware still blocked reaching the PAGE itself for a signed-
// out visitor before that fetch ever ran. /feedback stays protected on
// purpose (Lino: "feedback nur für eingeloggte user").
//
// /preview is public too (2026-07-20, #254) — the video-feedback share-link
// destination, reachable by anyone with the token (same no-login trust
// model as every /share/{token} Python page), plain fetch via
// lib/publicPreviewApi.ts, no Clerk token attached.
//
// /preview-ideas is public too (2026-07-21, #262) — same no-login share-
// link destination, this time for the "ideas" ShareLink.kind (replaces
// app/idea_share_view.py), plain fetch via lib/publicIdeasPreviewApi.ts.
// Listed as its own explicit entry rather than relying on "/preview(.*)"
// above to also happen to match "/preview-ideas/..." — not worth trusting
// path-to-regexp's exact wildcard-adjacency semantics here.
//
// /preview-scenes is public too (2026-07-21, #268) — same no-login share-
// link destination, this time for the "storyboard" ShareLink.kind (replaces
// app/share_view.py), plain fetch via lib/publicScenesPreviewApi.ts. Same
// "own explicit entry" reasoning as /preview-ideas above.
//
// /icon is public too (2026-07-30) — Next.js's dynamically-generated favicon
// route (`app/icon.tsx`, via `next/og`'s ImageResponse). The matcher below
// only excludes paths that already END in a static-file extension
// (`.png`/`.ico`/etc.), but `/icon` itself has no extension in its URL, so
// it was falling through to `auth.protect()` and 404ing for every
// signed-out browser's plain favicon request (which is every browser —
// favicons are fetched before/without any Clerk session).
//
// /deliver is public too (2026-09-06) — same no-login share-link
// destination, this time for the new "deliver" ShareLink.kind (final
// client handoff, alongside — not instead of — /preview's own "video"
// feedback link), plain fetch via lib/publicDeliverApi.ts.
const isPublicRoute = createRouteMatcher([
  "/", "/sign-in(.*)", "/sign-up(.*)", "/devlog(.*)", "/preview(.*)", "/preview-ideas(.*)", "/preview-scenes(.*)", "/deliver(.*)", "/icon",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
