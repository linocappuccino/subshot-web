"use client";

/* 2026-11-16, Lino: «DaVinci-Plugin direkt auf der Webseite downloadbar, Download wird bei jeder neuen Version
   automatisch aktualisiert» — data live from https://subshot.ch/download/davinci/latest.json; the stable link
   /download/davinci always redirects to the newest .pkg. Until a release exists: «bald verfügbar», no link. */
import { useEffect, useState } from "react";
import { useLanguage } from "@/lib/i18n";

export type PluginRelease = { available: boolean; version?: string; size?: number; released_at?: string; macos?: string | null; min_resolve?: string | null; notes?: string | null };

const API = process.env.NEXT_PUBLIC_API_BASE_URL || "https://subshot.ch";
export const DAVINCI_DOWNLOAD_URL = `${API}/download/davinci`;
export const DAVINCI_HOWTO_URL = "/how-to?post=help-subtitle-sync";
let cache: Promise<PluginRelease> | null = null;

export function usePluginRelease(): PluginRelease | null {
  const [r, setR] = useState<PluginRelease | null>(null);
  useEffect(() => {
    cache ??= fetch(`${API}/download/davinci/latest.json`, { cache: "no-store" }).then((x) => x.json()).catch(() => ({ available: false }));
    let alive = true;
    cache.then((d) => { if (alive) setR(d); });
    return () => { alive = false; };
  }, []);
  return r;
}

const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" }) : "");

/** variant «full» = card (account page), «button» = toolbar button, «inline» = one small line (Resolve box),
 *  «line» = subtle row on the projects overview */
export function DavinciDownload({ variant = "full" }: { variant?: "full" | "button" | "inline" | "line" }) {
  const r = usePluginRelease();
  const en = useLanguage().language === "en";
  const forResolve = en ? "For DaVinci Resolve" : "Für DaVinci Resolve";
  if (!r) return null;
  if (variant === "line") {
    return (
      <div data-davinci-download className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 text-sm">
        <span className="text-base" aria-hidden>🎬</span>
        <span className="font-medium text-white/85">{en ? "DaVinci plugin" : "DaVinci-Plugin"}</span>
        <span className="text-white/45">
          {r.available ? `Version ${r.version} · ${fmtDate(r.released_at)} · ${forResolve} · macOS` : `${en ? "Coming soon" : "Bald verfügbar"} · ${forResolve} · macOS`}
        </span>
        <span className="ml-auto flex items-center gap-3">
          <a href={DAVINCI_HOWTO_URL} className="text-white/45 underline hover:text-white/75">How to</a>
          {r.available && (
            <a href={DAVINCI_DOWNLOAD_URL} className="rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-500">{en ? "⬇ Download" : "⬇ Herunterladen"}</a>
          )}
        </span>
      </div>
    );
  }
  if (variant === "button") {
    if (!r.available) return null;
    return (
      <a data-davinci-download href={DAVINCI_DOWNLOAD_URL} title={`${en ? "DaVinci plugin" : "DaVinci-Plugin"} ${r.version} · ${fmtDate(r.released_at)}`}
        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500">
        ⬇ {en ? "DaVinci plugin" : "DaVinci-Plugin"} {r.version}
      </a>
    );
  }
  if (variant === "inline") {
    return (
      <div data-davinci-download className="mt-2 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-2 text-[11px] text-white/45">
        {r.available ? (
          <>
            <a href={DAVINCI_DOWNLOAD_URL} className="rounded-md bg-blue-600 px-2 py-0.5 font-medium text-white hover:bg-blue-500">⬇ Plugin {r.version}</a>
            <span>{fmtDate(r.released_at)} · {forResolve} · macOS</span>
          </>
        ) : (
          <span>{en ? "DaVinci plugin: coming soon" : "DaVinci-Plugin: bald verfügbar"}</span>
        )}
        <a href={DAVINCI_HOWTO_URL} className="ml-auto underline hover:text-white/70">How to</a>
      </div>
    );
  }
  return (
    <section id="davinci-plugin" data-davinci-download className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <h2 className="text-lg font-semibold">{en ? "DaVinci plugin" : "DaVinci-Plugin"}</h2>
      <p className="mt-1 text-sm text-white/55">{forResolve} · macOS{r.available && r.macos ? ` ${r.macos}+` : ""}. {en ? "The link always downloads the latest version." : "Der Link lädt immer die neueste Version."}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {r.available ? (
          <>
            <a href={DAVINCI_DOWNLOAD_URL} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500">{en ? "⬇ Download plugin" : "⬇ Plugin herunterladen"}</a>
            <span className="text-sm text-white/70">Version {r.version} · {fmtDate(r.released_at)}{r.size ? ` · ${Math.round(r.size / 1048576)} MB` : ""}</span>
          </>
        ) : (
          <span className="text-sm text-white/60">{en ? "Coming soon." : "Bald verfügbar."}</span>
        )}
        <a href={DAVINCI_HOWTO_URL} className="text-sm text-white/50 underline hover:text-white/80">How to</a>
      </div>
      {r.available && r.notes && <p className="mt-3 whitespace-pre-line text-xs text-white/45">{r.notes}</p>}
    </section>
  );
}
