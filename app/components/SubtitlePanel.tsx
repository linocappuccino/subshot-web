"use client";

import { useEffect, useRef, useState } from "react";
import { useLanguage, type TranslationKey } from "@/lib/i18n";

/** Lang-agnostic cue shape this component actually renders — either a
 * SubtitleSegment (original) or a SubtitleTranslationCue (an alternate
 * language), both share exactly this shape (see lib/types.ts). The parent
 * (VideoReviewModal) picks WHICH track's list this is based on `lang`. */
type SubtitleCue = { id: string; text: string; edited: boolean };

// 2026-07-21-style width constant, same shape as VideoReviewModal's own
// COMMENT_COL_WIDTH. 2026-07-28, Lino: "die Spalte soll breiter sein für
// die Untertitel" — bumped from the original 420 (a flowing transcript
// reads better with more horizontal room per line than the original
// per-segment-box layout needed).
export const SUBTITLE_COL_WIDTH = 560;

// 2026-07-28, Lino: text-size dropdown, initially 4 named sizes
// (text-xs..text-lg) — replaced with a plain px-number picker ("als
// Zahlauswahl") per his follow-up, and pushed well past the old text-lg
// (18px) ceiling ("da darfst du noch einiges grösser gehen"), up to 48px.
const TEXT_SIZE_OPTIONS_PX = [12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48];
const DEFAULT_TEXT_SIZE_PX = 14;

// 2026-07-29, Lino: Übersetzungs-Button — mirrors app/translation.py's
// SUPPORTED_LANGUAGES on the backend exactly (ISO 639-1 codes the free
// Google-Translate endpoint accepts). Keep both lists in sync if either
// side ever grows.
export const SUBTITLE_LANGUAGES: Record<string, string> = {
  de: "Deutsch",
  en: "English",
  fr: "Français",
  it: "Italiano",
  es: "Español",
  pt: "Português",
  nl: "Nederlands",
};

// 2026-07-28, Lino: "doppelte Zeilenumschläge sollen IMMER nach einem Satz
// sein, nicht nach einem Segment" — an SRT cue is NOT reliably one
// sentence; a sentence often runs across 2+ segments (a mid-sentence cue
// break), so the break-after-every-segment rule read wrong wherever that
// happened. A segment only gets the double `<br />` if its OWN text ends
// on real sentence-ending punctuation (., !, ?, … — optionally followed by
// a closing quote/paren) — otherwise it's joined to the next segment with
// a plain space, same as mid-sentence prose.
function endsSentence(text: string): boolean {
  return /[.!?…]["'”’)\]]*$/.test(text.trimEnd());
}

/** 2026-07-28, Lino: "ich möchte einen Fliesstext mit unsichtbaren
 * Segmenten" — a complete redesign from the original per-segment-textarea
 * layout (which read as a stack of disjointed boxes, not a transcript).
 * Every segment is still its own independently-editable unit under the
 * hood (own contentEditable `<span>`, own blur-triggered save, own
 * immutable timecode — see SubtitleSegmentPatch in the backend, still has
 * no timecode fields at all) — the redesign is PURELY visual: every span
 * renders `display: inline` with zero border/background/padding-box
 * styling, joined by a plain space, inside ONE shared paragraph flow, so
 * the whole thing reads and wraps exactly like ordinary running prose —
 * no visible seam anywhere between one segment's text and the next, even
 * while idle (no focus highlight either — "unsichtbar" taken literally,
 * not just "subtle").
 *
 * Cursor-safety follows the SAME idea RichTextEditor.tsx already proved out
 * for a much harder contentEditable case in this codebase: an external
 * update (initial load, a Pusher live-sync refetch, a version switch) only
 * ever touches a span's `textContent` when it actually differs from the
 * incoming segment text — checked against the DOM's OWN current
 * `textContent` (not a side-cache, see that effect's own doc comment for
 * why) — and never overwrites a span the user currently has focused, so
 * live-sync never yanks the cursor mid-type.
 *
 * 2026-07-28, Lino: "werden Korrekturen gemacht soll dies irgendwo
 * gekennzeichnet werden" — a segment whose text has ever been edited
 * (`seg.edited`, set server-side, never reset) gets a plain text-color
 * change (amber) instead of white — still zero box/border/background, so
 * it doesn't reintroduce the seams the "unsichtbar" redesign removed.
 *
 * 2026-07-29, Lino: Übersetzungs-Button — "unbedingt über einen gratis
 * service!!" (see app/translation.py: deep-translator/Google, no API key).
 * `lang` picks whether the flowing text shows/edits the original transcript
 * or one specific alternate language. 2026-08-08: this component is now
 * fully LANG-AGNOSTIC — it just renders whichever cue list `cues` is (the
 * parent, VideoReviewModal, already resolved that to either the original
 * segments or one language's own independent track, see
 * SubtitleTranslation's doc comment in models.py for why a translation
 * track is no longer 1:1 with the original's cue count/timing) and calls
 * `onEditText(cueId, text)` — it no longer needs to know or care whether
 * `lang` is "original" or a real code. Every language shares this exact
 * same editing surface, so the whole cursor-safety/edited-highlight
 * machinery below applies identically to all of them. Switching languages
 * never touches timing. */
export function SubtitlePanel({
  cues,
  hasOriginal,
  originalLang,
  loading,
  onEditText,
  canManage,
  uploading,
  onUpload,
  onDownload,
  lang,
  availableLangs,
  onChangeLang,
  translating,
  onTranslate,
}: {
  cues: SubtitleCue[];
  /** 2026-08-08 — ob der Original-Track überhaupt Inhalt hat, UNABHÄNGIG
   * von `lang`/`cues` (die jetzt den gerade AKTIVEN Tab zeigen). Der
   * Übersetzen-Button hängt vom Original ab (translate_subtitles übersetzt
   * immer VOM Original aus), nicht vom gerade sichtbaren Tab — ohne dieses
   * Flag würde er beim Betrachten einer Sprache verschwinden, obwohl
   * Übersetzen weiterhin möglich wäre. */
  hasOriginal: boolean;
  /** 2026-08-08, Lino: "es soll nicht Original heissen sondern auch
   * einfach die Sprache die es ist wenn man mehrere Sprachen hochlädt" —
   * the original's own auto-detected language code, used to label its tab
   * like every other language; null falls back to the generic "Original"
   * label (empty track, undetected, or a pre-existing video from before
   * this field existed). */
  originalLang: string | null;
  loading: boolean;
  onEditText: (cueId: string, text: string) => void;
  canManage: boolean;
  uploading?: boolean;
  /** 2026-08-08, Lino (2nd pass — "der button soll einfach nur SRT
   * hochladen sein... das Tool soll bei SRT hochladen die Sprachen auch
   * checken"): EIN Upload-Weg für alles — beliebig viele Files auf einmal
   * (Mehrfachauswahl im selben Datei-Dialog), das Backend erkennt pro
   * Datei die Sprache und entscheidet selbst, ob sie das Original ersetzt
   * (gleiche Sprache wie das bisherige Original) oder einen eigenen
   * Sprach-Track anlegt/ersetzt (siehe upload_subtitles' eigener
   * Doc-Kommentar in main.py für die genaue Routing-Regel). */
  onUpload?: (files: File[]) => void;
  onDownload?: () => void;
  /** "original" oder ein Sprachcode (z.B. "fr") — welche Spalte gerade
   * angezeigt/bearbeitet wird. 2026-08-07: kein binäres original/translated
   * mehr — ein Video kann mehrere Sprachen gleichzeitig haben (Swiss
   * DE/FR/IT-Anforderung), jede mit ihren eigenen Korrekturen. */
  lang: string;
  /** Welche Sprachen diese Version überhaupt hat (Reiter neben "Original")
   * — vom Elternteil aus `Object.keys(subtitles.translations)` abgeleitet,
   * da dieses Component seit 2026-08-08 nur noch die aktive Liste sieht,
   * nicht mehr die komplette SubtitlesData-Struktur. */
  availableLangs: string[];
  onChangeLang: (lang: string) => void;
  translating?: boolean;
  /** Undefined auf der öffentlichen Preview-Seite (editor-gated im
   * Backend) — der Übersetzen-Button (NEUE Sprache hinzufügen) wird dann
   * gar nicht erst gerendert. Bereits vorhandene Sprachen bleiben aber auf
   * beiden Oberflächen wähl- und korrigierbar. */
  onTranslate?: (targetLang: string) => void;
}) {
  const { t } = useLanguage();
  const [textSizePx, setTextSizePx] = useState(DEFAULT_TEXT_SIZE_PX);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const spanRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const focusedIdRef = useRef<string | null>(null);
  const [pickedTargetLang, setPickedTargetLang] = useState("en");

  // 2026-07-28, Lino: "geht man eine Version zurueck und wieder nach vorne,
  // werden die Untertitel transparent angezeigt" — a version switch
  // unmounts these spans (VideoReviewModal's subtitle-fetch effect swaps in
  // a whole new `cues` array keyed by the OTHER version's ids), then
  // switching back remounts brand-new, EMPTY spans for the original
  // version's (unchanged) ids. This effect used to compare against a
  // `lastWritten` ref cache that survives that whole round trip — since the
  // text hadn't actually changed, it saw "nothing to do" and skipped
  // writing into the freshly-mounted (still empty) span, leaving it
  // rendered with no text at all (which read as "transparent"). Comparing
  // against the DOM's OWN current `textContent` instead of a side-cache
  // fixes it: a freshly-mounted empty span always differs from its real
  // cue text and gets filled in, while an already-correct, unfocused span
  // (nothing external changed) is left alone exactly as before.
  // 2026-07-29: also re-runs on `lang` — switching Original/Übersetzt must
  // rewrite every (unfocused) span to the other column's text (2026-08-08:
  // `cues` itself already IS the right column now, the parent swaps it).
  useEffect(() => {
    for (const cue of cues) {
      if (focusedIdRef.current === cue.id) continue;
      const el = spanRefs.current[cue.id];
      if (!el) continue;
      if (el.textContent !== cue.text) {
        el.textContent = cue.text;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cues, lang]);

  function commit(cueId: string, text: string) {
    const cue = cues.find((c) => c.id === cueId);
    if (!cue) return;
    if (text === cue.text) return;
    onEditText(cueId, text);
  }

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {canManage && (
        <div className="flex flex-wrap items-center gap-2 px-1 pb-3 shrink-0">
          {/* 2026-08-08, Lino (2nd pass — "der button soll einfach nur SRT
              hochladen sein, das Tool soll bei SRT hochladen die Sprachen
              auch checken"): EIN Upload-Button/-Dialog, `multiple` erlaubt
              eine Mehrfachauswahl im selben Datei-Dialog — das Backend
              entscheidet pro Datei selbst, ob sie das Original ersetzt
              oder einen eigenen Sprach-Track anlegt (siehe onUpload's
              eigener Doc-Kommentar oben). */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".srt"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length > 0) onUpload?.(files);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="text-xs font-medium text-white/70 hover:text-white bg-white/5 hover:bg-white/10 disabled:opacity-50 rounded-lg px-3 py-1.5 transition-colors"
          >
            {uploading ? t("subtitlePanel.uploading") : t("subtitlePanel.upload")}
          </button>
          {cues.length > 0 && (
            <button
              onClick={() => onDownload?.()}
              className="text-xs font-medium text-white/70 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg px-3 py-1.5 transition-colors"
            >
              {t("subtitlePanel.download")}
            </button>
          )}
          <select
            value={textSizePx}
            onChange={(e) => setTextSizePx(Number(e.target.value))}
            title={t("subtitlePanel.textSize")}
            className="text-xs font-medium text-white/70 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg px-2 py-1.5 transition-colors focus:outline-none"
          >
            {TEXT_SIZE_OPTIONS_PX.map((px) => (
              <option key={px} value={px} className="bg-neutral-900">
                {px}px
              </option>
            ))}
          </select>
          {/* 2026-07-29, Lino: Übersetzungs-Button — Zielsprache waehlen +
              auslösen, komplett ueber einen gratis Dienst (siehe
              app/translation.py). Editor-gated wie das Upload selbst. */}
          {onTranslate && hasOriginal && (
            <>
              <select
                value={pickedTargetLang}
                onChange={(e) => setPickedTargetLang(e.target.value)}
                title={t("subtitlePanel.targetLanguage")}
                className="text-xs font-medium text-white/70 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg px-2 py-1.5 transition-colors focus:outline-none"
              >
                {Object.entries(SUBTITLE_LANGUAGES).map(([code, label]) => (
                  <option key={code} value={code} className="bg-neutral-900">
                    {label}
                  </option>
                ))}
              </select>
              <button
                onClick={() => onTranslate(pickedTargetLang)}
                disabled={translating}
                className="text-xs font-medium text-white/70 hover:text-white bg-white/5 hover:bg-white/10 disabled:opacity-50 rounded-lg px-3 py-1.5 transition-colors"
              >
                {translating ? t("subtitlePanel.translating") : t("subtitlePanel.translate")}
              </button>
            </>
          )}
        </div>
      )}
      {/* Sprach-Reiter — ein Reiter pro Sprache, die diese Version je hatte
          (Original + jede übersetzte Sprache unabhängig, 2026-08-07), für
          JEDE Rolle sichtbar (auch öffentliche Preview-Besucher), nicht nur
          canManage — Korrigieren einer bereits vorhandenen Sprache ist
          bewusst genauso offen wie beim Original (siehe
          patch_subtitle_segment/patch_share_subtitle_segment im Backend);
          nur das ERSTMALIGE Übersetzen in eine neue Sprache bleibt
          editor-gated (onTranslate oben). Sichtbar sobald mindestens eine
          Übersetzung existiert — bei nur einer Originalsprache lohnt sich
          kein Umschalter. */}
      {availableLangs.length > 0 && (
        <div className="flex items-center gap-2 px-1 pb-3 shrink-0">
          <SubtitleLangTabs lang={lang} originalLang={originalLang} availableLangs={availableLangs} onChangeLang={onChangeLang} t={t} />
        </div>
      )}
      {/* 2026-07-28, Lino: "es braucht wenn eine SRT hinzugefügt wurde im
          Videoplayer eine kleine Info dass der Text bearbeitet werden
          kann" — the flowing-text redesign deliberately removed every
          visual "this is editable" cue (no boxes/borders, see this
          component's own doc comment), which reads great as a transcript
          but gives nobody — team member or public preview visitor — any
          hint they can just click in and correct it. One small pinned line
          above the scrollable text, shown for both surfaces whenever
          there's actually something to correct. */}
      {cues.length > 0 && (
        <p className="text-[11px] text-white/30 px-1 pb-2 shrink-0">{t("subtitlePanel.editableHint")}</p>
      )}
      <div className="flex-1 overflow-y-auto min-h-0 pr-1">
        {loading ? (
          <p className="text-xs text-white/40 px-1">{t("common.loading")}</p>
        ) : cues.length === 0 ? (
          <p className="text-xs text-white/40 px-1">
            {canManage ? t("subtitlePanel.emptyCanUpload") : t("subtitlePanel.emptyNoAccess")}
          </p>
        ) : (
          // One shared paragraph flow — segments are `inline` spans, still
          // completely unstyled (no box/border/background, see this
          // component's own doc comment above). 2026-07-28, Lino: "mache
          // nach einem Satz immer einen Zeilenumbruch für die
          // Übersichtlichkeit (dieser taucht dann natürlich nicht in der
          // SRT auf)" — a break after a sentence-ending segment (instead of
          // a plain space) reads like a script/transcript with one line per
          // sentence, WITHOUT reintroducing visible per-segment boxes. Two
          // `<br />`s (a full blank line, per Lino's "eher zwei
          // Zeilenumschläge") — but ONLY where `endsSentence()` says the
          // segment's text actually ends a sentence (see that function's own
          // doc comment: a segment mid-sentence gets a plain space instead,
          // per Lino's later correction — cue breaks and sentence breaks
          // aren't the same thing). Purely a rendering choice — neither the
          // `<br />`s nor the joining space ever lives in a segment's own
          // `text` (what actually gets saved/exported), so it can never leak
          // into the downloaded .srt. Text size is user-adjustable via the
          // toolbar's px-number dropdown (`textSizePx` state) — a plain
          // inline `fontSize`, not a Tailwind class, since the requested
          // range (12-48px) doesn't map onto Tailwind's fixed text-size
          // scale.
          <div
            style={{ fontSize: `${textSizePx}px` }}
            className="leading-relaxed text-white/90 whitespace-pre-wrap px-1 py-1"
          >
            {cues.map((cue, i) => (
              <span key={cue.id}>
                <span
                  ref={(el) => {
                    spanRefs.current[cue.id] = el;
                  }}
                  contentEditable
                  suppressContentEditableWarning
                  title={cue.edited ? t("subtitlePanel.editedHint") : undefined}
                  className={cue.edited ? "outline-none text-amber-300/90" : "outline-none"}
                  onFocus={() => {
                    focusedIdRef.current = cue.id;
                  }}
                  onBlur={(e) => {
                    focusedIdRef.current = null;
                    commit(cue.id, e.currentTarget.textContent ?? "");
                  }}
                />
                {i < cues.length - 1 ? (
                  endsSentence(cue.text) ? (
                    <>
                      <br />
                      <br />
                    </>
                  ) : (
                    " "
                  )
                ) : null}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Sprach-Reiter (2026-08-07, ersetzt den alten binären Original/Übersetzt-
 * Umschalter) — ein Tab pro Sprache, die diese Version je hatte, damit man
 * z.B. zwischen Original, Français und Italiano hin- und herwechseln kann
 * und dabei IMMER die eigene gespeicherte Korrektur jeder Sprache sieht,
 * nie eine überschriebene/verlorene. Eigene Komponente nur weil sie an zwei
 * leicht unterschiedlichen Stellen im Toolbar-Bereich oben eingehängt wird
 * (canManage vs. nicht), Logik/Markup sollen dabei nicht auseinanderlaufen. */
function SubtitleLangTabs({
  lang,
  originalLang,
  availableLangs,
  onChangeLang,
  t,
}: {
  lang: string;
  originalLang: string | null;
  availableLangs: string[];
  onChangeLang: (lang: string) => void;
  t: (key: TranslationKey) => string;
}) {
  function tabClass(active: boolean) {
    return active
      ? "px-2.5 py-1 rounded-md bg-white/15 text-white"
      : "px-2.5 py-1 rounded-md text-white/50 hover:text-white/80";
  }
  // 2026-08-08, Lino: "es soll nicht Original heissen sondern auch
  // einfach die Sprache die es ist wenn man mehrere Sprachen hochlädt" —
  // same lookup the alternate-language tabs already use below, falling
  // back to the generic "Original" label only when the language genuinely
  // isn't known (see originalLang's own doc comment).
  const originalLabel = originalLang ? SUBTITLE_LANGUAGES[originalLang] ?? originalLang.toUpperCase() : t("subtitlePanel.original");
  return (
    <div className="inline-flex flex-wrap text-xs font-medium bg-white/5 rounded-lg p-0.5 gap-0.5">
      <button onClick={() => onChangeLang("original")} className={tabClass(lang === "original")}>
        {originalLabel}
      </button>
      {availableLangs.map((code) => (
        <button key={code} onClick={() => onChangeLang(code)} className={tabClass(lang === code)}>
          {SUBTITLE_LANGUAGES[code] ?? code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
