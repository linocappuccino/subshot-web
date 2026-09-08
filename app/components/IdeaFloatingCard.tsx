"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AuthImage } from "./AuthImage";
import { AuthVideo } from "./AuthVideo";
import { IdeaFeedbackPanel } from "./IdeaFeedbackPanel";
import { IdeaImageReorderGrid } from "./IdeaImageReorderGrid";
import { ImageGeneratePopup } from "./ImageGeneratePopup";
import { IdeaLinkEmbed } from "./IdeaLinkEmbed";
import { RichTextEditor } from "./RichTextEditor";
import { Button } from "./ui/Button";
import { useApi } from "@/lib/useApi";
import { useToast } from "./ui/Toast";
import { useAutosave } from "@/lib/useAutosave";
import { ApiError } from "@/lib/api";
import { richTextToPlainText, sanitizeRichTextHtml } from "@/lib/richText";
import { renderIdeaForPresentation } from "@/lib/ideaPresentation";
import { detectSocialEmbed } from "@/lib/embed";
import type { Annotation, Idea, MemberRole } from "@/lib/types";
import { useLanguage } from "@/lib/i18n";
import { isVideoUrl } from "@/lib/media";

const IDEA_MAX_IMAGES = 50;
const SLIDESHOW_INTERVAL_MS = 4000;
const GENERATION_POLL_MS = 3000;

/** The Ideenseite's single floating card (2026-07-17 redesign, replaces the
 * old grid+modal — Lino: "das brauchen wir anders... hier braucht es
 * einfach eine grosse kachel, ... fast browser füllend"). One idea, fully
 * in place: title at the top (autosaved), a large image area (auto-
 * advancing crossfade slideshow if multiple images), the description
 * below, and feedback + "Abgenommen" at the bottom. No separate create/
 * edit dialog anymore — this IS both. */
export function IdeaFloatingCard({
  idea,
  autoFocusTitle,
  presenting,
  onTogglePresenting,
  onUpdated,
  onDeleted,
  annotations,
  highlightedAnnotationId,
  onDeleteAnnotation,
  onAnnotationUpdated,
  myRole,
  canDeleteComments,
}: {
  idea: Idea;
  /** True right after this idea was created via the "+" button — selects
   * the default "Neue Idee" title so typing immediately replaces it. */
  autoFocusTitle?: boolean;
  /** 2026-07-18, Lino: "pro Kachel noch einen Präsentationsmodus" — lives
   * in the parent (IdeaFocusView), not local state here, so it survives
   * navigating to the next/previous idea via the arrow buttons (this
   * component remounts per idea, keyed by idea.id, see IdeaFocusView). */
  presenting: boolean;
  onTogglePresenting: () => void;
  onUpdated: (idea: Idea) => void;
  onDeleted: (id: string) => void;
  /** 2026-07-22 — passed straight through to IdeaFeedbackPanel, see its
   * own doc comment: makes Textmarker-Kommentare left on the public
   * preview page visible/clickable-from-the-sidebar here too. */
  annotations?: Annotation[];
  highlightedAnnotationId?: string | null;
  onDeleteAnnotation?: (annotation: Annotation) => void;
  onAnnotationUpdated?: (annotation: Annotation) => void;
  /** 2026-07-27, Todoist #356 — gates the "Intern abgenommen/abgelehnt"
   * buttons to Projektleiter/Owner; every member still SEES the status
   * (read-only) regardless of role. */
  myRole?: MemberRole | null;
  /** 2026-09-08 — passed straight through to IdeaFeedbackPanel, gates the
   * plain-feedback delete button the same way onDeleteAnnotation's own
   * presence already gates HighlightEntry's. */
  canDeleteComments?: boolean;
}) {
  const api = useApi();
  const toast = useToast();
  const { t } = useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState(idea.title);
  const [text, setText] = useState(idea.text);
  const detectedEmbed = useMemo(() => detectSocialEmbed(text), [text]);
  const [slideIndex, setSlideIndex] = useState(0);
  // 2026-07-21, Lino: "Per klick auf die diashow kann man die diashow
  // anhalten" — pauses the auto-advance interval below; a click on the
  // image background/photo itself toggles it, the prev/next/reorder/remove
  // buttons stop propagation so clicking THEM doesn't also toggle pause.
  const [slideshowPaused, setSlideshowPaused] = useState(false);
  // 2026-07-18 (Todoist #197, Lino: "16:9 Bilder werden abgeschnitten...
  // die Kachel soll sich dem Bild anpassen") — presenting mode used to
  // force every landscape photo into an assumed-exact 16:9 box (and every
  // portrait into 9:16); a photo that's actually e.g. 1.85:1 or 4:3 got
  // squeezed/cropped into that wrong-shaped hole. This tracks the photo's
  // REAL ratio (AuthImage's onAspectRatio) so the box can size to it
  // exactly instead of guessing.
  const [aspectRatio, setAspectRatio] = useState(16 / 9);
  const [uploading, setUploading] = useState(false);
  const [reordering, setReordering] = useState(false);
  // 2026-07-30, Lino: "manchmal zeigt er den Sortierungsmodus und nicht die
  // Diashow" — reordering (opened via "Anordnen", or auto-opened right
  // after uploading several images at once, see handleUploadBatch below)
  // and presenting were two fully independent booleans; the presenting
  // toggle button stayed reachable regardless of `reordering`, so clicking
  // it while still mid-reorder flipped `presenting` true without ever
  // clearing `reordering` — the `{reordering ? <IdeaImageReorderGrid/> :
  // <slideshow>}` branch below then kept showing the drag-grid instead of
  // the slideshow for the rest of the presenting session. Force-exit
  // reordering the moment presenting turns on, catching every path that
  // sets it (not just one button's onClick).
  useEffect(() => {
    if (presenting) setReordering(false);
  }, [presenting]);
  const [generating, setGenerating] = useState(false);
  const [showGeneratePopup, setShowGeneratePopup] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // 2026-07-18, Lino: "der Abgenommen Button muss unten rechts in der
  // Kachel platziert werden" (moved out of IdeaFeedbackPanel, which now
  // only renders the feedback list) + "soll nicht blau sein, sondern
  // gräulich und wird dann grün wenn man ihn klickt... animiert sich ein
  // Hacken davor". `approving` doubles as both "request in flight" AND
  // "just clicked, show green+check" — on success the component re-renders
  // with idea.status==='approved' and this button unmounts entirely (the
  // header's own "✓ Angenommen" badge takes over), so there's no separate
  // "done" state to design for; on failure it resets back to grey so the
  // click can be retried.
  const [approving, setApproving] = useState(false);
  // 2026-07-19, Lino: "nicht nur einen Abgenommen Button sondern auch einen
  // Abgelehnt Button" — same shape as `approving` above, just for the
  // reject path (no feedback-resolved gate, discarding an idea doesn't need
  // it). Terminal like approved: idea.status flips to 'rejected' on
  // success, the header badge takes over, this button unmounts.
  const [rejecting, setRejecting] = useState(false);
  // 2026-07-27, Todoist #356 — internal PL/Admin review gate, separate
  // request-in-flight flags from approving/rejecting above (different
  // buttons, different endpoints).
  const [internalApproving, setInternalApproving] = useState(false);
  const [internalRejecting, setInternalRejecting] = useState(false);
  const canInternalReview = myRole === "projektleiter" || myRole === "owner";
  // 2026-07-18, Lino: "man kann erst Abgenommen drücken wenn man alle
  // Kommentare abgehackt hat. ansonsten kommt eine Meldung" — default true
  // (no feedback yet, or still loading, shouldn't block the very first
  // approve), flipped by IdeaFeedbackPanel's onAllResolvedChange once it
  // knows the real answer.
  const [allFeedbackResolved, setAllFeedbackResolved] = useState(true);

  // 2026-07-22, Lino: "klickt man oben auf Kommentar und es öffnet sich die
  // Kachel mit dem Kommentar, muss man auch die Highlights sehen im Text,
  // sonst macht das ganze Highlighten ja keinen Sinn??? drückt man auf den
  // Kommentar unten muss das gehighlightete kurz aufleuchten... scrollt der
  // Text direkt zum gehighlighteten Text." Textmarker-Kommentare (see
  // IdeaFeedbackPanel) were visible in the feedback list since #314/#315.
  //
  // 2026-07-31, Lino: "es soll immer im / Modus sein auch beim bearbeiten
  // und beim markierte Kommentare ansehen" — this used to swap the live
  // RichTextEditor out for a READ-ONLY marked-up rendering
  // (wrapHighlightsInHtml, same as the public preview) whenever the idea
  // had any text highlights, since safely injecting <mark> into a live
  // contentEditable risks corrupting cursor/edit state. In practice that
  // made the card flip constantly between the two while reviewing feedback
  // — any click in the text (even just reading near a mark) dropped into
  // edit mode, then the next comment clicked in the panel below snapped it
  // straight back to read-only to show THAT mark.
  //
  // 2026-07-31, immediate follow-up, Lino: "man muss die Text-Markierung
  // immer so sehen wie sie auch gemacht wurde" — a same-day "just flash the
  // whole box" simplification (mirroring idea.title's own, since a plain
  // <input> genuinely can't show a marked substring) wasn't good enough:
  // he wants the ACTUAL highlighted substring visible, not just "something
  // in this general area changed color". Real fix: RichTextEditor now
  // paints highlights via the CSS Custom Highlight API (see its own
  // `highlights` prop doc comment) — a pure paint layer that never touches
  // the actual contentEditable DOM, so it's safe to keep live while
  // editing. The editor itself stays mounted unconditionally either way.
  const ideaAnnotations = (annotations ?? []).filter((a) => a.idea_id === idea.id);
  const titleAnnotations = ideaAnnotations.filter((a) => a.field === "idea.title");
  const textAnnotations = ideaAnnotations.filter((a) => a.field === "idea.text");
  const [titlePulsing, setTitlePulsing] = useState(false);
  const [activeTextHighlightId, setActiveTextHighlightId] = useState<string | null>(null);

  // Comment-entry (IdeaFeedbackPanel, below) → flash title input, or
  // brighten+scroll-to the matching highlight inside the text (see
  // RichTextEditor's own `activeHighlightId` handling for the scroll).
  function handleSelectAnnotation(ann: Annotation) {
    if (ann.field === "idea.title") {
      setTitlePulsing(true);
      titleRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => setTitlePulsing(false), 1200);
      return;
    }
    setActiveTextHighlightId(ann.id);
    setTimeout(() => setActiveTextHighlightId((cur) => (cur === ann.id ? null : cur)), 1200);
  }

  // Arrived here via the "Kommentare"-sidebar (page.tsx's handleAnnotationSelect
  // already set highlightedAnnotationId before navigating) — pulse/scroll to
  // the matching mark the same way clicking the comment entry below would,
  // so the sidebar click and the in-card click behave identically.
  useEffect(() => {
    if (!highlightedAnnotationId) return;
    const match = ideaAnnotations.find((a) => a.id === highlightedAnnotationId);
    if (!match) return;
    handleSelectAnnotation(match);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightedAnnotationId]);

  const openedFor = useRef<string | null>(null);
  useEffect(() => {
    if (openedFor.current === idea.id) return;
    openedFor.current = idea.id;
    setTitle(idea.title);
    setText(idea.text);
    setSlideIndex(0);
    if (autoFocusTitle && titleRef.current) {
      titleRef.current.focus();
      titleRef.current.select();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idea.id]);

  const approved = idea.status === "approved";
  const rejected = idea.status === "rejected";

  useAutosave(
    () => {
      api
        .patchIdea(idea.id, { title: title.trim() || "Neue Idee", text })
        .then(onUpdated)
        .catch((e) => toast.showError(e instanceof ApiError ? e.message : t("ideaCard.autosaveFailed")));
    },
    [title, text],
    idea.id
  );

  // Auto-advancing crossfade slideshow — only when there's more than one
  // ready image to cycle through.
  const readyImages = idea.images.filter((img) => img.status === "ready" && img.image_url);
  useEffect(() => {
    if (readyImages.length < 2 || slideshowPaused) return;
    const timer = setInterval(() => setSlideIndex((i) => (i + 1) % readyImages.length), SLIDESHOW_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [readyImages.length, slideshowPaused]);

  async function refreshImages() {
    // No single-idea GET — cheapest way to pick up the freshly changed
    // images list is the idea's own project list, same pattern the old
    // IdeaEditModal used for the AI-generation poll.
    const list = await api.listIdeas(idea.project_id);
    const fresh = list.find((i) => i.id === idea.id);
    if (fresh) onUpdated(fresh);
  }

  // 2026-07-17 bug fix (Lino: "sieht so aus als würde die AI Bilder
  // Erstellung... nicht funktionieren, man wartet ewig") — root cause: the
  // generate endpoint returns 202 immediately (real generation happens in
  // a background task, a few seconds later, success OR failure), but
  // nothing here EVER re-checked after that one-off refreshImages() call
  // right after the 202. A 'generating' placeholder image never had
  // anything to flip it back — it just sat there forever, looking exactly
  // like "waiting forever" even on a totally normal generation, and
  // permanently on an outright failure (e.g. Gemini's safety filter
  // rejecting a prompt — confirmed happening in production logs). Poll
  // while any image on THIS idea is still 'generating', same idea as
  // Scene's own generation poll elsewhere in the app.
  const hasGeneratingImage = idea.images.some((img) => img.status === "generating");
  useEffect(() => {
    if (!hasGeneratingImage) return;
    const timer = setInterval(() => {
      refreshImages().catch(() => {});
    }, GENERATION_POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasGeneratingImage, idea.id]);

  // 2026-07-17, Lino: "klickt man Bild hochladen, soll man direkt bis zu
  // 10 Bilder hochladen können" — one file input selection can now contain
  // several files; uploaded one at a time (the backend endpoint only takes
  // one file per call), capped at whatever's still free of the image-slot
  // limit.
  // 2026-07-30, Lino: "wenn man die bilder in einer ideenkachel hochgeladen
  // hat, soll es dann direkt in der diashow starten" — used to auto-open
  // the reorder grid afterward when more than one image just got added;
  // now lands on the normal slideshow instead, same as a single upload
  // always did. Reordering/deleting is still reachable via the explicit
  // "Anordnen" button, just no longer force-opened.
  async function handleUploadBatch(files: FileList) {
    const remaining = IDEA_MAX_IMAGES - idea.images.length;
    const toUpload = Array.from(files).slice(0, Math.max(0, remaining));
    if (toUpload.length === 0) return;
    setUploading(true);
    try {
      for (const file of toUpload) {
        await api.uploadIdeaImage(idea.id, file);
      }
      await refreshImages();
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("ideaCard.imageUploadFailed"));
    } finally {
      setUploading(false);
    }
  }

  async function handleSaveOrder(orderedIds: string[]) {
    try {
      const updated = await api.reorderIdeaImages(idea.id, orderedIds);
      onUpdated(updated);
      setSlideIndex(0);
      setReordering(false);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("ideaCard.reorderSaveFailed"));
    }
  }

  async function handleGenerate(prompt: string, style: "realistic" | "sketch" | "funny_sketch", aspectRatio: "16:9" | "9:16") {
    setGenerating(true);
    try {
      await api.generateIdeaImage(idea.id, style, aspectRatio, prompt);
      await refreshImages();
    } catch (e) {
      if (!(e instanceof ApiError && e.code === "insufficient_credits")) {
        toast.showError(e instanceof ApiError ? e.message : t("ideaCard.generateFailed"));
      }
    } finally {
      setGenerating(false);
    }
  }

  // 2026-07-30, Lino: "das x in der diashow soll verschwinden, man soll nur
  // in der anordnen ansicht bilder löschen können" — deletion used to be
  // reachable from BOTH the slideshow's own × (removed the CURRENT slide)
  // AND the reorder grid; now only the reorder grid deletes, by explicit
  // imageId (no more "current slide" concept needed since the slideshow
  // itself no longer initiates deletes). setSlideIndex clamped in case the
  // deleted image was at/after the current position.
  async function handleDeleteImage(imageId: string) {
    try {
      await api.deleteIdeaImage(idea.id, imageId);
      setSlideIndex((i) => Math.max(0, Math.min(i, readyImages.length - 2)));
      await refreshImages();
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("ideaCard.imageDeleteFailed"));
    }
  }

  async function handleApprove() {
    if (!allFeedbackResolved) {
      toast.showError(t("ideaCard.resolveFeedbackFirst"));
      return;
    }
    setApproving(true);
    try {
      const updated = await api.approveIdea(idea.id);
      onUpdated(updated);
      toast.showSuccess(t("ideaCard.approvedToast"));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("ideaCard.approveFailed"));
      setApproving(false);
    }
  }

  async function handleReject() {
    setRejecting(true);
    try {
      const updated = await api.rejectIdea(idea.id);
      onUpdated(updated);
      toast.showSuccess(t("ideaCard.rejectedToast"));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("ideaCard.rejectFailed"));
      setRejecting(false);
    }
  }

  async function handleInternalApprove() {
    setInternalApproving(true);
    try {
      const updated = await api.internalApproveIdea(idea.id);
      onUpdated(updated);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("ideaCard.internalApproveFailed"));
    } finally {
      setInternalApproving(false);
    }
  }

  async function handleInternalReject() {
    setInternalRejecting(true);
    try {
      const updated = await api.internalRejectIdea(idea.id);
      onUpdated(updated);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("ideaCard.internalRejectFailed"));
    } finally {
      setInternalRejecting(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await api.deleteIdea(idea.id);
      onDeleted(idea.id);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("ideaCard.deleteFailed"));
      setDeleting(false);
    }
  }

  const imageCount = idea.images.length;

  // 2026-07-18, Lino: "Präsentationsmodus... das Bild wird grösser und der
  // Text wird rechts neben das Bild gelegt" — same JSX content either way,
  // only the surrounding layout differs (see the presenting/normal
  // composition in the return below), so these are plain variables rather
  // than duplicated markup.
  const imageAndUploadBlock = (
    <>
      {/* 2026-07-21, Lino: "der Bildbereich muss dann grösser sein um die
          bilderreihenfolge sauber zu ändern... die layoutkachel hat jetzt
          IMMER das layout von der präsentations version" — was gated on
          `presenting` (bigger left-column image + wide card only while
          showing off to a client); now the permanent default regardless of
          `presenting`, which from here on only toggles the TEXT rendering
          (see textAndFeedbackBlock below) exactly as before, not the
          layout/image sizing. */}
      {/* 2026-07-22, Lino: "den titel der idee bitte zentral in der linken
          spalte platzieren (oben über der slideshow)" — moved out of the
          top header row (see the header's own `presenting` branch above)
          into this column instead, read-only like the rest of the
          presentation-mode text rendering. */}
      {presenting && (
        <h2 className="shrink-0 text-2xl font-bold tracking-tight text-center px-2 pb-2">{title}</h2>
      )}
      <div className="shrink-0">
        {reordering ? (
          <IdeaImageReorderGrid images={idea.images} onSave={handleSaveOrder} onCancel={() => setReordering(false)} onDeleteImage={handleDeleteImage} />
        ) : (
          <div
            // 2026-07-18 (Todoist #197): no aspect-[16/9]/[9/16] bucketing —
            // bucketing every photo into an assumed-exact ratio cropped/
            // squeezed anything that wasn't EXACTLY that shape (a 1.85:1 or
            // 4:3 photo, say). The real ratio comes from AuthImage's
            // onAspectRatio instead (inline style below).
            // 2026-07-19, Lino: "das 16:9 Bild wird immer noch
            // abgeschnitten" — w-full (fill the column) + max-h-[64vh]:
            // aspect-ratio first tries to derive height from that full
            // width, which for ordinary landscape photos already lands
            // well under 64vh — only a photo tall enough that the derived
            // height would exceed 64vh gets max-height-clamped, at which
            // point object-contain on the <img> below letterboxes it,
            // never crops.
            className="relative w-full max-h-[64vh] mx-auto rounded-2xl overflow-hidden bg-black/20 outline-none"
            style={{ aspectRatio }}
            tabIndex={readyImages.length > 1 ? 0 : -1}
            onClick={() => {
              if (readyImages.length > 1) setSlideshowPaused((p) => !p);
            }}
            onKeyDown={(e) => {
              // 2026-07-17, Lino: "mit den Pfeiltasten auf der Tastatur kann
              // man zum nächsten Bild kommen" — scoped to THIS element
              // having focus (click the image once first), not a global
              // document listener, since IdeaFocusView already binds plain
              // ArrowLeft/Right to switching between IDEAS — stopping
              // propagation here means clicking into the image first lets
              // arrow keys browse ITS pictures instead of jumping ideas.
              if (readyImages.length < 2) return;
              if (e.key === "ArrowLeft") {
                e.stopPropagation();
                setSlideIndex((i) => (i - 1 + readyImages.length) % readyImages.length);
              } else if (e.key === "ArrowRight") {
                e.stopPropagation();
                setSlideIndex((i) => (i + 1) % readyImages.length);
              }
            }}
          >
            {readyImages.length > 0 ? (
              <>
                  <div
                    key={readyImages[slideIndex]?.id ?? slideIndex}
                    className="absolute inset-0"
                  >
                    {/* object-contain (2026-07-17, Lino: "es muss schon
                        immer das ganze bild sichtbar sein im
                        bearbeitungsmodus") — the outer box's own aspect
                        ratio follows the photo's real ratio (onAspectRatio
                        below), so contain here is mostly just a safety
                        margin for edge cases, not doing the heavy lifting
                        alone anymore. */}
                    {isVideoUrl(readyImages[slideIndex]?.image_url ?? "") ? (
                      <AuthVideo
                        path={readyImages[slideIndex]?.image_url ?? ""}
                        className="w-full h-full object-contain"
                        onAspectRatio={setAspectRatio}
                      />
                    ) : (
                      <AuthImage
                        path={readyImages[slideIndex]?.image_url ?? ""}
                        alt={title}
                        className="w-full h-full object-contain"
                        onAspectRatio={setAspectRatio}
                      />
                    )}
                  </div>
                {readyImages.length > 1 && (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSlideIndex((i) => (i - 1 + readyImages.length) % readyImages.length);
                      }}
                      aria-label={t("ideaCard.previousImage")}
                      className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center backdrop-blur-sm transition-colors"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSlideIndex((i) => (i + 1) % readyImages.length);
                      }}
                      aria-label={t("ideaCard.nextImage")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center backdrop-blur-sm transition-colors"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
                    </button>
                    <div className="absolute bottom-3 inset-x-0 flex items-center justify-center gap-1.5">
                      {readyImages.map((img, i) => (
                        <button
                          key={img.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSlideIndex(i);
                          }}
                          aria-label={t("ideaCard.imageDot", { number: i + 1 })}
                          className={`w-1.5 h-1.5 rounded-full transition-all ${i === slideIndex ? "bg-white w-4" : "bg-white/40"}`}
                        />
                      ))}
                    </div>
                    {!presenting && !approved && !rejected && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setReordering(true);
                        }}
                        aria-label={t("ideaCard.arrangeImagesAria")}
                        className="absolute top-3 left-3 h-8 px-2.5 rounded-full bg-black/50 hover:bg-black/70 text-white text-xs font-medium flex items-center gap-1 backdrop-blur-sm transition-colors"
                      >
                        ⠿ {t("ideaCard.arrangeImages")}
                      </button>
                    )}
                    {/* 2026-07-21 — subtle indicator so it's clear WHY the
                        slideshow stopped advancing, and that clicking again
                        resumes it. */}
                    {slideshowPaused && (
                      <div className="absolute bottom-3 left-3 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center pointer-events-none">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" /><rect x="14" y="5" width="4" height="14" /></svg>
                      </div>
                    )}
                  </>
                )}
                {/* 2026-07-30, Lino: "das x in der diashow soll
                    verschwinden, man soll nur in der anordnen ansicht
                    bilder löschen können" — removed outright, deleting is
                    now exclusively reachable via IdeaImageReorderGrid's
                    own per-tile × (see handleDeleteImage above). */}
              </>
            ) : hasGeneratingImage ? (
              <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-white/40 text-sm">
                <div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                {t("ideaCard.generatingImage")}
              </div>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-white/20 text-5xl">💡</div>
            )}
          </div>
        )}
      </div>

      {/* 2026-07-19, Lino: "Im präsentationsmodus braucht es den Bild
          hochladen und Ai Bild button nicht" — presenting is read-only
          showing-off, not editing; the layout itself no longer depends on
          `presenting` (see the imageAndUploadBlock/textAndFeedbackBlock
          composition below — always side-by-side now), only whether
          upload/generate controls show at all still does. No px-8 here
          (2026-07-21): this block now always lives inside the image
          column div below, which already has its own px-8. */}
      {!presenting && !approved && !rejected && imageCount < IDEA_MAX_IMAGES && (
        <div className="shrink-0 pt-3">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/heic,image/webp,image/gif,video/mp4,video/quicktime,video/webm"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) handleUploadBatch(e.target.files);
              e.target.value = "";
            }}
          />
          <div className="flex flex-wrap items-stretch gap-2">
            <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? t("videoTile.uploading") : `📷 ${t("ideaCard.uploadImage")}`}
            </Button>
            {/* 2026-07-17, Lino: "unter der Bild box soll ein Button 'AI
                Bild generieren' sein, drückt man darauf kommt ein Pop up" —
                replaces the old permanently-visible format/style switches
                + generate button row (see ImageGeneratePopup). */}
            <Button variant="secondary" size="sm" disabled={generating} onClick={() => setShowGeneratePopup(true)}>
              {generating ? t("ideaCard.generating") : `✨ ${t("ideaCard.generateImage")}`}
            </Button>
            <span className="text-xs text-white/30 self-center">{imageCount}/{IDEA_MAX_IMAGES}</span>
          </div>
        </div>
      )}
    </>
  );

  const textAndFeedbackBlock = (
    <div className="flex-1 min-h-0 overflow-y-auto px-8 pb-8 pt-3">
      {/* 2026-07-18 (Todoist #208, Lino: "die Symbole und Markierungen von
          / werden im Präsentationsmodus NICHT dargestellt... man sieht
          also nur den reinen Text") — presenting shows a read-only,
          cleaned-up rendering instead of the live RichTextEditor: the
          slash-menu markers/end-caps are meaningful editing scaffolding
          (see #184/#200/#205), not something a client should ever see
          while an idea is being shown off. Editing (and seeing the raw
          markers) still works exactly as before once presenting mode is
          left again. */}
      {presenting ? (
        <div
          className="min-h-[320px] w-full text-[15px] leading-relaxed whitespace-pre-wrap [&>div]:mb-2"
          // 2026-07-28, Lino: Titel/Dialog-Formatierung fehlte im
          // Präsentationsmodus komplett — sanitizeRichTextHtml() strippt
          // JEDES Attribut (auch `class`) von jedem erlaubten Tag, DIV
          // eingeschlossen. renderIdeaForPresentation() erzeugt seine
          // Titel/Dialog-Formatierung aber genau ueber `class="font-bold
          // text-xl"`/`class="italic"` auf frisch selbst gebauten <div>s —
          // ein Sanitize-Pass DANACH loeschte diese Klassen, bevor sie je
          // gerendert wurden. Reihenfolge getauscht: der rohe, ungeprüfte
          // Idea.text wird zuerst sanitized (die eigentliche XSS-Schutz-
          // Aufgabe), ERST DANACH von renderIdeaForPresentation in
          // vertrauenswuerdiges, selbst-escapetes Markup mit eigenen
          // Klassen umgewandelt — das braucht keinen zweiten Sanitize-Pass
          // mehr, da es ausschliesslich aus escapeHtml()-behandeltem Text
          // und fest verdrahteten class-Werten besteht.
          dangerouslySetInnerHTML={{ __html: renderIdeaForPresentation(sanitizeRichTextHtml(text)) }}
        />
      ) : (
        // 2026-07-31, Lino — see this component's own doc comment above
        // (near ideaAnnotations) for the two-step history: the live "/"
        // editor now stays mounted unconditionally, AND actually renders
        // the real text highlights (via RichTextEditor's `highlights` /
        // `activeHighlightId` props), instead of switching to a separate
        // read-only view or falling back to a whole-box flash.
        <RichTextEditor
          value={text}
          onChange={setText}
          placeholder={t("ideaCard.descriptionPlaceholder")}
          disabled={approved || rejected}
          className="min-h-[320px] w-full bg-white/[0.05] border border-white/10 rounded-xl px-4 py-3.5 text-[15px] leading-relaxed outline-none focus:ring-2 focus:ring-blue-500/50 whitespace-pre-wrap"
          highlights={textAnnotations.map((a) => ({ id: a.id, text: a.text ?? "" }))}
          activeHighlightId={activeTextHighlightId}
        />
      )}
      {/* 2026-07-27 — a YouTube/TikTok/Instagram link typed anywhere in the
          description above renders as a real, playable embed right here, in
          both editing and presenting mode, so the post can be watched
          without leaving the Ideas page (see lib/embed.ts). Keyed by the
          detected URL so switching to a DIFFERENT link (not just any
          keystroke elsewhere in the text) remounts the player. */}
      {detectedEmbed && <IdeaLinkEmbed key={detectedEmbed.url} embed={detectedEmbed} />}
      {/* 2026-07-21, Lino: "wenn keine kommentare da sind, kann das
          kommentarfeld komplett ausgeblendet werden" — IdeaFeedbackPanel now
          owns its own border-t/spacing and renders nothing at all (not even
          the divider) until real feedback exists, so an idea with no
          comments yet leaves the full height above for writing instead of a
          near-empty "Noch kein Feedback vom Kunden." block. */}
      <IdeaFeedbackPanel
        idea={idea}
        onAllResolvedChange={setAllFeedbackResolved}
        annotations={annotations}
        highlightedAnnotationId={highlightedAnnotationId}
        onDeleteAnnotation={onDeleteAnnotation}
        onSelectAnnotation={handleSelectAnnotation}
        onAnnotationUpdated={onAnnotationUpdated}
        canDeleteComments={canDeleteComments}
      />
    </div>
  );

  return (
    <div
      // 2026-07-21, Lino: "die layoutkachel von der Ideen kachel hat jetzt
      // IMMER das layout von der präsentations version... so hat man
      // generell mehr platz um zu schreiben und arbeiten" — was
      // conditional on `presenting` (the wide layout only while showing off
      // to a client); now the permanent width regardless.
      // 2026-07-21, Lino: "kann man hier die kachel noch breiter machen damit
      // man mehr platz hat zum schreiben fürs textfeld" — cap widened
      // further (1650px -> 1900px); the image column stays a fixed 46% (see
      // below) so the extra width goes proportionally to both columns,
      // including the text/RichTextEditor side.
      // 2026-07-21, Lino: "wenn man den präsentieren klickt füllt sich die
      // ganze seite... der kachelrahmen ist dann nicht mehr zu sehen, dies
      // bitte mit einer schönen smoothen animation machen" — presenting no
      // longer just widens the layout (that's now permanent, see above), it
      // dissolves the whole "card" chrome (rounded corners, shadow, glass
      // tint/border) into the fullscreen backdrop IdeaFocusView already
      // renders behind this component, leaving only the image+text content
      // floating. `transition-all duration-500` animates this smoothly on
      // its own — this element doesn't remount when `presenting` toggles
      // (same idea, same key), so unlike AppShell's tint-overlay bug this
      // session, there's always a real "from" value for the browser to
      // interpolate from.
      className={`w-full flex flex-col overflow-hidden relative transition-all duration-500 ease-in-out ${
        presenting ? "h-[92vh] max-w-none rounded-none shadow-none" : "h-[88vh] max-w-[1900px] rounded-[32px] shadow-2xl shadow-black/50"
      }`}
      style={
        presenting
          ? { background: "rgba(255,255,255,0)", backdropFilter: "blur(0px) saturate(1)", WebkitBackdropFilter: "blur(0px) saturate(1)", border: "1px solid rgba(255,255,255,0)" }
          : {
              // Apple-style glass (2026-07-17, Lino: "die ideen kacheln sollen
              // ein wenig glasig sein, so dass man den hintergrund verschwommen
              // in der kachel sieht") — low-opacity white tint + strong blur +
              // saturation boost is what actually reads as "glass" (a near-
              // opaque dark fill, what this had before, just looks like a
              // regular solid card no matter how much blur sits under it).
              background: "rgba(255,255,255,0.08)",
              backdropFilter: "blur(40px) saturate(1.8)",
              WebkitBackdropFilter: "blur(40px) saturate(1.8)",
              border: "1px solid rgba(255,255,255,0.18)",
            }
      }
    >
      <div className="shrink-0 px-8 pt-8 pb-3 flex items-start justify-between gap-3">
        {/* 2026-07-22, Lino: "dort den titel der idee bitte zentral in der
            linken spalte platzieren (oben über der slideshow)" — while
            presenting, the title moves down into the image column (see
            imageAndUploadBlock's own title heading below) instead of
            sitting in this top header row; an empty flex-1 spacer keeps the
            presentation-toggle/delete buttons on the right at the same
            position either way. */}
        {presenting ? (
          <div className="flex-1" />
        ) : (
          <input
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("ideaCard.titlePlaceholder")}
            disabled={approved || rejected}
            className={`flex-1 bg-transparent text-3xl font-bold tracking-tight outline-none placeholder:text-white/25 disabled:text-white/70 rounded-lg transition-shadow ${
              titlePulsing ? "ring-2 ring-yellow-400/70" : ""
            }`}
          />
        )}
        <div className="shrink-0 flex items-start gap-1">
          {/* 2026-07-18, Lino: "pro Kachel noch einen 'Präsentationsmodus',
              irgend ein kleines Symbol" — toggles the side-by-side layout
              below (see the presenting/normal branch further down).
              2026-07-18 follow-up (Todoist #183): "sieht aus wie das kleine
              PowerPoint-Präsentationssymbol" — swapped the old 4-corner
              expand icon for a two-panel/split-layout glyph.
              2026-07-18, second follow-up (Todoist #197): "macht keinen
              Sinn" — swapped again, this time for a screen-on-an-easel
              glyph (Lino's own description: "ein Symbol von einer
              Präsentationstafel"), a clearer, more literal "presentation"
              read than the split-panel icon was. */}
          <button
            onClick={onTogglePresenting}
            aria-label={presenting ? t("ideaCard.presentModeExit") : t("ideaCard.presentModeEnter")}
            title={presenting ? t("ideaCard.presentModeExit") : t("ideaCard.presentModeEnter")}
            className={`mt-1.5 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
              presenting ? "text-blue-400 bg-blue-500/10 hover:bg-blue-500/20" : "text-white/30 hover:text-white hover:bg-white/10"
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="13" rx="1.5" />
              <path d="M8 21 10 16M16 21l-2-5" />
              <path d="M12 16v2" />
            </svg>
          </button>
          {approved ? (
            <div className="flex flex-col items-end gap-1 mt-1">
              <span className="text-xs font-semibold text-emerald-400 bg-emerald-500/10 rounded-full px-3 py-1.5">✓ {t("ideaCard.approvedBadge")}</span>
              {/* 2026-07-17, Lino: "es braucht ein Datum und Uhrzeit WANN das
                  Video abgenommen wurde" */}
              {idea.approved_at && (
                <span className="text-[11px] text-white/40">
                  {new Date(idea.approved_at).toLocaleString("de-CH", {
                    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
                  })}
                </span>
              )}
            </div>
          ) : rejected ? (
            // 2026-07-19 — mirrors the approved badge above, just red/✗;
            // rejected has no timestamp column (not asked for, unlike
            // approved_at which Lino specifically requested).
            <span className="text-xs font-semibold text-red-400 bg-red-500/10 rounded-full px-3 py-1.5 mt-1">✗ {t("ideaCard.rejected")}</span>
          ) : (
            <button
              onClick={handleDelete}
              disabled={deleting}
              aria-label={t("ideaCard.deleteIdea")}
              className="mt-1.5 w-8 h-8 rounded-full flex items-center justify-center text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16Z" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* 2026-07-27, Todoist #356 — "Intern abgenommen/abgelehnt": a
          SEPARATE PL/Admin-only review gate from the client-facing
          Abgenommen/Abgelehnt footer below. Blocks creating/sending the
          Ideas preview ShareLink (see ShareLinkModal.tsx) until every open
          idea has gone through this. Visible to every team member
          (read-only for non-PL/Admin, canInternalReview gates the actual
          buttons); hidden once there's nothing meaningful left to show
          (idea already client-decided AND was never internally reviewed —
          i.e. ideas that predate this feature). */}
      {!presenting && (idea.status === "open" || idea.internal_status) && (
        <div className="shrink-0 px-8 py-2 flex items-center justify-end gap-2 border-t border-white/10 bg-white/[0.02]">
          {idea.internal_status === "approved" ? (
            <span className="text-xs text-emerald-400/80">
              ✓ {t("ideaCard.internalApprovedBy", {
                name: idea.internal_reviewed_by_name ?? "",
                when: idea.internal_reviewed_at
                  ? new Date(idea.internal_reviewed_at).toLocaleString("de-CH", {
                      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
                    })
                  : "",
              })}
            </span>
          ) : idea.internal_status === "rejected" ? (
            <span className="text-xs text-red-400/80">
              ✗ {t("ideaCard.internalRejectedBy", {
                name: idea.internal_reviewed_by_name ?? "",
                when: idea.internal_reviewed_at
                  ? new Date(idea.internal_reviewed_at).toLocaleString("de-CH", {
                      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
                    })
                  : "",
              })}
            </span>
          ) : canInternalReview ? (
            <>
              <button
                onClick={handleInternalReject}
                disabled={internalRejecting || internalApproving}
                className="rounded-full px-3 py-1 text-xs font-semibold text-white/70 bg-white/10 hover:bg-red-500/20 hover:text-red-300 transition-colors disabled:opacity-50"
              >
                {t("ideaCard.internalReject")}
              </button>
              <button
                onClick={handleInternalApprove}
                disabled={internalRejecting || internalApproving}
                className="rounded-full px-3 py-1 text-xs font-semibold text-white/70 bg-white/10 hover:bg-emerald-500/20 hover:text-emerald-300 transition-colors disabled:opacity-50"
              >
                {t("ideaCard.internalApprove")}
              </button>
            </>
          ) : (
            <span className="text-xs text-white/40">{t("ideaCard.internalReviewPending")}</span>
          )}
        </div>
      )}

      {/* 2026-07-18, Lino: "das Bild wird grösser und der Text wird rechts
          neben das Bild gelegt" — Bild+Upload-Buttons und Text+Feedback
          nebeneinander statt untereinander; das Bild bleibt dadurch beim
          Scrollen im Text automatisch "fix", weil nur die rechte Spalte
          scrollt. 2026-07-21: war conditional auf `presenting` (nur beim
          Vorführen fürs Layout) — jetzt IMMER diese Anordnung, `presenting`
          steuert ab jetzt nur noch textAndFeedbackBlock's eigene
          Textdarstellung (roher Editor vs. saubere Präsentations-Rendering,
          siehe oben), nicht mehr das Layout selbst. */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="w-[46%] shrink-0 overflow-y-auto px-8 pb-8 flex flex-col gap-3">{imageAndUploadBlock}</div>
        {/* 2026-07-21 — found while verifying #275's neighbor changes: this
            wrapper was missing min-h-0 AND flex/flex-col, so on a long idea
            the row's own overflow-hidden clipped the bottom of the text/
            feedback column outright instead of letting textAndFeedbackBlock's
            own overflow-y-auto scroll to it. min-h-0 alone wasn't sufficient
            either — textAndFeedbackBlock's `flex-1` class only does anything
            inside a flex CONTAINER, and this wrapper wasn't one, so the
            child just grew to its full content height (measured 1241px vs
            an 852px available row) instead of being capped+made scrollable.
            Content past the visible card height, including the ENTIRE
            feedback panel, was unreachable — not just visually cut off.
            Masked until now since most idea text is short enough to fit
            without triggering it. */}
        <div className="flex-1 min-h-0 min-w-0 flex flex-col border-l border-white/10">{textAndFeedbackBlock}</div>
      </div>

      {/* 2026-07-19, Lino: "der abgenommen button ist momentan noch
          transparent über dem textfeld... mach diesen ganz unten in der
          Kachel hin, der soll dann immer an unterster Stelle sein" — was
          `absolute bottom-6 right-6` floating over the scrollable content
          (translucent bg, so text visibly bled through underneath while
          typing/scrolling near the bottom); now a real shrink-0 footer row
          in normal flex flow, always the last thing in the card regardless
          of how much content is above it. Hidden once approved — the
          header badge (see above) takes over as the permanent "done"
          indicator. */}
      {!presenting && !approved && !rejected && (
        <div className="shrink-0 flex justify-end gap-2 px-8 py-4 border-t border-white/10">
          {/* 2026-07-19, Lino: "nicht nur einen Abgenommen Button sondern
              auch einen Abgelehnt Button" — same grey-then-color-on-click
              shape as Abgenommen (red instead of green), no feedback-
              resolved gate since discarding an idea doesn't need one. */}
          <button
            onClick={handleReject}
            disabled={rejecting}
            className={`flex items-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-semibold text-white shadow-xl transition-colors ${
              rejecting ? "bg-red-500" : "bg-white/15 hover:bg-white/25"
            }`}
          >
            {rejecting && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            )}
            {t("ideaCard.rejected")}
          </button>
          <button
            onClick={handleApprove}
            disabled={approving}
            title={allFeedbackResolved ? undefined : t("ideaCard.approveDisabledTitle")}
            className={`flex items-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-semibold text-white shadow-xl transition-colors ${
              approving ? "bg-emerald-500" : allFeedbackResolved ? "bg-white/15 hover:bg-white/25" : "bg-white/10 opacity-50"
            }`}
          >
            {approving && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            )}
            {t("ideaCard.approveButton")}
          </button>
        </div>
      )}

      <ImageGeneratePopup
        open={showGeneratePopup}
        onClose={() => setShowGeneratePopup(false)}
        initialPrompt={richTextToPlainText(text)}
        onGenerate={handleGenerate}
      />
    </div>
  );
}
