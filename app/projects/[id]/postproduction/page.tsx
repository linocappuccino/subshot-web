"use client";

import { Suspense, useEffect, useRef, useState, use as usePromise } from "react";
import { AppShell } from "@/app/components/AppShell";
import { Button } from "@/app/components/ui/Button";
import { ShareLinkModal } from "@/app/components/ShareLinkModal";
import { VideoTile } from "@/app/components/VideoTile";
import { VideoReviewModal } from "@/app/components/VideoReviewModal";
import { subscribeToChanges } from "@/lib/realtime";
import { EdgeNavButton } from "@/app/components/EdgeNavButton";
import { NotionImportModal } from "@/app/components/NotionImportModal";
import { useRouter, useSearchParams } from "next/navigation";
import { useApi } from "@/lib/useApi";
import { useLanguage } from "@/lib/i18n";
import { ApiError, invalidateGetCache } from "@/lib/api";
import { setNavCache, takeNavCache } from "@/lib/navCache";
import { readVideoMetadata } from "@/lib/media";
import { useToast } from "@/app/components/ui/Toast";
import type { Member, ProjectDetail, Section, PostproductionStatus, Video } from "@/lib/types";

/** sessionStorage statt eines URL-Query-Params (2026-07-17) — die
 * Hauptseite (app/projects/[id]/page.tsx) hat keinen Suspense-Wrapper um
 * useSearchParams (siehe z.B. CreditsPage fuer das Gegenbeispiel), das
 * hier extra einzuziehen nur fuer diesen einen Rueckweg waere unnoetig
 * invasiv fuer eine so grosse Datei. Wird einmalig beim Mounten der
 * Hauptseite gelesen und sofort wieder geloescht. */
const RETURN_VIEW_KEY = "subshot:returnView";

// 2026-07-31 — same reactive-useSearchParams-in-a-small-Suspense-boundary
// fix as projects/[id]/page.tsx's own NotificationParamsWatcher (see its
// doc comment for the full reasoning): the old window.location.search
// mount-only read never re-fired when a notification was clicked while
// already on this exact postproduction page.
function NotificationParamsWatcher({
  onParams,
}: {
  onParams: (params: { openVideo: string | null; openComment: string | null }) => void;
}) {
  const searchParams = useSearchParams();
  const openVideo = searchParams.get("openVideo");
  const openComment = searchParams.get("openComment");
  useEffect(() => {
    if (!openVideo && !openComment) return;
    onParams({ openVideo, openComment });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openVideo, openComment]);
  return null;
}

/** #11 Schritt 6 (Postproduction-Tracking) — eigener Bereich pro Projekt
 * (2026-07-17, siehe Lino's Entscheidung: eigener Tab statt Einbau in die
 * bestehende Ideen<->Szenen-Swipe-Ansicht). Listet alle Sections, die per
 * "Ab in die Postproduction"-Aktion (SectionBlock-Menü auf der
 * Szenenübersicht) explizit dorthin geschickt wurden — Status von jeder
 * Rolle änderbar, Deadline nur ab 'projektleiter', siehe
 * SectionPostproductionPatch-Backend-Kommentar. */
export default function PostproductionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const api = useApi();
  const toast = useToast();
  const { t } = useLanguage();
  const router = useRouter();

  const [data, setData] = useState<ProjectDetail | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [myRole, setMyRole] = useState<Member["role"] | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // 2026-07-17, Lino: "die video kacheln sollen direkt auf der
  // postproductionseite sein.. keine zeilen ansicht" — Videos aller
  // Postproduction-Sections werden jetzt beim Laden auf einen Schlag
  // geholt (statt erst on-demand beim Aufklappen einer Zeile, siehe
  // frühere expandedVideos-Version), damit die Kacheln sofort sichtbar
  // sind statt hinter einem Klick versteckt.
  const [videosBySection, setVideosBySection] = useState<Record<string, Video[]>>({});
  // 2026-07-18 (Todoist #201, Lino: "ein Indikator der zeigt wie weit der
  // Upload ist") — 0-1 fraction per section while its first video is
  // uploading (addVideo below); the empty "+" box shows this instead of
  // itself, then the real VideoTile takes over once the upload is fully
  // done (videosBySection only gets the new entry at that point).
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  // 2026-07-20, Lino: "drückt man '3 Punkte' -> 'neue Version hochladen'
  // geht es erst mal sehr lange bis etwas passiert, es muss auch wieder
  // eine sofortige Upload-Anzeige kommen" — same shape as uploadProgress
  // above but keyed by VIDEO id (a section can hold several video tiles,
  // each independently uploading a new version), used only by
  // uploadVersionFromTile below to drive VideoTile's uploadFraction prop.
  const [versionUploadProgress, setVersionUploadProgress] = useState<Record<string, number>>({});
  const [reviewingVideo, setReviewingVideo] = useState<Video | null>(null);
  // 2026-07-18, Lino: "klickt man auf eine Notification soll man direkt zu
  // dieser Seite und Kachel kommen" — fed by NotificationParamsWatcher
  // below (see its own doc comment for why this replaced a mount-only
  // window.location.search read).
  const [autoOpenVideoId, setAutoOpenVideoId] = useState<string | null>(null);
  // 2026-07-31 — the specific comment to scroll/pulse to inside
  // VideoReviewModal once it opens (see Notification.comment_id's own
  // backend doc comment).
  const [autoOpenCommentId, setAutoOpenCommentId] = useState<string | null>(null);
  // 2026-07-19, Lino: "man muss auch ohne Szenenpipeline Videos hochladen
  // können" — zuerst nur sichtbar wenn module_scripting aus war, dann "+
  // Video" (nicht "+ Section") und IMMER auf der Postproduction-Seite,
  // unabhängig von den Pipeline-Modulen. Dann nochmals korrigiert: KEINE
  // separate benannte "Section-Box" — der Klick öffnet direkt den
  // Datei-Dialog (kein Namens-Prompt dazwischen), die Section entsteht erst
  // MIT der Datei zusammen (is_unplanned=True, siehe create_section in
  // main.py) und wird wieder gelöscht statt nur geleert, sobald ihr einziges
  // Video gelöscht wird (siehe deleteVideo unten UND server-seitig in
  // delete_video — beide, falls der Server-Cleanup je fehlschlägt, bleibt
  // der Client trotzdem konsistent).
  const unplannedVideoInputRef = useRef<HTMLInputElement>(null);
  async function createUnplannedVideoSection(file: File) {
    if (!data) return;
    try {
      const section = await api.createSection(data.id, t("postproduction.unplannedVideoName"), data.sections.length, true);
      setData((prev) => (prev ? { ...prev, sections: [...prev.sections, section] } : prev));
      await addVideo(section, file);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("postproduction.genericFailed"));
    }
  }
  useEffect(() => {
    if (!autoOpenVideoId) return;
    const video = Object.values(videosBySection).flat().find((v) => v.id === autoOpenVideoId);
    if (!video) return;
    setReviewingVideo(video);
    setAutoOpenVideoId(null);
    router.replace(`/projects/${id}/postproduction`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenVideoId, videosBySection]);
  const [showShareModal, setShowShareModal] = useState(false);
  // 2026-07-17, Lino: "Auf der Postproduction fehlt die Navigation mit
  // Team, Kommentare etc." — dieselbe Header-Toolbar wie auf der
  // Szenenseite (page.tsx), same Komponente (NotionImportModal) nicht neu
  // gebaut, nur hierher mitgenommen. (Team-Button seither wieder entfernt,
  // Kommentare/AnnotationsPanel-Button 2026-07-18 auf Wunsch wieder raus —
  // Lino: "auf der Postproduction Seite braucht es kein 'Kommentare'
  // Button", Video-Feedback läuft über VideoReviewModal, nicht über
  // Szenen-Annotations.)
  const [showNotion, setShowNotion] = useState(false);

  async function goBackToScenes() {
    sessionStorage.setItem(RETURN_VIEW_KEY, "scenes");
    // 2026-08-26 — no longer waits for an exit animation (see
    // [[project_subshot_web_speed_and_correctness_2026-08-25]]); the
    // prefetch still fires and is still awaited (capped at 0.8s), same
    // reasoning as goToPostproductionWithTransition's identical comment on
    // the other side of this navigation.
    const prefetch = (async () => {
      try {
        const [project, projectMembers, projectAnnotations] = await Promise.all([
          api.projectDetail(id), api.members(id), api.listAnnotations(id),
        ]);
        setNavCache(`scenes:${id}`, { project, members: projectMembers, annotations: projectAnnotations });
      } catch {
        // Reiner Optimierungs-Pfad — schlägt der Prefetch fehl, lädt die
        // Zielseite beim Mounten einfach ganz normal selbst nach.
      }
    })();
    await Promise.race([prefetch, new Promise((resolve) => setTimeout(resolve, 800))]);
    router.push(`/projects/${id}`);
  }

  // 2026-07-30, Lino: "< Projekt oben links führt ins Leere zurück, man
  // landet wieder auf Postproduction" — der alte Link ging auf
  // `/projects/${id}` (die Ideen/Szenen-Seite DIESES Projekts), nicht auf
  // die Projektübersicht (`/projects`); bei einem reinen Postproduction-
  // Projekt (module_concept/module_scripting beide aus) redirectet diese
  // Seite selbst sofort wieder zurück zu Postproduction (#251), daher der
  // gefühlte "es passiert nichts"-Loop. Spiegelt goToProjectsWithTransition
  // aus page.tsx 1:1 (gleiches sessionStorage-Flag für die Eintritts-
  // Animation auf projects/page.tsx), damit "zurück zur Projektübersicht"
  // von JEDER Workflow-Seite aus gleich funktioniert und gleich aussieht.
  async function goToProjects() {
    // 2026-08-26 — used to set a sessionStorage flag + wait 220ms for
    // projects/page.tsx's own enter animation; both sides gone now.
    router.push("/projects");
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      // 2026-07-17: Hinweg von der Szenenseite hat das Bundle schon vorab
      // geladen (siehe page.tsx's goToPostproductionWithTransition) — steht
      // es bereit, direkt anzeigen statt nochmal auf's Netz zu warten.
      const cached = takeNavCache<{
        project: ProjectDetail;
        members: Member[];
        myUserId: string;
        videosBySection: Record<string, Video[]>;
      }>(`postpro:${id}`);
      if (cached) {
        setData(cached.project);
        setMembers(cached.members);
        setMyRole(cached.members.find((m) => m.user_id === cached.myUserId)?.role ?? null);
        setCurrentUserId(cached.myUserId);
        setVideosBySection(cached.videosBySection);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const [project, projectMembers, me] = await Promise.all([
          api.projectDetail(id), api.members(id), api.me(),
        ]);
        if (cancelled) return;
        setData(project);
        setMembers(projectMembers);
        setMyRole(projectMembers.find((m) => m.user_id === me.id)?.role ?? null);
        setCurrentUserId(me.id);

        // 2026-08-31 — perf pass: was one listVideos(section.id) call PER
        // postproduction section (Promise.all'd, but still N round-trips
        // before this grid could render for a project with many sections
        // already in postproduction) — one bulk call instead, grouped by
        // section_id client-side exactly the same way as before.
        const allVideos = await api.listProjectVideos(id);
        if (cancelled) return;
        const bySection: Record<string, Video[]> = {};
        for (const video of allVideos) {
          (bySection[video.section_id] ??= []).push(video);
        }
        setVideosBySection(bySection);
      } catch (e) {
        if (!cancelled) toast.showError(e instanceof ApiError ? e.message : t("postproduction.loadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // 2026-07-19: module_postproduction is now a real gate (see page.tsx's
  // identical reasoning for module_concept/module_scripting) — reachable
  // directly by URL even though the nav button to get here was already
  // hidden when the module is off, so this route needs its own hard check
  // too, not just the cosmetic hide.
  useEffect(() => {
    if (data && !data.module_postproduction) router.replace(`/projects/${id}`);
  }, [data, id, router]);

  function updateVideo(sectionId: string, updated: Video) {
    setVideosBySection((prev) => ({
      ...prev,
      [sectionId]: (prev[sectionId] ?? []).map((v) => (v.id === updated.id ? updated : v)),
    }));
    setReviewingVideo((prev) => (prev?.id === updated.id ? updated : prev));
  }

  // 2026-07-28 — live comment sync, in-app counterpart to preview/[token]/
  // page.tsx's identical effect (same Pusher channel — a client's public-
  // link comment and a team member's in-app comment reach each other live).
  // Re-lists just this video's section (not the whole project) and reuses
  // `updateVideo` so both `videosBySection` and an open `reviewingVideo`
  // stay in sync, same as every other mutation in this file already does.
  useEffect(() => {
    if (!reviewingVideo) return;
    return subscribeToChanges("video", reviewingVideo.id, () => {
      api
        .listVideos(reviewingVideo.section_id)
        .then((videos) => {
          setVideosBySection((prev) => ({ ...prev, [reviewingVideo.section_id]: videos }));
          const fresh = videos.find((v) => v.id === reviewingVideo.id);
          if (fresh) setReviewingVideo(fresh);
        })
        .catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewingVideo?.id]);

  // 2026-07-19 (Todoist #212, Lino: "kann im thumbnail nicht über die
  // kachel scrubben... ein thumbnail auf der kachel wird auch nicht vom
  // video dargestellt") — right after upload, the tile only had the
  // `/complete` response, which is captured BEFORE the server's background
  // job (video_processing.py) has generated thumbnail_key/filmstrip_key.
  // Nothing ever re-fetched afterward, so the tile stayed stuck in that
  // pre-processing state (no scrub, no thumbnail) until a full page
  // reload — polls the section's video list until this version's
  // filmstrip_url shows up, then merges the real data in.
  // 2026-07-29, Lino: "wird immernoch unendlich angezeigt... man muss die
  // seite immer reloaden" — the original ~1-minute give-up cap was too
  // short for real large videos (ffmpeg thumbnail/filmstrip generation on a
  // 300-400MB+ file genuinely takes longer than that), and giving up left
  // the tile stuck in the pre-processing state with zero indication
  // anything was still happening. Extended to a 10-minute window (5s
  // interval, gentle enough not to hammer the API) — covers realistic
  // processing times for even very large uploads; if a job genuinely fails
  // server-side, this still just gives up quietly after 10 min rather than
  // polling forever, same reload-as-fallback story as before.
  function pollForFilmstrip(sectionId: string, videoId: string, versionId: string) {
    let attempts = 0;
    const maxAttempts = 120;
    const tick = async () => {
      attempts += 1;
      try {
        const videos = await api.listVideos(sectionId);
        const video = videos.find((v) => v.id === videoId);
        const version = video?.versions.find((v) => v.id === versionId);
        if (video && version?.filmstrip_url) {
          updateVideo(sectionId, video);
          return;
        }
      } catch {
        // network hiccup — just retry
      }
      if (attempts < maxAttempts) setTimeout(tick, 5000);
    };
    setTimeout(tick, 2000);
  }

  // 2026-07-18 (Todoist #189): used to just create an empty placeholder
  // video titled `Video ${n}` — upload was a separate later step, and that
  // placeholder title is exactly why every tile showed "Video 1" (n was
  // always 1, since this only ever ran once per section, right when its
  // video LIST was still empty). Now takes the picked file directly,
  // titles the video after the section itself (matches VideoTile's own
  // sectionName label, which becomes redundant and is dropped there), and
  // uploads the first version in the same click — create, then the exact
  // same 3-step version-upload flow as uploadVersionFromTile below.
  async function addVideo(section: Section, file: File) {
    setUploadProgress((prev) => ({ ...prev, [section.id]: 0 }));
    try {
      const list = videosBySection[section.id] ?? [];
      const created = await api.createVideo(section.id, section.name, list.length);
      const version = await api.createVideoVersion(created.id, file);
      if (!version.playback_url) throw new Error("Keine Upload-URL erhalten.");
      await api.uploadVideoFile(version.playback_url, file, (fraction) =>
        setUploadProgress((prev) => ({ ...prev, [section.id]: fraction }))
      );
      // 2026-07-18 (Todoist #201, Lino: "die Kachel wird zu gross
      // dargestellt, sie soll sich ans Video anpassen") — VideoTile sizes
      // itself from filmstrip_frame_width/height, which only exist once
      // the SERVER's background filmstrip job has run; right after upload
      // that's still null, so a freshly uploaded 9:16 video fell back to
      // the 16:9 default and looked wrong-shaped/too big until that job
      // eventually finished. This same <video> element (already loaded to
      // read `duration`) also has the real videoWidth/videoHeight — a
      // valid stand-in for the real filmstrip ratio (frames are scaled
      // crops of the video's own frames, same aspect ratio, see
      // video_processing.py), good enough to size the tile correctly
      // immediately, overwritten by the real filmstrip values once that
      // background job's own response arrives on a later fetch.
      const dims = await readVideoMetadata(file);
      const completed = await api.completeVideoVersion(version.id, file.size, dims.duration);
      setVideosBySection((prev) => ({
        ...prev,
        [section.id]: [
          ...(prev[section.id] ?? []),
          {
            ...created,
            versions: [
              dims.width && dims.height
                ? { ...completed, filmstrip_frame_width: dims.width, filmstrip_frame_height: dims.height }
                : completed,
            ],
          },
        ],
      }));
      pollForFilmstrip(section.id, created.id, completed.id);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("postproduction.createVideoFailed"));
      // A failed upload into a freshly-created is_unplanned section (see
      // createUnplannedVideoSection) would otherwise leave an empty,
      // permanently-dangling section behind — clean it up rather than
      // showing a named "box" that was never supposed to exist standalone.
      if (section.is_unplanned && !(videosBySection[section.id] ?? []).length) {
        api.deleteSection(section.id).catch(() => {});
        setData((prev) => (prev ? { ...prev, sections: prev.sections.filter((s) => s.id !== section.id) } : prev));
      }
    } finally {
      setUploadProgress((prev) => {
        const next = { ...prev };
        delete next[section.id];
        return next;
      });
    }
  }

  // Shared by deleteVideo AND deleteVideoVersion below (the latter's backend
  // route cascade-deletes the whole Video row once its last version is
  // gone, see delete_video_version in main.py) — both cases need the exact
  // same local-state cleanup once the video tile itself is really gone.
  function removeVideoLocally(sectionId: string, videoId: string) {
    const remaining = (videosBySection[sectionId] ?? []).filter((v) => v.id !== videoId);
    setVideosBySection((prev) => ({ ...prev, [sectionId]: remaining }));
    // The backend already deletes an is_unplanned section server-side once
    // its last video is gone — mirror that here so it also disappears from
    // THIS tab's already-loaded `sections` list without waiting for a
    // refetch.
    const section = data?.sections.find((s) => s.id === sectionId);
    if (section?.is_unplanned && remaining.length === 0) {
      setData((prev) => (prev ? { ...prev, sections: prev.sections.filter((s) => s.id !== sectionId) } : prev));
    }
  }

  async function deleteVideo(sectionId: string, video: Video) {
    try {
      await api.deleteVideo(video.id);
      removeVideoLocally(sectionId, video.id);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("postproduction.deleteVideoFailed"));
    }
  }

  // 2026-07-26, Lino: "Wenn man löschen drückt kann man wählen zwischen
  // alle videos (versionen) löschen, oder eine Version auswählen die
  // gelöscht werden soll" — deletes exactly ONE version (whichever the
  // modal currently has open, via its own version prev/next navigation),
  // not the whole video. `video.versions.length <= 1` mirrors the backend's
  // own "was this the last version" check byte-for-byte (delete_video_version
  // cascade-deletes the Video row itself in that case) — same local cleanup
  // as a full deleteVideo then, otherwise just drop that one version.
  async function deleteVideoVersion(sectionId: string, video: Video, versionId: string) {
    try {
      await api.deleteVideoVersion(versionId);
      if (video.versions.length <= 1) {
        removeVideoLocally(sectionId, video.id);
        setReviewingVideo(null);
      } else {
        updateVideo(sectionId, { ...video, versions: video.versions.filter((v) => v.id !== versionId) });
      }
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("postproduction.deleteVideoFailed"));
    }
  }

  // 2026-07-17, Lino: "auf der kachel in der übersicht soll ein 3 punkte
  // button sein... 'upload new Version'" — gleicher 3-Schritt-Upload-Flow
  // wie VideoReviewModal's uploadNewVersion, nur direkt von der Kachel aus
  // statt erst das Modal öffnen zu müssen.
  // 2026-07-20, Lino: "es dauert sehr lange bis etwas passiert, es muss
  // eine sofortige Upload-Anzeige kommen" — vorher wurde `created` (Status
  // 'uploading') erst NACH dem kompletten upload+complete in den State
  // geschrieben, die Kachel zeigte also die ganze Upload-Dauer über schlicht
  // gar nichts an. Jetzt: `created` sofort per updateVideo einhängen (lässt
  // VideoTiles bestehende stillUploading-Anzeige sofort greifen), echten
  // Fortschritt per uploadFraction/versionUploadProgress durchreichen (gleiche
  // Mechanik wie addVideo/uploadProgress oben, nur pro Video statt pro
  // Section), danach normal weiter zu 'complete' + Filmstrip-Polling.
  async function uploadVersionFromTile(sectionId: string, video: Video, file: File) {
    setVersionUploadProgress((prev) => ({ ...prev, [video.id]: 0 }));
    try {
      const created = await api.createVideoVersion(video.id, file);
      if (!created.playback_url) throw new Error("Keine Upload-URL erhalten.");
      updateVideo(sectionId, { ...video, versions: [...video.versions, created] });
      await api.uploadVideoFile(created.playback_url, file, (fraction) =>
        setVersionUploadProgress((prev) => ({ ...prev, [video.id]: fraction }))
      );
      const { duration } = await readVideoMetadata(file);
      const completed = await api.completeVideoVersion(created.id, file.size, duration);
      updateVideo(sectionId, { ...video, versions: [...video.versions, completed] });
      pollForFilmstrip(sectionId, video.id, completed.id);
      toast.showSuccess(t("postproduction.versionUploaded"));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("postproduction.uploadFailed"));
      // the failed 'uploading' placeholder version pushed above must not
      // linger on the tile forever — revert to the video's pre-attempt state.
      updateVideo(sectionId, video);
    } finally {
      setVersionUploadProgress((prev) => {
        const next = { ...prev };
        delete next[video.id];
        return next;
      });
    }
  }

  // 2026-07-19, Lino's finale Rollen-Spezifikation: alle drei Rollen
  // (Admin/Projektleiter/Editor) duerfen den Status aendern, nur Editor
  // darf die Deadline NICHT aendern (sehen aber schon) — vorher stand hier
  // noch `myRole === "owner"`, ein Rest vom Team-losen Fallback-Verhalten
  // aus #147, das den neuen Projektleiter-Rang uebersehen hat. Team-weite
  // Admin/Projektleiter-Ueberschreibung (siehe patch_section_postproduction
  // in main.py) ist absichtlich nicht dupliziert -- das Backend erzwingt
  // sie ohnehin, hier geht es nur um die UI-Sichtbarkeit fuer den
  // Normalfall (Projekt-Rolle).
  const canEditStatus = myRole === "editor" || myRole === "projektleiter" || myRole === "owner";
  const canEditDeadline = myRole === "projektleiter" || myRole === "owner";

  function updateSection(updated: Section) {
    setData((prev) => (prev ? { ...prev, sections: prev.sections.map((s) => (s.id === updated.id ? updated : s)) } : prev));
  }

  async function updateStatus(section: Section, status: PostproductionStatus) {
    try {
      updateSection(await api.patchSectionPostproduction(section.id, { status }));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("postproduction.saveFailed"));
    }
  }

  async function updateDeadline(section: Section, date: Date | null) {
    try {
      updateSection(await api.patchSectionPostproduction(section.id, { deadline: date ? date.toISOString() : null }));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("postproduction.saveFailed"));
    }
  }

  async function renameVideo(sectionId: string, video: Video, title: string) {
    try {
      updateVideo(sectionId, await api.patchVideo(video.id, { title }));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("postproduction.renameFailed"));
    }
  }

  // 2026-08-06, Lino: "auf den kacheln muss man auch auswählen können wer
  // verantwortlich ist für das video" — same shape as renameVideo above.
  async function updateVideoAssignee(sectionId: string, video: Video, userId: string | null) {
    try {
      updateVideo(sectionId, await api.patchVideo(video.id, { assignee_id: userId }));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("postproduction.saveFailed"));
    }
  }

  // 2026-07-19 (Todoist #219, Lino: "Kacheln nach Dringlichkeit sortieren,
  // die Deadline die am nächsten zum aktuellen Datum ist, soll als erstes
  // erscheinen") — Deadline lebt auf der Section (siehe VideoTile's
  // deadline-Prop, geteilt von allen Videos darin), Sortieren der Sections
  // sortiert also automatisch auch die Kacheln unten (sections.flatMap).
  // Sections ohne Deadline ans Ende, nicht einfach nach oben sortiert (ein
  // fehlender Wert ist kein "dringendster" Wert).
  const sections = (data?.sections ?? [])
    .filter((s) => s.in_postproduction)
    .slice()
    .sort((a, b) => {
      if (!a.postproduction_deadline && !b.postproduction_deadline) return 0;
      if (!a.postproduction_deadline) return 1;
      if (!b.postproduction_deadline) return -1;
      return new Date(a.postproduction_deadline).getTime() - new Date(b.postproduction_deadline).getTime();
    });

  return (
    <AppShell>
      <Suspense fallback={null}>
        <NotificationParamsWatcher
          onParams={({ openVideo, openComment }) => {
            if (openVideo) setAutoOpenVideoId(openVideo);
            if (openComment) setAutoOpenCommentId(openComment);
          }}
        />
      </Suspense>
      <div className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 pt-8 pb-28">
        {/* 2026-07-21, Lino: "die platzierung der buttons muss auf JEDER
            WORKFLOW seite gleich sein" — der Zurueck-Link war hier eine
            EIGENE Zeile ueber dem Header-Row (Link, dann erst der flex-Row
            mit Titel+Buttons); auf Ideen/Szenen (page.tsx) sitzt der
            Zurueck-Link dagegen INNERHALB der linken Spalte DIESES Rows,
            also auf gleicher Hoehe wie "Teilen" & Co. Dadurch startete der
            Button-Row hier eine ganze Zeile + mb-1 tiefer als auf Ideen/
            Szenen. Fix: gleiche Struktur wie dort — Link als erstes Kind der
            linken Spalte, mb-8 statt mb-6 (identischer Row-Abstand). */}
        {/* 2026-07-30, Lino: "der pipeline titel soll jeweils horizontal
            zentriert auf der gleichen höhe wie < projekt und den buttons
            rechts sein" — the workflow-stage label ("Postproduction") used
            to sit left-aligned directly under the back-link, its own row
            further down than the buttons. Pulled it OUT of the left column
            into an absolutely-centered layer of this same row (centered
            against the row's full width AND height, not just the left
            half), same technique on both this page and page.tsx (Ideen/
            Szenen) so the header reads identically across every workflow
            stage. client_name/h1 stay in their own row below, unaffected. */}
        <div className="relative flex items-center justify-between mb-2 gap-3 flex-wrap">
          <button
            type="button"
            onClick={goToProjects}
            className="text-sm text-white/40 hover:text-white/70 transition-colors flex items-center gap-1"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
            {t("workflow.backToProjects")}
          </button>
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
            <div className="font-bebas text-xl uppercase tracking-wide text-white/40 whitespace-nowrap">
              {t("workflow.postproduction")}
            </div>
          </div>
          <div className="relative z-10 flex gap-2 flex-wrap">
            {/* 2026-07-17, Lino: "Notion Import brauchen wir auch nicht (nur
                den button ausblenden)" — showNotion-State + Modal bewusst
                nicht entfernt, siehe page.tsx (Ideen/Szenen) fuer denselben
                Schritt. */}
            {canEditStatus && (
              <Button variant="secondary" size="sm" onClick={() => unplannedVideoInputRef.current?.click()}>
                <PlusIcon /> {t("workflow.newVideo")}
              </Button>
            )}
            {canEditStatus && (
              <Button variant="secondary" size="sm" onClick={() => setShowShareModal(true)}>
                <ShareIcon /> {t("workflow.share")}
              </Button>
            )}
            {/* 2026-09-06, Lino: "nach der Postproduction-Seite kommt die
                Deliver-Page, jedes abgeschlossene Video wird dort dann zum
                Download aufgeführt" — own dedicated page (not a modal like
                Share above), since it needs a duration/password/cover-video
                picker plus a live preview of what's actually eligible. */}
            <Button variant="secondary" size="sm" onClick={() => router.push(`/projects/${id}/deliver`)}>
              <DeliverIcon /> {t("workflow.deliver")}
            </Button>
          </div>
        </div>

        <div className="mb-8">
          {/* 2026-07-30, Lino: "auftraggeber soll jeweils grösser dargestellt
              werden auf den pipeline seiten" — was text-sm, same size as the
              small back-link/hint text; bumped to text-lg so it reads as its
              own real header line, not an afterthought caption. */}
          {/* 2026-08-06 — project's own color as text color, see
              projects/[id]/page.tsx's identical header for the full note. */}
          {data?.client_name && (
            <div className="text-lg font-medium mb-0.5" style={{ color: data.color }}>
              {data.client_name}
            </div>
          )}
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            {data?.emoji && <span>{data.emoji}</span>} {data?.name ?? t("workflow.projectBack")}
          </h1>
        </div>

        {loading ? (
          <p className="text-sm text-white/40">Lädt…</p>
        ) : sections.length === 0 ? (
          <p className="text-sm text-white/40">
            {data?.module_scripting ? (
              <>
                Noch keine Abschnitte in der Postproduction. Auf der Szenenübersicht: Menü (⋮) auf einem Abschnitt →
                &bdquo;Ab in die Postproduction&ldquo;, sobald alle Szenen im Kasten sind — oder über „+ Video“ oben
                direkt ein ungeplantes Video hochladen.
              </>
            ) : (
              <>Noch kein Video. Über „+ Video“ oben eines hochladen.</>
            )}
          </p>
        ) : (
          // 2026-07-17, Lino: "die video kacheln sollen direkt auf der
          // postproductionseite sein.. keine zeilen ansicht wie es jetzt
          // ist" — ein einziges Kachel-Grid statt der vorherigen
          // aufklappbaren Zeilen-Liste. Jede Kachel traegt Status/Deadline/
          // Titel/Version selbst (siehe VideoTile), Sections ohne Video
          // bekommen eine leere "+ Video"-Kachel statt komplett zu fehlen.
          // 2026-07-17, Lino: "die kachel soll sich in der breite der
          // videogrösse anpassen (gibt ja nur 9:16 und 16:9)" — flex-wrap
          // statt CSS-Grid, jede Kachel bringt ihre eigene Breite mit
          // (siehe VideoTile's TILE_HEIGHT-Rechnung).
          <div className="flex flex-wrap gap-4 items-start">
            {sections.flatMap((section) => {
              const videos = videosBySection[section.id] ?? [];
              const tiles = videos.map((video) => (
                <VideoTile
                  key={video.id}
                  video={video}
                  status={section.postproduction_status}
                  deadline={section.postproduction_deadline}
                  canEditStatus={canEditStatus}
                  canEditDeadline={canEditDeadline}
                  onOpen={() => setReviewingVideo(video)}
                  onChangeStatus={(status) => updateStatus(section, status)}
                  onChangeDeadline={(date) => updateDeadline(section, date)}
                  onUploadVersion={canEditStatus ? (file) => uploadVersionFromTile(section.id, video, file) : undefined}
                  onRename={canEditStatus ? (title) => renameVideo(section.id, video, title) : undefined}
                  uploadFraction={versionUploadProgress[video.id]}
                  members={members}
                  onChangeAssignee={(userId) => updateVideoAssignee(section.id, video, userId)}
                />
              ));
              if (videos.length === 0 && canEditStatus) {
                const progress = uploadProgress[section.id];
                if (progress !== undefined) {
                  // 2026-07-18 (Todoist #201, Lino: "ein Indikator der
                  // zeigt wie weit der Upload ist") — replaces the "+"
                  // box for the duration of the upload; the real
                  // VideoTile takes over once addVideo's whole
                  // create→upload→complete chain finishes. Shown for
                  // is_unplanned sections too (mid-upload from the "+
                  // Video" header button) — only the EMPTY, no-upload-in-
                  // progress placeholder below is skipped for those.
                  tiles.push(
                    <div
                      key={`${section.id}-add`}
                      style={{ width: (240 * 16) / 9, height: 240 }}
                      className="flex shrink-0 flex-col items-center justify-center gap-3 rounded-xl border border-white/15 text-white/60 px-6"
                    >
                      <span className="text-sm font-medium">{t("postproduction.uploading", { percent: Math.round(progress * 100) })}</span>
                      <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full transition-[width] duration-150" style={{ width: `${Math.round(progress * 100)}%` }} />
                      </div>
                    </div>
                  );
                } else if (!section.is_unplanned) {
                  // 2026-07-19, Lino: the "+ Video" header button must NOT
                  // create a persistent, separately-named "section box" —
                  // an is_unplanned section only exists WITH a video (see
                  // createUnplannedVideoSection/deleteVideo), so it should
                  // never actually be empty for long enough to hit this
                  // branch; skipped here as a safety net rather than
                  // showing a "Video für „Ungeplantes Video“" box that
                  // looks like a real named section.
                  tiles.push(
                    <label
                      key={`${section.id}-add`}
                      style={{ width: (240 * 16) / 9, height: 240 }}
                      className="flex shrink-0 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 text-white/40 hover:text-white hover:border-white/30 transition-colors cursor-pointer"
                    >
                      {/* 2026-07-18 (Todoist #189): clicking this box now opens
                          the OS file picker directly instead of just creating
                          an empty placeholder video (upload used to be a
                          separate second step) — a native <label>/<input
                          type=file> pairing does that with no JS click-
                          forwarding needed. */}
                      <input
                        type="file"
                        accept="video/*"
                        className="hidden"
                        onChange={(e) => {
                          if (e.target.files?.[0]) addVideo(section, e.target.files[0]);
                          e.target.value = "";
                        }}
                      />
                      <span className="text-2xl leading-none">+</span>
                      <span className="text-base font-medium text-center px-3">{t("postproduction.videoForSection", { name: section.name })}</span>
                    </label>
                  );
                }
              }
              return tiles;
            })}
          </div>
        )}
      </div>
      {/* 2026-07-17, Lino: "diese Buttons müssen IMMER sichtbar sein damit
          man im Workflow vor und zurück kann" — gleicher Rand-Button wie
          auf der Szenenseite, hier nur die Rückrichtung (zurück zu
          Szenen). 2026-07-19: ausgeblendet wenn weder Ideen noch Scripting
          freigeschaltet sind (reines Postproduction-Projekt) — die
          Hauptseite hätte in dem Fall nichts zu zeigen und würde per Gate
          sofort wieder hierher zurückspringen. */}
      {(data?.module_concept || data?.module_scripting) && (
        <EdgeNavButton
          side="left"
          onClick={goBackToScenes}
          ariaLabel={t("postproduction.backToScenesAria")}
          label={t("postproduction.backToScenesLabel")}
        />
      )}
      <input
        ref={unplannedVideoInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) createUnplannedVideoSection(file);
          e.target.value = "";
        }}
      />
      <ShareLinkModal
        open={showShareModal}
        onClose={() => setShowShareModal(false)}
        projectId={id}
        projectName={data?.name ?? ""}
        kind="video"
      />
      {data && (
        <>
          <NotionImportModal
            open={showNotion}
            onClose={() => setShowNotion(false)}
            project={data}
            onImported={() => api.projectDetail(data.id).then(setData)}
          />
        </>
      )}
      {reviewingVideo && (
        <VideoReviewModal
          video={reviewingVideo}
          canEdit={canEditStatus}
          currentUserId={currentUserId}
          members={members}
          onClose={() => setReviewingVideo(null)}
          onVideoUpdated={(updated) => updateVideo(reviewingVideo.section_id, updated)}
          initialHighlightedCommentId={autoOpenCommentId}
          // 2026-08-07, Lino: "wenn kommentare offen sind, muss es auf
          // 'in bearbeitung' sein, wurden alle abgehackt oder gelöscht,
          // muss es auf 'wartet auf feedback' sein" — the backend now
          // applies this immediately inside every comment create/resolve/
          // delete write (see _sync_section_status_for_comments in
          // main.py; two earlier, narrower attempts — session+close-gated,
          // then one-directional-only — both left real gaps, see that
          // function's own doc comment). That write response doesn't
          // include the SECTION though, so this page's `data.sections`
          // (what VideoTile's status pill actually reads) has no way to
          // learn about it on its own — re-fetches the whole project
          // detail (same pattern `onImported` above already uses) after
          // EVERY comment action, not just resolve/delete.
          //
          // Real bug found live testing an earlier version of this fix:
          // `api.projectDetail` is a GET, and lib/api.ts dedupes/caches
          // every GET for 4s (see GET_CACHE_TTL_MS) — opening the video
          // already fetched this exact path moments earlier, so a "fresh"
          // re-fetch within that window kept silently returning the
          // EARLIER cached response (captured before the write), and the
          // tile just sat there showing the old status until the 4s
          // window happened to expire or a real reload bypassed the cache
          // entirely. invalidateGetCache forces the very next call to be
          // a real network round trip.
          // 2026-08-07, Lino: "klickt man dann DIREKT in den hintergrund
          // dass sich der player schliesst, wird der kommentar nicht
          // geöffnet über die kommentare" — this refetch only ever updated
          // `data.sections` (the status pill), never `videosBySection`
          // (each VIDEO's own embedded `comments`, which is exactly what
          // `reviewingVideo` gets set FROM when a tile is reopened — see
          // `onOpen={() => setReviewingVideo(video)}` above). Normally the
          // live-sync Pusher subscription further up (`subscribeToChanges
          // ("video", reviewingVideo.id, ...)`) catches up on its own
          // shortly after — but that subscription's cleanup runs the
          // INSTANT this modal unmounts, and a backdrop click closes it
          // essentially immediately after the correction's blur/save fires
          // (far faster than clicking a safe element first, or the ×
          // button, which both cost a human a beat of reaction time) — so
          // the real-time round trip can easily still be in flight when
          // the subscription tears down, and the notification never
          // lands. Explicitly refetching this section's videos here too
          // makes it correct regardless of that race.
          onCommentsChanged={() => {
            invalidateGetCache(`projects/${id}`);
            api.projectDetail(id).then(setData);
            api.listVideos(reviewingVideo.section_id).then((videos) => {
              setVideosBySection((prev) => ({ ...prev, [reviewingVideo.section_id]: videos }));
              setReviewingVideo((prev) => {
                if (!prev) return prev;
                const fresh = videos.find((v) => v.id === prev.id);
                return fresh ?? prev;
              });
            });
          }}
          onDeleteVideo={
            canEditStatus
              ? () => {
                  deleteVideo(reviewingVideo.section_id, reviewingVideo);
                  setReviewingVideo(null);
                }
              : undefined
          }
          onDeleteVersion={
            canEditStatus
              ? (versionId) => deleteVideoVersion(reviewingVideo.section_id, reviewingVideo, versionId)
              : undefined
          }
          listSubtitles={api.listSubtitles}
          onEditSubtitleText={api.patchSubtitleSegment}
          onEditSubtitleTranslation={api.patchSubtitleTranslation}
          onUploadSubtitles={api.uploadSubtitles}
          onDownloadSubtitles={api.subtitlesDownloadUrl}
          onTranslateSubtitles={api.translateSubtitles}
        />
      )}
    </AppShell>
  );
}

function DeliverIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 19h14" />
    </svg>
  );
}
function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
      <path d="M8.6 10.5 15.4 6.5M8.6 13.5l6.8 4" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function NotionIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 7h2l6 8V7h2M7 17h2" />
    </svg>
  );
}
