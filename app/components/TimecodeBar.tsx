"use client";

import { useEffect, useRef, useState } from "react";
import { useApi } from "@/lib/useApi";
import { useLanguage } from "@/lib/i18n";
import { Menu, MenuItem } from "./ui/Menu";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import type { Section } from "@/lib/types";

/** 2026-08-30 — web port of the iOS "Set Marker" on-set timecode feature
 * (ShotListView.swift's timecodeBar/markClipBar), see project memory. Real
 * Nikon ZR frame rates (confirmed against Nikon's own online manual) — no
 * plain 24/30/60, this camera doesn't offer those at all. */
const FPS_PRESETS = [23.976, 25, 29.97, 50, 59.94, 100, 119.88, 200, 239.76];

/** 2026-08-30, Lino: auto-stop the running session after 1h of no activity
 * ("auch wenn man mindestens 1h nicht mehr im projekt war"). 2026-08-31 —
 * now checked against the SHARED `Section.timecode_synced_at` (see its own
 * doc comment in models.py) instead of a per-device localStorage
 * timestamp, so every client agrees on whether a session is still "live". */
const IDLE_TIMEOUT_MS = 60 * 60 * 1000;

function fpsLabel(fps: number): string {
  return Number.isInteger(fps) ? String(fps) : String(fps);
}

/** Time-of-Day, HH:MM:SS:FF — never "seconds since something started" (see
 * SceneMarker's own doc comment). Nominal frame count (round(fps)) drives
 * the FF field per standard SMPTE convention — 23.976p still labels frames
 * 0-23, exactly like the iOS/backend math. `date` is expected to already
 * have the shared timecode_offset_seconds correction baked in by the
 * caller (see syncedNow below) — this function itself is offset-agnostic. */
function formatTimecode(date: Date, fps: number): string {
  const nominalFrames = Math.round(fps);
  const frames = Math.min(nominalFrames - 1, Math.floor((date.getMilliseconds() / 1000) * nominalFrames));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}:${pad(frames)}`;
}

/** Sticky bar mounted ONLY inside the opened shotlist for ONE section —
 * 2026-08-30, Lino: "der timecode muss immer in der shotlist selber
 * laufen! NICHT in der uebersicht!! jedes video/projekt braucht ja seinen
 * eigenen timecode!" — was previously mounted for the whole "Skript" view
 * (visible even on the section-picker overview) with an internal section-
 * switcher; now takes exactly ONE `section` and has no switcher at all —
 * the parent page re-mounts a fresh instance (via `key={section.id}`)
 * whenever a different section is opened, so framerate/timecode state
 * never leaks between sections.
 *
 * 2026-08-31, Lino: "übernimmt eine person den timecode mit der kamera,
 * ist er bei den anderen die das gleiche projekt geöffnet haben direkt
 * auch mit gesynced, diese müssen dann nicht mehr mit der kamera syncen."
 * The whole session (fps + a wall-clock correction offset, set via the
 * iOS app's camera-based "Start Rec-Markers" visual-timecode-sync, or a
 * plain manual pick here on web with offset 0) now lives on the Section
 * itself (see Section.timecode_fps's own doc comment in models.py)
 * instead of this device's own localStorage — `localSection` below just
 * MIRRORS it (optimistic on this device's own actions), reconciled
 * automatically whenever the parent page's own poll refreshes `section`.
 * "Weiter tracken" (2026-08-30, Lino: a restart of an already-started
 * session needs no camera re-sync — reuses the EXISTING fps+offset) now
 * means exactly the same thing for a session STARTED BY SOMEONE ELSE, not
 * just one this device itself started before. */
export function TimecodeBar({ section, allScenesDone }: { section: Section; allScenesDone: boolean }) {
  const api = useApi();
  const { t } = useLanguage();

  const [localSection, setLocalSection] = useState(section);
  useEffect(() => setLocalSection(section), [section]);

  const isFresh = localSection.timecode_synced_at
    ? Date.now() - new Date(localSection.timecode_synced_at).getTime() < IDLE_TIMEOUT_MS
    : false;
  const hasSavedSession = localSection.timecode_fps != null;
  const isRunning = hasSavedSession && isFresh;
  const offsetSeconds = localSection.timecode_offset_seconds || 0;
  const fps = localSection.timecode_fps ?? null;

  const [now, setNow] = useState(() => new Date());
  const [isExporting, setIsExporting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetMarkerCount, setResetMarkerCount] = useState<number | null>(null);
  const [isCountingForReset, setIsCountingForReset] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setNow(new Date()), 100);
    return () => clearInterval(id);
  }, [isRunning]);

  // 2026-08-30, Lino: "sind alle clips als im kasten markiert in einer
  // shotlist, stopt der timecode marker (und speichert natuerlich)" —
  // 2026-08-31: now also clears the SHARED backend session (not just this
  // device's own display), so it doesn't linger stale for the next shoot
  // day on this section.
  const allScenesDoneHandledRef = useRef(false);
  useEffect(() => {
    if (allScenesDone && isRunning && !allScenesDoneHandledRef.current) {
      allScenesDoneHandledRef.current = true;
      api.patchSectionTimecode(section.id, { fps: null }).then(setLocalSection).catch(() => {});
    }
    if (!allScenesDone) allScenesDoneHandledRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allScenesDone, isRunning]);

  useEffect(() => {
    if (!feedback) return;
    const id = setTimeout(() => setFeedback(null), 1600);
    return () => clearTimeout(id);
  }, [feedback]);

  function handleError(e: unknown) {
    setError(e instanceof Error ? e.message : String(e));
  }

  /** Starts a BRAND NEW session (offset 0 — no camera available on web) or
   * changes the framerate of an existing one. */
  function startTracking(newFps: number) {
    api.patchSectionTimecode(section.id, { fps: newFps, offset_seconds: 0 }).then(setLocalSection).catch(handleError);
  }

  /** "Weiter tracken" — resumes the EXISTING shared fps+offset (whoever
   * set it, on whichever platform) with a single tap, no re-pick needed. */
  function continueTracking() {
    if (fps == null) return;
    api.patchSectionTimecode(section.id, { fps, offset_seconds: offsetSeconds }).then(setLocalSection).catch(handleError);
  }

  // 2026-08-31, Lino: "das marker setzen... muss sofort passieren so dass
  // man auch marker direkt hintereinander setzen kann" — was gated on
  // isSending, disabling the button for the full network round trip, so a
  // fast real on-set take sequence could lose the second tap. Optimistic
  // now: feedback flash happens instantly, the actual POST fires
  // independently per tap without blocking the next one. The backend
  // itself refreshes timecode_synced_at on every created marker (see
  // create_scene_marker's own comment) — no separate "touch" call needed
  // here anymore.
  function markClip() {
    if (fps == null) return;
    const timecode = formatTimecode(new Date(Date.now() + offsetSeconds * 1000), fps);
    setFeedback(`${t("timecodeBar.markerSaved")} · ${timecode}`);
    api.createSceneMarker(section.id, { timecode, fps }).catch(handleError);
  }

  async function exportEdl() {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const text = await api.sceneMarkersEdlText(section.id);
      const blob = new Blob([text], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${section.name.replace(/\//g, "-")}.edl`;
      a.click();
      URL.revokeObjectURL(url);
      // 2026-08-31, Lino: "der timecode soll nach dem teilen der edl
      // gestoppt werden.. also in der app nicht mehr weiterlaufen" -
      // exporting the EDL is treated as "this project's shoot is done",
      // same as the all-scenes-done auto-stop already does. Stops the
      // SHARED session for every client with this section open, not just
      // this device/tab - iOS parity, see its exportEDL()'s own comment.
      const updated = await api.patchSectionTimecode(section.id, { fps: null });
      setLocalSection(updated);
    } catch (e) {
      handleError(e);
    } finally {
      setIsExporting(false);
    }
  }

  // 2026-08-30, Lino: "resetten muss man per dialog bestaetigen. (es
  // werden xx marker geloescht)" — fetch the real current count right
  // when Reset is tapped (not cached/guessed) so the confirm dialog can
  // say exactly how many markers are about to be deleted.
  async function startReset() {
    setIsCountingForReset(true);
    try {
      const markers = await api.sceneMarkers(section.id);
      setResetMarkerCount(markers.length);
    } catch (e) {
      handleError(e);
      setResetMarkerCount(null);
    } finally {
      setIsCountingForReset(false);
    }
  }

  async function confirmReset() {
    setResetMarkerCount(null);
    setIsResetting(true);
    try {
      await api.resetSceneMarkers(section.id);
      // 2026-08-31 — Reset now also clears the shared session itself
      // (fps/offset), not just the recorded markers: a fresh start should
      // mean a fresh "Set Framerate"/"Start Rec-Markers" gate for everyone,
      // not silently resuming the just-reset session's old fps.
      const updated = await api.patchSectionTimecode(section.id, { fps: null });
      setLocalSection(updated);
      setFeedback(t("timecodeBar.resetDone"));
    } catch (e) {
      handleError(e);
    } finally {
      setIsResetting(false);
    }
  }

  const fpsMenu = (trigger: React.ReactNode) => (
    // 2026-08-31, Lino: "die Framerate Auswahl wird von der Kachel
    // abgeschnitten" — same class of bug as the emoji picker (see Menu's
    // own `portal` doc comment): this card's `overflow-hidden` (for its
    // rounded corners) clips the default non-portal absolute dropdown.
    <Menu trigger={trigger} portal>
      {(close) => (
        <>
          {FPS_PRESETS.map((preset) => (
            <MenuItem
              key={preset}
              onClick={() => {
                startTracking(preset);
                close();
              }}
            >
              {fpsLabel(preset)} fps
            </MenuItem>
          ))}
        </>
      )}
    </Menu>
  );

  return (
    // 2026-08-31, Lino: "muss oben schöner dargestellt werden" — was a flat,
    // edge-to-edge, sharp-cornered black bar (bg-black/75), visually out of
    // place next to every OTHER surface in this app (rounded-2xl cards,
    // dark-gray #212121 fill, a subtle white/[0.06] border — same recipe as
    // ProjectInfoBox/the section-overview tiles/PublicSectionComments).
    // Reworked into a floating card matching that recipe instead, `top-3`
    // (not `top-0`) so it reads as floating with real space above it once
    // stuck, rather than flush against the viewport edge.
    <div className="sticky top-3 z-20 mb-4">
      <div className="rounded-2xl bg-[#212121] border border-white/[0.08] shadow-lg shadow-black/40 text-white text-sm overflow-hidden">
        <div className="px-4 py-3">
          {isRunning && fps != null ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="font-mono text-xl font-bold tabular-nums">
                  {formatTimecode(new Date(now.getTime() + offsetSeconds * 1000), fps)}
                </span>
                <span className="text-white/45 text-xs truncate">→ {section.name}</span>
              </div>
              <div className="flex items-center gap-1.5">
                {fpsMenu(
                  <span className="text-white/60 text-xs font-semibold cursor-pointer bg-white/5 hover:bg-white/10 rounded-full px-2.5 py-1 transition-colors">
                    {fpsLabel(fps)} fps
                  </span>
                )}
                <div className="flex-1" />
                <button
                  onClick={startReset}
                  disabled={isResetting || isCountingForReset}
                  className="p-2 rounded-full hover:bg-white/10 disabled:opacity-40 text-white/70"
                  title={t("timecodeBar.reset")}
                >
                  {isCountingForReset ? "…" : "↺"}
                </button>
                <button
                  onClick={exportEdl}
                  disabled={isExporting}
                  className="p-2 rounded-full hover:bg-white/10 disabled:opacity-40 text-white/70"
                  title={t("timecodeBar.exportEdl")}
                >
                  ⇪
                </button>
              </div>
              {/* 2026-08-31 — no disabled state here anymore (see markClip's
                  own doc comment): must stay instantly re-tappable for a
                  fast take sequence. */}
              <button
                onClick={markClip}
                className="w-full px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 font-semibold text-sm transition-colors"
              >
                {t("timecodeBar.setMarker")}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-white/50 text-xs flex-1">
                {hasSavedSession ? t("timecodeBar.continueTrackingHint") : t("timecodeBar.setFramerateHint")}
              </span>
              {hasSavedSession ? (
                <button
                  onClick={continueTracking}
                  className="px-4 py-2 rounded-full bg-green-600 hover:bg-green-500 font-semibold text-xs cursor-pointer transition-colors"
                >
                  {t("timecodeBar.continueTracking")}
                </button>
              ) : (
                fpsMenu(
                  <span className="px-4 py-2 rounded-full bg-blue-600 hover:bg-blue-500 font-semibold text-xs cursor-pointer transition-colors">
                    {t("timecodeBar.setFramerate")}
                  </span>
                )
              )}
            </div>
          )}
        </div>
        {feedback && <div className="flex justify-center py-1.5 bg-green-600/85 text-white text-xs font-semibold">{feedback}</div>}
        {error && (
          <div
            className="flex justify-between items-center gap-3 px-4 py-1.5 bg-red-600/85 text-white text-xs font-semibold cursor-pointer"
            onClick={() => setError(null)}
          >
            <span>{error}</span>
            <span className="opacity-70">✕</span>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={resetMarkerCount !== null}
        title={t("timecodeBar.resetConfirmTitle").replace("{section}", section.name)}
        message={t("timecodeBar.resetConfirmMessage").replace("{count}", String(resetMarkerCount ?? 0))}
        confirmLabel={t("timecodeBar.reset")}
        onConfirm={() => {
          confirmReset();
        }}
        onCancel={() => setResetMarkerCount(null)}
      />
    </div>
  );
}
