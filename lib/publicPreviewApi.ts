import type { SharedVideoPreviewData, VideoComment, SubtitlesData, SubtitleSegment, SubtitleTranslationCue } from "./types";
import { ApiError } from "./api";

// 2026-07-20 (#254) — the public no-login video preview page's own tiny API
// client. Deliberately NOT createApiClient/useApi(): those hard-require a
// Clerk Bearer token (throw before the request even fires, see api.ts's
// request()), which an anonymous visitor never has. Same plain-fetch-
// against-NEXT_PUBLIC_API_BASE_URL pattern devlog/page.tsx already uses for
// its own public route. Password-protected share links attach the unlock
// token as a custom header (not a cookie) — the browser can't reliably
// send/receive a cookie cross-origin here anyway (see main.py's
// _require_unlocked_share_link doc comment: CORS runs with
// allow_credentials=False, and the cookie is SameSite=Lax).
const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL!;

async function handle<T>(resPromise: Promise<Response>): Promise<T> {
  const res = await resPromise;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = text || res.statusText;
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed?.detail === "string") message = parsed.detail;
    } catch {
      // not JSON, keep raw text
    }
    throw new ApiError(res.status, message);
  }
  return res.json();
}

function unlockHeaders(unlockToken: string | null): Record<string, string> {
  return unlockToken ? { "X-Share-Unlock": unlockToken } : {};
}

export const publicPreviewApi = {
  fetchVideoPreview: (token: string, unlockToken: string | null) =>
    handle<SharedVideoPreviewData>(
      fetch(`${BASE_URL}/share/${token}/video-preview`, { headers: unlockHeaders(unlockToken) })
    ),

  unlock: (token: string, password: string) =>
    handle<{ unlock_token: string }>(
      fetch(`${BASE_URL}/share/${token}/unlock-json`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })
    ),

  postComment: (
    token: string, unlockToken: string | null,
    versionId: string, timestampSeconds: number, comment: string, parentCommentId: string | null, authorName: string
  ) =>
    handle<VideoComment>(
      fetch(`${BASE_URL}/share/${token}/video-comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...unlockHeaders(unlockToken) },
        body: JSON.stringify({
          version_id: versionId, timestamp_seconds: timestampSeconds, comment,
          parent_comment_id: parentCommentId, author_name: authorName,
        }),
      })
    ),

  // 2026-07-21 — can now come back as {status:"processing"} instead of a
  // URL when the video's Wasserzeichen-Switch is on and the watermarked
  // copy isn't encoded yet (backend kicks off generation on first request);
  // VideoReviewModal.tsx's downloadCurrentVideo polls until it flips to
  // {url, status:"ready"}.
  getDownloadUrl: (token: string, unlockToken: string | null, versionId: string) =>
    handle<{ url: string; status: "ready" } | { status: "processing" }>(
      fetch(`${BASE_URL}/share/${token}/video-versions/${versionId}/download-url`, { headers: unlockHeaders(unlockToken) })
    ),

  submitFeedback: (token: string, unlockToken: string | null, versionId: string) =>
    handle<{ ok: boolean }>(
      fetch(`${BASE_URL}/share/${token}/video-versions/${versionId}/submit-feedback-json`, {
        method: "POST",
        headers: unlockHeaders(unlockToken),
      })
    ).then(() => undefined),

  deleteComment: (token: string, unlockToken: string | null, commentId: string) =>
    fetch(`${BASE_URL}/share/${token}/video-comments/${commentId}`, {
      method: "DELETE",
      headers: unlockHeaders(unlockToken),
    }).then(async (res) => {
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        let message = text || res.statusText;
        try {
          const parsed = JSON.parse(text);
          if (typeof parsed?.detail === "string") message = parsed.detail;
        } catch {
          // not JSON
        }
        throw new ApiError(res.status, message);
      }
    }),

  // 2026-07-28 — Lino: "auch die Personen von der Preview-Seite direkt
  // korrigieren" können; kein Upload/Download hier (nur der Backend-Autor
  // der Postproduction lädt/exportiert die SRT), nur Lesen + Text-Korrektur.
  listSubtitles: (token: string, unlockToken: string | null, versionId: string) =>
    handle<SubtitlesData>(
      fetch(`${BASE_URL}/share/${token}/video-versions/${versionId}/subtitles`, { headers: unlockHeaders(unlockToken) })
    ),

  // Korrigiert eine Original-Zeile (text-only, siehe api.ts's eigenes
  // patchSubtitleSegment).
  patchSubtitleSegment: (token: string, unlockToken: string | null, segmentId: string, text: string) =>
    handle<SubtitleSegment>(
      fetch(`${BASE_URL}/share/${token}/subtitle-segments/${segmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...unlockHeaders(unlockToken) },
        body: JSON.stringify({ text }),
      })
    ),

  // 2026-08-08: Korrektur EINES Sprach-Cues über dessen eigene id (siehe
  // api.ts's eigenes patchSubtitleTranslation) — Preview-Besucher können so
  // jede bereits vorhandene Sprache einzeln korrigieren, ohne andere
  // Sprachen zu berühren.
  patchSubtitleTranslation: (token: string, unlockToken: string | null, translationId: string, text: string) =>
    handle<SubtitleTranslationCue>(
      fetch(`${BASE_URL}/share/${token}/subtitle-translations/${translationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...unlockHeaders(unlockToken) },
        body: JSON.stringify({ text }),
      })
    ),
};
