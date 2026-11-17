"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { VIDEO_GRID, VideoTile, useVideoGridCols } from "@/app/components/VideoTile";
import { FormatBadge, ResolutionBadge, FormatTabs, PlatformTabs, type PlatformTab, LanguageBadge, LanguageTabs, type FormatTab, type LanguageTab } from "@/app/components/PostproLanguages";
import { VideoReviewModal } from "@/app/components/VideoReviewModal";
import { publicPreviewApi } from "@/lib/publicPreviewApi";
import { ApiError } from "@/lib/api";
import { setPreviewLanguage, useLanguage } from "@/lib/i18n";
import { subscribeToChanges } from "@/lib/realtime";
import { facetCounts, filterVideos, listGroups, matrixOf } from "@/lib/postproFilter";
import { PostproListView, PostproMatrixView, ViewSwitch, usePostproView } from "@/app/components/PostproViews";
import type { PostproductionStatus } from "@/lib/types";
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
  const [ppView, setPpView] = usePostproView();  // 2026-11-17 — overview link only (read-only list / matrix)

  function load(unlock: string | null) {
    setLoading(true);
    publicPreviewApi
      .fetchVideoPreview(token, unlock)
      .then((d) => {
        setData(d);
        setPreviewLanguage(d.language);
        setNeedsPassword(false);
        setError(null);
        const wanted = d.single_video_id || openVideoId;
        if (d.single_video_id) {
          const v = d.videos.find((video) => video.id === d.single_video_id);
          if (v) setReviewingVideo(v);
          setOpenedFromParam(true);
        } else if (wanted && !openedFromParam) {
          const v = d.videos.find((video) => video.id === wanted);
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

  // 2026-11-13, Lino: the client clicks through the languages too (filter only, no assigning)
  const [langTab, setLangTab] = useState<LanguageTab>("all");
  const [fmtTab, setFmtTab] = useState<FormatTab>("all");
  const [plTab, setPlTab] = useState<PlatformTab>("all");
  const [gridRef, gridStyle] = useVideoGridCols((data?.videos ?? []).some((v) => ["16:9", "5:4"].includes((data?.video_formats ?? {})[v.id] ?? "16:9")));
  const sectionById = useMemo(() => {
    const map = new Map<string, SharedVideoPreviewData["sections"][number]>();
    data?.sections.forEach((s) => map.set(s.id, s));
    return map;
  }, [data]);

  // 2026-09-16 — REMOVED the "nearest deadline first" sort this page used
  // to copy from postproduction/page.tsx (#219). Root cause of Lino's "die
  // reihenfolge ist auf der preview seite immer noch falsch" report: the
  // backend's own order (Section.sort_order then Video.sort_order — now
  // editor-controlled via the postproduction page's manual-order mode, see
  // reorder_postproduction_videos in main.py) was correct end-to-end
  // (verified live via server logs + direct API checks), but THIS sort
  // silently discarded it and re-sorted by deadline before every render —
  // deadline is an internal production-tracking concept the external
  // client viewing this page has no reason to care about, and it made the
  // whole point of the new reorder feature (letting Lino choose what the
  // client sees) impossible to achieve from here. `data.videos` is now
  // rendered in the order the backend already sends it, unsorted.
  const assignments = data?.video_languages ?? {};
  const formats = data?.video_formats ?? {};
  // 2026-11-16 — counters and tiles from the same function (lib/postproFilter)
  const pfCtx = { assignments, formats };
  const pfFilter = { lang: langTab, fmt: fmtTab, plat: plTab };
  const sortedVideos = filterVideos(data?.videos ?? [], pfFilter, pfCtx);
  const fc = facetCounts(data?.videos ?? [], pfFilter, pfCtx);

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
        ) : data.single_video_id ? (
          // 2026-11-17 — single-video link: no overview behind the (not closable) review
          null
        ) : (
          <>
          {(data.languages ?? []).length > 0 && (
            <LanguageTabs
              data={{ languages: data.languages ?? [], assignments, unassigned: data.videos.filter((v) => !assignments[v.id]).length }}
              tab={langTab}
              onTab={setLangTab}
              total={data.videos.length}
              counts={fc.lang}
              hideEmptyUnassigned
            />
          )}
          <FormatTabs counts={fc.fmt} present={fc.present.fmt} tab={fmtTab} onTab={setFmtTab} />
          <PlatformTabs counts={fc.plat} present={fc.present.plat} tab={plTab} onTab={setPlTab} />
          <div className="mb-3 flex justify-end"><ViewSwitch view={ppView} onView={setPpView} /></div>
          {ppView !== "tiles" ? (() => {
            const sectionOf: Record<string, string> = {};
            for (const v of data.videos) sectionOf[v.id] = v.section_id;
            const order = data.sections.map((s) => s.id);
            const secInfo: Record<string, { name: string; status: PostproductionStatus | null }> = {};
            for (const s of data.sections) secInfo[s.id] = { name: s.name, status: s.postproduction_status };
            const labels: Record<PostproductionStatus, string> = {
              wartend: t("postproductionStatus.wartend"), in_bearbeitung: t("postproductionStatus.inBearbeitung"),
              wartet_auf_feedback: t("postproductionStatus.wartetAufFeedback"), abgeschlossen: t("postproductionStatus.abgeschlossen"),
              abgelehnt: t("postproductionStatus.abgelehnt"),
            };
            const byId: Record<string, Video> = {};
            for (const v of sortedVideos) byId[v.id] = v;
            const langsList = data.languages ?? [];
            if (sortedVideos.length === 0) return <p className="text-sm text-white/40">{t("postproViews.nothing")}</p>;
            return ppView === "matrix" ? (
              <PostproMatrixView
                matrix={matrixOf(sortedVideos, pfCtx, data.video_spots ?? {}, sectionOf, order, [...langsList].sort((a, b) => a.sort_order - b.sort_order).map((l) => l.id))}
                videosById={byId} sectionById={secInfo} languages={langsList}
                onOpen={(v) => setReviewingVideo(v)} statusLabel={(s) => labels[s]}
              />
            ) : (
              <PostproListView
                readOnly
                groups={listGroups(sortedVideos, sectionOf, order).map((g) => ({ id: g.section, name: secInfo[g.section]?.name ?? "", status: secInfo[g.section]?.status ?? null, videos: g.ids.map((i) => byId[i]) }))}
                languages={langsList} assignments={assignments} formats={formats}
                onOpen={(v) => setReviewingVideo(v)} statusLabel={(s) => labels[s]}
              />
            );
          })() : (
          <div ref={gridRef} className={VIDEO_GRID} style={gridStyle}>
            {sortedVideos.map((video) => {
              const section = sectionById.get(video.section_id);
              const lang = (data.languages ?? []).find((l) => l.id === assignments[video.id]);
              return (
                <div key={video.id} data-video-lang={lang?.id ?? ""} className="contents">
                <VideoTile
                  video={video}
                  status={section?.postproduction_status ?? null}
                  deadline={section?.postproduction_deadline ?? null}
                  canEditStatus={false}
                  canEditDeadline={false}
                  onOpen={() => setReviewingVideo(video)}
                  onChangeStatus={() => {}}
                  onChangeDeadline={() => {}}
                  showDeadlineLabel
                  fill
                  languageBadge={
                    lang || formats[video.id] ? (
                      <span className="flex items-center gap-1">
                        <LanguageBadge current={lang ?? null} languages={[]} />
                        <FormatBadge f={formats[video.id]} />
                        <ResolutionBadge versions={video.versions} />
                      </span>
                    ) : undefined
                  }
                />
                </div>
              );
            })}
          </div>
          )}
          </>
        )}
      </div>

      {reviewingVideo && (
        <VideoReviewModal
          video={reviewingVideo}
          sectionStatus={sectionById.get(reviewingVideo.section_id)?.postproduction_status ?? null}
          canEdit={false}
          currentUserId={null}
          members={[]}
          onClose={() => { if (!data?.single_video_id) setReviewingVideo(null); }}
          onVideoUpdated={updateVideo}
          publicMode
          lockedOpen={!!data?.single_video_id}
          postComment={(versionId, timestampSeconds, comment, parentCommentId, authorName) =>
            publicPreviewApi.postComment(token, unlockToken, versionId, timestampSeconds, comment, parentCommentId, authorName)
          }
          onSubmitFeedback={(versionId) => publicPreviewApi.submitFeedback(token, unlockToken, versionId)}
          onDeleteComment={(commentId) => publicPreviewApi.deleteComment(token, unlockToken, commentId)}
          getDownloadUrl={(versionId) => publicPreviewApi.getDownloadUrl(token, unlockToken, versionId)}
          listSubtitles={(versionId) => publicPreviewApi.listSubtitles(token, unlockToken, versionId)}
          onEditSubtitleText={(segmentId, text, authorName) => publicPreviewApi.patchSubtitleSegment(token, unlockToken, segmentId, text, authorName)}
          onEditSubtitleTranslation={(translationId, text, authorName) =>
            publicPreviewApi.patchSubtitleTranslation(token, unlockToken, translationId, text, authorName)
          }
        />
      )}
    </div>
  );
}
