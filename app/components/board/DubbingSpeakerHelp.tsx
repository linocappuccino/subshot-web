"use client";

/** 2026-11-13, Lino: the shared studio (speaker link) opens with a short «So funktioniert's» — German or English
 * depending on the language set (the app's language cookie, else the browser), with a DE/EN switch. «Nicht mehr
 * anzeigen» is remembered per browser; the «?» in the header opens it again. */
import { useEffect, useState } from "react";

type L = "de" | "en";
const HIDE_KEY = "subshot-dubbing-help-hidden";
const LANG_KEY = "subshot-dubbing-help-lang";

function startLang(): L {
  try {
    const own = localStorage.getItem(LANG_KEY);
    if (own === "de" || own === "en") return own;
  } catch {
    // private mode
  }
  const cookie = typeof document !== "undefined" ? document.cookie.match(/(?:^|; )subshot_lang=([^;]*)/) : null;
  if (cookie) return cookie[1] === "en" ? "en" : "de";
  return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("de") ? "de" : "en";
}

const TEXT: Record<L, { title: string; steps: [string, string][]; blocked: string; go: string; hide: string }> = {
  de: {
    title: "So funktioniert's",
    steps: [
      ["🎙️ Mikrofon freigeben", "Wähle oben rechts dein Mikrofon und klicke im Browser auf «Erlauben». Am besten mit Kopfhörern, sonst nimmt das Mikrofon den Ton vom Video mit."],
      ["🎬 Abschnitt wählen", "Klicke unten auf der Timeline einen Abschnitt an. Einen neuen legst du an, indem du in einer freien Stelle der Timeline ziehst."],
      ["📝 Text einfügen und ablesen", "Füge den Sprechtext links ein oder passe ihn an. Mit dem Griff am rechten Rand machst du die Textspalte schmaler, «Text über Video» legt den Text gross aufs Bild."],
      ["⏺ Aufnehmen", "Drück «Aufnehmen»: nach 3-2-1 läuft das Video, und du sprichst synchron dazu. Du kannst pro Abschnitt beliebig viele Takes aufnehmen und jeden mit ▶ anhören."],
      ["🔊 Ton beim Abspielen", "«Split sound»: Originalton, wo noch nichts aufgenommen ist, sonst deine Aufnahme. «Full audio»: nur das Original. «No sound»: stumm."],
      ["✅ Fertig", "Alles wird automatisch gespeichert, das Team sieht deine Takes sofort."],
    ],
    blocked: "Das Mikrofon ist im Browser blockiert. Klicke links in der Adressleiste auf das Schloss bzw. das Kamera-/Mikrofon-Symbol, erlaube das Mikrofon und lade die Seite neu.",
    go: "Los geht's",
    hide: "Nicht mehr anzeigen",
  },
  en: {
    title: "How it works",
    steps: [
      ["🎙️ Allow the microphone", "Pick your microphone at the top right and click «Allow» when the browser asks. Headphones work best — otherwise the microphone also records the video's sound."],
      ["🎬 Pick a section", "Click a section on the timeline at the bottom. To add a new one, drag across an empty part of the timeline."],
      ["📝 Add and read the script", "Paste or edit the script on the left. Drag the handle on its right edge to make the column narrower; «Text über Video» puts the script big over the picture."],
      ["⏺ Record", "Press «Aufnehmen» (record): after 3-2-1 the video plays and you speak along. Record as many takes per section as you like and play each one with ▶."],
      ["🔊 Playback sound", "«Split sound»: original sound where nothing is recorded yet, otherwise your recording. «Full audio»: only the original. «No sound»: silent."],
      ["✅ Done", "Everything is saved automatically — the team sees your takes right away."],
    ],
    blocked: "The microphone is blocked in your browser. Click the lock or camera/microphone icon in the address bar, allow the microphone and reload the page.",
    go: "Let's go",
    hide: "Don't show again",
  },
};

export function useSpeakerHelp(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(HIDE_KEY) !== "1";
    } catch {
      return true;
    }
  });
  return [open, setOpen];
}

export function DubbingSpeakerHelp({ onClose }: { onClose: () => void }) {
  const [lang, setLang] = useState<L>(startLang);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    let alive = true;
    navigator.permissions
      ?.query({ name: "microphone" as PermissionName })
      .then((p) => {
        if (!alive) return;
        setBlocked(p.state === "denied");
        p.onchange = () => alive && setBlocked(p.state === "denied");
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const t = TEXT[lang];
  function pickLang(l: L) {
    setLang(l);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      // private mode
    }
  }
  return (
    <div data-speaker-help className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-auto rounded-2xl bg-[#1d1f26] border border-white/10 p-5 text-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <h2 className="flex-1 text-lg font-bold">{t.title}</h2>
          <div className="flex rounded-lg bg-black/30 p-0.5 text-xs font-semibold">
            {(["de", "en"] as const).map((l) => (
              <button key={l} type="button" data-help-lang={l} onClick={() => pickLang(l)} className={`px-2 py-1 rounded-md ${lang === l ? "bg-white text-black" : "text-white/60 hover:text-white"}`}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        {blocked && <p data-help-blocked className="mb-3 rounded-lg bg-red-500/15 border border-red-400/30 px-3 py-2 text-sm text-red-200">⚠︎ {t.blocked}</p>}
        <ol className="flex flex-col gap-3">
          {t.steps.map(([head, body], i) => (
            <li key={i} className="text-sm">
              <div className="font-semibold">{head}</div>
              <div className="text-white/65 leading-snug">{body}</div>
            </li>
          ))}
        </ol>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" data-help-go onClick={onClose} className="rounded-lg bg-rose-500 hover:bg-rose-400 px-4 py-2 text-sm font-semibold">
            {t.go}
          </button>
          <button
            type="button"
            data-help-hide
            onClick={() => {
              try {
                localStorage.setItem(HIDE_KEY, "1");
              } catch {
                // private mode
              }
              onClose();
            }}
            className="text-sm text-white/50 hover:text-white"
          >
            {t.hide}
          </button>
        </div>
      </div>
    </div>
  );
}
