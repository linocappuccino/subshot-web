"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { VideoTile } from "@/app/components/VideoTile";
import { VideoReviewModal } from "@/app/components/VideoReviewModal";
import { publicPreviewApi } from "@/lib/publicPreviewApi";
import { ApiError } from "@/lib/api";
import { setPreviewLanguage, useLanguage } from "@/lib/i18n";
import { subscribeToChanges } from "@/lib/realtime";
import type { SharedVideoPreviewData, Video } from "@/lib/types";

// 2026-07-20 (#254, corrected scope) — public no-login "viewer" counterpart
// to /projects/[id]/postproduction/page.tsx. Reuses the REAL VideoTile +
// VideoReviewModal components (not a hand-rolled clone) in read-only mode:
// no status/deadline editing, no upload/rename/delete, just open a video,
// scrub the timeline, leave comments, and (once) submit feedback to lock
// further comments on that version. Added to proxy.ts's public route
// matcher — this page must render for a signed-out visitor. Deliberately
// NOT wrapped in <AppShell> (notification bell/credits/team links make no
// sense for an anonymous viewer) — own minimal header instead, matching the
// "Subshot - {Team}" / "Auftrag: {Projekt}" convention every OTHER public
// preview page (share_view.py/idea_share_view.py/video_share_view.py) uses,
// see _brand_header_html in the backend.
export default function PreviewVideoPage() {
  return (
    <Suspense fallback={null}>
      <PreviewVideoPageInner />
    </Suspense>
  );
}

function PreviewVideoPageInner() {
  const { t } = useLanguage();
  const params = useParams<{ token: string }>();
  const token = params.token;
  const searchParams = useSearchParams();
  const openVideoId = searchParams.get("video");

  const [data, setData] = useState<SharedVideoPreviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [passwordDraft, setPasswordDraft] = useState("");
  const [passwordError, setPasswordError] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockToken, setUnlockToken] = useState<string | null>(null);
  const [reviewingVideo, setReviewingVideo] = useState<Video | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openedFromParam, setOpenedFromParam] = useState(false);

  function load(unlock: string | null) {
    setLoading(true);
    publicPreviewApi
      .fetchVideoPreview(token, unlock)
      .then((d) => {
        setData(d);
        setPreviewLanguage(d.language);
        setNeedsPassword(false);
        setError(null);
        if (openVideoId && !openedFromParam) {
          const v = d.videos.find((video) => video.id === openVideoId);
          if (v) setReviewingVideo(v);
          setOpenedFromParam(true);
        }
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 403) setNeedsPassword(true);
        else setError(e instanceof ApiError ? e.message : t("previewPage.loadFailed"));
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // 2026-07-28 — live comment sync (Lino: "sieht man das direkt in der
  // preview seite?"). A SEPARATE silent refetch, not `load()` — `load`
  // toggles `loading`, which gates the whole tile-grid render, so reusing
  // it here would flash the entire page back to "Lädt…" every time anyone
  // (including a second visitor) leaves a comment. Also re-syncs
  // `reviewingVideo` from the fresh data — it's its own state, not derived
  // from `data`, so a plain `setData` alone would leave an OPEN modal
  // showing stale comments even after the underlying data refreshed.
  useEffect(() => {
    if (!reviewingVideo) return;
    return subscribeToChanges("video", reviewingVideo.id, () => {
      publicPreviewApi
        .fetchVideoPreview(token, unlockToken)
        .then((d) => {
          setData(d);
          setReviewingVideo((prev) => (prev ? d.videos.find((v) => v.id === prev.id) ?? prev : prev));
        })
        .catch(() => {});
    });
  }, [reviewingVideo?.id, token, unlockToken]);

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

  function updateVideo(updated: Video) {
    setData((prev) => (prev ? { ...prev, videos: prev.videos.map((v) => (v.id === updated.id ? updated : v)) } : prev));
    setReviewingVideo(updated);
  }

  const sectionById = useMemo(() => {
    const map = new Map<string, SharedVideoPreviewData["sections"][number]>();
    data?.sections.forEach((s) => map.set(s.id, s));
    return map;
  }, [data]);

  // Same "nearest deadline first, undated last" order as postproduction/
  // page.tsx (#219) — deadline lives on the section, shared by every video
  // inside it, so this sorts videos by their OWN section's deadline.
  const sortedVideos = useMemo(() => {
    if (!data) return [];
    return [...data.videos].sort((a, b) => {
      const da = sectionById.get(a.section_id)?.postproduction_deadline;
      const db_ = sectionById.get(b.section_id)?.postproduction_deadline;
      if (!da && !db_) return 0;
      if (!da) return 1;
      if (!db_) return -1;
      return new Date(da).getTime() - new Date(db_).getTime();
    });
  }, [data, sectionById]);

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

  return (
    <div className="min-h-screen bg-[#161616] text-white">
      <div className="max-w-6xl mx-auto w-full px-4 sm:px-6 pt-8 pb-28">
        <a href="https://subshot.ch" className="inline-flex items-baseline gap-1.5 mb-1 hover:opacity-80 transition-opacity">
          {data?.team_logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- presigned R2 URL, not a static/local asset next/image can optimize
            <img src={data.team_logo_url} alt={data.team_name ?? "Logo"} className="w-8 h-8 rounded-lg object-cover" />
          ) : (
            <span className="font-anton text-lg uppercase">
              Subshot
              {data?.team_name && <span className="text-white/40"> - {data.team_name}</span>}
            </span>
          )}
        </a>
        {/* 2026-07-29, Lino: Auftraggeber immer auch auf den Preview-Seiten
            zeigen, gleiche Behandlung wie im authentifizierten Pipeline-Header
            (projects/[id]/page.tsx).
            2026-07-30, Lino: "der auftraggeber muss grösser dargestellt
            werden und der projekttitel auch" — see preview-ideas/[token]'s
            identical header for the full comment; same size bump here. */}
        {/* 2026-08-06 — project's own color as text color (data.project_color),
            same treatment as the authenticated pipeline header. */}
        {data?.client_name && (
          <div className="text-lg font-medium" style={{ color: data.project_color }}>
            {data.client_name}
          </div>
        )}
        <h1 className="text-2xl font-bold text-white mb-6">{t("previewPage.projectLabel", { name: data?.project_name ?? "…" })}</h1>

        {loading ? (
          <p className="text-sm text-white/40">{t("common.loading")}</p>
        ) : error ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : !data || data.videos.length === 0 ? (
          <p className="text-sm text-white/40">{t("previewVideoPage.noVideos")}</p>
        ) : (
          <div className="flex flex-wrap gap-4 items-start">
            {sortedVideos.map((video) => {
              const section = sectionById.get(video.section_id);
              return (
                <VideoTile
                  key={video.id}
                  video={video}
                  status={section?.postproduction_status ?? null}
                  deadline={section?.postproduction_deadline ?? null}
                  canEditStatus={false}
                  canEditDeadline={false}
                  onOpen={() => setReviewingVideo(video)}
                  onChangeStatus={() => {}}
                  onChangeDeadline={() => {}}
                  showDeadlineLabel
                />
              );
            })}
          </div>
        )}
      </div>

      {reviewingVideo && (
        <VideoReviewModal
          video={reviewingVideo}
          canEdit={false}
          currentUserId={null}
          members={[]}
          onClose={() => setReviewingVideo(null)}
          onVideoUpdated={updateVideo}
          publicMode
          postComment={(versionId, timestampSeconds, comment, parentCommentId, authorName) =>
            publicPreviewApi.postComment(token, unlockToken, versionId, timestampSeconds, comment, parentCommentId, authorName)
          }
          onSubmitFeedback={(versionId) => publicPreviewApi.submitFeedback(token, unlockToken, versionId)}
          onDeleteComment={(commentId) => publicPreviewApi.deleteComment(token, unlockToken, commentId)}
          getDownloadUrl={(versionId) => publicPreviewApi.getDownloadUrl(token, unlockToken, versionId)}
          listSubtitles={(versionId) => publicPreviewApi.listSubtitles(token, unlockToken, versionId)}
          onEditSubtitleText={(segmentId, text) => publicPreviewApi.patchSubtitleSegment(token, unlockToken, segmentId, text)}
          onEditSubtitleTranslation={(translationId, text) =>
            publicPreviewApi.patchSubtitleTranslation(token, unlockToken, translationId, text)
          }
        />
      )}
    </div>
  );
}
