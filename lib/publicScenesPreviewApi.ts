import type { ScenesPreviewData, Annotation, SceneCommentSendResult } from "./types";
import { ApiError } from "./api";

// 2026-07-21 (#268) — the public no-login "Szenenpreview" (storyboard)
// page's own tiny API client, same reasoning/shape as
// lib/publicIdeasPreviewApi.ts (#262): deliberately NOT createApiClient/
// useApi() (hard-requires a Clerk Bearer token, throws before the request
// even fires for a signed-out visitor). `unlock()` itself isn't duplicated
// here — POST /share/{token}/unlock-json is generic to any ShareLink.kind,
// see publicPreviewApi.unlock, imported directly by
// app/preview-scenes/[token]/page.tsx instead of re-exporting an identical
// wrapper around the same endpoint.
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

export const publicScenesPreviewApi = {
  fetchScenesPreview: (token: string, unlockToken: string | null) =>
    handle<ScenesPreviewData>(
      fetch(`${BASE_URL}/share/${token}/scenes-preview`, { headers: unlockHeaders(unlockToken) })
    ),

  // Every highlight (and any pre-existing pen, filtered out client-side —
  // see ScenesPreviewData's own doc comment) annotation for the whole
  // project — same generic GET /share/{token}/annotations the authenticated
  // app's own AnnotationsPanel uses, no scenes-preview-specific endpoint
  // needed.
  fetchAnnotations: (token: string, unlockToken: string | null) =>
    handle<Annotation[]>(
      fetch(`${BASE_URL}/share/${token}/annotations`, { headers: unlockHeaders(unlockToken) })
    ),

  // Text-highlight creation — kind is always "highlight" from this page
  // (Lino: pen/freehand drawing dropped from this rebuild entirely, see
  // ScenesPreviewData's doc comment), field mirrors share_view.py's
  // data-field values ("name" | "description" | "dialogue") exactly so
  // existing pre-#268 annotations in the DB stay compatible with new ones.
  createAnnotation: (
    token: string, unlockToken: string | null,
    sceneId: string, authorName: string, field: string, text: string, comment: string
  ) =>
    handle<Annotation>(
      fetch(`${BASE_URL}/share/${token}/annotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...unlockHeaders(unlockToken) },
        body: JSON.stringify({
          scene_id: sceneId, author_name: authorName, kind: "highlight",
          field, text, comment,
        }),
      })
    ),

  // No ownership check client OR server side beyond UX affordance (see
  // ShareAnnotationDelete's own doc comment on the backend) — the button is
  // always shown, a mismatched typed name just 403s.
  deleteAnnotation: (token: string, unlockToken: string | null, annotationId: string, authorName: string) =>
    fetch(`${BASE_URL}/share/${token}/annotations/${annotationId}/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...unlockHeaders(unlockToken) },
      body: JSON.stringify({ author_name: authorName }),
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

  // 2026-07-27 — plain (non-highlighted) scene comments, same draft/send
  // shape as lib/publicIdeasPreviewApi.ts's saveFeedback/sendFeedback.
  saveComment: (token: string, unlockToken: string | null, sceneId: string, authorName: string, comment: string) =>
    handle<Annotation>(
      fetch(`${BASE_URL}/share/${token}/scenes/${sceneId}/comment-json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...unlockHeaders(unlockToken) },
        body: JSON.stringify({ author_name: authorName, comment }),
      })
    ),

  sendComment: (token: string, unlockToken: string | null, sceneId: string, authorName: string, comment: string) =>
    handle<SceneCommentSendResult>(
      fetch(`${BASE_URL}/share/${token}/scenes/${sceneId}/comment/send-json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...unlockHeaders(unlockToken) },
        body: JSON.stringify({ author_name: authorName, comment }),
      })
    ),

  deleteComment: (token: string, unlockToken: string | null, sceneId: string, commentId: string) =>
    fetch(`${BASE_URL}/share/${token}/scenes/${sceneId}/comment/${commentId}`, {
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

  // 2026-08-31, Todoist #96 — Section counterpart to saveComment/
  // sendComment/deleteComment above, same draft/send/delete shape, just
  // scoped to a whole Section ("Skript"/Shotlist) instead of one scene.
  saveSectionComment: (token: string, unlockToken: string | null, sectionId: string, authorName: string, comment: string) =>
    handle<Annotation>(
      fetch(`${BASE_URL}/share/${token}/sections/${sectionId}/comment-json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...unlockHeaders(unlockToken) },
        body: JSON.stringify({ author_name: authorName, comment }),
      })
    ),

  sendSectionComment: (token: string, unlockToken: string | null, sectionId: string, authorName: string, comment: string) =>
    handle<SceneCommentSendResult>(
      fetch(`${BASE_URL}/share/${token}/sections/${sectionId}/comment/send-json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...unlockHeaders(unlockToken) },
        body: JSON.stringify({ author_name: authorName, comment }),
      })
    ),

  deleteSectionComment: (token: string, unlockToken: string | null, sectionId: string, commentId: string) =>
    fetch(`${BASE_URL}/share/${token}/sections/${sectionId}/comment/${commentId}`, {
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

  // Static map thumbnail for a scene's location — see GET
  // /share/{token}/static-map's own doc comment. 404s (no map available)
  // are left to the caller to swallow, same "just show the address text"
  // fallback the old share_view.py page already used when no coordinates
  // were set.
  fetchStaticMapBlobUrl: async (token: string, unlockToken: string | null, lat: number, lng: number): Promise<string> => {
    const res = await fetch(`${BASE_URL}/share/${token}/static-map?lat=${lat}&lng=${lng}`, { headers: unlockHeaders(unlockToken) });
    if (!res.ok) throw new ApiError(res.status, res.statusText);
    return URL.createObjectURL(await res.blob());
  },
};
