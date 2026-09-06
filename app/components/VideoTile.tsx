"use client";

import { useRef, useState } from "react";
import { Pill } from "./ui/Badge";
import { Menu, MenuItem } from "./ui/Menu";
import { Avatar } from "./ui/Avatar";
import { DateTimePicker } from "./ui/DateTimePicker";
import type { Member, PostproductionStatus, Video, VideoVersion } from "@/lib/types";
import { useLanguage } from "@/lib/i18n";

// 2026-07-18 (Todoist #192, Lino: "jeder Status eine eigene Farbe") — all
// three non-final statuses used to share the same grey "default" tone,
// making them indistinguishable at a glance.
export const STATUS_TONE: Record<PostproductionStatus, "default" | "good" | "danger" | "info" | "warning"> = {
  wartend: "default",
  in_bearbeitung: "info",
  wartet_auf_feedback: "warning",
  abgeschlossen: "good",
  abgelehnt: "danger",
};

// 2026-07-19 (Todoist #218, Lino: "hintergrundglow wie in der
// projektübersicht, die farbe soll den status repräsentieren") — same hex
// values as Badge.tsx's tone color classes (bg-emerald-500/bg-red-500/
// bg-blue-500/bg-amber-500), read off manually since the glow needs a raw
// CSS color for backgroundColor, not a Tailwind class name.
const STATUS_GLOW_COLOR: Record<PostproductionStatus, string> = {
  wartend: "#9ca3af",
  in_bearbeitung: "#3b82f6",
  wartet_auf_feedback: "#f59e0b",
  abgeschlossen: "#10b981",
  abgelehnt: "#ef4444",
};

// 2026-07-17, Lino: "die kachel soll sich in der breite der videogrösse
// anpassen (gibt ja nur 9:16 und 16:9)" — vorher lag die Kachel in einem
// CSS-Grid mit fixen Spalten (alle Kacheln gleich breit, nur die Höhe
// passte sich per aspect-ratio an). Jetzt gibt jede Kachel eine Ziel-
// HÖHE per CSS vor, die Breite ergibt sich per CSS `aspect-ratio`
// automatisch daraus (Browser-berechnet) — der Elterncontainer
// (postproduction/page.tsx) ist dafür auf `flex flex-wrap` umgestellt,
// kein CSS-Grid mehr.
//
// Zweite Runde (2026-07-17, Lino: "warum sind die kacheln auf einmal
// kleiner geworden??") — ein fester Pixel-Wert (240px) ignorierte die
// Bildschirmgrösse komplett, während das alte Grid (2/3/4 Spalten je nach
// Breakpoint) auf grossen Screens automatisch deutlich grössere Kacheln
// erzeugte. `clamp()` mit einer vw-Komponente bringt diese Responsivität
// zurück, ohne zum Grid zurückzumüssen (das die variable Breite pro
// Kachel ja gerade nicht konnte).
// 2026-08-25 — the literal clamp() moved into globals.css's --video-tile-h custom property so a
// narrow-viewport media query can give it a different floor (see that file's comment) — this
// component just references the variable now, with the same clamp as a fallback for anywhere the
// custom property somehow isn't defined.
const TILE_HEIGHT_CSS = "var(--video-tile-h, clamp(220px, 22vw, 400px))";

/** Kachel-Darstellung fuer ein Video (2026-07-17, Lino: "hier sollen auch
 * wieder kacheln dargestellt werden, im thumbnail der kachel soll immer
 * ein frame vom hochgeladenen video dargestellt werden... man kann über
 * die kachel fahren und das video spielt mit dem mauszeiger"). Zeigt immer
 * die NEUESTE 'ready' Version (Klick öffnet automatisch die aktuellste
 * Version, siehe VideoReviewModal's eigener initialer Index).
 *
 * Hover-Scrubbing OHNE echtes <video>-Element -- ein Sprite-Bild
 * (filmstrip_url, N Frames nebeneinander, siehe backend
 * video_processing.py) wird per CSS background-position verschoben, kein
 * Netzwerk-Request pro Mausbewegung, kein Video-Decode auf einer Seite mit
 * potenziell vielen Kacheln gleichzeitig.
 *
 * Zweite Runde (2026-07-17, Lino: "die video kacheln sollen direkt auf der
 * postproductionseite sein.. keine zeilen ansicht... auf der video kachel
 * sieht mann dann auch die deadlin, status und titel... die version soll
 * auch zu sehen sein") — vorher war die Kachel ein einzelnes <button>
 * (siehe postproduction/page.tsx's fruehere Zeilen-Ansicht mit Status/
 * Deadline im Zeilen-Header). Jetzt traegt die Kachel Status+Deadline
 * selbst als eigener Footer UNTER dem Thumbnail (kein <select>/DatePicker
 * in einem <button> verschachtelt — ungueltiges HTML, deshalb Root jetzt
 * ein <div>, nur die Thumbnail-Flaeche selbst ist klickbar). Versions-
 * Nummer als kleines Badge oben rechts im Thumbnail. */
export function VideoTile({
  video, status, deadline, canEditStatus, canEditDeadline, onOpen, onChangeStatus, onChangeDeadline, onUploadVersion, onRename,
  showDeadlineLabel, uploadFraction, members, onChangeAssignee,
}: {
  video: Video;
  status: PostproductionStatus | null;
  deadline: string | null;
  canEditStatus: boolean;
  canEditDeadline: boolean;
  onOpen: () => void;
  onChangeStatus: (status: PostproductionStatus) => void;
  onChangeDeadline: (date: Date | null) => void;
  /** 2026-08-06, Lino: "auf den kacheln muss man auch auswählen können wer
   * verantwortlich ist für das video: da soll Editor stehen und dann kann
   * man vom Team eine Person auswählen" — undefined `members`/`onChangeAssignee`
   * means "no Editor picker at all" (the public preview page's read-only
   * VideoTile instance never passes these, same opt-out convention as
   * onUploadVersion/onRename above). Editable at the same role floor as
   * status (canEditStatus) — patch_video's own role gate matches. */
  members?: Member[];
  onChangeAssignee?: (userId: string | null) => void;
  /** Undefined = kein 3-Punkte-Menü (nur canEditStatus-Nutzer). */
  onUploadVersion?: (file: File) => void;
  /** Undefined = kein Stift-Icon zum Umbenennen (nur canEditStatus-Nutzer). */
  onRename?: (title: string) => void;
  /** 2026-07-20, Lino (öffentliche Preview-Seite): "Deadline: ..." / bei
   * fehlender Deadline "Deadline: keine" statt nur dem nackten Datum/"—" —
   * bewusst ein eigener Opt-in-Prop statt globaler Textänderung, damit die
   * bestehende Postproduction-Seite (Editor-Rolle ohne Deadline-Recht)
   * unverändert bleibt. */
  showDeadlineLabel?: boolean;
  /** 2026-07-20, Lino: "es muss eine sofortige Upload-Anzeige kommen wo man
   * den Status davon sieht" — 0-1 fraction while a NEW VERSION uploads onto
   * an already-existing tile (postproduction/page.tsx's uploadVersionFromTile),
   * undefined once the upload finishes/isn't running. Same idea as the
   * per-section uploadProgress placeholder box used for a tile's FIRST
   * video, just rendered inline here since this tile already exists. */
  uploadFraction?: number;
}) {
  const { t } = useLanguage();
  const statusLabels: Record<PostproductionStatus, string> = {
    wartend: t("postproductionStatus.wartend"),
    in_bearbeitung: t("postproductionStatus.inBearbeitung"),
    wartet_auf_feedback: t("postproductionStatus.wartetAufFeedback"),
    abgeschlossen: t("postproductionStatus.abgeschlossen"),
    abgelehnt: t("postproductionStatus.abgelehnt"),
  };
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(video.title);
  const readyVersions = video.versions.filter((v) => v.status === "ready");
  const latest = readyVersions[readyVersions.length - 1] as VideoVersion | undefined;
  // 2026-07-19, Lino: "wenn man ein Video hochlädt soll auf der Kachel 'In
  // Verarbeitung' stehen, damit man nicht nur eine leere Kachel sieht, bis
  // Thumbnail und Scrubben verfügbar sind" — `latest` above only ever
  // looks at READY versions, so a version still mid-upload (status
  // 'uploading') was invisible to it entirely, and the tile fell through
  // to the plain "Noch kein Video hochgeladen" empty state exactly as if
  // nothing had been uploaded at all — misleading right after a real
  // upload. Separately, even once a version flips to 'ready', its
  // thumbnail_url/filmstrip_url stay null until video_processing.py's
  // ffmpeg background task finishes (~40s, see #212's own fix) — that gap
  // needs its own distinct "still processing" state, not just "empty".
  const mostRecentVersion = video.versions[video.versions.length - 1] as VideoVersion | undefined;
  const stillUploading = mostRecentVersion?.status === "uploading";
  const stillProcessing = !stillUploading && Boolean(latest) && !latest?.thumbnail_url;
  const tileRef = useRef<HTMLDivElement>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [hovering, setHovering] = useState(false);

  const frameCount = latest?.filmstrip_frame_count ?? 0;
  const hasFilmstrip = !!latest?.filmstrip_url && frameCount > 1;

  function handleMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!hasFilmstrip || !tileRef.current) return;
    const rect = tileRef.current.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setFrameIndex(Math.min(frameCount - 1, Math.floor(fraction * frameCount)));
  }

  const showFilmstripFrame = hovering && hasFilmstrip;
  const bgPositionPercent = frameCount > 1 ? (frameIndex / (frameCount - 1)) * 100 : 0;
  const commentCount = latest?.comments.filter((c) => c.status === "open").length ?? 0;

  // 2026-07-17, Lino: "9:16 videos werden beim scrubben verzogen... kacheln
  // die ein 9:16 video drin haben, können auch im 9:16 format dargestellt
  // werden" — die Kachel war fest auf aspect-video (16:9) genagelt, das
  // Filmstrip-Sprite (jeder Frame in seinem ECHTEN Seitenverhältnis, siehe
  // video_processing.py's `scale=160:-1`) wurde beim Scrubben also in eine
  // falsch-proportionierte Box gequetscht. Fix: Kachel übernimmt das echte
  // Seitenverhältnis aus filmstrip_frame_width/height (Fallback 16:9,
  // solange die Background-Task noch nicht durchgelaufen ist) — sobald
  // Kachel- und Frame-Seitenverhältnis übereinstimmen, verzieht das
  // background-size-Prozent-Mapping unten nichts mehr.
  // 2026-07-26, Lino: "wird ein video hochgeladen und dann bearbeitet, soll
  // die kachel immer die grösse behalten vom hochgeladenen video.. jetzt
  // ändert sie immer auf 16:9" — root cause: `latest` always means the
  // NEWEST ready version, and a freshly uploaded new version flips to
  // 'ready' well before ffmpeg's background task (~40s, #212) has produced
  // ITS OWN filmstrip_frame_width/height. The aspect ratio used to fall
  // straight through to the hardcoded 16:9 the instant that happened, even
  // when an OLDER version of the exact same video already had a known real
  // (e.g. 9:16) ratio sitting right there — the tile visibly snapped to
  // 16:9 for the ~40s gap on every single re-upload. Now walks backwards
  // from the newest ready version to the oldest, using the first one that
  // already has known filmstrip dimensions — only true first-ever uploads
  // (no version has ever finished processing yet) still see the 16:9
  // placeholder.
  const versionWithKnownAspect = [...readyVersions].reverse().find(
    (v) => v.filmstrip_frame_width && v.filmstrip_frame_height
  );
  const aspectRatio = versionWithKnownAspect
    ? versionWithKnownAspect.filmstrip_frame_width! / versionWithKnownAspect.filmstrip_frame_height!
    : 16 / 9;

  // 2026-07-20, Lino: "ein langer Titel verzieht die Kachel in der Breite,
  // das sollte nicht passieren" — CSS min-width:0 + line-clamp allein
  // reichte NICHT: die Breite dieses flex-col-Containers ist "auto"
  // (shrink-to-fit), und ein wrap-faehiger Text traegt trotzdem seine
  // volle EIN-Zeilen-Breite zu dieser Berechnung bei (min-width:0
  // verhindert nur eine MINDESTgroesse, nicht den bevorzugten Max-Content).
  // Ein per JS/ResizeObserver gemessenes Breiten-Cap wurde ausprobiert und
  // wieder verworfen — abhaengig von genau HIER instabil (Chromium
  // scheint den flex-Item-Querschnitt der Thumbnail in Wechselwirkung mit
  // dem Elternelement zu setzen, das fuehrte zu einer echten Feedback-
  // Schleife: Kachel wird durch den Titel breiter -> Thumbnail "stretched"
  // mit -> naechste Messung noch breiter). Stattdessen die Breite rein
  // per CSS `calc()` aus genau denselben zwei Werten berechnet, die die
  // Thumbnail selbst per `aspect-ratio` verwendet (TILE_HEIGHT_CSS *
  // aspectRatio) — komplett unabhängig vom Titel-Inhalt, kein JS, keine
  // Rueckkopplung möglich.
  const tileWidthCss = `calc(${TILE_HEIGHT_CSS} * ${aspectRatio})`;

  return (
    // 2026-07-19 (Todoist #218): NOT overflow-hidden on this outer wrapper
    // (unlike before) — the status glow below needs to bleed past the
    // tile's own rounded corners, same reason projects/page.tsx's tile
    // keeps its glow div as a sibling of the (separately) overflow-hidden
    // thumbnail box rather than a descendant of it. The footer's background
    // respects rounded-xl on its own regardless of overflow, so that part
    // needed no change — but the thumbnail/filmstrip box below had NO
    // border-radius of its own, only relying on THIS div's overflow-hidden
    // to look rounded; removing that here made its square corners poke out
    // at the top (real regression, caught live) until `rounded-t-xl` was
    // added directly to it below.
    // 2026-08-26 — was a framer-motion `layout` FLIP transition (2026-07-19,
    // Lino asked for a smooth reorder animation here); superseded by the
    // newer "wir entfernen uns von Übergangsanimationen, soll super
    // schnell sein" direction — reorders now snap instantly, no animation.
    <div
      style={{ width: tileWidthCss }}
      // 2026-08-25, Lino: "jede kachel soll bildschirmbreit sein für mobile, und untereinander" —
      // `max-sm:w-full!` overrides the inline `tileWidthCss` (Tailwind's `!` beats inline styles)
      // below the `sm` breakpoint, so each tile takes the FULL width of the flex-wrap container
      // instead of its usual aspect-ratio-derived masonry width — with each tile at 100%, the
      // parent's `flex-wrap` naturally stacks them one per row with no other change needed.
      // Desktop (`sm:` and up) is untouched, still the original variable-width masonry layout.
      // 2026-08-26, Lino: "wir entfernen uns vom glass effekt für flächen" — the see-through
      // `bg-white/5` (page background showing through) was the "glass" read on this specific
      // surface; swapped for the app's existing FLAT/opaque card convention already used for
      // every dialog/panel (Modal.tsx, AnnotationsPanel.tsx, TrialExpiredDialog.tsx, etc. all use
      // this same `bg-[#1c1c1e]`, one step lighter than layout.tsx's `#161616` body) — not a new
      // color invented for this one component. The ambient status-glow blur just below this is a
      // separate, deliberate accent (also used on projects/page.tsx's project tiles) and untouched.
      className="relative flex flex-col rounded-xl border border-white/10 bg-[#1c1c1e] shrink-0 max-sm:w-full!"
    >
      {/* 2026-07-19 (Todoist #218) — same ambient-glow technique as the
          project tiles on projects/page.tsx (blurred color layer behind
          the tile, not a box-shadow), colored by postproduction status
          instead of the project's picked color. Opacity dimmed 0.40 ->
          0.07 (2026-07-20, Lino: "der glow hinter den kacheln ist zu
          hell", then "immer noch viel zu stark" on the postproduction
          page after an intermediate 0.15 pass), same fix as
          projects/page.tsx — this component is also reused on the public
          /preview/[token] page. */}
      <div
        aria-hidden
        className="absolute inset-3 rounded-2xl blur-2xl opacity-[0.07] pointer-events-none -z-10"
        style={{ backgroundColor: STATUS_GLOW_COLOR[status ?? "wartend"] }}
      />
      {onUploadVersion && (
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.[0]) onUploadVersion(e.target.files[0]);
            e.target.value = "";
          }}
        />
      )}
      <div
        ref={tileRef}
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => e.key === "Enter" && onOpen()}
        onMouseEnter={() => setHovering(true)}
        onMouseMove={handleMove}
        onMouseLeave={() => {
          setHovering(false);
          setFrameIndex(0);
        }}
        style={{ height: TILE_HEIGHT_CSS, aspectRatio }}
        // max-sm:h-auto! overrides the inline fixed height below `sm` — with height freed up and
        // the outer wrapper now stretched to 100% width (see its own comment), `aspectRatio`
        // alone computes this box's height FROM that full width instead, same native CSS
        // aspect-ratio behavior as before just with width/height roles swapped for mobile.
        className="relative overflow-hidden rounded-t-xl cursor-pointer max-sm:h-auto!"
      >
        {showFilmstripFrame ? (
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `url(${latest!.filmstrip_url})`,
              backgroundSize: `${frameCount * 100}% 100%`,
              backgroundPosition: `${bgPositionPercent}% 0%`,
              backgroundRepeat: "no-repeat",
            }}
          />
        ) : latest?.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={latest.thumbnail_url} alt={video.title} className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-white/25">
            <VideoPlaceholderIcon />
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent pointer-events-none" />

        {/* 2026-07-17, Lino: "der Titel des Videos / idee soll unter dem
            Video dargestellt werden dann status dann deadline" — Titel/
            Kommentar-Zähler lebten vorher als Text-Overlay AUF dem
            Thumbnail (siehe git-Historie), jetzt nur noch Versions- +
            Kommentar-Badge (kurze Zahlen/Icons, keine Textzeile, die den
            Blick aufs Bild stört) — der eigentliche Titel steht jetzt im
            Footer unterhalb, siehe dort. */}
        {/* 2026-07-18, Lino: "ganz rechts oben der Kommentarzähler und
            links daneben die Versionsnummer" — beide jetzt in EINER Reihe
            statt übereinander gestapelt, Kommentarzähler als äusserstes
            (rechtestes) Element. */}
        <div className="absolute top-2 right-2 flex items-center gap-1">
          {latest && (
            <span className="text-[11px] font-mono text-white/80 bg-black/50 rounded-full px-2 py-0.5">
              v{latest.version_number}
            </span>
          )}
          {commentCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-white/80 bg-black/50 rounded-full px-2 py-0.5">
              💬 {commentCount}
            </span>
          )}
        </div>

        {/* 2026-07-17, Lino: "auf der kachel in der übersicht soll ein 3
            punkte button sein, dann kommt ein dropdown menü... 'upload new
            Version'" — stopPropagation ueberall noetig, sonst wuerde ein
            Klick auf den Button ZUSAETZLICH das Review-Modal oeffnen
            (dieser Bereich liegt innerhalb der klickbaren Thumbnail-
            Flaeche). */}
        {onUploadVersion && (
          <div className="absolute top-2 left-2" onClick={(e) => e.stopPropagation()}>
            {/* 2026-07-18 (Todoist #191, Lino: "das aufklappende Menü wird
                vom Rand der Kachel abgeschnitten") — the tile's own root
                div is `overflow-hidden` (needed to clip the thumbnail to
                its rounded corners), which was also clipping this dropdown
                since it rendered nested inside that same box. `portal`
                renders it into document.body instead — same fix already
                used for the emoji field and SceneEditModal's Zuständig
                dropdown, see Menu.tsx's own doc comment on this prop. */}
            <Menu
              portal
              trigger={
                <span className="w-6 h-6 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center text-white/80 hover:text-white transition-colors">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
                </span>
              }
            >
              {(close) => (
                <MenuItem
                  onClick={() => {
                    fileInputRef.current?.click();
                    close();
                  }}
                >
                  {t("videoTile.uploadNewVersion")}
                </MenuItem>
              )}
            </Menu>
          </div>
        )}

        {!mostRecentVersion && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-white/40 bg-black/40">
            {t("videoTile.noVideoUploaded")}
          </div>
        )}
        {stillUploading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-white/70 bg-black/50 px-6">
            <span>{t("videoTile.uploading")}{uploadFraction !== undefined ? ` ${Math.round(uploadFraction * 100)}%` : ""}</span>
            {uploadFraction !== undefined && (
              <div className="w-full max-w-[70%] h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-[width] duration-150"
                  style={{ width: `${Math.round(uploadFraction * 100)}%` }}
                />
              </div>
            )}
          </div>
        )}
        {stillProcessing && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-xs text-white/70 bg-black/50">
            <div className="w-3.5 h-3.5 border-2 border-white/25 border-t-white/70 rounded-full animate-spin" />
            {t("videoTile.processing")}
          </div>
        )}

      </div>

      {/* 2026-07-17, Lino: "der Titel des Videos / idee soll unter dem
          Video dargestellt werden dann status dann deadline" — fester
          Footer UNTER dem Thumbnail (bewusst ausserhalb der klickbaren
          Thumbnail-Fläche, kein Klick-Konflikt zwischen "Modal öffnen"
          und "Status ändern"), Reihenfolge exakt wie gefordert: Titel,
          dann Status, dann Deadline — untereinander statt nebeneinander. */}
      {/* 2026-08-07, Lino: "gib allem unter dem Video ein wenig mehr
          vertikalen Abstand.. dann sieht es ein wenig aufgeräumter aus" —
          gap-1.5 (6px) between title/status/editor/deadline read cramped,
          bumped to gap-2.5 (10px). */}
      <div className="px-3 py-2.5 flex flex-col gap-2.5 border-t border-white/10 min-w-0">
        <div className="min-w-0">
          {/* 2026-07-18, Lino: "Titel des Videos muss gross dargestellt
              werden. Jetzt ist der Titel sehr klein." — the small label
              that used to sit above this (the section name, Todoist #189)
              is gone now that video.title itself IS the section name
              (see addVideo in postproduction/page.tsx), so it was just
              showing the same text twice. */}
          {isEditingTitle ? (
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={() => {
                const trimmed = titleDraft.trim();
                if (trimmed && trimmed !== video.title) onRename?.(trimmed);
                else setTitleDraft(video.title);
                setIsEditingTitle(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  setTitleDraft(video.title);
                  setIsEditingTitle(false);
                }
              }}
              className="w-full text-lg font-semibold text-white bg-white/10 rounded px-1.5 py-0.5 -mx-1.5 focus:outline-none focus:ring-1 focus:ring-white/40"
            />
          ) : (
            // 2026-07-20, Lino: "ein langer Titel verzieht die Kachel in der
            // Breite, das sollte nicht passieren... Titel soll in 2 Zeilen
            // dargestellt werden, die Kachel wird dann unten ein wenig
            // grösser" — `truncate` (nowrap+ellipsis) still contributed its
            // full unwrapped text width to this flex column's intrinsic
            // sizing (no `min-width:0` on any ancestor), so a long title
            // widened the whole tile past the thumbnail's own aspect-ratio-
            // computed width instead of just clipping. `min-w-0` down the
            // chain + `line-clamp-2` (wraps normally, ellipsis after the
            // 2nd line) fixes both: width now follows the thumbnail only,
            // height grows to fit 1-2 lines instead.
            <div className="flex items-start gap-1.5 group min-w-0">
              <div className="text-lg font-semibold text-white line-clamp-2 break-words min-w-0">{video.title}</div>
              {onRename && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setTitleDraft(video.title);
                    setIsEditingTitle(true);
                  }}
                  aria-label={t("videoTile.renameVideo")}
                  className="shrink-0 mt-1 text-white/30 hover:text-white/80 transition-colors opacity-0 group-hover:opacity-100"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>
        <Pill tone={STATUS_TONE[status ?? "wartend"]} className="self-start">
          {canEditStatus ? (
            <select
              value={status ?? "wartend"}
              onChange={(e) => onChangeStatus(e.target.value as PostproductionStatus)}
              className="bg-transparent focus:outline-none cursor-pointer text-xs"
            >
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value} className="bg-[#111] text-white">
                  {label}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-xs">{statusLabels[status ?? "wartend"]}</span>
          )}
        </Pill>
        {members && onChangeAssignee && (
          <VideoTileEditorPicker
            members={members}
            assigneeId={video.assignee_id ?? null}
            editable={canEditStatus}
            onChange={onChangeAssignee}
          />
        )}
        <div className="flex items-center gap-1.5 text-xs text-white/60">
          {canEditDeadline ? (
            <>
              <DateTimePicker value={deadline ? new Date(deadline) : null} onChange={onChangeDeadline} placeholder={t("videoTile.setDeadline")} />
              {deadline && (
                <button onClick={() => onChangeDeadline(null)} aria-label={t("videoTile.removeDeadline")} className="text-white/30 hover:text-red-400 px-1">
                  ×
                </button>
              )}
            </>
          ) : showDeadlineLabel ? (
            <span>{t("videoTile.deadlineWithValue", { date: deadline ? new Date(deadline).toLocaleDateString("de-CH") : t("videoTile.noDeadlineValue") })}</span>
          ) : (
            <span>{deadline ? new Date(deadline).toLocaleDateString("de-CH") : "—"}</span>
          )}
        </div>
      </div>
    </div>
  );
}

/** "Editor" row (2026-08-06) — same compact single-select shape as the
 * status Pill/select above (a plain trigger, not a whole FieldGroup like
 * SceneEditModal's own multi-select assignee field — Video only ever has
 * ONE Editor, and this needs to fit inline in the tile's tight footer). */
function VideoTileEditorPicker({
  members,
  assigneeId,
  editable,
  onChange,
}: {
  members: Member[];
  assigneeId: string | null;
  editable: boolean;
  onChange: (userId: string | null) => void;
}) {
  const { t } = useLanguage();
  const assignee = members.find((m) => m.user_id === assigneeId) ?? null;
  const label = assignee ? assignee.name || assignee.email : t("videoTile.editorUnassigned");

  if (!editable) {
    return (
      <div className="inline-flex self-start items-center gap-1.5 rounded-full bg-white/8 px-2.5 py-1 text-xs text-white/70 max-w-full">
        <span className="text-white/40 shrink-0">{t("videoTile.editorLabel")}:</span>
        <span className="truncate">{label}</span>
      </div>
    );
  }

  return (
    <Menu
      align="start"
      trigger={
        // 2026-08-06 bug found live: an onClick={stopPropagation} directly
        // on this button silently ate the click before it could bubble up
        // to Menu's OWN wrapping <div onClick={...setOpen}> — which is how
        // Menu actually opens (it listens for the bubbled event, doesn't
        // attach its own listener to the trigger node). Menu's wrapper
        // already calls stopPropagation itself once IT handles the click,
        // so there's nothing left to guard against here — the whole prop
        // was redundant AND broke the menu outright, not just redundant.
        //
        // 2026-08-07, Lino: "editor auswahl feld... geht unter und ist
        // kleiner als die anderen texte / felder" — this used to be bare
        // unstyled text (no background/border/padding), so next to the
        // status Pill and the DateTimePicker's real bordered field it
        // visually disappeared. Now matches Pill's own shape
        // (rounded-full bg-white/8 px-2.5 py-1) so it reads as an actual
        // selectable field of the same visual weight as its neighbors.
        <button
          type="button"
          className="inline-flex self-start items-center gap-1.5 rounded-full bg-white/8 hover:bg-white/14 px-2.5 py-1 text-xs text-white/70 hover:text-white/90 transition-colors max-w-full"
        >
          <span className="text-white/40 shrink-0">{t("videoTile.editorLabel")}:</span>
          {assignee && <Avatar name={assignee.name} email={assignee.email} avatarUrl={assignee.avatar_url} size={16} />}
          <span className="truncate max-w-[8rem]">{label}</span>
        </button>
      }
    >
      {(close) => (
        <>
          <MenuItem
            onClick={() => {
              onChange(null);
              close();
            }}
          >
            {t("videoTile.editorUnassigned")}
          </MenuItem>
          {members.map((m) => (
            <MenuItem
              key={m.user_id}
              onClick={() => {
                onChange(m.user_id);
                close();
              }}
            >
              {m.name || m.email}
            </MenuItem>
          ))}
        </>
      )}
    </Menu>
  );
}

function VideoPlaceholderIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="14" height="14" rx="2" /><path d="m17 10 4-2v8l-4-2" />
    </svg>
  );
}
