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
const isPublicRoute = createRouteMatcher(["/", "/sign-in(.*)", "/sign-up(.*)", "/devlog(.*)"]);

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
