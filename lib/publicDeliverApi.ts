import type { DeliverPreviewData } from "./types";
import { ApiError } from "./api";

// Public no-login "Deliver" page's own tiny API client — same
// deliberately-not-createApiClient/useApi() reasoning as
// lib/publicPreviewApi.ts/publicScenesPreviewApi.ts (those hard-require a
// Clerk Bearer token, which an anonymous recipient never has). unlock()
// itself isn't duplicated here — POST /share/{token}/unlock-json is generic
// to any ShareLink.kind, see publicPreviewApi.unlock.
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

export const publicDeliverApi = {
  fetchDeliverPreview: (token: string, unlockToken: string | null) =>
    handle<DeliverPreviewData>(fetch(`${BASE_URL}/share/${token}/deliver-preview`, { headers: unlockHeaders(unlockToken) })),

  getDownloadUrl: (token: string, unlockToken: string | null, versionId: string) =>
    handle<{ url: string }>(
      fetch(`${BASE_URL}/share/${token}/deliver/${versionId}/download-url`, { headers: unlockHeaders(unlockToken) })
    ),

  // Used by the "Alles herunterladen (ZIP)" button — one presigned URL per
  // eligible video in a single round trip, so the client can fetch+zip
  // (client-zip) without ever routing the video bytes through this API.
  getDownloadAllUrls: (token: string, unlockToken: string | null) =>
    handle<{ files: { filename: string; url: string }[] }>(
      fetch(`${BASE_URL}/share/${token}/deliver/download-all-urls`, { headers: unlockHeaders(unlockToken) })
    ),
};
