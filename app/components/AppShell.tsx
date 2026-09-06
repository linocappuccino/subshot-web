"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { UserButton } from "@clerk/nextjs";
import { NotificationBell } from "./NotificationBell";
import { CreditsNavLink } from "./CreditsNavLink";
import { LanguageDialog } from "./LanguageDialog";
import { NotificationSettingsDialog } from "./NotificationSettingsDialog";
import { LanguageProvider, useLanguage } from "@/lib/i18n";
import { useApi } from "@/lib/useApi";
import type { TeamStorageUsage } from "@/lib/types";

// 2026-07-18: Team-Name+Admin-Status als Modul-Singleton zwischenspeichern
// (überlebt Client-Side-Navigationen, da das Modul nicht neu geladen wird —
// nur ein echter Seiten-Reload leert es). AppShell mountet bei JEDER
// Navigation neu (siehe Doc-Kommentar unten), ohne diesen Cache würde der
// Team-Link für Admins auf JEDER Seite kurz fehlen und dann reinpoppen —
// exakt das Wackeln, das mit CreditsNavLink schon einmal gefixt wurde, nur
// diesmal für einen ganzen Nav-Eintrag statt nur Text. 2026-07-28: die
// Speicheranzeige (siehe unten) zieht in dieselbe Cache-Struktur ein, aus
// demselben Grund.
let teamInfoCache: {
  teamName: string | null;
  teamLogoUrl: string | null;
  showTeamLink: boolean;
  storageUsage: TeamStorageUsage | null;
} | null = null;

/** Persistent top bar for every signed-in screen — replaces the bare
 * "Subshot" <h1> each page used to render on its own. One shared shell so
 * navigation/branding is consistent everywhere instead of every page
 * reinventing its own header.
 *
 * `tint` (2026-07-17, Lino: "jeder workflow seite eine andere
 * hintergrundfarbe... Szenenseite und Postproduction seite dürfen keine
 * farbe haben... die anderen können eine dezente dunkle hintergrund
 * farbe haben") — layout.tsx's bg-[#161616] on <body> is global/shared
 * (Szenen+Ideen sind sogar dieselbe Route, nur ein activeView-State-
 * Unterschied, siehe page.tsx), kann darum nicht pro Seite variieren.
 * Stattdessen ein full-bleed Overlay HINTER children, per CSS-Transition
 * eingefaerbt — undefined/null (Szenen, Postproduction) heisst "transparent",
 * die Basis bleibt exakt das bisherige neutrale Grau.
 *
 * 2026-07-21, Lino: "der wechsel vom hintergrund ist einfach ploetzlich" —
 * die alte Fassung war ein plain `<div>` mit `transition-colors`, nur
 * gemountet wenn `tint` gesetzt war (`{tint && (...)}`). AppShell mountet
 * aber bei JEDER Navigation neu (kein gemeinsames layout.tsx zwischen
 * /projects und /projects/[id]) — eine frisch gemountete Seite mit sofort
 * gesetztem tint (z.B. Ideen) hatte also nie ein "vorher", von dem eine
 * reine CSS-`transition` hätte überblenden können; ein neuer DOM-Knoten
 * committet seinen ersten Style-Wert sofort, ohne Animation. Fix: ein
 * `motion.div` mit `initial`/`animate` statt CSS-`transition` — das
 * animiert (anders als CSS-`transition`) auch beim allerersten Mount von
 * `initial` zu `animate`, exakt das gleiche Prinzip, das der Rest dieser App
 * für jede Enter-Animation schon verwendet. */
export function AppShell({ children, tint }: { children: React.ReactNode; tint?: string }) {
  return (
    <LanguageProvider>
      <AppShellInner tint={tint}>{children}</AppShellInner>
    </LanguageProvider>
  );
}

/** 2026-07-21, Lino: "oben soll man auf seinen avatar klicken koennen dann
 * geht ein dialog auf bei dem man sich von der app ausloggen kann, und die
 * sprache der app aendern kann" — split out of AppShell so it can sit
 * INSIDE LanguageProvider and call useLanguage(). Sign-out itself needed no
 * new code: Clerk's <UserButton> already opens exactly this "click avatar →
 * dialog" menu with its own built-in Sign out item; only the Sprache/
 * Language action below is new, added via Clerk's official custom-menu-item
 * API (<UserButton.MenuItems>/<UserButton.Action>) rather than replacing
 * their whole account dropdown with a hand-rolled one. */
function AppShellInner({ children, tint }: { children: React.ReactNode; tint?: string }) {
  const api = useApi();
  const { language, setLanguage, t } = useLanguage();
  const [showLanguageDialog, setShowLanguageDialog] = useState(false);
  const [showNotificationSettings, setShowNotificationSettings] = useState(false);
  const [teamName, setTeamName] = useState<string | null>(teamInfoCache?.teamName ?? null);
  const [teamLogoUrl, setTeamLogoUrl] = useState<string | null>(teamInfoCache?.teamLogoUrl ?? null);
  // 2026-07-18, Lino: "ich sehe den Team Button nicht mehr wo ich die Team
  // Sachen einstellen könnte" — real bug found (not an account/role
  // problem): gating this purely on isAdmin also hid the link for anyone
  // WITHOUT a team yet (teams[0] undefined → isAdmin stayed false), but
  // someone with no team is exactly who needs this link to CREATE one
  // (buy seats) in the first place — team/page.tsx already handles that
  // "no team yet" case with its own create-team form. Default `true` (not
  // `false`) so a no-team user never sees it flash-hidden while the check
  // is in flight; only an existing team's NON-admin member ever actually
  // loses the link, once the fetch below resolves.
  const [showTeamLink, setShowTeamLink] = useState(teamInfoCache?.showTeamLink ?? true);
  // 2026-07-28, Lino: "der Balken mit der Speicheranzeige soll mittig in der
  // Navigation stehen" — was its own left-aligned row on just /projects
  // (projects/page.tsx), moved here so it's centered in the persistent nav
  // and visible on every signed-in page, not just the project overview.
  const [storageUsage, setStorageUsage] = useState<TeamStorageUsage | null>(
    teamInfoCache?.storageUsage ?? null
  );

  // 2026-07-18, Lino: "Team button... nur dem Admin dargestellt" +
  // "gibt man beim Seats kaufen einen Namen ein wird dieser oben neben dem
  // Subshot logo angezeigt" — beides hängt am selben Team-Datensatz, darum
  // ein Fetch dafür. Team-weite Admin-Rolle kommt aus TeamMember.role
  // (siehe team/page.tsx's isCurrentUserAdmin — dort dieselbe Logik), NICHT
  // aus dem projekt-scoped Member.role. Rein UI-seitig, Backend bleibt die
  // eigentliche Durchsetzung (403 für Nicht-Admins). State startet aus
  // teamInfoCache (siehe oben), damit spätere Mounts in derselben Session
  // sofort den richtigen Zustand zeigen; der Fetch hier aktualisiert still
  // im Hintergrund, ohne vorher zurückzusetzen.
  useEffect(() => {
    let cancelled = false;
    Promise.all([api.me(), api.myTeams()])
      .then(async ([me, teams]) => {
        if (cancelled) return;
        // 2026-07-21 — DB is the source of truth for language (so web+iOS
        // always agree), the cookie LanguageProvider read on mount is just
        // a fast local cache that can be stale/absent on a new device.
        // Reconcile once this fetch resolves; setLanguage also re-writes
        // the cookie, so subsequent loads on THIS device start correct.
        if (me.language && me.language !== language) setLanguage(me.language);
        const team = teams[0];
        if (!team) {
          // Kein Team -> Link bleibt sichtbar, siehe Doc-Kommentar oben.
          // Auch kein Speichertarif ohne Team, also keine Anzeige.
          teamInfoCache = { teamName: null, teamLogoUrl: null, showTeamLink: true, storageUsage: null };
          setTeamName(null);
          setTeamLogoUrl(null);
          setShowTeamLink(true);
          setStorageUsage(null);
          return;
        }
        const [members, usage] = await Promise.all([
          api.teamMembers(team.id),
          api.teamStorageUsage(team.id).catch(() => null),
        ]);
        if (cancelled) return;
        const admin = members.some((m) => m.user_id === me.id && m.role === "admin");
        teamInfoCache = { teamName: team.name, teamLogoUrl: team.logo_url, showTeamLink: admin, storageUsage: usage };
        setTeamName(team.name);
        setTeamLogoUrl(team.logo_url);
        setShowTeamLink(admin);
        setStorageUsage(usage);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-screen relative">
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{ backgroundColor: tint ?? "rgba(0, 0, 0, 0)" }}
      />
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-[#161616]/80 border-b border-white/8">
        {/* 2026-07-28, Lino: "der Balken mit der Speicheranzeige soll mittig
            in der Navigation stehen" — grid statt flex-justify-between: die
            mittlere 1fr-Spalte zentriert relativ zur GESAMTEN Nav-Breite,
            unabhängig davon wie breit Logo links bzw. Links rechts gerade
            sind (ein reines `justify-between` mit einem 3. Kind in der Mitte
            würde stattdessen nur den Leerraum dazwischen zentrieren, nicht
            die ganze Bar). */}
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 grid grid-cols-[auto_1fr_auto] items-center gap-4">
          <Link href="/projects" className="flex items-center gap-2 tracking-tight">
            {/* 2026-07-17, Lino: "das emoji oben in der navigation bitte
                löschen" — der 🎬-Clapperboard vor dem Logo-Schriftzug ist
                raus, kein Ersatz-Icon (reiner Text-Wortmarke jetzt). */}
            {/* 2026-07-17, Lino: erst Thunder, dann "wir wechseln da auf den
                Font ANTON" — the logo isn't an <h1> (see AppShell's own doc
                comment on replacing the old per-page bare <h1>), so it needs
                the utility class directly rather than picking it up from
                globals.css's `h1 { }` rule. */}
            {/* 2026-07-17, Lino: "Subshot als Logo Text immer alles gross
                schreiben" — uppercase (not the literal string), same
                non-destructive reasoning as globals.css's h1 rule. */}
            {/* 2026-09-06, Lino: "hat man ein Logo hochgeladen muss es aber
                überall den geschriebenen Firmennamen ersetzen, auch oben im
                Header" — same full-replacement rule as the public preview
                pages' brand header (see Team.logo_key's own doc comment on
                the backend): the logo takes the place of "Subshot - Team"
                entirely, not just the team-name suffix. */}
            {teamLogoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- presigned R2 URL, not a static/local asset next/image can optimize
              <img src={teamLogoUrl} alt={teamName ?? "Team"} className="w-8 h-8 rounded-lg object-cover" />
            ) : (
              <>
                <span className="font-anton text-xl uppercase">Subshot</span>
                {teamName && (
                  <span className="font-anton text-xl uppercase text-white/40">
                    &nbsp;- {teamName}
                  </span>
                )}
              </>
            )}
          </Link>
          {storageUsage && (
            <div className="hidden sm:flex items-center justify-center gap-2.5 text-xs text-white/40">
              <div className="w-[180px] h-1.5 rounded-full bg-white/[0.06] overflow-hidden shrink-0">
                <div
                  className="h-full rounded-full bg-[#3875bd]"
                  style={{ width: `${Math.min(100, (storageUsage.used_bytes / storageUsage.tier_bytes) * 100)}%` }}
                />
              </div>
              <span>
                {t("nav.storageUsage", {
                  used: (storageUsage.used_bytes / 1024 / 1024 / 1024).toFixed(1),
                  tier: storageUsage.tier_gb,
                })}
              </span>
            </div>
          )}
          <div className="flex items-center gap-4 justify-self-end">
            <Link href="/devlog" className="hidden sm:flex items-center gap-1.5 text-sm text-white/60 hover:text-white transition-colors">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
              </svg>
              {t("nav.devlog")}
            </Link>
            <Link href="/feedback" className="hidden sm:flex items-center gap-1.5 text-sm text-white/60 hover:text-white transition-colors">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
              {t("nav.feedback")}
            </Link>
            <CreditsNavLink />
            {showTeamLink && (
              <Link href="/team" className="flex items-center gap-1.5 text-sm text-white/60 hover:text-white transition-colors">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                {t("nav.team")}
              </Link>
            )}
            <NotificationBell />
            <UserButton
              appearance={{
                elements: { userButtonAvatarBox: "w-8 h-8" },
              }}
            >
              <UserButton.MenuItems>
                <UserButton.Action
                  label={t("avatar.language")}
                  onClick={() => setShowLanguageDialog(true)}
                  labelIcon={
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z" />
                    </svg>
                  }
                />
                <UserButton.Action
                  label={t("avatar.notifications")}
                  onClick={() => setShowNotificationSettings(true)}
                  labelIcon={
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                    </svg>
                  }
                />
                {/* 2026-07-22 (pre-public-launch checklist) — legal pages live on the
                    backend (subshot.ch/impressum, cross-links to /datenschutz and
                    /agb from there), not duplicated into this Next.js app. */}
                <UserButton.Link
                  label={t("avatar.legal")}
                  href="https://subshot.ch/impressum"
                  labelIcon={
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
                    </svg>
                  }
                />
              </UserButton.MenuItems>
            </UserButton>
          </div>
        </div>
      </header>
      <main className="flex-1 flex flex-col">{children}</main>
      <LanguageDialog open={showLanguageDialog} onClose={() => setShowLanguageDialog(false)} />
      <NotificationSettingsDialog open={showNotificationSettings} onClose={() => setShowNotificationSettings(false)} />
    </div>
  );
}
