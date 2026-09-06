import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono, Anton, Bebas_Neue } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { deDE, enUS } from "@clerk/localizations";
import { LANGUAGE_COOKIE } from "@/lib/i18nConstants";
import { ToastProvider } from "@/app/components/ui/Toast";
import { TrialExpiredDialog } from "@/app/components/ui/TrialExpiredDialog";
import { InsufficientCreditsDialog } from "@/app/components/ui/InsufficientCreditsDialog";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// 2026-07-17, Lino: erst "für H1 Texte und Logo Text soll der Font Thunder
// verwendet werden", dann noch am selben Tag "das mit dem Font sofort
// wieder rückgängig machen! wir wechseln da auf den Font ANTON" — Thunder
// (self-hosted via next/font/local, eigene .ttf-Dateien) komplett entfernt,
// Anton ist ein Google Font, also einfach next/font/google wie Geist oben.
// 2026-07-19, Lino: nach Sichten von 10 H1-Kandidaten (subshot.ch/fonts)
// bleibt Anton NUR fürs Logo-Wortzeichen "Subshot" (AppShell.tsx) — jedes
// echte <h1> sowie Stellen, die bewusst wie ein h1 aussehen sollen (siehe
// projects/[id]/page.tsx's Workflow-Titel), wechselte damals auf Bricolage
// Grotesque.
// 2026-08-06, Lino: "die headers sollen alle im bebas neue font sein" —
// replaces Bricolage Grotesque with Bebas Neue for exactly the same set of
// elements (every real <h1> plus the two font-bricolage-utility call sites
// styled to match). Bebas Neue only ships one weight (400, normal).
const anton = Anton({
  variable: "--font-anton",
  weight: "400",
  subsets: ["latin"],
});

const bebas = Bebas_Neue({
  variable: "--font-bebas",
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Subshot",
  description: "Storyboard & shot list, in the browser.",
};

// Dark-mode-only, same as the iOS app (see SubshotApp.swift's
// .preferredColorScheme(.dark) comment) — this is a companion client to the
// same product, not a general-purpose web app that should follow OS theme.
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // 2026-07-21 — Clerk's OWN dialog text (Sign out, Manage account, etc. —
  // opened via UserButton, see AppShell.tsx) needs its own localization
  // separate from lib/i18n.tsx's small custom dictionary, since that only
  // covers the NEW Sprache/Language menu action, not Clerk's prebuilt UI.
  // Read server-side from the cookie (not the DB) so this is correct on
  // the very first paint, before any client-side fetch could resolve it —
  // the cookie is kept in sync with the DB by AppShell's own reconcile
  // effect, see lib/i18n.tsx's LanguageProvider doc comment.
  const cookieStore = await cookies();
  const isEnglish = cookieStore.get(LANGUAGE_COOKIE)?.value === "en";
  const clerkLocalization = isEnglish ? enUS : deDE;

  return (
    <ClerkProvider localization={clerkLocalization}>
      <html
        lang={isEnglish ? "en" : "de"}
        className={`${geistSans.variable} ${geistMono.variable} ${anton.variable} ${bebas.variable} h-full antialiased dark`}
      >
        <body className="min-h-full flex flex-col bg-[#161616] text-[#f0f0f0]">
          <ToastProvider>{children}</ToastProvider>
          <TrialExpiredDialog />
          <InsufficientCreditsDialog />
        </body>
      </html>
    </ClerkProvider>
  );
}
