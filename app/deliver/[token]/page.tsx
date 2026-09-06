"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { downloadZip } from "client-zip";
import { publicDeliverApi } from "@/lib/publicDeliverApi";
import { publicPreviewApi } from "@/lib/publicPreviewApi";
import { ApiError } from "@/lib/api";
import { setPreviewLanguage, useLanguage } from "@/lib/i18n";
import type { DeliverPreviewData, DeliverVideo } from "@/lib/types";

// 2026-09-06, Lino: "genau dieses Deliver-System möchte ich für Subshot nun
// auch haben... nach der Postproduction-Seite kommt die Deliver-Page, jedes
// abgeschlossene Video wird dort dann zum Download aufgeführt (immer die
// aller neuste Version)." Public no-login counterpart to
// /projects/[id]/deliver/page.tsx (the internal tab that creates/manages
// this link) — same "own minimal header, not wrapped in AppShell" and
// password-gate pattern as every other /preview* page (see that page's own
// doc comment); added to proxy.ts's public route matcher.
export default function DeliverPage() {
  return (
    <Suspense fallback={null}>
      <DeliverPageInner />
    </Suspense>
  );
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function DeliverPageInner() {
  const { t } = useLanguage();
  const router = useRouter();
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [data, setData] = useState<DeliverPreviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [passwordDraft, setPasswordDraft] = useState("");
  const [passwordError, setPasswordError] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockToken, setUnlockToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playingVideo, setPlayingVideo] = useState<DeliverVideo | null>(null);
  const [zipping, setZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState(0);
  const [countdown, setCountdown] = useState("");

  function load(unlock: string | null) {
    publicDeliverApi
      .fetchDeliverPreview(token, unlock)
      .then((d) => {
        setData(d);
        setNeedsPassword(false);
        setPreviewLanguage(d.language as "de" | "en");
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 403) setNeedsPassword(true);
        else setError(e instanceof ApiError ? e.message : t("deliverPage.loadFailed"));
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!data) return;
    function tick() {
      if (!data) return;
      const diffMs = new Date(data.expires_at).getTime() - Date.now();
      if (diffMs <= 0) {
        router.refresh();
        load(unlockToken);
        return;
      }
      const totalMinutes = Math.floor(diffMs / 60000);
      const days = Math.floor(totalMinutes / (60 * 24));
      const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
      const minutes = totalMinutes % 60;
      if (days > 0) setCountdown(`${days}${t("deliverPage.days")} ${hours}${t("deliverPage.hours")}`);
      else if (hours > 0) setCountdown(`${hours}${t("deliverPage.hours")} ${minutes}${t("deliverPage.minutes")}`);
      else setCountdown(`${minutes}${t("deliverPage.minutes")}`);
    }
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.expires_at]);

  async function submitPassword() {
    if (!passwordDraft.trim() || unlocking) return;
    setUnlocking(true);
    setPasswordError(false);
    try {
      const { unlock_token } = await publicPreviewApi.unlock(token, passwordDraft);
      setUnlockToken(unlock_token);
      load(unlock_token);
    } catch {
      setPasswordError(true);
    } finally {
      setUnlocking(false);
    }
  }

  async function downloadOne(video: DeliverVideo) {
    if (!video.latest_version) return;
    try {
      const { url } = await publicDeliverApi.getDownloadUrl(token, unlockToken, video.latest_version.id);
      // Same synthetic-<a>-click pattern as VideoReviewModal's own
      // downloadCurrentVideo — the presigned URL already carries a real
      // Content-Disposition: attachment header (see backend
      // _video_version_download_url), so this works cross-origin without
      // needing the blob-fetch trick some OTHER apps' plain R2 buckets need.
      const a = document.createElement("a");
      a.href = url;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
      alert(t("deliverPage.downloadFailed"));
    }
  }

  async function downloadAll() {
    setZipping(true);
    setZipProgress(0);
    try {
      const { files } = await publicDeliverApi.getDownloadAllUrls(token, unlockToken);
      const responses = [];
      for (let i = 0; i < files.length; i++) {
        responses.push({ name: files[i].filename, input: await fetch(files[i].url) });
        setZipProgress(Math.round(((i + 1) / files.length) * 90));
      }
      const zipResponse = downloadZip(responses);
      const blob = await zipResponse.blob();
      setZipProgress(100);
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `${data?.project_name || "download"}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch {
      alert(t("deliverPage.zipFailed"));
    } finally {
      setZipping(false);
    }
  }

  if (needsPassword) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#161616] text-white p-5">
        <div className="w-full max-w-xs rounded-2xl bg-[#212121] border border-white/10 p-7 text-center">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-3 text-white/40">
            <rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" />
          </svg>
          <h1 className="text-sm font-bold mb-1">{t("previewPage.gateTitle")}</h1>
          <p className="text-xs text-white/40 mb-5">{t("previewPage.gateMessage")}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitPassword();
            }}
          >
            <input
              autoFocus
              type="password"
              value={passwordDraft}
              onChange={(e) => setPasswordDraft(e.target.value)}
              placeholder={t("shareLinkModal.passwordPlaceholder")}
              className="w-full text-sm bg-white/5 border border-white/10 rounded-lg px-3.5 py-3 mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            />
            {passwordError && <p className="text-xs text-red-400 mb-3">{t("previewPage.wrongPassword")}</p>}
            <button
              type="submit"
              disabled={unlocking}
              className="w-full text-sm font-bold py-3 rounded-lg bg-blue-600 text-white disabled:opacity-50"
            >
              {t("previewPage.view")}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-[#161616] text-white/50 text-sm">{t("common.loading")}</div>;
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#161616] text-white/50 text-sm text-center px-6">
        {error || t("deliverPage.expired")}
      </div>
    );
  }

  const coverVideo = data.cover_video_version_id ? data.videos.find((v) => v.latest_version?.id === data.cover_video_version_id) : null;
  const coverVideoUrl = coverVideo?.latest_version?.playback_url ?? null;
  const hasHero = Boolean(coverVideoUrl || data.cover_thumbnail_url);

  return (
    <div className="min-h-screen bg-[#161616] text-white">
      <a
        href="https://subshot.ch"
        className="fixed left-5 top-5 z-20 sm:left-8 sm:top-6 inline-flex items-center"
      >
        {data.team_logo_url ? (
          // 2026-09-06, Lino: "muss grösser sein... und es soll keinen
          // Glasrahmen haben, sondern einfach direkt das PNG logo" — no
          // box/rounding/crop/shadow, just the actual (already-square, per
          // the upload requirement) PNG at a bigger natural size.
          // eslint-disable-next-line @next/next/no-img-element -- presigned R2 URL, not a static/local asset next/image can optimize
          <img src={data.team_logo_url} alt={data.team_name ?? "Logo"} className="h-14 w-auto sm:h-16" />
        ) : (
          <span className="font-anton text-lg uppercase drop-shadow">
            Subshot
            {data.team_name && <span className="text-white/60"> - {data.team_name}</span>}
          </span>
        )}
      </a>

      {hasHero ? (
        <div className="relative h-[65vh] w-full sm:h-[82vh]">
          {coverVideoUrl ? (
            <video src={coverVideoUrl} poster={data.cover_thumbnail_url ?? undefined} autoPlay muted loop playsInline className="h-full w-full object-cover" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- full-bleed hero background
            <img src={data.cover_thumbnail_url ?? undefined} alt="" className="h-full w-full object-cover" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#161616] via-[#161616]/20 to-black/30" />
          <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1.5 px-5 pb-10 text-left sm:px-10 sm:pb-12">
            <p className="text-sm uppercase tracking-widest text-white/70 sm:text-base">{data.client_name}</p>
            <h1 className="text-4xl font-semibold tracking-tight drop-shadow sm:text-6xl">{data.project_name}</h1>
            <p className="text-sm text-white/70 sm:text-base">
              {data.videos.length} {t(data.videos.length === 1 ? "deliverPage.video" : "deliverPage.videos")}
              {formatBytes(data.total_size_bytes) ? ` · ${formatBytes(data.total_size_bytes)}` : ""} · {t("deliverPage.expiresIn")} {countdown || "…"}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 px-5 pb-2 pt-10 text-left sm:px-10 sm:pt-16">
          <p className="text-sm uppercase tracking-widest text-white/50 sm:text-base">{data.client_name}</p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">{data.project_name}</h1>
          <p className="text-sm text-white/40 sm:text-base">
            {data.videos.length} {t(data.videos.length === 1 ? "deliverPage.video" : "deliverPage.videos")}
            {formatBytes(data.total_size_bytes) ? ` · ${formatBytes(data.total_size_bytes)}` : ""} · {t("deliverPage.expiresIn")} {countdown || "…"}
          </p>
        </div>
      )}

      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-10 sm:px-8 sm:py-16">
        <button
          type="button"
          disabled={zipping}
          onClick={downloadAll}
          className="flex w-fit cursor-pointer items-center gap-2 self-center rounded-full bg-white px-6 py-3 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-60 sm:self-start"
        >
          {zipping ? `${t("deliverPage.zipping")} ${zipProgress}%` : `⬇ ${t("deliverPage.downloadAll")}`}
        </button>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {data.videos.map((video) => (
            <div key={video.id} className="group relative aspect-square overflow-hidden rounded-xl bg-white/5">
              {video.latest_version?.thumbnail_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- presigned R2 URL
                <img src={video.latest_version.thumbnail_url} alt={video.title} className="h-full w-full object-cover" />
              ) : null}
              <button
                type="button"
                onClick={() => setPlayingVideo(video)}
                aria-label={t("deliverPage.play")}
                className="absolute inset-0 flex items-center justify-center bg-black/10 transition-colors hover:bg-black/30"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-black shadow-lg transition-transform group-hover:scale-110">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="ml-0.5 h-5 w-5">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  downloadOne(video);
                }}
                className="absolute right-2 top-2 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
              >
                ⬇
              </button>
              <p className="pointer-events-none absolute bottom-0 left-0 right-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5 text-[11px] text-white/80">
                {video.title}
              </p>
            </div>
          ))}
        </div>

        <p className="text-center text-xs text-white/30">{t("deliverPage.footerNote")}</p>
      </div>

      {playingVideo?.latest_version ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" onClick={() => setPlayingVideo(null)}>
          <button
            type="button"
            onClick={() => setPlayingVideo(null)}
            aria-label={t("common.close")}
            className="absolute right-4 top-4 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            ✕
          </button>
          <video
            key={playingVideo.id}
            src={playingVideo.latest_version.playback_url ?? undefined}
            controls
            autoPlay
            playsInline
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] max-w-[92vw] rounded-lg shadow-2xl"
          />
        </div>
      ) : null}
    </div>
  );
}
