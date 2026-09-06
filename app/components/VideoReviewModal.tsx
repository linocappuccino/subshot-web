"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import confetti from "canvas-confetti";
import { Avatar } from "./ui/Avatar";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { SubtitlePanel, SUBTITLE_COL_WIDTH, SUBTITLE_LANGUAGES } from "./SubtitlePanel";
import { useApi } from "@/lib/useApi";
import { ApiError } from "@/lib/api";
import { useToast } from "./ui/Toast";
import type { Member, Video, VideoComment, VideoVersion, SubtitlesData, SubtitleSegment, SubtitleTranslationCue } from "@/lib/types";
import { useLanguage } from "@/lib/i18n";
import { subscribeToChanges } from "@/lib/realtime";
import { readVideoMetadata } from "@/lib/media";

// 2026-07-21, Lino: "der kommentar bereich auf dem video player darf noch
// viel breiter sein" (nach 380px -> 460px bei #155) — 460 -> 640. Ein
// gemeinsamer Wert statt der frueheren Bare-Zahl an zwei Stellen
// (resizeAll's Kartenbreiten-Abzug + die Spalten-className unten), damit
// sie nie wieder auseinanderlaufen koennen.
const COMMENT_COL_WIDTH = 640;
// 2026-08-03 — Präsentationsmodus fürs Video-Feedback bekommt eine breitere
// Todo-Spalte als die normale Kommentarspalte (mehr Platz für grosse
// Checklisten-Zeilen), gleiche Begründung wie COMMENT_COL_WIDTH selbst.
const PRESENT_COMMENT_COL_WIDTH = 760;
// 2026-08-04 — Mindestbreiten, auf die resizeAll() die Kommentar-/
// Untertitel-Spalte runterskaliert, BEVOR das Video selbst kleiner werden
// darf (siehe resizeAll's eigener Kommentar). Klein genug, dass beide
// Spalten noch lesbar bleiben, aber nicht mehr ihre volle "Wunschbreite".
const COMMENT_COL_MIN_WIDTH = 320;
const PRESENT_COMMENT_COL_MIN_WIDTH = 380;
const SUBTITLE_COL_MIN_WIDTH = 260;
// Ab dieser Videobreite hört das Runterskalieren der Spalten auf zu helfen
// — darunter macht ein noch kleineres Video ohnehin keinen Sinn mehr.
const MIN_VIDEO_WIDTH = 420;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** 2026-08-03, Lino: "hat man jegliches offenes Feedback abgehackt, soll von
 * unten konfetti hochschiessen und wieder runterfallen" — canvas-confetti's
 * eigene Schwerkraft (`gravity`) erledigt das Runterfallen von selbst, ein
 * `origin.y` von 1 (Boden des Viewports) + `angle: 90` (gerade nach oben)
 * gibt das "hochschiessen". Mehrere Salven über ~1.2s statt einem einzelnen
 * Burst, mit zufälliger horizontaler Position pro Salve. */
function fireFeedbackConfetti() {
  const end = Date.now() + 1200;
  (function frame() {
    confetti({
      particleCount: 5,
      angle: 90,
      spread: 65,
      startVelocity: 50,
      gravity: 1,
      ticks: 220,
      origin: { x: Math.random() * 0.6 + 0.2, y: 1 },
      zIndex: 200,
    });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}

/** 2026-07-18 (Todoist #190) — the timeline marker's hover tooltip used to
 * render the full comment as one very wide single-line string. */
function excerpt(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** Fullscreen-Review (2026-07-17, Lino's ausführliche Spezifikation) —
 * grosses Video links, Kommentarspalte rechts, eigene Timeline mit
 * Avatar-Markern + Hover-Filmstrip-Vorschau, Versions-Navigation mit
 * Crossfade statt sichtbarem Reload. Öffnet immer auf der neuesten
 * 'ready'-Version (siehe initialVersionIndex unten). Portal wie
 * IdeaFocusView, gleiche Escape/Backdrop-Click-Konventionen. */
export function VideoReviewModal({
  video,
  canEdit,
  currentUserId,
  members,
  onClose,
  onVideoUpdated,
  onDeleteVideo,
  onDeleteVersion,
  publicMode,
  postComment,
  onSubmitFeedback,
  onDeleteComment,
  getDownloadUrl,
  listSubtitles,
  onEditSubtitleText,
  onEditSubtitleTranslation,
  onUploadSubtitles,
  onDownloadSubtitles,
  onTranslateSubtitles,
  initialHighlightedCommentId,
  onCommentsChanged,
}: {
  video: Video;
  canEdit: boolean;
  members: Member[];
  currentUserId: string | null;
  onClose: () => void;
  onVideoUpdated: (video: Video) => void;
  /** 2026-08-07, Lino: "wenn kommentare offen sind, muss es auf 'in
   * bearbeitung' sein, wurden alle abgehackt oder gelöscht, muss es auf
   * 'wartet auf feedback' sein" — the section's postproduction status is a
   * direct, immediate function of open-comment count now (see
   * _sync_section_status_for_comments in main.py), NOT gated on closing
   * the player — two earlier, narrower attempts (session-ref + close-only,
   * then a one-directional resolve/delete-only revert) both left real
   * gaps (a REOPENED comment never flipped back to 'in_bearbeitung', and
   * "before closing" was a pointless delay anyway). The backend already
   * applies the flip synchronously inside every create/resolve/delete
   * write; this callback exists purely because that response doesn't
   * include the SECTION, which postproduction/page.tsx's tiles read from
   * separate `data.sections` state this modal has no access to — fired
   * unconditionally after every real authenticated comment action
   * (create, resolve/reopen toggle, delete) so the caller can re-sync
   * immediately instead of waiting for a reload. Undefined on the public
   * preview page — comment actions there don't drive this at all (see
   * _mark_section_in_bearbeitung in main.py: preview-side stays gated on
   * "Feedback senden" specifically, unchanged). */
  onCommentsChanged?: () => void;
  /** Undefined = kein Lösch-Button (nur canEdit-Nutzer bekommen ihn — siehe
   * postproduction/page.tsx). */
  onDeleteVideo?: () => void;
  /** 2026-07-26, Lino: "Wenn man löschen drückt kann man wählen zwischen
   * alle videos (versionen) löschen, oder eine Version auswählen die
   * gelöscht werden soll" — deletes only the currently-open version
   * (navigate to the one you want first via the header's prev/next
   * arrows), as opposed to onDeleteVideo which removes the whole tile.
   * Same canEdit-only availability as onDeleteVideo. */
  onDeleteVersion?: (versionId: string) => void;
  /** 2026-07-20 (#254) — true for the public no-login preview page
   * (app/preview/[token]/page.tsx). Only changes: comments post via
   * `postComment` instead of the authenticated `api.createVideoComment`
   * (a first-time visitor-name prompt gates the first comment, same
   * sessionStorage-for-the-tab convention the old Python preview page
   * used), and a "Feedback senden" button appears that locks further
   * comments on this version via `onSubmitFeedback` until a new version is
   * uploaded. `canEdit=false` + `currentUserId=null` already disable every
   * other authenticated-only control (new-version upload, resolve/delete),
   * see this component's own canEdit/isOwn gates below — no other change
   * needed for viewer mode. */
  publicMode?: boolean;
  postComment?: (
    versionId: string, timestampSeconds: number, comment: string, parentCommentId: string | null, authorName: string
  ) => Promise<VideoComment>;
  onSubmitFeedback?: (versionId: string) => Promise<void>;
  /** 2026-07-20, Lino: "man muss auch Kommentare in der Preview wieder
   * löschen können, wenn man noch nicht Feedback senden gedrückt hat" —
   * only ever offered for a comment THIS browser session itself just
   * posted (see `myCommentIds` below — there's no real account to check
   * real ownership against for an anonymous visitor), and only while
   * `currentVersion.feedback_locked` is still false. */
  onDeleteComment?: (commentId: string) => Promise<void>;
  /** 2026-07-21 — only passed by the public preview page (mirrors
   * postComment/onSubmitFeedback's own token-bound-callback shape); the
   * authenticated postproduction page leaves this undefined and
   * downloadCurrentVideo below falls back to api.getVideoVersionDownloadUrl.
   * Can resolve to {status:"processing"} instead of a URL — the public
   * download is the only place the Wasserzeichen-Switch takes effect, and a
   * watermarked copy may still be encoding (see pollDownloadUrl below). */
  getDownloadUrl?: (versionId: string) => Promise<{ url: string; status: "ready" } | { status: "processing" }>;
  /** 2026-07-28 — Untertitel-Spalte links (siehe SubtitlePanel.tsx). Lesen/
   * Korrigieren geht auf BEIDEN Oberflaechen (eingeloggt + oeffentliche
   * Preview, siehe SubtitlePanel's eigener Doc-Kommentar), daher immer
   * gesetzt (nicht optional wie postComment etc.) — nur die konkrete
   * Implementierung dahinter unterscheidet sich (api.* vs. publicPreviewApi.*
   * ueber token/unlockToken, siehe die beiden Aufrufer-Seiten). Upload/
   * Download bleiben optional — nur die authentifizierte Seite reicht sie
   * durch, canManage in SubtitlePanel blendet die UI sonst komplett aus. */
  listSubtitles: (versionId: string) => Promise<SubtitlesData>;
  onEditSubtitleText: (segmentId: string, text: string) => Promise<SubtitleSegment>;
  /** 2026-08-08 — Korrektur EINES Cues in EINER Sprache, über dessen
   * eigene id (siehe SubtitleTranslationCue/patchSubtitleTranslation) —
   * ein Sprach-Track ist nicht mehr 1:1 mit dem Original verknüpft, siehe
   * SubtitleTranslation's Doc-Kommentar in models.py. Genauso immer
   * gesetzt (nicht optional) wie onEditSubtitleText oben, gleiche
   * Begründung. */
  onEditSubtitleTranslation: (translationId: string, text: string) => Promise<SubtitleTranslationCue>;
  /** 2026-08-08 (2nd pass — "der button soll einfach nur SRT hochladen
   * sein, das Tool soll bei SRT hochladen die Sprachen auch checken"):
   * EIN Upload-Weg für beliebig viele Files (Mehrfachauswahl), das
   * Backend entscheidet pro Datei via Spracherkennung selbst, ob sie das
   * Original ersetzt oder einen eigenen Sprach-Track anlegt (siehe
   * upload_subtitles' eigener Doc-Kommentar in main.py). Undefined auf
   * der öffentlichen Preview-Seite (editor-gated), SubtitlePanel blendet
   * den Button dann aus. */
  onUploadSubtitles?: (versionId: string, files: File[]) => Promise<SubtitlesData>;
  /** 2026-08-08, Lino (3rd pass — "wenn man auf SRT herunterladen drückt
   * sollen immer alle SRTs heruntergeladen werden die... übersetzt oder
   * hochgeladen wurden"): liefert immer ein .zip mit JEDEM Track (Original
   * + jede Sprache), kein `lang`-Parameter mehr — der Aufrufer
   * (postproduction/page.tsx) reicht `api.subtitlesDownloadUrl` direkt
   * durch. */
  onDownloadSubtitles?: (versionId: string) => Promise<string>;
  /** 2026-07-29, Lino: Übersetzungs-Button — undefined auf der öffentlichen
   * Preview-Seite (editor-gated im Backend, gleiche Begründung wie
   * onUploadSubtitles), SubtitlePanel blendet den Button dann aus. */
  onTranslateSubtitles?: (versionId: string, targetLang: string) => Promise<SubtitlesData>;
  /** 2026-07-31, Lino: "wenn man in den notifications auf einen kommentar
   * klickt, soll es direkt die videokachel öffnen mit dem kommentar" — the
   * caller (postproduction/page.tsx) already opens this modal for the
   * right VIDEO via its own openVideo handling; this additionally
   * highlights/scrolls to the specific comment, same look as clicking a
   * timeline marker's avatar already does (see highlightedCommentId's own
   * doc comment below). Only ever checked against comments on WHATEVER
   * version is showing when the modal opens (normally the latest, which is
   * also where a new comment actually landed) — doesn't hunt across older
   * versions for it. */
  initialHighlightedCommentId?: string | null;
}) {
  const api = useApi();
  const toast = useToast();
  const { t } = useLanguage();
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoWrapRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 2026-07-18, Lino: "die grosse Kachel passt sich immer noch nicht der
  // Videogrösse an in Breite und Höhe" — headerRef/chromeRef messen die
  // NICHT-Video-Höhe (Titel-Toolbar oben, Play/Timeline-Zeile unten), damit
  // resizeCard() weiss, wie viel vom verfügbaren Viewport tatsächlich fürs
  // Video selbst übrig bleibt, und die ganze Karte (nicht nur das <video>)
  // exakt um das Video (+ Kommentarspalte) herum schrumpfen kann.
  const headerRef = useRef<HTMLDivElement>(null);
  const chromeRef = useRef<HTMLDivElement>(null);
  const [cardSize, setCardSize] = useState<{ width: number; height: number } | null>(null);
  // See its own doc comment right where it's read/written, just above the
  // final `return` — suppresses the card's resize transition for the very
  // first render that gets a real `cardSize`.
  const cardTransitionRef = useRef(false);
  // 2026-08-04, Lino: "lieber nehmen wir ein wenig von der breite von den
  // kommentare und untertiteln weg anstatt das Video verkleinert
  // darzustellen" — beide Spalten waren FIX breit, siehe resizeAll()'s
  // eigener Kommentar dazu weiter unten für die volle Begründung.
  const [commentColWidth, setCommentColWidth] = useState<number>(COMMENT_COL_WIDTH);
  const [subtitleColWidth, setSubtitleColWidth] = useState<number>(SUBTITLE_COL_WIDTH);
  const [uploading, setUploading] = useState(false);
  // 2026-07-29, Lino: "muss auch ein statusbalken irgendwo ersichtlich sein..
  // man hat keine ahnung was passiert" — real upload-progress fraction, same
  // mechanism postproduction/page.tsx's uploadVersionFromTile already had
  // (api.uploadVideoFile's optional 3rd callback param), just never wired
  // up here.
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [confirmDeleteVideo, setConfirmDeleteVideo] = useState(false);
  const [confirmDeleteVersion, setConfirmDeleteVersion] = useState(false);
  // 2026-07-26 — only meaningful when there's more than one version AND a
  // per-version delete path exists at all; a single-version video has no
  // real "which one" choice, so the trash button skips straight to the old
  // whole-video confirm in that case (see the button's onClick below).
  const [showDeleteChoice, setShowDeleteChoice] = useState(false);
  // 2026-07-17, Lino: "soll man die Kommentarspalte rechts mit einem
  // kleinen symbol ausblenden oder einblenden können" — Video bekommt die
  // volle Breite, wenn man sich nur den Schnitt anschauen will ohne die
  // Kommentare im Weg zu haben.
  const [showComments, setShowComments] = useState(true);
  // 2026-08-03, Lino: Präsentationsmodus fürs Video-Feedback — Video gross
  // links, offenes Feedback als grosse Todo-Liste rechts (analog zum
  // bestehenden Ideen-Präsentationsmodus, siehe IdeaFloatingCard.tsx).
  // Erzwingt die Kommentarspalte sichtbar (siehe showComments||presenting
  // unten) und blendet Untertitel-Spalte + die meisten Header-Buttons aus,
  // unabhängig von deren eigenem Ein/Ausblend-Zustand.
  const [presenting, setPresenting] = useState(false);
  // 2026-07-28 — Untertitel-Spalte links, gleiches Ein/Ausblend-Muster wie
  // showComments oben. Default false (anders als showComments) — die Spalte
  // ist bis zum ersten Laden nicht sicher relevant (kein SRT hochgeladen =
  // nichts zu zeigen), automatisch true gesetzt sobald das erste Segment
  // eintrifft (siehe der Segmente-Fetch-Effect unten).
  const [showSubtitles, setShowSubtitles] = useState(false);
  const [subtitles, setSubtitles] = useState<SubtitlesData>({ original: [], original_lang: null, translations: {} });
  const [subtitlesLoading, setSubtitlesLoading] = useState(false);
  const [uploadingSubtitles, setUploadingSubtitles] = useState(false);
  // 2026-07-29, Lino: Übersetzungs-Button — welche Sprache die Spalte gerade
  // anzeigt/exportiert (nicht persistiert, rein lokale UI-Wahl, jeder
  // Betrachter kann unabhängig umschalten). Zurück auf "original", sobald ein
  // Versionswechsel eine neue Segmente-Liste laedt (siehe Fetch-Effect oben).
  const [subtitleLang, setSubtitleLang] = useState<string>("original");
  const [translatingSubtitles, setTranslatingSubtitles] = useState(false);
  // 2026-08-08 — SubtitlePanel ist seit dem Mehrsprachen-Upload lang-
  // agnostisch (kennt nur noch "die aktive Cue-Liste", siehe dessen eigener
  // Doc-Kommentar) — hier wird pro Render aufgelöst, WELCHE Liste das ist,
  // statt das SubtitlePanel selbst aus `translations[lang]` picken zu
  // lassen (das kannte früher `segments[].translations` direkt).
  const activeSubtitleCues = subtitleLang === "original" ? subtitles.original : subtitles.translations[subtitleLang] ?? [];
  const availableSubtitleLangs = Object.keys(subtitles.translations).sort();
  const hasOriginalSubtitles = subtitles.original.length > 0;
  const hasAnySubtitles = hasOriginalSubtitles || availableSubtitleLangs.length > 0;

  const versions = video.versions;
  const initialVersionIndex = useMemo(() => {
    for (let i = versions.length - 1; i >= 0; i--) {
      if (versions[i].status === "ready") return i;
    }
    return versions.length - 1;
  }, [versions]);
  const [versionIndex, setVersionIndex] = useState(initialVersionIndex);
  const currentVersion: VideoVersion | undefined = versions[versionIndex];

  // 2026-07-28 — laedt die Untertitel-Segmente neu, sobald sich die
  // Version aendert (SRT ist pro VideoVersion gescoped, siehe
  // SubtitleSegment's Doc-Kommentar — ein Versionswechsel muss die Liste
  // komplett ersetzen, nicht mergen). `false` bei fehlendem currentVersion
  // (z.B. waehrend eines Uploads, bevor die erste Version 'ready' ist).
  useEffect(() => {
    setSubtitleLang("original");
    if (!currentVersion) {
      setSubtitles({ original: [], original_lang: null, translations: {} });
      return;
    }
    let cancelled = false;
    setSubtitlesLoading(true);
    listSubtitles(currentVersion.id)
      .then((data) => {
        if (cancelled) return;
        setSubtitles(data);
        if (data.original.length > 0 || Object.keys(data.translations).length > 0) setShowSubtitles(true);
      })
      .catch(() => {
        if (!cancelled) setSubtitles({ original: [], original_lang: null, translations: {} });
      })
      .finally(() => {
        if (!cancelled) setSubtitlesLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentVersion?.id]);

  // Live-Sync (Pusher) — dieselbe video-<id> Channel wie Kommentare/
  // Notification-Broadcast (siehe app/realtime.py), aber eine EIGENE
  // Subscription: Untertitel sind kein Teil des `video`-Objekts (anders als
  // Kommentare, die ueber currentVersion.comments kommen), daher hier
  // selbststaendig statt ueber die Eltern-Seiten's Refetch mitzulaufen.
  useEffect(() => {
    if (!currentVersion) return;
    const versionId = currentVersion.id;
    return subscribeToChanges("video", video.id, () => {
      listSubtitles(versionId).then(setSubtitles).catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.id, currentVersion?.id]);

  const [videoReady, setVideoReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  // 2026-08-03, Lino: "zieht man den playhead irgendwo hin und speichert
  // danach einen kommentar, springt der playhead an den Anfang zurück" —
  // root cause: `playback_url` is a presigned R2 URL that main.py's
  // `_video_out` re-signs FRESH on every single API response (never the
  // same string twice, see that function's own doc comment), and posting a
  // comment broadcasts on this video's Pusher channel (`create_video_comment`
  // -> `broadcast_changed(video_channel(...))`) — the postproduction/preview
  // pages' own live-sync listener for that channel then refetches and hands
  // this component a brand-new `video` object whose `currentVersion.playback_url`
  // string differs even though nothing about the actual file changed. React
  // sees a changed `src` on the SAME <video> element and reloads it, which
  // resets the browser's own playback position to 0 (confirmed live: the
  // browser's native reset fires its OWN `timeupdate` before
  // `loadedmetadata` even runs, so trying to restore the position from
  // inside `loadedmetadata` loses the race — the "last known time" is
  // already clobbered to 0 by then). Real fix: never hand the <video>
  // element a re-signed URL for a version it ALREADY has loaded in the
  // first place — `videoSrcRef` remembers {versionId, url} of what's
  // currently loaded; `resolveVideoSrc` below keeps serving that same URL
  // string for as long as it's still the same version, so React never sees
  // a changed `src` prop and never reloads. Only a REAL version switch
  // (different id) is allowed through to a new URL — see resolveVideoSrc.
  // `safePlay`'s own expired-URL recovery (Sentry a9bc1f2f) explicitly
  // clears this ref first so its intentionally-fresh URL isn't ignored too.
  const videoSrcRef = useRef<{ versionId: string; url: string } | undefined>(undefined);
  function resolveVideoSrc(): string | undefined {
    if (!currentVersion?.playback_url) return undefined;
    if (videoSrcRef.current?.versionId === currentVersion.id) return videoSrcRef.current.url;
    videoSrcRef.current = { versionId: currentVersion.id, url: currentVersion.playback_url };
    return currentVersion.playback_url;
  }
  const [duration, setDuration] = useState(currentVersion?.duration_seconds ?? 0);
  const [hoverFraction, setHoverFraction] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  // 2026-07-26 (Todoist #328) — mirrors isDragging for the rAF loop below,
  // which needs a synchronous read inside its own tick() without
  // resubscribing the effect on every drag start/stop.
  const isDraggingRef = useRef(false);
  const [hoveredCommentId, setHoveredCommentId] = useState<string | null>(null);
  // 2026-07-18 (Todoist #190) — clicking a timeline marker's avatar already
  // seeks the video; this ADDITIONALLY highlights + scrolls to that
  // comment's row in the right-hand column, briefly, so it's easy to find
  // among a long list.
  const [highlightedCommentId, setHighlightedCommentId] = useState<string | null>(null);
  const commentRowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // 2026-07-31 — same highlight+scroll the timeline-marker click below
  // does, just triggered once from the outside instead of a click (see
  // initialHighlightedCommentId's own doc comment). Delayed one tick so
  // commentRowRefs has actually been populated by the comment list's own
  // render before this tries to scroll to it.
  useEffect(() => {
    if (!initialHighlightedCommentId) return;
    const commentId = initialHighlightedCommentId;
    const timer = setTimeout(() => {
      setHighlightedCommentId(commentId);
      commentRowRefs.current.get(commentId)?.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => setHighlightedCommentId((id) => (id === commentId ? null : id)), 2000);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHighlightedCommentId]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  // 2026-07-17, Lino: "wenn man ein 9:16 Video öffnet sollen KEINE schwarzen
  // balken links und rechts vom video sein" — gleiche Regel wie im
  // Subtitle-Burner-Player (siehe feedback_video_player-Memory: NIE
  // aspect-ratio+max-height/max-width kombinieren, das lässt genau dann
  // Balken uebrig, wenn Container- und Video-Seitenverhaeltnis
  // auseinanderlaufen). Stattdessen `resizeAll` unten: Ziel-Breite/
  // Hoehe explizit aus dem ECHTEN Video-Seitenverhaeltnis (videoWidth/
  // videoHeight) + verfuegbarem Platz berechnet, per JS gesetzt — der
  // Video-Wrapper ist danach exakt video-foermig, kein Container-Rand
  // bleibt sichtbar.
  const [videoBoxSize, setVideoBoxSize] = useState<{ width: number; height: number } | null>(null);

  const [commentText, setCommentText] = useState("");
  const [replyTo, setReplyTo] = useState<VideoComment | null>(null);
  const [posting, setPosting] = useState(false);
  // 2026-07-20 (#254) — anonymous-visitor name, captured once per tab
  // (sessionStorage, not localStorage — "bis man die Seite schliesst"),
  // same convention as the old Python preview page's name dialog.
  const NAME_KEY = "subshotPreviewVisitorName";
  const [visitorName, setVisitorName] = useState<string | null>(
    () => (publicMode && typeof window !== "undefined" ? sessionStorage.getItem(NAME_KEY) : null)
  );
  const [showNameDialog, setShowNameDialog] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const [confirmSubmitFeedback, setConfirmSubmitFeedback] = useState(false);
  const [myCommentIds, setMyCommentIds] = useState<Set<string>>(new Set());
  // 2026-07-17, Lino: "in den kommentaren soll man teamnutzer markieren
  // können" — @Mention-Autocomplete im Kommentarfeld, mirrors der
  // bestehenden Server-seitigen Name-Erkennung (_notify_video_comment_
  // mentions). `mentionQuery` = das Wort nach dem zuletzt eingetippten
  // "@" bis zur Cursor-Position, null wenn gerade keine Mention getippt
  // wird (kein "@" unmittelbar davor im aktuellen Wort).
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);

  function handleCommentTextChange(value: string, cursorPos: number) {
    setCommentText(value);
    const uptoCursor = value.slice(0, cursorPos);
    const atIndex = uptoCursor.lastIndexOf("@");
    if (atIndex === -1) {
      setMentionQuery(null);
      return;
    }
    const between = uptoCursor.slice(atIndex + 1);
    // Sobald ein Leerzeichen/Zeilenumbruch im Wort nach dem "@" auftaucht,
    // ist die Mention "fertig getippt" — Dropdown zu.
    if (/\s/.test(between)) {
      setMentionQuery(null);
      return;
    }
    setMentionQuery(between);
  }

  function insertMention(member: Member) {
    if (!commentInputRef.current) return;
    const name = member.name || member.email;
    const cursorPos = commentInputRef.current.selectionStart ?? commentText.length;
    const uptoCursor = commentText.slice(0, cursorPos);
    const atIndex = uptoCursor.lastIndexOf("@");
    if (atIndex === -1) return;
    const next = `${commentText.slice(0, atIndex)}@${name} ${commentText.slice(cursorPos)}`;
    setCommentText(next);
    setMentionQuery(null);
    requestAnimationFrame(() => commentInputRef.current?.focus());
  }

  const mentionMatches =
    mentionQuery === null
      ? []
      : members.filter((m) => (m.name || m.email).toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 5);

  useEffect(() => {
    setVideoReady(false);
    setCurrentTime(0);
    setDuration(currentVersion?.duration_seconds ?? 0);
    setIsPlaying(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionIndex]);

  // 2026-07-26 — deleting a version (onDeleteVersion) can leave versionIndex
  // pointing past the end of the now-shorter `versions` array (e.g. deleting
  // the last-in-list version while it was the one open) — clamp back onto
  // the new last version rather than showing "Diese Version hat noch kein
  // Video" for an index that just no longer exists.
  useEffect(() => {
    if (versions.length > 0 && versionIndex > versions.length - 1) setVersionIndex(versions.length - 1);
  }, [versions.length, versionIndex]);

  function fitBox(availW: number, availH: number, ratio: number) {
    let w = availW;
    let h = w / ratio;
    if (h > availH) {
      h = availH;
      w = h * ratio;
    }
    return { width: w, height: h };
  }

  // 2026-07-18, Lino: "die grosse Kachel passt sich immer noch nicht der
  // Videogrösse an in der Breite und Höhe" — vorher wurde nur das <video>
  // selbst (videoBoxSize) an SEINEN Container angepasst, während die Karte
  // drumherum immer fix `w-full h-full max-w-[1700px]` blieb (viel toter
  // dunkler Raum bei 9:16-Videos). Jetzt rechnet dieselbe Funktion RÜCKWÄRTS
  // vom Viewport-Budget aus: verfügbarer Platz minus Header/Controls/
  // Timeline/Kommentarspalte/Padding ergibt die Ziel-Videogrösse, und die
  // Kartengrösse selbst wird aus DIESER Videogrösse + Chrome zurückgerechnet
  // — die Karte schrumpft/wächst also mit dem Video, statt umgekehrt.
  // 2026-08-03, Lino: "öffnet man ein Video, streckt sich das Player-Fenster
  // zuerst auseinander und dann wieder zusammen... die Kachel öffnet sich,
  // aber Video und Player werden erst später geladen, was die Kachel auch
  // wieder komisch stretchen lässt" — resizeAll() used to bail out entirely
  // until the REAL `<video>` element had actually loaded metadata over the
  // network (`el.videoWidth`/`videoHeight`), which for anything but a tiny
  // clip takes a visible moment. Until then the card fell back to its
  // `w-full h-full max-w-[1700px]` placeholder size (see the card's own
  // className below) — huge and the wrong aspect ratio — then visibly
  // snapped down once the real metadata finally arrived (the 500ms
  // `transition-all` on the card makes that snap read as a stretch).
  // `filmstrip_frame_width/height` (video_processing.py, generated once at
  // upload time, already sitting on `currentVersion` for any
  // already-processed video) gives the exact same real aspect ratio
  // WITHOUT waiting on the video network fetch — use it as long as the
  // actual element hasn't loaded its own dimensions yet, so the very first
  // layout is already correctly sized and nothing visibly moves once the
  // real video catches up. Genuinely brand-new (still-processing) videos
  // have neither yet and correctly keep the old placeholder-then-snap
  // behavior — nothing to fall back to there.
  function resizeAll() {
    const el = videoRef.current;
    const knownRatio =
      el && el.videoWidth && el.videoHeight
        ? el.videoWidth / el.videoHeight
        : currentVersion?.filmstrip_frame_width && currentVersion?.filmstrip_frame_height
          ? currentVersion.filmstrip_frame_width / currentVersion.filmstrip_frame_height
          : null;
    if (!knownRatio) return;
    const ratio = knownRatio;

    // 2026-08-03 — Präsentationsmodus füllt fast den ganzen Viewport (kein
    // Backdrop-Rand), damit Video+Feedback wirklich GROSS werden.
    const outerPad = presenting ? 0 : window.innerWidth < 640 ? 12 : 24; // Backdrop p-3 sm:p-6
    const maxCardW = window.innerWidth - outerPad * 2;
    const maxCardH = window.innerHeight - outerPad * 2;

    const headerH = headerRef.current?.offsetHeight ?? 0;
    const chromeH = chromeRef.current?.offsetHeight ?? 0; // Controls-Zeile + Timeline, inkl. ihrem eigenen gap
    const colPadX = 40; // linke Spalte: p-5 links+rechts
    const colPadY = 40 + 12; // p-5 oben+unten + gap-3 zwischen Video und Chrome-Block

    // Präsentationsmodus erzwingt die Kommentarspalte sichtbar (auch wenn
    // showComments zuvor ausgeschaltet war) und in einer eigenen, breiteren
    // Todo-Listen-Breite; Untertitel sind im Präsentationsmodus immer
    // ausgeblendet (siehe showSubtitles && !presenting weiter unten), egal
    // was showSubtitles gerade sagt.
    const commentsShown = (showComments || presenting) && window.innerWidth >= 1024;
    const subtitlesShown = showSubtitles && !presenting && window.innerWidth >= 1024;
    const desiredCommentW = presenting ? PRESENT_COMMENT_COL_WIDTH : COMMENT_COL_WIDTH;
    const commentMinW = presenting ? PRESENT_COMMENT_COL_MIN_WIDTH : COMMENT_COL_MIN_WIDTH;

    // 2026-08-04, Lino: "ist man auf einem kleineren Bildschirm und hat den
    // videoplayer offen mit untertiteln, wird das video zu klein
    // dargestellt!! lieber nehmen wir ein wenig von der breite von den
    // kommentare und untertiteln weg anstatt das Video verkleinert
    // darzustellen" — beide Spalten waren bisher FIX breit (640-760/560px);
    // auf einem ~1280-1440px-Laptop mit BEIDEN Spalten offen liess das dem
    // Video praktisch keinen Platz mehr (availW rutschte bis auf den
    // 160px-Minimalwert). Jetzt bekommt das Video Vorrang: beide Spalten
    // werden GEMEINSAM proportional runterskaliert (nie unter ihre eigene
    // Mindestbreite), bis mindestens MIN_VIDEO_WIDTH fürs Video übrig bleibt.
    const totalDesiredColW = (commentsShown ? desiredCommentW : 0) + (subtitlesShown ? SUBTITLE_COL_WIDTH : 0);
    const availableForCols = Math.max(0, maxCardW - colPadX - MIN_VIDEO_WIDTH);
    const colScale = totalDesiredColW > 0 ? Math.min(1, availableForCols / totalDesiredColW) : 1;

    const commentColW = commentsShown ? Math.max(commentMinW, Math.round(desiredCommentW * colScale)) : 0;
    const subtitleColW = subtitlesShown ? Math.max(SUBTITLE_COL_MIN_WIDTH, Math.round(SUBTITLE_COL_WIDTH * colScale)) : 0;
    setCommentColWidth(commentColW || desiredCommentW);
    setSubtitleColWidth(subtitleColW || SUBTITLE_COL_WIDTH);

    const availW = Math.max(160, maxCardW - colPadX - commentColW - subtitleColW);
    const availH = Math.max(120, maxCardH - headerH - chromeH - colPadY);

    const videoBox = fitBox(availW, availH, ratio);
    setVideoBoxSize(videoBox);
    setCardSize({
      width: Math.min(maxCardW, Math.round(videoBox.width + colPadX + commentColW + subtitleColW)),
      height: Math.min(maxCardH, Math.round(videoBox.height + headerH + chromeH + colPadY)),
    });
  }

  useEffect(() => {
    window.addEventListener("resize", resizeAll);
    return () => window.removeEventListener("resize", resizeAll);
  }, []);

  // Kommentarspalte ein-/ausblenden ändert die verfügbare Breite fürs
  // Video, ohne dass `src` sich ändert (kein neues loadedmetadata) — ohne
  // das hier bliebe die alte, jetzt falsche Grösse stehen. 2026-08-03 —
  // also re-runs on mount/version-switch (`currentVersion?.id`) and as soon
  // as the filmstrip dimensions arrive (`currentVersion?.filmstrip_frame_*`,
  // e.g. right after a background-job poll updates them) — see resizeAll's
  // own doc comment for why: this is what lets the card size itself
  // correctly BEFORE the real `<video>` element's network metadata load
  // finishes, instead of only reacting to it after the fact. `useLayoutEffect`
  // (not `useEffect`) specifically so this runs before the browser paints —
  // an `useEffect` here would still let the wrong (placeholder) size paint
  // for one frame first, the exact flash this is meant to eliminate.
  useLayoutEffect(() => {
    resizeAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    showComments,
    showSubtitles,
    presenting,
    currentVersion?.id,
    currentVersion?.filmstrip_frame_width,
    currentVersion?.filmstrip_frame_height,
  ]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // 2026-08-03 — im Präsentationsmodus verlässt Escape zuerst NUR den
      // Präsentationsmodus (analog zu IdeaFocusView's closeOrExitPresenting),
      // erst ein zweites Escape schliesst das ganze Modal.
      if (e.key === "Escape") {
        if (presenting) setPresenting(false);
        else onClose();
        return;
      }
      // Nur wenn kein Textfeld fokussiert ist — sonst würde Pfeil-links/
      // rechts beim Tippen im Kommentarfeld die Version wechseln.
      // 2026-07-29 (Bugfix): fehlte hier der contentEditable-Fall —
      // SubtitlePanel's Segment-Spans sind `<span contenteditable>`, keine
      // HTMLInputElement/HTMLTextAreaElement, also griff dieser Guard beim
      // Tippen dort NICHT. Ganz normales Cursor-Repositionieren mit
      // Pfeil-links/rechts waehrend des Korrigierens eines Untertitels
      // loeste dadurch (bei >1 Version) einen Versionswechsel aus —
      // wechselt currentVersion, was den Untertitel-Fetch-Effect (siehe
      // oben, [currentVersion?.id]) das komplette subtitleSegments-Array
      // gegen die ANDERE Version austauschen laesst. Da SubtitlePanel jede
      // Span mit `key={seg.id}` rendert und die neue Version komplett
      // andere Segment-IDs hat, unmounted React die gerade fokussierte
      // Span mitten im Tippen — kein blur (also kein commit) feuert dafuer
      // je, der Fokus faellt einfach auf <body>, und der neue Text geht
      // committlos verloren (genau der gemeldete Bug: "ganzen Satz
      // geloescht und neuen reingeschrieben wird nicht uebernommen").
      // isContentEditable deckt sowohl SubtitlePanel's Spans als auch jedes
      // zukuenftige contentEditable in diesem Modal ab.
      const isTyping =
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement ||
        (document.activeElement instanceof HTMLElement && document.activeElement.isContentEditable);
      if (isTyping) return;
      if (e.key === "ArrowLeft" && versionIndex > 0) setVersionIndex((i) => i - 1);
      if (e.key === "ArrowRight" && versionIndex < versions.length - 1) setVersionIndex((i) => i + 1);
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [versionIndex, versions.length, onClose, presenting]);

  function updateComments(updater: (comments: VideoComment[]) => VideoComment[]) {
    onVideoUpdated({
      ...video,
      versions: video.versions.map((v) => (v.id === currentVersion?.id ? { ...v, comments: updater(v.comments) } : v)),
    });
  }

  const [downloading, setDownloading] = useState(false);

  // 2026-07-21, Lino: kleiner Download-Pfeil oben im Videoviewer, lädt genau
  // die gerade angezeigte Version herunter — auf Postproduction- UND
  // Preview-Seite, da beide dieses Modal teilen. Zwei frühere Ansätze live
  // per Playwright verifiziert und verworfen: (1) fetch-as-Blob auf
  // `playback_url` — die R2-Presigned-URL beantwortet GET-`fetch()` ohne
  // `Access-Control-Allow-Origin` (CORS-Block), obwohl dieselbe URL als
  // `<video src>` (kein CORS nötig zum Abspielen) problemlos lädt. (2) ein
  // simples `<a download>` auf `playback_url` — von Chrome für diese
  // Cross-Origin-R2-URL schlicht ignoriert (öffnet/spielt das Video statt
  // es zu speichern), weil die Presigned-URL ohne Content-Disposition-
  // Header antwortet. Fix: ein eigener Backend-Endpoint
  // (`_video_version_download_url` in main.py) presignt dieselbe R2-Datei
  // NEU mit `ResponseContentDisposition=attachment; filename=...` — DIESE
  // URL erzwingt den Download-Dialog rein über den echten Response-Header,
  // unabhängig vom `download`-Attribut/CORS.
  // 2026-07-21 — the public download can come back "processing" (see
  // getDownloadUrl's doc comment above) when the Wasserzeichen-Switch is on
  // and the watermarked copy is still being encoded server-side. Polls
  // rather than failing outright — ffmpeg re-encoding a full video takes
  // real time, this isn't a transient error. 3s interval / 90s cap (longer
  // than the 2s/60s filmstrip poll elsewhere in this app — a full re-encode
  // is heavier than the thumbnail/filmstrip frame extraction that poll
  // waits on).
  async function pollDownloadUrl(versionId: string): Promise<string> {
    const POLL_INTERVAL_MS = 3000;
    const POLL_MAX_ATTEMPTS = 30;
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      const result = publicMode && getDownloadUrl
        ? await getDownloadUrl(versionId)
        : { url: await api.getVideoVersionDownloadUrl(versionId), status: "ready" as const };
      if (result.status === "ready") return result.url;
      if (attempt === 0) toast.showSuccess(t("videoReviewModal.watermarkPreparing"));
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    throw new Error(t("videoReviewModal.watermarkPrepareTimeout"));
  }

  async function downloadCurrentVideo() {
    if (!currentVersion || downloading) return;
    setDownloading(true);
    try {
      const url = await pollDownloadUrl(currentVersion.id);
      const a = document.createElement("a");
      a.href = url;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : t("videoReviewModal.downloadFailed"));
    } finally {
      setDownloading(false);
    }
  }

  // 2026-07-27, Lino: "hat man pause gedrückt auf einem video soll man
  // diesen frame per download button direkt als PNG downloaden können" —
  // pure client-side canvas capture of whatever frame the <video> element
  // is currently showing, no backend round-trip. Needs `crossOrigin="anonymous"`
  // on the <video> tag above (playback_url is a cross-origin R2 presigned
  // URL) or canvas.toBlob taints and silently produces nothing — R2's CORS
  // config already allows app.subshot.ch (verified live), so this works for
  // both the authenticated app and the public preview page.
  function downloadCurrentFrame() {
    const el = videoRef.current;
    if (!el || !el.videoWidth || !el.videoHeight) return;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = el.videoWidth;
      canvas.height = el.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) {
          toast.showError(t("videoReviewModal.downloadFrameFailed"));
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${video.title || "frame"}-${formatTime(el.currentTime).replace(":", "-")}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, "image/png");
    } catch {
      toast.showError(t("videoReviewModal.downloadFrameFailed"));
    }
  }

  // 2026-07-21, Lino: Switch im Videoplayer, "sobald man runterladen klickt
  // und der switch aktiviert wird, werden alle videos in der einen video
  // kachel mit dem wasserzeichen versehen" — lebt auf Video (nicht Version)
  // Ebene, gilt also fuer alle Versionen dieser einen Kachel. Nur fuer
  // eingeloggte Editoren sichtbar/schaltbar (!publicMode && canEdit) — die
  // oeffentliche Preview-Seite zeigt den Switch selbst nicht, das Ergebnis
  // (wasserzeichenpflichtig oder nicht) wirkt sich dort nur beim Download
  // aus.
  const [togglingWatermark, setTogglingWatermark] = useState(false);
  async function toggleWatermark() {
    if (togglingWatermark) return;
    setTogglingWatermark(true);
    const next = !video.watermark_enabled;
    try {
      const updated = await api.patchVideo(video.id, { watermark_enabled: next });
      onVideoUpdated(updated);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("videoReviewModal.watermarkSaveFailed"));
    } finally {
      setTogglingWatermark(false);
    }
  }

  // 2026-07-28, Lino: "manche Videos bleiben unendlich auf 'In Verarbeitung'
  // bis man die Seite refreshed" — root cause: uploadNewVersion below never
  // re-fetched after `completeVideoVersion`, unlike its two siblings
  // (postproduction/page.tsx's `addVideo`/`uploadVersionFromTile`, both
  // already fixed 2026-07-19 per #212) which poll until the background
  // thumbnail/filmstrip job finishes. This is the ONE upload path that only
  // exists inside the already-OPEN review modal (`canEdit`-gated, so only
  // reachable in the authenticated in-app context — never publicMode, safe
  // to use `api.listVideos` here) — it just never got the same fix.
  // 2026-07-29, Lino (same report again — the 07-28 fix above only made
  // polling happen at all, but the ~1-minute give-up window was still too
  // short for genuinely large videos): extended to 10 minutes at a 5s
  // interval, same reasoning/change as postproduction/page.tsx's sibling
  // pollForFilmstrip.
  function pollForFilmstrip(versionId: string) {
    let attempts = 0;
    const maxAttempts = 120;
    const tick = async () => {
      attempts += 1;
      try {
        const videos = await api.listVideos(video.section_id);
        const freshVideo = videos.find((v) => v.id === video.id);
        const freshVersion = freshVideo?.versions.find((v) => v.id === versionId);
        if (freshVideo && freshVersion?.filmstrip_url) {
          onVideoUpdated(freshVideo);
          return;
        }
      } catch {
        // network hiccup — just retry
      }
      if (attempts < maxAttempts) setTimeout(tick, 5000);
    };
    setTimeout(tick, 5000);
  }

  async function uploadNewVersion(file: File) {
    setUploading(true);
    setUploadProgress(0);
    try {
      const created = await api.createVideoVersion(video.id, file);
      if (!created.playback_url) throw new Error("Keine Upload-URL erhalten.");
      await api.uploadVideoFile(created.playback_url, file, (fraction) => setUploadProgress(fraction));
      const { duration } = await readVideoMetadata(file);
      const completed = await api.completeVideoVersion(created.id, file.size, duration);
      const nextVersions = [...video.versions, completed];
      onVideoUpdated({ ...video, versions: nextVersions });
      // Direkt zur frisch hochgeladenen (neuesten) Version springen — "man
      // öffnet die Kachel immer auf der aktuellsten Version" gilt sinngemäss
      // auch fürs Hochladen selbst.
      setVersionIndex(nextVersions.length - 1);
      pollForFilmstrip(completed.id);
      toast.showSuccess(t("videoReviewModal.versionUploaded"));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("videoReviewModal.uploadFailed"));
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  }

  // 2026-08-08 — dispatcht anhand von `subtitleLang`, WELCHE der beiden
  // PATCH-Formen gemeint ist (SubtitlePanel selbst ist seit dem
  // Mehrsprachen-Upload lang-agnostisch, siehe dessen eigener Doc-
  // Kommentar — es liefert nur noch `(cueId, text)`, kennt `subtitleLang`
  // nicht). Optimistisch — sofort lokal uebernehmen (SubtitlePanel haelt
  // zwar schon einen eigenen Entwurf, aber der State hier muss auch
  // uebereinstimmen, sonst zeigt ein Live-Sync-Refetch kurz den alten Text
  // bevor die echte Antwort zurueckkommt).
  function handleEditSubtitleCueText(cueId: string, text: string) {
    if (subtitleLang === "original") {
      setSubtitles((prev) => ({
        ...prev,
        original: prev.original.map((s) => (s.id === cueId ? { ...s, text } : s)),
      }));
      onEditSubtitleText(cueId, text)
        // 2026-08-07, Lino: "es funktioniert, aber man muss die seite immer
        // noch reloaden damit man die statusänderung sieht" — a subtitle
        // correction can create/reopen the subtitle-notice comment, which
        // now (see _sync_section_status_for_comments's "IMMER... auch der
        // Untertitel-Kommentar" fix in main.py) can flip the section's
        // status server-side same as any real comment — but this path never
        // told the caller to refetch, unlike submitComment/toggleResolved/
        // deleteComment below, which already do. `onCommentsChanged` is
        // undefined on the public preview page (same as those three), so
        // this is a no-op there regardless.
        .then(() => onCommentsChanged?.())
        .catch((e) => {
          toast.showError(e instanceof ApiError ? e.message : t("subtitlePanel.saveFailed"));
        });
      return;
    }
    const lang = subtitleLang;
    setSubtitles((prev) => ({
      ...prev,
      translations: {
        ...prev.translations,
        [lang]: (prev.translations[lang] ?? []).map((c) => (c.id === cueId ? { ...c, text, edited: true } : c)),
      },
    }));
    onEditSubtitleTranslation(cueId, text)
      .then(() => onCommentsChanged?.())
      .catch((e) => {
        toast.showError(e instanceof ApiError ? e.message : t("subtitlePanel.saveFailed"));
      });
  }

  // 2026-08-08, Lino (2nd pass — "der button soll einfach nur SRT
  // hochladen sein, das Tool soll bei SRT hochladen die Sprachen auch
  // checken"): EIN Handler für beliebig viele Files (Mehrfachauswahl),
  // das Backend entscheidet pro Datei via Spracherkennung selbst, ob sie
  // das Original ersetzt oder einen eigenen Sprach-Track anlegt (siehe
  // onUploadSubtitles' eigener Doc-Kommentar oben).
  async function handleUploadSubtitles(files: File[]) {
    if (!currentVersion || !onUploadSubtitles) return;
    setUploadingSubtitles(true);
    try {
      const data = await onUploadSubtitles(currentVersion.id, files);
      setSubtitles(data);
      setShowSubtitles(true);
      toast.showSuccess(t("subtitlePanel.uploadSuccess"));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("subtitlePanel.uploadFailed"));
    } finally {
      setUploadingSubtitles(false);
    }
  }

  // 2026-08-08, Lino (3rd pass — "wenn man auf SRT herunterladen drückt
  // sollen immer alle SRTs heruntergeladen werden die... übersetzt oder
  // hochgeladen wurden"): downloads a single .zip with every track now,
  // independent of `subtitleLang` (which tab happens to be active).
  async function handleDownloadSubtitles() {
    if (!currentVersion || !onDownloadSubtitles) return;
    try {
      const url = await onDownloadSubtitles(currentVersion.id);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${video.title || "untertitel"}.zip`;
      a.click();
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("subtitlePanel.downloadFailed"));
    }
  }

  // 2026-08-07, Lino: Swiss DE/FR/IT-Anforderung — ein Übersetzungslauf
  // betrifft jetzt nur noch `targetLang`'s eigene Spalte (siehe
  // translate_subtitles im Backend), jede andere Sprache mitsamt ihren
  // Korrekturen bleibt unangetastet erhalten. Schaltet die Ansicht direkt
  // auf die frisch übersetzte Sprache um.
  async function handleTranslateSubtitles(targetLang: string) {
    if (!currentVersion || !onTranslateSubtitles) return;
    setTranslatingSubtitles(true);
    try {
      const data = await onTranslateSubtitles(currentVersion.id, targetLang);
      setSubtitles(data);
      onVideoUpdated({
        ...video,
        versions: video.versions.map((v) =>
          v.id === currentVersion.id ? { ...v, subtitle_target_lang: targetLang } : v
        ),
      });
      setSubtitleLang(targetLang);
      toast.showSuccess(t("subtitlePanel.translateSuccess"));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("subtitlePanel.translateFailed"));
    } finally {
      setTranslatingSubtitles(false);
    }
  }

  async function submitComment() {
    if (!currentVersion || !commentText.trim() || posting) return;
    if (publicMode && !visitorName) {
      setShowNameDialog(true);
      return;
    }
    setPosting(true);
    try {
      const created =
        publicMode && postComment
          ? await postComment(
              currentVersion.id, videoRef.current?.currentTime ?? 0, commentText.trim(), replyTo?.id ?? null, visitorName!
            )
          : await api.createVideoComment(
              currentVersion.id, videoRef.current?.currentTime ?? 0, commentText.trim(), replyTo?.id ?? null
            );
      updateComments((prev) => [...prev, created]);
      if (publicMode) setMyCommentIds((prev) => new Set(prev).add(created.id));
      else onCommentsChanged?.();
      setCommentText("");
      setReplyTo(null);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("videoReviewModal.commentSaveFailed"));
    } finally {
      setPosting(false);
    }
  }

  async function deletePublicComment(comment: VideoComment) {
    if (!onDeleteComment) return;
    try {
      await onDeleteComment(comment.id);
      updateComments((prev) => prev.filter((c) => c.id !== comment.id && c.parent_comment_id !== comment.id));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("videoReviewModal.deleteFailed"));
    }
  }

  function confirmVisitorName() {
    const trimmed = nameDraft.trim();
    if (!trimmed) return;
    sessionStorage.setItem(NAME_KEY, trimmed);
    setVisitorName(trimmed);
    setShowNameDialog(false);
    requestAnimationFrame(() => commentInputRef.current?.focus());
  }

  async function submitFeedback() {
    if (!currentVersion || !onSubmitFeedback || submittingFeedback) return;
    setSubmittingFeedback(true);
    try {
      await onSubmitFeedback(currentVersion.id);
      onVideoUpdated({
        ...video,
        versions: video.versions.map((v) => (v.id === currentVersion.id ? { ...v, feedback_locked: true } : v)),
      });
      setConfirmSubmitFeedback(false);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("videoReviewModal.feedbackSendFailed"));
    } finally {
      setSubmittingFeedback(false);
    }
  }

  async function toggleResolved(comment: VideoComment) {
    const nextStatus = comment.status === "open" ? "resolved" : "open";
    try {
      const updated = await api.updateVideoCommentStatus(comment.id, nextStatus);
      updateComments((prev) => prev.map((c) => (c.id === comment.id ? updated : c)));
      onCommentsChanged?.();
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("videoReviewModal.resolveToggleFailed"));
    }
  }

  async function deleteComment(comment: VideoComment) {
    try {
      await api.deleteVideoComment(comment.id);
      updateComments((prev) => prev.filter((c) => c.id !== comment.id && c.parent_comment_id !== comment.id));
      onCommentsChanged?.();
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("videoReviewModal.deleteFailed"));
    }
  }

  // 2026-08-03, Lino: "das springen wenn man auf einen kommentar klickt geht
  // sehr lange bis der playhead zur position springt, das muss direkt
  // passieren" — this only ever set the native element's currentTime and
  // waited for the browser's own (throttled, and sometimes genuinely slow
  // if the target timestamp isn't on a keyframe) `timeupdate`/`seeked`
  // event to update React's `currentTime` state before the blue progress
  // bar visually moved. The timeline-drag handlers below already avoid this
  // by setting `currentTime` state directly alongside the real seek — do
  // the same here so the playhead jumps instantly regardless of how long
  // the actual frame decode takes.
  function seekTo(seconds: number) {
    setCurrentTime(seconds);
    if (videoRef.current) videoRef.current.currentTime = seconds;
  }

  // 2026-07-26 (Sentry a9bc1f2f) — HTMLMediaElement.play() returns a Promise
  // that rejects (NotSupportedError, "The element has no supported
  // sources") when the <video>'s src has failed to load — every call site
  // below used to call `.play()` bare, so that rejection went completely
  // unhandled and Sentry reported it as an uncaught global error. Root
  // cause of the actual load failure: `playback_url` is a presigned R2 URL
  // valid for only 2 hours (see r2_client.py's `presigned_url` doc
  // comment) — a modal left open across that window has a `src` that 403s
  // from R2 with no visible sign until play() is actually attempted. Fix:
  // catch the rejection, and (authenticated mode only — publicMode has no
  // token to refetch with) transparently re-fetch this video's row once to
  // get a freshly presigned `playback_url`, swap it in, and retry play —
  // most of the time the user never even sees a hiccup. If that retry also
  // fails (or we're in publicMode), surface a toast instead of crashing.
  const [refreshingSource, setRefreshingSource] = useState(false);
  async function safePlay() {
    const el = videoRef.current;
    if (!el) return;
    try {
      await el.play();
    } catch {
      if (publicMode || refreshingSource) {
        toast.showError(t("videoReviewModal.playbackFailed"));
        return;
      }
      setRefreshingSource(true);
      try {
        const fresh = await api.listVideos(video.section_id);
        const freshVideo = fresh.find((v) => v.id === video.id);
        if (!freshVideo) throw new Error("video gone");
        // 2026-08-03 — resolveVideoSrc() (see videoSrcRef's own doc
        // comment) normally keeps reusing the ALREADY-loaded URL for the
        // same version to avoid unwanted reloads elsewhere. That's exactly
        // wrong here: this fresh URL is the one actually needed (the old
        // one just 403'd), so clear the cache first or resolveVideoSrc
        // would keep ignoring it and retry against the same dead URL.
        videoSrcRef.current = undefined;
        onVideoUpdated(freshVideo);
        // src swap happens via the currentVersion.playback_url prop below;
        // give React a tick to re-render the <video> with the new src
        // before retrying, or `el.src` is still the stale/expired one.
        await new Promise((resolve) => requestAnimationFrame(resolve));
        await videoRef.current?.play();
      } catch {
        toast.showError(t("videoReviewModal.playbackFailed"));
      } finally {
        setRefreshingSource(false);
      }
    }
  }

  const comments = currentVersion?.comments ?? [];
  const rootComments = useMemo(
    // 2026-07-29 — system notices (system_kind set, see the "subtitle
    // edited" info comment) have no timestamp_seconds at all (they're
    // general, not pinned to a moment) — sort them first rather than
    // letting `null - null` land them in an arbitrary spot.
    () =>
      [...comments]
        .filter((c) => !c.parent_comment_id)
        .sort((a, b) => (a.timestamp_seconds ?? -1) - (b.timestamp_seconds ?? -1)),
    [comments]
  );
  // Scrubber markers only make sense for comments pinned to a real moment.
  const timelineComments = useMemo(() => rootComments.filter((c) => c.timestamp_seconds !== null), [rootComments]);
  const repliesByParent = useMemo(() => {
    const map = new Map<string, VideoComment[]>();
    for (const c of comments) {
      if (!c.parent_comment_id) continue;
      const list = map.get(c.parent_comment_id) ?? [];
      list.push(c);
      map.set(c.parent_comment_id, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.created_at.localeCompare(b.created_at));
    return map;
  }, [comments]);

  // 2026-08-03, Lino: "wird dies ja als kommentar erwähnt, dieser kommentar
  // muss auch abhackbar sein (wie ein normaler kommentar von einer person)"
  // — Todo-Liste des Präsentationsmodus zeigt ALLE rootComments, auch
  // System-Hinweise (system_kind, z.B. "Untertitel bearbeitet"); genau wie
  // in der normalen Kommentarspalte (CommentRow) ist deren Resolve-Button
  // nicht nach isSystem gegated, nur Reply/Seek ergeben für sie keinen Sinn.
  const feedbackItems = rootComments;
  const allFeedbackResolved = feedbackItems.length > 0 && feedbackItems.every((c) => c.status === "resolved");
  // Konfetti feuert nur beim ÜBERGANG offen->alles-erledigt, nicht schon
  // beim Öffnen des Präsentationsmodus, falls zufällig bereits alles
  // erledigt war — der Ref startet lazy mit dem aktuellen Wert.
  const wasAllFeedbackResolvedRef = useRef(allFeedbackResolved);
  useEffect(() => {
    if (presenting && allFeedbackResolved && !wasAllFeedbackResolvedRef.current) {
      fireFeedbackConfetti();
    }
    wasAllFeedbackResolvedRef.current = allFeedbackResolved;
  }, [allFeedbackResolved, presenting]);

  const filmstrip = currentVersion?.filmstrip_url;
  const frameCount = currentVersion?.filmstrip_frame_count ?? 0;
  const frameWidth = currentVersion?.filmstrip_frame_width ?? 160;
  const frameHeight = currentVersion?.filmstrip_frame_height ?? 90;
  // 2026-07-22, Lino: "taucht irgend ein quadratischer Rahmen auf/über dem
  // video auf" beim Scrubben — frameWidth/frameHeight sind die RAW
  // Extraktions-Pixelmasse (video_processing.py skaliert die Breite auf
  // 320, die Hoehe folgt frei aus dem Seitenverhaeltnis der Quelle), nicht
  // eine fuers Hover-Preview gedachte Anzeigegroesse. Fuer ein Hochkant-
  // Video (z.B. 320x569) wurde die Preview-Box dadurch riesig und ragte
  // weit ueber die Timeline hinaus ins Video hinein. Auf eine feste
  // Anzeigehoehe skalieren (Breite folgt dem echten Seitenverhaeltnis),
  // damit die Box immer klein und ausserhalb des Videos bleibt.
  const PREVIEW_DISPLAY_HEIGHT = 90;
  const previewScale = PREVIEW_DISPLAY_HEIGHT / frameHeight;
  const previewWidth = frameWidth * previewScale;
  const previewHeight = PREVIEW_DISPLAY_HEIGHT;

  function fractionFromClientX(clientX: number): number {
    if (!timelineRef.current) return 0;
    const rect = timelineRef.current.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }

  function handleTimelineMove(e: React.MouseEvent<HTMLDivElement>) {
    setHoverFraction(fractionFromClientX(e.clientX));
  }

  // 2026-07-17, Lino: "in der timeline muss man die player position (der
  // blaue strich) auch mit der maus ziehen und draggen können" — vorher
  // nur Klick-zum-Seeken. mousedown startet den Drag UND seekt sofort
  // (fühlt sich sonst wie ein "totes" erstes Klicken an), das window-
  // level mousemove/mouseup-Paar sorgt dafür, dass der Drag auch
  // weiterläuft, wenn der Mauszeiger die schmale Timeline-Leiste
  // verlässt (h-1.5 ist schmal genug, dass das schnell passiert).
  // 2026-07-18, Lino: "beim Draggen folgt die Timeline noch sehr wackelig
  // und ungenau, muss sehr genau der Maus folgen" — Root Cause: der blaue
  // Fortschrittsbalken wird aus `currentTime` berechnet (progressPct), und
  // `currentTime` wurde bisher NUR über das <video>-`timeupdate`-Event
  // aktualisiert, das der Browser gedrosselt feuert (~4x/Sekunde, siehe
  // Kommentar weiter unten bei der Balken-Transition) — die Maus bewegt
  // sich also spürbar schneller als der Balken hinterherkam. Fix: waehrend
  // des Drags `currentTime` direkt aus der Maus-Fraction setzen (kein
  // Warten auf das Browser-Event), damit der Balken exakt 1:1 der Maus
  // folgt; das eigentliche Video-Seek (`seekTo`) läuft parallel weiter.
  function handleTimelinePointerDown(e: React.MouseEvent<HTMLDivElement>) {
    const fraction = fractionFromClientX(e.clientX);
    setHoverFraction(fraction);
    isDraggingRef.current = true;
    setIsDragging(true);
    if (duration > 0) {
      setCurrentTime(fraction * duration);
      seekTo(fraction * duration);
    }
  }

  useEffect(() => {
    if (!isDragging) return;
    function onMove(e: MouseEvent) {
      const fraction = fractionFromClientX(e.clientX);
      setHoverFraction(fraction);
      if (duration > 0) {
        setCurrentTime(fraction * duration);
        seekTo(fraction * duration);
      }
    }
    function onUp() {
      isDraggingRef.current = false;
      setIsDragging(false);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging, duration]);

  // 2026-07-26 (Todoist #328, Lino: "spielt man ein video ab, springt die
  // blaue timeline ruckelig nach vorne.. das muss smooth sein!") — Root
  // cause: `currentTime` (and therefore progressPct/the bar's `width`) was
  // driven ONLY by the <video> element's native `timeupdate` event, which
  // browsers throttle to ~4 ticks/second — at normal playback framerates
  // that reads as visible discrete jumps every ~250ms, not a smooth sweep.
  // The pre-existing `transition-[width] duration-150` on the bar (added
  // 2026-07-17 for a DIFFERENT complaint, see that comment below) only
  // half-masked this: 150ms is shorter than the 250ms tick gap, so the bar
  // reaches its new target and then visibly SITS STILL for ~100ms before
  // the next jump — still jerky, just less far each time. Fix: while
  // actually playing, poll `video.currentTime` every animation frame
  // (~60/sec) instead of waiting on timeupdate — this alone makes the
  // advance genuinely continuous. `onTimeUpdate` below stays wired for the
  // paused/seeking/buffering cases this loop doesn't cover (it's a no-op
  // while playing since this effect already updates currentTime more
  // often). Skips writes while a manual drag is in progress (isDraggingRef)
  // so the two update paths never fight over the same frame.
  useEffect(() => {
    if (!isPlaying) return;
    let raf: number;
    function tick() {
      if (videoRef.current && !isDraggingRef.current) {
        setCurrentTime(videoRef.current.currentTime);
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying]);

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  // 2026-08-03, Lino: "das Player-Fenster streckt sich zuerst auseinander
  // und dann wieder zusammen" — even with resizeAll() now producing the
  // right numbers immediately on mount (see its own doc comment), a small
  // visible snap remained: React commits TWICE before the first paint (once
  // with `cardSize` still null/fallback classes, once with the real
  // computed size from the mount-time layout effect), and CSS transitions
  // animate between ANY two style recalculations regardless of whether a
  // paint happened in between — so the card's own `transition-all` was
  // still animating from the fallback size to the real one, just over a
  // shorter, less dramatic distance than before. Fix: suppress the
  // transition entirely for whichever render is the FIRST one to see a real
  // `cardSize` (so that specific commit just applies statically, no
  // animation, nothing to see), then re-enable it for every render after —
  // legitimate later resizes (toggling comments/subtitles, window resize,
  // entering/leaving presentation mode) still animate smoothly as before.
  // Deliberately a ref mutated during render (read-then-write-for-next-time,
  // same pattern as `resolveVideoSrc` above) rather than state, so flipping
  // it never itself causes an extra re-render.
  const cardTransitionEnabled = cardTransitionRef.current;
  if (cardSize) cardTransitionRef.current = true;

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-[80] flex items-center justify-center bg-black/85 backdrop-blur-xl transition-[padding] duration-500 ease-in-out ${
        // 2026-08-25, Lino: "wenn der player öffnet soll dieser fast full screen gezeigt werden
        // so haben auch die symbole mehr platz" — no backdrop padding at all below `sm` (was
        // `p-3`), the card itself is forced full-screen right below (see its own comment).
        presenting ? "p-0" : "p-0 sm:p-6"
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        // 2026-07-18: solange resizeAll() noch nicht gelaufen ist (kein
        // videoWidth bekannt), Fallback auf die alte volle Grösse — sonst
        // wäre die Karte beim allerersten Frame 0x0.
        // 2026-08-03 — Präsentationsmodus löst Ecken/Rand auf (analog zu
        // IdeaFloatingCard's presenting-Behandlung), transition-all
        // animiert das UND die per resizeAll() neu berechnete cardSize
        // smooth, da dasselbe DOM-Element (kein Remount) einfach nur seine
        // Werte ändert.
        // 2026-08-04, Lino: "so kriegen wir noch mehr platz.. es darf
        // wirklich browserfüllend sein" — im Präsentationsmodus wird die
        // per resizeAll() berechnete cardSize (die sich eng um Video+Chrome
        // schrumpft) NICHT mehr als Inline-Grösse angewendet, stattdessen
        // `w-screen h-screen` (kein 95vw/92vh-Deckel mehr). Das <video>
        // selbst bleibt trotzdem exakt in seinem eigenen Seitenverhältnis
        // (videoBoxSize, unverändert) — der Rand um ein nicht exakt
        // passendes Video herum ist reines Letterboxing, keine künstliche
        // Kartenbegrenzung mehr.
        // 2026-08-25, Lino: same ask as the backdrop padding above — the card's normal (non-
        // presenting) sizing comes from `cardSize`, computed to shrink SNUGLY around the video
        // (see the comments above), which on a narrow phone leaves a lot of unused space around a
        // small card instead of actually using the screen — exactly what left too little room for
        // the header's icons. `max-sm:w-screen!`/`h-screen!`/`max-w-none!`/`max-h-none!` force
        // the card past its inline `cardSize` style (Tailwind's `!` beats inline styles) below
        // `sm`, giving it the SAME true full-viewport size `presenting` mode already gets — the
        // header/icons stay visible and now get the full screen width to lay out in (see that
        // row's own 2026-08-25 comment). Desktop is completely unaffected (`sm:` and up still use
        // the snug `cardSize`/95vw/92vh fit exactly as before).
        style={cardSize && !presenting ? { width: cardSize.width, height: cardSize.height } : undefined}
        className={`relative overflow-hidden bg-[#0b0c10] flex flex-col ${cardTransitionEnabled ? "transition-all duration-500 ease-in-out" : ""} ${
          presenting
            ? "rounded-none border-0 w-screen h-screen"
            : `rounded-2xl border border-white/10 ${cardSize ? "max-w-[95vw] max-h-[92vh]" : "w-full h-full max-w-[1700px]"} max-sm:w-screen! max-sm:h-screen! max-sm:max-w-none! max-sm:max-h-none! max-sm:rounded-none! max-sm:border-0!`
        }`}
      >
        {/* 2026-08-04, Lino: "die leiste oben muss im präsentationsmodus
            nicht angezeigt werden, der präsentationsmodus kann einfach per x
            oben rechts geschlossen werden" — die GANZE Header-Zeile
            verschwindet jetzt (nicht mehr nur einzelne Buttons darin), dafür
            schwebt weiter unten ein einzelnes X oben rechts, nur während
            presenting. Header komplett unmounten (statt nur ausblenden)
            lässt headerRef.current?.offsetHeight in resizeAll() automatisch
            auf 0 fallen — mehr vertikaler Platz fürs Video, ganz ohne
            Sonderfall dort. */}
        {!presenting && (
        // 2026-08-25 audit fix (Lino: geteilter Preview-Link auf dem Smartphone — "klickt man auf
        // die Kachel... werden die Symbole oben übereinander gelegt"). Root cause: this row had no
        // flex-wrap and the icon group was `shrink-0` (never concedes width) — on a narrow phone
        // viewport, the title row + up to ~7 icon buttons together don't fit one line, and with no
        // wrap/scroll the icon group just crowds/overlaps past the container edge. Fixed by
        // stacking title and icons onto their own rows below the `sm` breakpoint (icons get a full
        // line to themselves — comfortably enough width even for every icon at once) while staying
        // a single row on desktop exactly as before; `flex-wrap` on the icon group itself is a
        // second safety net in case even a full mobile-width line isn't enough.
        <div ref={headerRef} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-5 py-3 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setVersionIndex((i) => i - 1)}
              disabled={versionIndex <= 0}
              aria-label={t("videoReviewModal.previousVersion")}
              className="w-8 h-8 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent transition-colors shrink-0"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
            </button>
            <div className="min-w-0">
              <div className="font-semibold text-sm truncate">{currentVersion?.original_filename ?? video.title}</div>
              <div className="text-xs text-white/40">{t("videoReviewModal.versionOf", { number: currentVersion?.version_number ?? "–", total: versions.length })}</div>
            </div>
            <button
              onClick={() => setVersionIndex((i) => i + 1)}
              disabled={versionIndex >= versions.length - 1}
              aria-label={t("videoReviewModal.nextVersion")}
              className="w-8 h-8 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent transition-colors shrink-0"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
            </button>
          </div>
          <div className="flex items-center flex-wrap gap-1.5 shrink-0">
            {canEdit && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.[0]) uploadNewVersion(e.target.files[0]);
                    e.target.value = "";
                  }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="relative overflow-hidden text-xs font-medium text-white/70 hover:text-white bg-white/5 hover:bg-white/10 disabled:opacity-100 rounded-lg px-3 py-1.5 transition-colors"
                >
                  {uploading
                    ? `${t("videoTile.uploading")}${uploadProgress !== null ? ` ${Math.round(uploadProgress * 100)}%` : ""}`
                    : t("videoReviewModal.newVersion")}
                  {uploading && uploadProgress !== null && (
                    <span
                      aria-hidden
                      className="absolute left-0 bottom-0 h-0.5 bg-blue-500 transition-[width] duration-150"
                      style={{ width: `${Math.round(uploadProgress * 100)}%` }}
                    />
                  )}
                </button>
              </>
            )}
            {onDeleteVideo && (
              <button
                onClick={() => (onDeleteVersion && versions.length > 1 ? setShowDeleteChoice(true) : setConfirmDeleteVideo(true))}
                aria-label={t("videoReviewModal.deleteVideo")}
                className="w-9 h-9 rounded-full flex items-center justify-center text-white/40 hover:text-red-400 hover:bg-white/10 transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6" /></svg>
              </button>
            )}
            {/* 2026-07-21 — nur fuer eingeloggte Editoren, siehe
                toggleWatermark's Doc-Kommentar. Wirkt nicht auf DIESE
                Ansicht (die bleibt immer unwasserzeichnet), nur auf
                Downloads ueber den oeffentlichen Preview-Link. */}
            {!publicMode && canEdit && (
              <button
                onClick={toggleWatermark}
                disabled={togglingWatermark}
                aria-label={video.watermark_enabled ? t("videoReviewModal.watermarkDisable") : t("videoReviewModal.watermarkEnable")}
                title={
                  video.watermark_enabled
                    ? t("videoReviewModal.watermarkActiveTitle")
                    : t("videoReviewModal.watermarkInactiveTitle")
                }
                className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors disabled:opacity-40 ${
                  video.watermark_enabled ? "text-blue-400 bg-white/10" : "text-white/40 hover:text-white hover:bg-white/10"
                }`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <text x="12" y="15" fontSize="7" fontWeight="700" textAnchor="middle" fill="currentColor" stroke="none" transform="rotate(-25 12 13)">PW</text>
                </svg>
              </button>
            )}
            {currentVersion?.playback_url && (
              <button
                onClick={downloadCurrentVideo}
                disabled={downloading}
                aria-label={t("videoReviewModal.downloadVideo")}
                title={t("videoReviewModal.downloadVideo")}
                className="w-9 h-9 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 disabled:opacity-40 transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
              </button>
            )}
            {currentVersion?.playback_url && (
              <button
                onClick={downloadCurrentFrame}
                disabled={isPlaying}
                aria-label={t("videoReviewModal.downloadFrame")}
                title={t("videoReviewModal.downloadFrame")}
                className="w-9 h-9 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 disabled:opacity-40 disabled:pointer-events-none transition-colors"
              >
                {/* 2026-08-25, Lino: "das symbol für den thumbnail download vom aktuellen frame...
                    sieht noch zu komisch aus", then after the first redraw (photo frame + small
                    download-arrow badge) — "mach das thumbnail symbol einfach ohne den download
                    pfeil." Plain, well-centered photo-frame glyph now, no badge at all — the
                    button's own title/aria-label ("Frame herunterladen") already says what it
                    does, the icon doesn't need to spell out "download" too. */}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="14" rx="2" /><circle cx="8.5" cy="9.5" r="1.5" fill="currentColor" stroke="none" /><path d="M4 15l4.5-4.5 3 3L18 8l3 4" /></svg>
              </button>
            )}
            {(canEdit || hasAnySubtitles) && (
              <button
                onClick={() => setShowSubtitles((v) => !v)}
                aria-label={showSubtitles ? t("subtitlePanel.hide") : t("subtitlePanel.show")}
                title={showSubtitles ? t("subtitlePanel.hide") : t("subtitlePanel.show")}
                className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                  showSubtitles ? "text-blue-400 bg-white/10" : "text-white/40 hover:text-white hover:bg-white/10"
                }`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><line x1="7" y1="14" x2="9" y2="14" /><line x1="12" y1="14" x2="17" y2="14" /><line x1="7" y1="10" x2="17" y2="10" /></svg>
              </button>
            )}
            <button
              onClick={() => setShowComments((v) => !v)}
              aria-label={showComments ? t("videoReviewModal.hideComments") : t("videoReviewModal.showComments")}
              title={showComments ? t("videoReviewModal.hideComments") : t("videoReviewModal.showComments")}
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                showComments ? "text-blue-400 bg-white/10" : "text-white/40 hover:text-white hover:bg-white/10"
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
            </button>
            {/* 2026-08-03, Lino: Präsentationsmodus fürs Video-Feedback —
                gleiches "Präsentationstafel"-Symbol wie IdeaFloatingCard.tsx,
                für Wiedererkennbarkeit. Nur hier (normale Ansicht) sichtbar,
                da die ganze Header-Zeile im Präsentationsmodus verschwindet
                — Verlassen läuft dort über das separate schwebende X. */}
            <button
              onClick={() => setPresenting(true)}
              aria-label={t("videoReviewModal.presentModeEnter")}
              title={t("videoReviewModal.presentModeEnter")}
              className="w-9 h-9 rounded-full flex items-center justify-center transition-colors text-white/40 hover:text-white hover:bg-white/10"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="13" rx="1.5" />
                <path d="M8 21 10 16M16 21l-2-5" />
                <path d="M12 16v2" />
              </svg>
            </button>
            <button
              onClick={onClose}
              aria-label={t("common.close")}
              className="w-9 h-9 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
        )}
        {/* 2026-08-04 — schwebendes X, nur im Präsentationsmodus: verlässt
            NUR den Präsentationsmodus (zurück zur normalen Ansicht mit
            Header), schliesst nicht das ganze Modal — gleiche Konvention wie
            die Escape-Taste (siehe deren Kommentar weiter unten). */}
        {presenting && (
          <button
            onClick={() => setPresenting(false)}
            aria-label={t("videoReviewModal.presentModeExit")}
            title={t("videoReviewModal.presentModeExit")}
            className="absolute top-4 right-4 z-20 w-10 h-10 rounded-full flex items-center justify-center text-white/60 hover:text-white bg-black/30 hover:bg-white/10 transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        )}
        {showDeleteChoice && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-sm rounded-2xl bg-[#1c1c1e] border border-white/10 p-5">
              <h3 className="text-sm font-semibold mb-1.5">{t("videoReviewModal.deleteChoiceTitle")}</h3>
              <p className="text-xs text-white/40 mb-4">{t("videoReviewModal.deleteChoiceMessage")}</p>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => {
                    setShowDeleteChoice(false);
                    setConfirmDeleteVersion(true);
                  }}
                  className="w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium bg-white/5 hover:bg-white/10 transition-colors"
                >
                  {t("videoReviewModal.deleteChoiceThisVersion")}
                  <span className="block text-xs text-white/40 mt-0.5">
                    {t("videoReviewModal.versionOf", { number: currentVersion?.version_number ?? "–", total: versions.length })}
                  </span>
                </button>
                <button
                  onClick={() => {
                    setShowDeleteChoice(false);
                    setConfirmDeleteVideo(true);
                  }}
                  className="w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium bg-red-600/10 text-red-400 hover:bg-red-600/20 transition-colors"
                >
                  {t("videoReviewModal.deleteChoiceAllVersions")}
                </button>
              </div>
              <div className="flex justify-end mt-4">
                <button
                  onClick={() => setShowDeleteChoice(false)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10"
                >
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          </div>
        )}
        <ConfirmDialog
          open={confirmDeleteVersion}
          title={t("videoReviewModal.deleteVersionTitle")}
          message={t("videoReviewModal.deleteVersionMessage", { number: currentVersion?.version_number ?? "–" })}
          onConfirm={() => {
            setConfirmDeleteVersion(false);
            if (currentVersion) onDeleteVersion?.(currentVersion.id);
          }}
          onCancel={() => setConfirmDeleteVersion(false)}
        />
        <ConfirmDialog
          open={confirmDeleteVideo}
          title={t("videoReviewModal.deleteVideo")}
          message={t("videoReviewModal.deleteVideoMessage", { title: video.title })}
          onConfirm={() => {
            setConfirmDeleteVideo(false);
            onDeleteVideo?.();
          }}
          onCancel={() => setConfirmDeleteVideo(false)}
        />
        <ConfirmDialog
          open={confirmSubmitFeedback}
          title={t("videoReviewModal.submitFeedbackTitle")}
          message={t("videoReviewModal.submitFeedbackMessage")}
          confirmLabel={t("videoReviewModal.send")}
          danger={false}
          onConfirm={submitFeedback}
          onCancel={() => setConfirmSubmitFeedback(false)}
        />
        {showNameDialog && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-xs rounded-2xl bg-[#1c1c1e] border border-white/10 p-5">
              <h3 className="text-sm font-semibold mb-1">{t("videoReviewModal.visitorNameTitle")}</h3>
              <p className="text-xs text-white/40 mb-3">{t("videoReviewModal.visitorNameHint")}</p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  confirmVisitorName();
                }}
              >
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  placeholder={t("videoReviewModal.visitorNamePlaceholder")}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowNameDialog(false)}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10"
                  >
                    {t("common.cancel")}
                  </button>
                  <button type="submit" className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-600 text-white">
                    {t("videoReviewModal.continue")}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Body */}
        {/* 2026-08-25, Lino: "im preview modus wenn man im player ist auf dem Mobile" kann man
            nicht scrollen. Root cause: `resizeAll()`'s height budget for the video box only
            reserves room for header+chrome (it never reserves anything for the comments column,
            since `commentsShown` there is explicitly `&& window.innerWidth >= 1024` — correct for
            desktop's side-by-side layout, where comments get their OWN column with independent
            internal scrolling). Below `lg` this wrapper stacks video-then-comments in one
            `flex-col` instead (comments panel further down still renders unconditionally on
            `showComments || presenting`, with no width-based gate) — so the video ends up sized
            to nearly the FULL card height with nothing left for the comments panel stacked below
            it, and with `overflow-hidden` on this wrapper that overflow was simply clipped/
            unreachable rather than scrollable. `overflow-y-auto` below `lg` (still `overflow-hidden`
            at `lg:` and up, desktop completely unchanged) lets the whole stacked column scroll so
            the comments panel is actually reachable. */}
        <div className="flex-1 flex overflow-y-auto lg:overflow-hidden flex-col lg:flex-row">
          {/* Ganz links: Untertitel-Spalte (2026-07-28) — nur Text, bewusst
              KEINE Timecodes (siehe SubtitlePanel's Doc-Kommentar). */}
          {showSubtitles && !presenting && (
            <div
              className="hidden lg:flex flex-col p-5 border-r border-white/8 shrink-0 overflow-hidden"
              style={{ width: subtitleColWidth }}
            >
              <SubtitlePanel
                cues={activeSubtitleCues}
                hasOriginal={hasOriginalSubtitles}
                originalLang={subtitles.original_lang}
                loading={subtitlesLoading}
                onEditText={handleEditSubtitleCueText}
                canManage={canEdit}
                uploading={uploadingSubtitles}
                onUpload={onUploadSubtitles ? handleUploadSubtitles : undefined}
                onDownload={onDownloadSubtitles ? handleDownloadSubtitles : undefined}
                lang={subtitleLang}
                availableLangs={availableSubtitleLangs}
                onChangeLang={setSubtitleLang}
                translating={translatingSubtitles}
                onTranslate={onTranslateSubtitles ? handleTranslateSubtitles : undefined}
              />
            </div>
          )}
          {/* Links: Video + Timeline */}
          <div className="flex-1 flex flex-col p-5 gap-3 min-w-0">
            <div ref={videoWrapRef} className="flex-1 relative rounded-xl overflow-hidden flex items-center justify-center min-h-0">
              {currentVersion?.playback_url ? (
                <video
                  ref={videoRef}
                  src={resolveVideoSrc()}
                  crossOrigin="anonymous"
                  onLoadedData={() => setVideoReady(true)}
                  onLoadedMetadata={(e) => {
                    setDuration(e.currentTarget.duration || currentVersion.duration_seconds || 0);
                    resizeAll();
                  }}
                  onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onClick={() => (videoRef.current?.paused ? safePlay() : videoRef.current?.pause())}
                  muted={isMuted}
                  style={{
                    opacity: videoReady ? 1 : 0.2, transition: "opacity 0.25s ease",
                    // 2026-07-17, Lino: "keine schwarzen balken bei 9:16" —
                    // width/height kommen exakt aus resizeAll() statt
                    // max-w/max-h (siehe [[feedback_video_player]]), bis die
                    // erste Messung passiert ist (kurz vor loadedmetadata)
                    // fällt es auf 100% zurück, sonst wäre der allererste
                    // Frame unsichtbar/0x0.
                    width: videoBoxSize?.width ?? "100%", height: videoBoxSize?.height ?? "100%",
                  }}
                  // 2026-08-03, Lino: "im präsentationsmodus sollen die
                  // videoecken abgerundet sein" — the wrap div's own
                  // `rounded-xl` (above) only clips visibly when the video
                  // fills it exactly; normally there's letterbox space
                  // around the video that blends into the same dark
                  // background, so the video's own corners need their own
                  // rounding directly (border-radius clips a <video>'s
                  // rendered frame same as an <img>).
                  className={`cursor-pointer ${presenting ? "rounded-xl" : ""}`}
                />
              ) : (
                <p className="text-sm text-white/40">{t("videoReviewModal.noVideoForVersion")}</p>
              )}
            </div>

            {/* chromeRef umschliesst Steuerzeile+Timeline zusammen, damit
                resizeAll() ihre kombinierte Höhe in einer Messung bekommt
                (siehe resizeAll-Doc-Kommentar oben). */}
            <div ref={chromeRef} className="flex flex-col gap-3">
            {/* Eigene Steuerzeile (2026-07-17, Lino: "es gibt jetzt 2
                timelines... wir wollen aber nur eine timeline") — native
                `controls` komplett raus, Play/Pause+Stummschalten hier statt
                doppelt (Browser-Leiste + eigene Timeline mit Markern). */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => (videoRef.current?.paused ? safePlay() : videoRef.current?.pause())}
                aria-label={isPlaying ? t("videoReviewModal.pause") : t("videoReviewModal.play")}
                className="w-8 h-8 rounded-full flex items-center justify-center text-white bg-white/10 hover:bg-white/20 transition-colors shrink-0"
              >
                {isPlaying ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" /><rect x="14" y="5" width="4" height="14" /></svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                )}
              </button>
              <span className="text-xs font-mono text-white/50 shrink-0">{formatTime(currentTime)} / {formatTime(duration)}</span>
              <button
                onClick={() => setIsMuted((m) => !m)}
                aria-label={isMuted ? t("videoReviewModal.unmute") : t("videoReviewModal.mute")}
                className="w-8 h-8 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors shrink-0"
              >
                {isMuted ? (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5Z" /><path d="m23 9-6 6M17 9l6 6" /></svg>
                ) : (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5Z" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" /></svg>
                )}
              </button>
            </div>

            {/* Custom Timeline: Fortschritt + Kommentar-Marker + Hover-Filmstrip */}
            <div className="relative pt-8 pb-8">
              {hoverFraction != null && filmstrip && frameCount > 1 && (() => {
                // 2026-07-19, Lino: "beim Scrubben über die Timeline wird
                // das Bild über der Timeline vom Kachelrand abgeschnitten"
                // — centering the preview exactly on the cursor (the old
                // `calc(fraction% - frameWidth/2)`) pushes it partway past
                // the timeline's own left/right edge whenever the cursor is
                // near either end, and the modal clips that overflow.
                // Clamp to the timeline's actual pixel width instead, same
                // idea as a native video scrubber: the preview slides along
                // normally through the middle, then stops sliding and stays
                // fully on-screen for the last frameWidth/2 near each edge.
                const containerWidth = timelineRef.current?.getBoundingClientRect().width ?? 0;
                const rawLeft = hoverFraction * containerWidth - previewWidth / 2;
                const clampedLeft = Math.min(Math.max(rawLeft, 0), Math.max(0, containerWidth - previewWidth));
                return (
                  <div
                    className="absolute bottom-full mb-2 pointer-events-none rounded-md overflow-hidden border border-white/20 shadow-xl"
                    style={{
                      left: clampedLeft,
                      width: previewWidth, height: previewHeight,
                      backgroundImage: `url(${filmstrip})`,
                      backgroundSize: `${frameCount * previewWidth}px ${previewHeight}px`,
                      backgroundPosition: `-${Math.min(frameCount - 1, Math.floor(hoverFraction * frameCount)) * previewWidth}px 0px`,
                    }}
                  />
                );
              })()}
              <div
                ref={timelineRef}
                onMouseMove={handleTimelineMove}
                onMouseLeave={() => !isDragging && setHoverFraction(null)}
                onMouseDown={handleTimelinePointerDown}
                // 2026-07-18, Lino: "Timelinelinie ist noch zu dick, kann
                // feiner sein" — von h-1.5 (6px) auf h-1 (4px).
                className="group relative h-1 rounded-full bg-white/10 cursor-pointer"
              >
                {/* 2026-07-17, Lino: "kann sie sich smoother vergrössern"
                    (der Fortschrittsbalken beim Abspielen) — ursprünglich
                    eine CSS-Transition auf width, um die Lücken zwischen
                    den ~4x/Sekunde timeupdate-Ticks zu glätten.
                    2026-07-26 (#328): `currentTime` wird waehrend des
                    Abspielens jetzt per rAF-Loop (siehe oben) ~60x/Sekunde
                    aktualisiert statt nur ueber timeupdate — die Transition
                    wuerde dem jetzt nur noch eine kuenstliche Verzoegerung
                    hinzufuegen. Bleibt NUR fuer den restlichen Fall (pausiert,
                    z.B. Versionswechsel/programmatischer Sprung) erhalten,
                    waehrend Drag UND waehrend des Abspielens aus. */}
                <div
                  className={`h-full rounded-full bg-blue-500 ${isDragging || isPlaying ? "" : "transition-[width] duration-150 ease-linear"}`}
                  style={{ width: `${progressPct}%` }}
                />
                {/* 2026-07-21, Lino: "ein kleiner Indikator wenn man mit der
                    Maus auf der Spitze der Timeline ist, um zu wissen dass man
                    ziehen kann" — rein visueller Griff an der aktuellen
                    Abspielposition, pointer-events-none damit Klicks/Drag
                    weiterhin vom umschliessenden Track (onMouseDown oben)
                    behandelt werden, nicht vom Griff selbst. Sichtbar bei
                    Hover ODER waehrend des Draggens (sonst verschwindet er
                    genau dann, wenn man ihn gerade zieht). */}
                <div
                  className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white ring-1 ring-black/20 shadow pointer-events-none transition-opacity ${
                    isDragging ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  }`}
                  style={{ left: `${progressPct}%` }}
                />
                {/* 2026-07-17, Lino: "ein kleiner weisser vertikaler strich,
                    darunter der avatar... avatar braucht eine leichte
                    Kontur" — Strich sitzt AUF der Timeline (top-0, volle
                    Track-Hoehe+etwas), Avatar haengt darunter (flex-col,
                    kein top-1/2-Zentrieren mehr wie vorher). */}
                {timelineComments.map((c) => (
                  <div
                    key={c.id}
                    className="absolute top-0 -translate-x-1/2 z-10 flex flex-col items-center gap-2"
                    style={{ left: `${duration > 0 ? ((c.timestamp_seconds ?? 0) / duration) * 100 : 0}%` }}
                    onMouseEnter={() => setHoveredCommentId(c.id)}
                    onMouseLeave={() => setHoveredCommentId((id) => (id === c.id ? null : id))}
                  >
                    <div className="w-0.5 h-3 bg-white rounded-full shrink-0" />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        seekTo(c.timestamp_seconds ?? 0);
                        // 2026-07-18 (Todoist #190): additionally highlight
                        // + scroll to this comment's row in the sidebar,
                        // not just seek the video.
                        setHighlightedCommentId(c.id);
                        commentRowRefs.current.get(c.id)?.scrollIntoView({ behavior: "smooth", block: "center" });
                        setTimeout(() => setHighlightedCommentId((id) => (id === c.id ? null : id)), 2000);
                      }}
                      className={`block rounded-full ring-1 ring-white/50 overflow-hidden ${c.status === "resolved" ? "opacity-40" : ""}`}
                    >
                      <Avatar name={c.author_name} avatarUrl={c.avatar_url} size={20} />
                    </button>
                    {hoveredCommentId === c.id && (
                      <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-white/15 bg-black/90 px-3 py-1.5 text-xs text-white shadow-xl">
                        <span className="text-white/50 font-mono mr-1.5">{formatTime(c.timestamp_seconds ?? 0)}</span>
                        {/* 2026-07-18 (Todoist #190): excerpt to 50 chars —
                            a long comment used to render as one very wide
                            single-line tooltip. */}
                        <span className="font-semibold">{c.author_name}:</span> {excerpt(c.comment, 50)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            </div>
          </div>

          {/* Rechts: Kommentarspalte — 2026-07-21, Lino: "darf noch viel
              breiter sein" (380px -> 460px bei #155, jetzt -> 640px).
              2026-08-04 — Breite kommt jetzt aus resizeAll()'s elastischer
              commentColWidth (siehe deren Kommentar) statt einer fixen
              Tailwind-Klasse, damit sie auf kleineren Bildschirmen dem Video
              Platz abgeben kann; die `lg:`-Sichtbarkeits-Logik bleibt aber
              reines CSS (unterhalb 1024px bleibt es bei `w-full`). */}
          {(showComments || presenting) && (
          <div
            className="w-full shrink-0 border-t lg:border-t-0 lg:border-l border-white/10 flex flex-col min-h-0"
            style={window.innerWidth >= 1024 ? { width: commentColWidth } : undefined}
          >
            {presenting ? (
              // 2026-08-03, Lino: Präsentationsmodus — Feedback als grosse,
              // übersichtliche Todo-Liste statt der normalen Thread-Ansicht
              // (keine Antworten/Kommentarfeld, nur Abhaken+Springen). Teilt
              // sich denselben `comments`-State mit der normalen Ansicht, ein
              // hier abgehaktes Element erscheint dort also sofort ebenfalls
              // durchgestrichen — kein Extra-Sync nötig.
              <div className="flex-1 overflow-y-auto p-8 flex flex-col">
                {/* 2026-08-03, Lino: "die 3/3 soll direkt rechts neben dem
                    Feedback stehen" — was `justify-between`, pushing the
                    counter to the far right edge of the column instead of
                    right next to the title. */}
                <div className="flex items-center gap-3 mb-6 shrink-0">
                  <h3 className="text-2xl font-bold tracking-tight">{t("videoReviewModal.presentModeTitle")}</h3>
                  {feedbackItems.length > 0 && (
                    <span className="text-sm font-mono text-white/40 shrink-0">
                      {feedbackItems.filter((c) => c.status === "resolved").length}/{feedbackItems.length}
                    </span>
                  )}
                </div>
                {feedbackItems.length === 0 ? (
                  <p className="text-lg text-white/30">{t("videoReviewModal.noCommentsYet")}</p>
                ) : (
                  <div className="flex flex-col divide-y divide-white/8">
                    {feedbackItems.map((c) => (
                      <PresentationFeedbackRow
                        key={c.id}
                        comment={c}
                        canModify={canEdit || (!!currentUserId && c.user_id === currentUserId)}
                        onSeek={() => seekTo(c.timestamp_seconds ?? 0)}
                        onToggleResolved={() => toggleResolved(c)}
                      />
                    ))}
                  </div>
                )}
                {/* 2026-08-03, Lino: "hat man jegliches offenes Feedback
                    abgehackt, soll von unten konfetti hochschiessen" — das
                    Konfetti selbst kommt aus fireFeedbackConfetti() (per
                    canvas, deckt den ganzen Viewport ab), diese Zeile ist nur
                    die begleitende Erfolgsmeldung. */}
                {allFeedbackResolved && (
                  <div className="mt-8 text-center text-2xl font-semibold text-emerald-400 shrink-0">
                    {t("videoReviewModal.allFeedbackDone")}
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
                  {rootComments.length === 0 && (
                    <p className="text-sm text-white/30">{t("videoReviewModal.noCommentsYet")}</p>
                  )}
                  {rootComments.map((c) => (
                    <div key={c.id} className="flex flex-col gap-2">
                      <CommentRow
                        rowRef={(el) => {
                          if (el) commentRowRefs.current.set(c.id, el);
                          else commentRowRefs.current.delete(c.id);
                        }}
                        highlighted={highlightedCommentId === c.id}
                        comment={c}
                        canEdit={canEdit}
                        isOwn={!!currentUserId && c.user_id === currentUserId}
                        canDeleteOverride={publicMode && myCommentIds.has(c.id) && !currentVersion?.feedback_locked}
                        onSeek={() => seekTo(c.timestamp_seconds ?? 0)}
                        onReply={() => setReplyTo(c)}
                        onToggleResolved={() => toggleResolved(c)}
                        onDelete={() => (publicMode ? deletePublicComment(c) : deleteComment(c))}
                      />
                      {(repliesByParent.get(c.id) ?? []).map((r) => (
                        <div key={r.id} className="ml-6 pl-3 border-l border-white/10">
                          <CommentRow
                            comment={r}
                            canEdit={canEdit}
                            isOwn={!!currentUserId && r.user_id === currentUserId}
                            canDeleteOverride={publicMode && myCommentIds.has(r.id) && !currentVersion?.feedback_locked}
                            onSeek={() => seekTo(r.timestamp_seconds ?? 0)}
                            onReply={() => setReplyTo(c)}
                            onToggleResolved={() => toggleResolved(r)}
                            onDelete={() => (publicMode ? deletePublicComment(r) : deleteComment(r))}
                          />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>

                <div className="border-t border-white/10 p-3 shrink-0">
                  {publicMode && currentVersion?.feedback_locked ? (
                    <p className="text-sm text-white/40 text-center py-2">
                      ✓ {t("videoReviewModal.feedbackDone")}
                    </p>
                  ) : (
                    <>
                      {replyTo && (
                        <div className="flex items-center justify-between gap-2 mb-2 text-xs text-white/50 bg-white/5 rounded-lg px-2.5 py-1.5">
                          <span>{t("videoReviewModal.replyingTo")} <strong className="text-white/80">{replyTo.author_name}</strong></span>
                          <button onClick={() => setReplyTo(null)} className="text-white/40 hover:text-white">×</button>
                        </div>
                      )}
                      {/* 2026-07-17, Lino: "Das kommentar feld rechts muss grösser
                          (höher sein)" — textarea statt einzeiligem input, Enter
                          schickt weiterhin ab (Shift+Enter für einen Zeilenumbruch,
                          Standard-Chat-Konvention). */}
                      <div className="relative flex items-center gap-2">
                        {mentionMatches.length > 0 && (
                          <div className="absolute bottom-full mb-1.5 left-9 right-0 rounded-lg border border-white/15 bg-[#161616] shadow-xl overflow-hidden z-10">
                            {mentionMatches.map((m) => (
                              <button
                                key={m.user_id}
                                onClick={() => insertMention(m)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-white/10 transition-colors"
                              >
                                <Avatar name={m.name} email={m.email} avatarUrl={m.avatar_url} size={20} />
                                {m.name || m.email}
                              </button>
                            ))}
                          </div>
                        )}
                        <span className="shrink-0 text-xs text-white/40 font-mono w-9 text-right">{formatTime(currentTime)}</span>
                        <textarea
                          ref={commentInputRef}
                          value={commentText}
                          onChange={(e) => handleCommentTextChange(e.target.value, e.target.selectionStart)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey && mentionMatches.length === 0) {
                              e.preventDefault();
                              submitComment();
                            }
                            if (e.key === "Escape" && mentionMatches.length > 0) setMentionQuery(null);
                          }}
                          rows={3}
                          placeholder={replyTo ? t("videoReviewModal.replyPlaceholder") : t("videoReviewModal.commentPlaceholder")}
                          className="flex-1 resize-none bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                        />
                      </div>
                      {/* 2026-07-26 (Todoist #329) — Enter now saves the comment
                          (see the textarea's onKeyDown above, unchanged), so the
                          separate "Kommentar speichern" button this used to pair
                          with "Feedback senden" is gone — same Enter/Shift+Enter
                          convention as the idea-comments box
                          (PublicIdeaLightbox.tsx). "Feedback senden" stays: it's
                          a distinct, more consequential action (locks the
                          version), not a duplicate save path. */}
                      {publicMode && onSubmitFeedback && (
                        <div className="flex items-center justify-end gap-2 mt-2">
                          <button
                            onClick={() => setConfirmSubmitFeedback(true)}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white/10 text-white/70 hover:text-white hover:bg-white/15"
                          >
                            {t("videoReviewModal.submitFeedbackTitle")}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

/** 2026-08-07, Lino: "wenn Untertitel von jemand anderen korrigiert werden
 * muss... ein Kommentar erscheinen... für jede Sprache ein separater
 * Kommentar" — shared between CommentRow and PresentationFeedbackRow so the
 * "which system_kind counts as a notice" and "what text does it show"
 * logic can't drift between the two surfaces (same reasoning as the
 * pre-existing subtitle_edited notice, just one language-aware kind added
 * alongside it). */
function isSystemNotice(comment: VideoComment): boolean {
  return comment.system_kind === "subtitle_edited" || comment.system_kind === "subtitle_translation_edited";
}
function systemNoticeText(comment: VideoComment, t: ReturnType<typeof useLanguage>["t"]): string {
  if (comment.system_kind === "subtitle_translation_edited") {
    const lang = comment.system_kind_lang ?? "";
    return t("videoReviewModal.subtitleTranslationEditedNotice", { lang: SUBTITLE_LANGUAGES[lang] ?? lang.toUpperCase() });
  }
  return t("videoReviewModal.subtitleEditedNotice");
}

function CommentRow({
  comment, canEdit, isOwn, canDeleteOverride, onSeek, onReply, onToggleResolved, onDelete, rowRef, highlighted,
}: {
  comment: VideoComment;
  canEdit: boolean;
  isOwn: boolean;
  /** 2026-07-20 (#254 follow-up, public preview) — lets a comment be
   * DELETE-only-able without also unlocking "Abhaken"/resolve, which makes
   * no sense for an anonymous viewer thread. Independent of canModify
   * below (which still governs resolve, unchanged for the authenticated
   * app). */
  canDeleteOverride?: boolean;
  onSeek: () => void;
  onReply: () => void;
  onToggleResolved: () => void;
  onDelete: () => void;
  /** 2026-07-18 (Todoist #190) — lets the timeline marker's avatar click
   * scroll this exact row into view and briefly highlight it. */
  rowRef?: (el: HTMLDivElement | null) => void;
  highlighted?: boolean;
}) {
  const { t } = useLanguage();
  const canModify = canEdit || isOwn;
  const canDelete = canModify || canDeleteOverride;
  // 2026-07-29 — the one auto-generated "subtitles were edited" notice
  // (VideoComment.system_kind) isn't pinned to a moment and wasn't written
  // by anyone — no seek-on-click, no avatar/author, its text always comes
  // from i18n (never the stored `comment` fallback string, so it matches
  // whatever language the viewer is actually reading in), no reply.
  const isSystem = isSystemNotice(comment);
  const resolved = comment.status === "resolved";
  // 2026-07-17, Lino: "klickt man in der seitenleiste auf einen kommentar,
  // springt der player direkt zur position im video" — die ganze Zeile ist
  // jetzt klickbar (nicht mehr nur der kleine Timecode), Action-Buttons
  // stoppen die Propagation, damit "Antworten"/"Löschen" nicht versehentlich
  // AUCH noch seekt.
  // 2026-08-05, Lino: die normale Kommentar-Ansicht soll "immer wie beim
  // Präsentationsmodus" aussehen — grosses Checkbox-Kreis (steuert jetzt
  // direkt resolve/reopen, ersetzt den alten separaten "Abhaken"-Text-
  // Button), dann GROSSER Timecode, dann Avatar+Name, darunter der
  // Kommentar. Struktur/Grösse 1:1 vom Checkbox-Kreis aus
  // PresentationFeedbackRow übernommen, damit beide Ansichten wirklich
  // gleich aussehen.
  return (
    <div
      ref={rowRef}
      onClick={isSystem ? undefined : onSeek}
      className={`flex items-center gap-3 rounded-lg -mx-1.5 px-1.5 py-2 transition-colors ${isSystem ? "" : "cursor-pointer"} ${
        highlighted ? "bg-blue-500/20 ring-1 ring-blue-500/50" : isSystem ? "" : "hover:bg-white/5"
      } ${resolved ? "opacity-50" : ""}`}
    >
      {/* 2026-08-05, Lino: "checkkreis soll vertikal mittig von der
          kommentar höhe sein" — Aussen-Flex jetzt items-center statt
          items-start, kein eigener mt-Offset mehr am Button noetig. */}
      <button
        onClick={(e) => { e.stopPropagation(); canModify && onToggleResolved(); }}
        disabled={!canModify}
        aria-label={resolved ? t("videoReviewModal.reopen") : t("videoReviewModal.resolve")}
        title={resolved ? t("videoReviewModal.reopen") : t("videoReviewModal.resolve")}
        className={`w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
          resolved ? "bg-emerald-500 border-emerald-500 text-white" : "border-white/30 hover:border-white/60"
        } ${canModify ? "cursor-pointer" : "cursor-default opacity-50"}`}
      >
        {resolved && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
        )}
      </button>
      <div className="flex-1 min-w-0">
        {/* 2026-08-05, Lino: Timecode war "minimal zu gross" — text-lg -> text-base. */}
        {!isSystem && (
          <span className="text-base font-mono font-semibold text-blue-400">{formatTime(comment.timestamp_seconds ?? 0)}</span>
        )}
        <div className={`flex items-center gap-2 flex-wrap ${isSystem ? "" : "mt-1"}`}>
          {isSystem ? (
            <div className="w-[22px] h-[22px] rounded-full bg-white/10 flex items-center justify-center shrink-0 text-white/50">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
            </div>
          ) : (
            <Avatar name={comment.author_name} avatarUrl={comment.avatar_url} size={22} />
          )}
          <span className="text-sm font-semibold">{isSystem ? t("videoReviewModal.systemNoticeLabel") : comment.author_name}</span>
        </div>
        <p className={`text-sm text-white/80 break-words mt-1 ${resolved ? "line-through decoration-white/30" : ""}`}>
          {isSystem ? systemNoticeText(comment, t) : comment.comment}
        </p>
        {/* 2026-08-05, Lino: "bestätigung wer es gemacht hat, soll rechts
            neben Löschen auftauchen" — war eine eigene Zeile ueber der
            Action-Row, jetzt Teil derselben Zeile, nach Löschen. */}
        <div className="flex items-center gap-3 mt-1">
          {!isSystem && (
            <button onClick={(e) => { e.stopPropagation(); onReply(); }} className="text-xs text-white/40 hover:text-white/80 flex items-center gap-1">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 17H4v-5a4 4 0 0 1 4-4h12" /><path d="m14 3 5 5-5 5" /></svg>
              {t("videoReviewModal.reply")}
            </button>
          )}
          {canDelete && (
            <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="text-xs text-red-400/80 hover:text-red-400">
              {t("common.delete")}
            </button>
          )}
          {resolved && comment.resolved_by_name && (
            <span className="text-[11px] text-white/40">✓ {comment.resolved_by_name}</span>
          )}
        </div>
      </div>
    </div>
  );
}

/** 2026-08-03, Lino: Präsentationsmodus fürs Video-Feedback — eine Zeile der
 * grossen Todo-Liste rechts neben dem Video. Anders als CommentRow bewusst
 * ohne Antworten/Löschen (nur Abhaken+Springen, siehe die feature-Beschreibung:
 * "sehr übersichtlich dargestellt"). System-Hinweise (system_kind, z.B.
 * "Untertitel bearbeitet") erscheinen hier genau wie in CommentRow OHNE
 * Sprung-Ziel (kein timestamp_seconds), sind aber genau wie ein normaler
 * Kommentar abhakbar — Lino: "dieser kommentar muss auch abhackbar sein
 * (wie ein normaler kommentar von einer person)". */
function PresentationFeedbackRow({
  comment, canModify, onSeek, onToggleResolved,
}: {
  comment: VideoComment;
  canModify: boolean;
  onSeek: () => void;
  onToggleResolved: () => void;
}) {
  const { t } = useLanguage();
  const resolved = comment.status === "resolved";
  const isSystem = isSystemNotice(comment);
  // 2026-08-05, Lino: "die grössen bitte auch im präsentationsmodus...
  // anpassen" — selbe Timecode-Groesse (text-base, war text-xs) und
  // vertikal zum ganzen Zeilen-Inhalt zentrierter Checkkreis (items-center
  // statt items-start+mt-1) wie gerade eben bei CommentRow.
  return (
    <div className="flex items-center gap-4 py-4">
      <button
        onClick={() => canModify && onToggleResolved()}
        disabled={!canModify}
        aria-label={resolved ? t("videoReviewModal.reopen") : t("videoReviewModal.resolve")}
        title={resolved ? t("videoReviewModal.reopen") : t("videoReviewModal.resolve")}
        className={`w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
          resolved ? "bg-emerald-500 border-emerald-500 text-white" : "border-white/30 hover:border-white/60"
        } ${canModify ? "cursor-pointer" : "cursor-default opacity-50"}`}
      >
        {resolved && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
        )}
      </button>
      <button
        onClick={isSystem ? undefined : onSeek}
        disabled={isSystem}
        className={`flex-1 min-w-0 text-left ${isSystem ? "cursor-default" : "cursor-pointer"}`}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-semibold text-white/60">
            {isSystem ? t("videoReviewModal.systemNoticeLabel") : comment.author_name}
          </span>
          {!isSystem && <span className="text-base font-mono font-semibold text-blue-400">{formatTime(comment.timestamp_seconds ?? 0)}</span>}
        </div>
        <p className={`text-xl leading-snug break-words ${resolved ? "line-through decoration-white/30 text-white/35" : "text-white/90"}`}>
          {isSystem ? systemNoticeText(comment, t) : comment.comment}
        </p>
      </button>
    </div>
  );
}
