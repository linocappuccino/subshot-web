import type { SharedIdeasPreviewData, IdeaFeedback, IdeaFeedbackSendResult, Annotation } from "./types";
import { ApiError } from "./api";

// 2026-07-21 (#262) — the public no-login "Ideen-Preview" page's own tiny
// API client, same reasoning/shape as lib/publicPreviewApi.ts (#254, video):
// deliberately NOT createApiClient/useApi() (hard-requires a Clerk Bearer
// token, throws before the request even fires for a signed-out visitor).
// `unlock()` itself isn't duplicated here — POST /share/{token}/unlock-json
// is generic to any ShareLink.kind, so preview-ideas/[token]/page.tsx just
// imports publicPreviewApi.unlock directly rather than this file
// re-exporting an identical wrapper around the same endpoint.
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

export const publicIdeasPreviewApi = {
  fetchIdeasPreview: (token: string, unlockToken: string | null) =>
    handle<SharedIdeasPreviewData>(
      fetch(`${BASE_URL}/share/${token}/ideas-preview`, { headers: unlockHeaders(unlockToken) })
    ),

  // "Feedback speichern" — always inserts a fresh 'draft' row (never
  // upserts), still editable/deletable afterward via deleteFeedback below.
  saveFeedback: (token: string, unlockToken: string | null, ideaId: string, authorName: string, comment: string) =>
    handle<IdeaFeedback>(
      fetch(`${BASE_URL}/share/${token}/ideas/${ideaId}/feedback-json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...unlockHeaders(unlockToken) },
        body: JSON.stringify({ author_name: authorName, comment }),
      })
    ),

  // "Feedback senden" — locks the round: promotes every draft under this
  // author name to 'sent' (plus one new 'sent' row if `comment` is
  // non-empty), bumps feedback_round once. Returns the idea's whole
  // refreshed feedback list, not just a delta.
  sendFeedback: (token: string, unlockToken: string | null, ideaId: string, authorName: string, comment: string) =>
    handle<IdeaFeedbackSendResult>(
      fetch(`${BASE_URL}/share/${token}/ideas/${ideaId}/feedback/send-json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...unlockHeaders(unlockToken) },
        body: JSON.stringify({ author_name: authorName, comment }),
      })
    ),

  // Draft rows only (backend 404s on anything else) — no ownership check
  // either client or server side, see delete_share_idea_feedback_json's
  // own doc comment; the page gates the "×" button purely on
  // status==='draft', regardless of who wrote it.
  deleteFeedback: (token: string, unlockToken: string | null, ideaId: string, feedbackId: string) =>
    fetch(`${BASE_URL}/share/${token}/ideas/${ideaId}/feedback/${feedbackId}`, {
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

  // Text-highlight annotations (2026-07-21, #268 follow-up — same generic
  // GET/POST/delete /share/{token}/annotations the Szenen-Preview page's
  // own publicScenesPreviewApi already uses, just passing idea_id instead
  // of scene_id when creating. Not duplicated into a shared file since
  // each preview page's api client only ever talks to ITS OWN preview
  // endpoints plus this one generic one — same reasoning as why `unlock()`
  // isn't re-exported here either (see this file's own header comment).
  fetchAnnotations: (token: string, unlockToken: string | null) =>
    handle<Annotation[]>(
      fetch(`${BASE_URL}/share/${token}/annotations`, { headers: unlockHeaders(unlockToken) })
    ),

  // field mirrors PublicIdeaLightbox's own data-field values ("idea.title"
  // | "idea.text") — kind is always "highlight" (pen/freehand was never
  // built for ideas either, same scope decision as #268 made for scenes).
  createAnnotation: (
    token: string, unlockToken: string | null,
    ideaId: string, authorName: string, field: string, text: string, comment: string
  ) =>
    handle<Annotation>(
      fetch(`${BASE_URL}/share/${token}/annotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...unlockHeaders(unlockToken) },
        body: JSON.stringify({
          idea_id: ideaId, author_name: authorName, kind: "highlight",
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
};
