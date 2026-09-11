import type {
  Annotation,
  DeliverStatus,
  DeliverLink,
  Idea,
  IdeaFeedback,
  IdeaImage,
  Invite,
  InvitePreview,
  Me,
  MePatch,
  Member,
  InfoMember,
  SubtitlesData,
  SubtitleSegment,
  SubtitleTranslationCue,
  Feedback,
  FeedbackAdmin,
  Notification,
  NotionDatabase,
  PostproductionStatus,
  Project,
  ProjectDetail,
  ProjectFolder,
  Scene,
  SceneDialogue,
  SceneMarker,
  Section,
  SeatPrice,
  TeamStorageUsage,
  Shot,
  Team,
  TeamInvitePreview,
  TeamMember,
  TeamRole,
  TodoItem,
  TodoList,
  TodoSidebarData,
  Video,
  VideoComment,
  VideoVersion,
} from "./types";

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL!;

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

// 2026-08-05, Lino: "jegliche transitions oder ladezeiten von neuen seiten
// etc. viel schneller werden" — measured with a real Playwright pass
// against production first (per this project's own "debug before
// assuming a bug" rule): the actual page load event was already fast
// (~300-800ms), but every navigation fired 20-40+ backend requests, with
// the SAME endpoint (me, teams/mine, projects/{id}/members, ...) hit 2-3
// times each — every component that needs "the current user"/"my team"
// etc. calls useApi() independently via its own useMemo, and this
// request() had zero caching/dedup, so N components mounting together on
// one page navigation meant N redundant round trips to the same URL. This
// module-level cache is the single choke point every endpoint method
// already funnels through, so fixing it here covers the whole app without
// touching ~30 call sites individually. GET-only (a write must never
// return stale cached data), keyed on the exact path+query string, and
// deliberately SHORT-lived (4s) — long enough to collapse a page-mount
// burst (everything mounts within the same tick or two), far shorter than
// every poll interval already in the app (NotificationBell/TodoSidebar
// both poll every 12-20s), so no poller ever serves data staler than it
// already tolerates. Caches the in-flight PROMISE, not just the resolved
// value, so concurrent callers during the same round trip share the one
// real fetch instead of each starting their own.
const GET_CACHE_TTL_MS = 4000;
const getRequestCache = new Map<string, { promise: Promise<unknown>; timestamp: number }>();

// 2026-09-08 (security audit finding, MEDIUM) — this cache used to be keyed
// on the bare path ("me", "projects", ...) with no per-user scoping at all.
// Module state (getRequestCache) persists across a client-side Clerk
// sign-out + a DIFFERENT sign-in in the same tab (no full page reload
// forces a fresh module instance) — a request to an identical path within
// the 4s TTL window right after that switch could silently return the
// PREVIOUS user's cached response (their `me()` profile, their project
// list) to the new session. Every cache key now carries the acting user's
// id as a prefix; `keyFor`/`pathOfKey` are the only two places that need
// to know the "userId::path" shape, so the invalidation helpers below stay
// path-only from every existing call site's point of view.
function keyFor(userId: string | null | undefined, path: string): string {
  return `${userId ?? "anon"}::${path}`;
}
function pathOfKey(key: string): string {
  const i = key.indexOf("::");
  return i === -1 ? key : key.slice(i + 2);
}

/** 2026-08-07, Lino: "der status... muss sich sofort ändern" — real bug
 * found live testing that fix: a caller that KNOWS the server just changed
 * (e.g. resolving a comment can flip a section's postproduction_status
 * server-side, see _maybe_revert_to_wartet_auf_feedback in main.py) and
 * immediately re-fetches to pick up that change can land inside the SAME
 * 4s cache window as an earlier, now-stale GET to that exact path — the
 * "fresh" re-fetch silently returns the OLD cached promise/response,
 * captured before the write, and the UI never updates without a real page
 * reload once the window naturally expires. Evicting the entry first
 * guarantees the very next `request()` call for this path is a real
 * network round trip. Exported at module scope (not per-createApiClient
 * instance) since the cache itself is module-level too. */
export function invalidateGetCache(path: string) {
  for (const key of getRequestCache.keys()) {
    if (pathOfKey(key) === path) getRequestCache.delete(key);
  }
}

/** 2026-08-25, Lino: "projekte tauchen immer wieder auf die entweder gelöscht
 * wurden oder aus irgendeinem grund nicht angezeigt wurden" — the exact same
 * root cause as invalidateGetCache's own 2026-08-07 fix above, just never
 * applied to the projects/folders LIST endpoints: deleteProject/createProject/
 * patchProject/moveProject (and the folder equivalents) never invalidated
 * anything, so a `projects()`/`folders()` re-fetch within the 4s GET_CACHE_TTL_MS
 * window after ANY of those writes silently returned the pre-write list — a
 * just-deleted project still showing, a just-created one missing, a rename/
 * folder-move/module-toggle not reflected.
 *
 * Deliberately NOT a blanket "invalidate everything starting with projects/"
 * — dozens of nested-resource writes live under that same prefix (scenes,
 * shots, sections, members, ideas, todo-lists, ...), and Lino's SAME message
 * also asked for the app to be faster; blindly busting every OTHER cached
 * project's detail cache (and every unrelated nested list) on every single
 * shot/scene/member write would undermine that. Matched narrowly instead —
 * only the handful of writes that can actually change what a LIST shows:
 * create/delete/rename/move/module-toggle on the project or folder itself. */
const PROJECT_LIST_MUTATION_RE = /^projects(?:\/([^/?]+)(?:\/move)?)?$/;
const FOLDER_LIST_MUTATION_RE = /^folders(?:\/([^/?]+)(?:\/(?:move|image))?)?$/;

function invalidateListCachesFor(path: string) {
  const projectMatch = path.match(PROJECT_LIST_MUTATION_RE);
  if (projectMatch) {
    for (const key of getRequestCache.keys()) {
      const p = pathOfKey(key);
      if (p === "projects" || p.startsWith("projects?")) getRequestCache.delete(key);
    }
    if (projectMatch[1]) invalidateGetCache(`projects/${projectMatch[1]}`);
    return;
  }
  const folderMatch = path.match(FOLDER_LIST_MUTATION_RE);
  if (folderMatch) {
    for (const key of getRequestCache.keys()) {
      const p = pathOfKey(key);
      if (p === "folders" || p.startsWith("folders?")) getRequestCache.delete(key);
    }
    if (folderMatch[1]) invalidateGetCache(`folders/${folderMatch[1]}`);
  }
}

/** Same shape as the iOS APIClient: one authorizedRequest-style fetch
 * wrapper, all endpoint methods built on top of it. `getToken` is Clerk's
 * useAuth().getToken, injected by useApi() rather than imported directly so
 * this file has no hard dependency on being called from a Client Component. */
export function createApiClient(getToken: () => Promise<string | null>, userId?: string | null) {
  async function doRequest<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await getToken();
    if (!token) throw new ApiError(401, "Nicht angemeldet.");
    const res = await fetch(`${BASE_URL}/${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // FastAPI's default error shape is {"detail": "..."} (and the trial
      // gate's own 402 adds {"error": "trial_expired", ...} on top of that)
      // — every ApiError.message used to be the raw JSON text itself
      // (`{"detail":"Requires at least 'editor' role"}`) instead of the
      // actual message, shown as-is in every toast across the app. Parse it
      // out here once, centrally, instead of at each of the ~30 call sites.
      let message = text || res.statusText;
      let code: string | undefined;
      if (text) {
        try {
          const parsed = JSON.parse(text);
          if (typeof parsed?.detail === "string") message = parsed.detail;
          if (typeof parsed?.error === "string") code = parsed.error;
        } catch {
          // Not JSON (e.g. a plain-text 502 from the proxy) — keep the raw text.
        }
      }
      if (code === "trial_expired" && typeof window !== "undefined") {
        // One shared dialog (see TrialExpiredDialog) instead of a toast per
        // failed request — the trial gate blocks EVERY write, and with
        // fields like LocationPicker firing one PATCH per keystroke, a toast
        // here would mean a new one appearing on every character typed.
        window.dispatchEvent(new CustomEvent("subshot:trial-expired", { detail: message }));
      }
      // 2026-07-16, same shared-dialog-not-toast pattern as trial_expired
      // above — see InsufficientCreditsDialog + generate_scene_image_endpoint's
      // matching JSONResponse shape.
      if (code === "insufficient_credits" && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("subshot:insufficient-credits", { detail: message }));
      }
      throw new ApiError(res.status, message, code);
    }
    if (res.status === 204) return undefined as T;
    return res.json();
  }

  /** Every endpoint method below calls this, not doRequest directly — GET
   * requests are deduped/cached (see GET_CACHE_TTL_MS's own doc comment),
   * everything else (POST/PATCH/DELETE) always hits the network. */
  function request<T>(path: string, init?: RequestInit): Promise<T> {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method !== "GET") {
      const result = doRequest<T>(path, init);
      result.then(() => invalidateListCachesFor(path)).catch(() => {});
      return result;
    }
    const key = keyFor(userId, path);
    const cached = getRequestCache.get(key);
    if (cached && Date.now() - cached.timestamp < GET_CACHE_TTL_MS) {
      return cached.promise as Promise<T>;
    }
    const promise = doRequest<T>(path, init);
    getRequestCache.set(key, { promise, timestamp: Date.now() });
    // A failed request must not keep being replayed to every caller for
    // the rest of the TTL window — drop it immediately so the next caller
    // gets a fresh attempt instead of the same cached rejection.
    promise.catch(() => getRequestCache.delete(key));
    return promise;
  }

  return {
    me: () => request<Me>("me"),
    patchMe: (body: MePatch) =>
      request<Me>("me", { method: "PATCH", body: JSON.stringify(body) }),
    knownCollaborators: () => request<Member[]>("me/known-collaborators"),
    todoSidebar: () => request<TodoSidebarData>("me/todo-sidebar"),
    notifications: (unreadOnly = true) => request<Notification[]>(`me/notifications?unread_only=${unreadOnly}`),
    markNotificationRead: (id: string) => request<Notification>(`me/notifications/${id}/read`, { method: "POST" }),
    markAllNotificationsRead: () => request<void>("me/notifications/read-all", { method: "POST" }),

    // ── Folders ──────────────────────────────────────────────────────────
    folders: (parentFolderId?: string) =>
      request<ProjectFolder[]>(`folders${parentFolderId ? `?parent_folder_id=${parentFolderId}` : ""}`),
    folder: (id: string) => request<ProjectFolder>(`folders/${id}`),
    createFolder: (name: string, color?: string, emoji?: string, sortOrder = 0, parentFolderId?: string) =>
      request<ProjectFolder>("folders", {
        method: "POST",
        body: JSON.stringify({ name, color, emoji, sort_order: sortOrder, parent_folder_id: parentFolderId }),
      }),
    patchFolder: (
      id: string,
      body: Partial<{
        name: string;
        color: string;
        emoji: string | null;
        sort_order: number;
        clear_background_image: boolean;
        parent_folder_id: string | null;
      }>
    ) => {
      const { emoji, parent_folder_id, ...rest } = body;
      return request<ProjectFolder>(`folders/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...rest,
          emoji: emoji ?? undefined,
          clear_emoji: emoji === null,
          parent_folder_id: parent_folder_id ?? undefined,
          clear_parent_folder: parent_folder_id === null,
        }),
      });
    },
    deleteFolder: (id: string) => request<void>(`folders/${id}`, { method: "DELETE" }),
    moveFolder: (id: string, beforeFolderId: string | null) =>
      request<ProjectFolder>(`folders/${id}/move`, { method: "POST", body: JSON.stringify({ before_folder_id: beforeFolderId }) }),
    uploadFolderImage: (id: string, file: File) => {
      const form = new FormData();
      form.append("file", file);
      return request<ProjectFolder>(`folders/${id}/image`, { method: "POST", body: form });
    },

    // ── Projects ─────────────────────────────────────────────────────────
    projects: (folderId?: string) =>
      request<Project[]>(`projects${folderId ? `?folder_id=${folderId}` : ""}`),
    createProject: (
      name: string,
      color?: string,
      emoji?: string,
      modules?: Partial<{
        module_concept: boolean;
        module_scripting: boolean;
        module_postproduction: boolean;
      }>,
      clientName?: string | null
    ) => request<Project>("projects", { method: "POST", body: JSON.stringify({ name, color, emoji, client_name: clientName || undefined, ...modules }) }),
    projectDetail: (id: string) => request<ProjectDetail>(`projects/${id}`),
    patchProject: (
      id: string,
      body: Partial<{
        name: string;
        color: string;
        emoji: string | null;
        shoot_date: string | null;
        location_address: string | null;
        location_lat: number | null;
        location_lng: number | null;
        client_name: string | null;
        description: string | null;
        folder_id: string | null;
        team_id: string | null;
        module_concept: boolean;
        module_scripting: boolean;
        module_postproduction: boolean;
      }>
    ) => {
      const { emoji, folder_id, team_id, location_address, description, ...rest } = body;
      return request<Project>(`projects/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...rest,
          emoji: emoji ?? undefined,
          clear_emoji: emoji === null,
          folder_id: folder_id ?? undefined,
          clear_folder: folder_id === null,
          team_id: team_id ?? undefined,
          clear_team: team_id === null,
          // null means "the user cleared this field" — the backend can't
          // tell that apart from "field omitted" otherwise (both parse to
          // None), see clear_location/clear_description on ProjectPatch.
          location_address: location_address ?? undefined,
          clear_location: location_address === null,
          description: description ?? undefined,
          clear_description: description === null,
        }),
      });
    },
    deleteProject: (id: string) => request<void>(`projects/${id}`, { method: "DELETE" }),
    moveProject: (id: string, beforeProjectId: string | null) =>
      request<Project>(`projects/${id}/move`, { method: "POST", body: JSON.stringify({ before_project_id: beforeProjectId }) }),
    projectPdfUrl: async (id: string, view: "cards" | "table" | "ideas" = "cards") => {
      // Downloaded (not just linked) because the endpoint needs the same
      // Bearer auth as everything else — a plain <a href> can't attach one.
      const token = await getToken();
      if (!token) throw new ApiError(401, "Nicht angemeldet.");
      const res = await fetch(`${BASE_URL}/projects/${id}/pdf?view=${view}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => res.statusText));
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    },
    // password/clearPassword both optional — omitting both leaves whatever
    // password an existing link already had untouched (see backend
    // ShareLinkCreate), so re-opening the share modal without touching the
    // password fields can't silently wipe one that was set earlier.
    // `kind` (2026-07-16): a project can have one live "storyboard" link
    // AND, separately, one live "ideas" link (Planungssektor) at once —
    // see backend ShareLink.kind.
    shareLink: (projectId: string, password?: string, clearPassword?: boolean, kind: "storyboard" | "ideas" | "video" = "storyboard") =>
      request<{ url: string; expires_at: string; has_password: boolean }>(`projects/${projectId}/share-link`, {
        method: "POST",
        body: JSON.stringify({ password: password || null, clear_password: !!clearPassword, kind }),
      }),

    // ── Deliver (2026-09-06) ─────────────────────────────────────────────
    deliverStatus: (projectId: string) => request<DeliverStatus>(`projects/${projectId}/deliver`),
    createOrUpdateDeliverLink: (
      projectId: string,
      body: { duration_hours: number; password?: string; clear_password?: boolean; cover_video_version_id?: string | null; clear_cover?: boolean }
    ) =>
      request<DeliverLink>(`projects/${projectId}/deliver-link`, {
        method: "POST",
        body: JSON.stringify({
          duration_hours: body.duration_hours,
          password: body.password || null,
          clear_password: !!body.clear_password,
          cover_video_version_id: body.cover_video_version_id ?? null,
          clear_cover: !!body.clear_cover,
        }),
      }),
    revokeDeliverLink: (projectId: string) => request<void>(`projects/${projectId}/deliver-link`, { method: "DELETE" }),

    // ── Scenes ───────────────────────────────────────────────────────────
    createScene: (projectId: string, body: Record<string, unknown>) =>
      request<Scene>(`projects/${projectId}/scenes`, { method: "POST", body: JSON.stringify(body) }),
    patchScene: (id: string, body: Record<string, unknown>) =>
      request<Scene>(`scenes/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    deleteScene: (id: string) => request<void>(`scenes/${id}`, { method: "DELETE" }),
    duplicateScene: (id: string) => request<Scene>(`scenes/${id}/duplicate`, { method: "POST" }),
    listAnnotations: (projectId: string) => request<Annotation[]>(`projects/${projectId}/annotations`),
    patchAnnotation: (id: string, status: "open" | "resolved" | "rejected") =>
      request<Annotation>(`annotations/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    // 2026-09-08, Lino: "als admin muss man kommentare auch löschen können
    // egal was für einen status sie haben" — AnnotationsPanel only had
    // resolve/reject/reopen before, never delete, for ANY status.
    deleteAnnotation: (id: string) => request<void>(`annotations/${id}`, { method: "DELETE" }),
    moveScene: (id: string, beforeSceneId: string | null) =>
      request<Scene>(`scenes/${id}/move`, { method: "POST", body: JSON.stringify({ before_scene_id: beforeSceneId }) }),
    reorderScenes: (projectId: string, sectionId: string | null, orderedSceneIds: string[]) =>
      request<Scene[]>(`projects/${projectId}/scenes/reorder`, {
        method: "POST",
        body: JSON.stringify({ section_id: sectionId, ordered_scene_ids: orderedSceneIds }),
      }),
    // 2026-09-09 — independent "Shot-Reihenfolge" view (see Scene.shooting_order's
    // own doc comment): whole scene blocks within one Section reordered for the
    // shooting-day schedule, separate from reorderScenes' narrative sort_order.
    // Supersedes the 2026-09-07 shot-level attempt (reorderShotsShootingOrder).
    reorderScenesShootingOrder: (sectionId: string, orderedSceneIds: string[]) =>
      request<Scene[]>(`sections/${sectionId}/scenes/reorder-shooting-order`, {
        method: "POST",
        body: JSON.stringify({ ordered_scene_ids: orderedSceneIds }),
      }),
    uploadSceneImage: (id: string, file: File) => {
      const form = new FormData();
      form.append("file", file);
      return request<Scene>(`scenes/${id}/image`, { method: "POST", body: form });
    },
    // Fire-and-forget (2026-07-15) — backend returns 202 immediately and
    // generates in the background; the scene's image_url shows up via the
    // existing 12s poll once it's done, whether or not this modal/tab is
    // still open by then. See generate_scene_image_endpoint's own comment.
    generateSceneImage: (id: string, style: "realistic" | "sketch" | "funny_sketch", aspectRatio: "16:9" | "9:16", prompt?: string) =>
      request<{ status: string }>(`scenes/${id}/generate-image`, {
        method: "POST",
        body: JSON.stringify({ style, aspect_ratio: aspectRatio, prompt }),
      }),

    // ── AI Credits (2026-07-16) ─────────────────────────────────────────
    // Credits only, never CHF/Rappen in this app's own UI (Lino) — the
    // Rappen amount only ever reaches Stripe's own checkout page via
    // creditCheckout, which the user is handed off to.
    creditBalance: () => request<{ balance: number }>("credits/balance"),
    creditCheckout: (credits: number) =>
      request<{ url: string }>("credits/checkout", { method: "POST", body: JSON.stringify({ credits }) }),

    addDialogue: (sceneId: string, text: string, sortOrder = 0) =>
      request<SceneDialogue>(`scenes/${sceneId}/dialogues`, {
        method: "POST",
        body: JSON.stringify({ text, sort_order: sortOrder }),
      }),
    patchDialogue: (id: string, body: { text?: string; done?: boolean }) =>
      request<SceneDialogue>(`dialogues/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    deleteDialogue: (id: string) => request<void>(`dialogues/${id}`, { method: "DELETE" }),

    // ── Shots ────────────────────────────────────────────────────────────
    createShot: (projectId: string, body: Record<string, unknown>) =>
      request<Shot>(`projects/${projectId}/shots`, { method: "POST", body: JSON.stringify(body) }),
    patchShot: (id: string, body: Record<string, unknown>) =>
      request<Shot>(`shots/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    deleteShot: (id: string) => request<void>(`shots/${id}`, { method: "DELETE" }),
    moveShot: (id: string, beforeShotId: string | null) =>
      request<Shot>(`shots/${id}/move`, { method: "POST", body: JSON.stringify({ before_shot_id: beforeShotId }) }),
    uploadShotImage: (id: string, file: File) => {
      const form = new FormData();
      form.append("file", file);
      return request<Shot>(`shots/${id}/image`, { method: "POST", body: form });
    },

    // ── Sections ─────────────────────────────────────────────────────────
    createSection: (projectId: string, name: string, sortOrder = 0, startInPostproduction = false) =>
      request<Section>(`projects/${projectId}/sections`, {
        method: "POST",
        body: JSON.stringify({ name, sort_order: sortOrder, start_in_postproduction: startInPostproduction }),
      }),
    patchSection: (
      id: string,
      body: Partial<{
        name: string; sort_order: number;
        shoot_date: string | null; location_address: string | null; location_lat: number | null; location_lng: number | null;
        client_name: string | null;
        description: string | null;
        add_project_info: boolean; remove_project_info: boolean;
        clear_thumbnail: boolean;
      }>
    ) => {
      const { location_address, description, ...rest } = body;
      return request<Section>(`sections/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...rest,
          // null means "the user cleared this field", see patchProject's
          // identical clear_location/clear_description handling.
          location_address: location_address ?? undefined,
          clear_location: location_address === null,
          description: description ?? undefined,
          clear_description: description === null,
        }),
      });
    },
    // 2026-09-11 — manual shotlist-tile cover, see Section.thumbnail_url's
    // own doc comment. Same upload shape as uploadSceneImage above.
    uploadSectionThumbnail: (id: string, file: File) => {
      const form = new FormData();
      form.append("file", file);
      return request<Section>(`sections/${id}/thumbnail`, { method: "POST", body: form });
    },
    deleteSection: (id: string) => request<void>(`sections/${id}`, { method: "DELETE" }),
    moveSection: (id: string, beforeSectionId: string | null) =>
      request<Section>(`sections/${id}/move`, { method: "POST", body: JSON.stringify({ before_section_id: beforeSectionId }) }),
    sendSectionToPostproduction: (id: string) =>
      request<Section>(`sections/${id}/send-to-postproduction`, { method: "POST" }),
    // 2026-08-31 — shared Mark-Clip timecode session (fps + camera-sync
    // offset), see Section.timecode_fps's own doc comment (models.py).
    // `fps: null` clears it (stop/reset).
    patchSectionTimecode: (id: string, body: { fps: number | null; offset_seconds?: number }) =>
      request<Section>(`sections/${id}/timecode`, { method: "PATCH", body: JSON.stringify(body) }),
    patchSectionPostproduction: (
      id: string,
      body: Partial<{ status: PostproductionStatus; deadline: string | null }>
    ) => {
      const { deadline, ...rest } = body;
      return request<Section>(`sections/${id}/postproduction`, {
        method: "PATCH",
        body: JSON.stringify({ ...rest, deadline: deadline ?? undefined, clear_deadline: deadline === null }),
      });
    },

    // ── Videos (#11 Schritt 7) ───────────────────────────────────────────
    listVideos: (sectionId: string) => request<Video[]>(`sections/${sectionId}/videos`),
    // 2026-08-31 — perf: bulk counterpart used by the Postproduction page
    // to fetch every video in one request instead of one per section (see
    // that page's own doc comment on videosBySection).
    listProjectVideos: (projectId: string) => request<Video[]>(`projects/${projectId}/videos`),
    createVideo: (sectionId: string, title = "Video", sortOrder = 0) =>
      request<Video>(`sections/${sectionId}/videos`, { method: "POST", body: JSON.stringify({ title, sort_order: sortOrder }) }),
    // assignee_id: undefined = don't touch it, null = explicitly unassign
    // (clear_assignee), a string = assign to that member — same "unset vs
    // explicit clear" idiom as patchFolder's parent_folder_id above.
    patchVideo: (id: string, body: Partial<{ title: string; sort_order: number; watermark_enabled: boolean; assignee_id: string | null }>) => {
      const { assignee_id, ...rest } = body;
      return request<Video>(`videos/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...rest, assignee_id: assignee_id ?? undefined, clear_assignee: assignee_id === null }),
      });
    },
    deleteVideo: (id: string) => request<void>(`videos/${id}`, { method: "DELETE" }),
    createVideoVersion: (videoId: string, file: File) =>
      request<VideoVersion>(`videos/${videoId}/versions`, {
        method: "POST",
        body: JSON.stringify({ original_filename: file.name, content_type: file.type || "video/mp4" }),
      }),
    /** Direct browser -> R2 PUT (bypasses this API entirely, see
     * create_video_version's presigned_upload_url) — not routed through
     * `request()`, which always attaches a Subshot Bearer token an
     * external R2 URL neither needs nor accepts.
     * 2026-07-18 (Todoist #201, Lino: "ein Indikator der zeigt wie weit
     * der Upload ist") — plain fetch() has no real upload-progress event
     * for the request body, so this switched to XMLHttpRequest (still the
     * only broadly-supported way to get one) wrapped in a Promise;
     * onProgress is optional so every other caller of this function keeps
     * working unchanged. */
    uploadVideoFile: (presignedPutUrl: string, file: File, onProgress?: (fraction: number) => void) =>
      new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", presignedPutUrl);
        xhr.setRequestHeader("Content-Type", file.type || "video/mp4");
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress?.(e.loaded / e.total);
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new ApiError(xhr.status, "Video-Upload zu R2 fehlgeschlagen."));
        };
        xhr.onerror = () => reject(new ApiError(0, "Video-Upload zu R2 fehlgeschlagen."));
        xhr.send(file);
      }),
    completeVideoVersion: (versionId: string, fileSizeBytes: number, durationSeconds?: number) =>
      request<VideoVersion>(`video-versions/${versionId}/complete`, {
        method: "POST",
        body: JSON.stringify({ file_size_bytes: fileSizeBytes, duration_seconds: durationSeconds ?? null }),
      }),
    deleteVideoVersion: (id: string) => request<void>(`video-versions/${id}`, { method: "DELETE" }),

    // ── Referenz-Video (2026-09-08, moved to per-Section 2026-09-10 — "jede
    // shotlist hat aber ihr eigenes scribble video!") — ein Beispielvideo
    // pro Shotlist, ganz oben abspielbar. Gleicher presign-then-complete
    // Ablauf wie Video-Versionen oben, minus Versionierung. ──────────────
    createReferenceVideo: (sectionId: string, file: File) =>
      request<{ upload_url: string }>(`sections/${sectionId}/reference-video`, {
        method: "POST",
        body: JSON.stringify({ original_filename: file.name, content_type: file.type || "video/mp4" }),
      }),
    completeReferenceVideo: (sectionId: string, durationSeconds?: number) =>
      request<Section>(`sections/${sectionId}/reference-video/complete`, {
        method: "POST",
        body: JSON.stringify({ duration_seconds: durationSeconds ?? null }),
      }),
    deleteReferenceVideo: (sectionId: string) => request<void>(`sections/${sectionId}/reference-video`, { method: "DELETE" }),
    getVideoVersionDownloadUrl: (id: string) =>
      request<{ url: string }>(`video-versions/${id}/download-url`).then((r) => r.url),
    // 2026-07-17: author_name kommt jetzt server-seitig vom eingeloggten
    // User (siehe main.py create_video_comment) — kein Name-Eingabefeld
    // mehr im eingeloggten Review-Modal noetig.
    createVideoComment: (versionId: string, timestampSeconds: number, comment: string, parentCommentId?: string | null) =>
      request<VideoComment>(`video-versions/${versionId}/comments`, {
        method: "POST",
        body: JSON.stringify({ timestamp_seconds: timestampSeconds, comment, parent_comment_id: parentCommentId ?? null }),
      }),
    updateVideoCommentStatus: (id: string, status: "open" | "resolved") =>
      request<VideoComment>(`video-comments/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    deleteVideoComment: (id: string) => request<void>(`video-comments/${id}`, { method: "DELETE" }),

    // ── Untertitel/SRT (2026-07-28) ──────────────────────────────────────
    listSubtitles: (versionId: string) => request<SubtitlesData>(`video-versions/${versionId}/subtitles`),
    // 2026-08-08, Lino (2nd pass — "der button soll einfach nur SRT
    // hochladen sein, das Tool soll bei SRT hochladen die Sprachen auch
    // checken"): EIN Upload-Weg für beliebig viele Files auf einmal — das
    // Backend erkennt pro Datei die Sprache (langdetect) und entscheidet
    // selbst, ob sie das Original ersetzt (gleiche Sprache wie das
    // bisherige Original) oder einen eigenen Sprach-Track anlegt/ersetzt
    // (siehe upload_subtitles' eigener Doc-Kommentar in main.py).
    uploadSubtitles: (versionId: string, files: File[]) => {
      const form = new FormData();
      for (const file of files) form.append("files", file);
      return request<SubtitlesData>(`video-versions/${versionId}/subtitles`, { method: "POST", body: form });
    },
    // Korrigiert GENAU EINE Original-Zeile (siehe SubtitleSegmentPatch im
    // Backend, text-only, Timecodes nie editierbar).
    patchSubtitleSegment: (id: string, text: string) =>
      request<SubtitleSegment>(`subtitle-segments/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ text }),
      }),
    // 2026-08-08: korrigiert GENAU EINEN Cue EINER Sprache, ueber dessen
    // EIGENE id (nicht mehr ueber segmentId+lang, siehe
    // SubtitleTranslation's Doc-Kommentar in models.py — ein Sprach-Track
    // hat jetzt sein eigenes Timing, keine 1:1-Zuordnung mehr zum Original).
    patchSubtitleTranslation: (id: string, text: string) =>
      request<SubtitleTranslationCue>(`subtitle-translations/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ text }),
      }),
    // 2026-07-29, Lino: Übersetzungs-Button — kostenloser Übersetzungsdienst
    // (deep-translator/Google, kein API-Key) läuft komplett im Backend, hier
    // nur der Trigger. 2026-08-07: überschreibt nur noch die eine
    // Zielsprache frisch, jede andere Sprache (mit ihren Korrekturen)
    // bleibt erhalten — immer vom Original übersetzt, nie von einer bereits
    // übersetzten Sprache aus.
    translateSubtitles: (versionId: string, targetLang: string) =>
      request<SubtitlesData>(`video-versions/${versionId}/subtitles/translate`, {
        method: "POST",
        body: JSON.stringify({ target_lang: targetLang }),
      }),
    // Gleiches "Bearer-Auth per fetch statt <a href>" Muster wie projectPdfUrl
    // oben — der Endpunkt braucht denselben Auth wie jeder andere. Kein
    // fps-Parameter mehr (2026-07-28, Lino: "er soll die framerate aus dem
    // video herauslesen") — der Backend-Endpunkt liest sie jetzt selbst
    // per ffprobe direkt aus der Videodatei. 2026-08-08, Lino (3rd pass —
    // "wenn man auf SRT herunterladen drückt sollen immer alle SRTs
    // heruntergeladen werden die... übersetzt oder hochgeladen wurden"):
    // kein `lang`-Parameter mehr — der Endpunkt liefert jetzt immer ein
    // .zip mit JEDEM Track (Original + jede Sprache) statt nur der gerade
    // aktiven Sprache.
    subtitlesDownloadUrl: async (versionId: string) => {
      const token = await getToken();
      if (!token) throw new ApiError(401, "Nicht angemeldet.");
      const res = await fetch(`${BASE_URL}/video-versions/${versionId}/subtitles/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => res.statusText));
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    },

    // ── Scene Markers (2026-08-30, web port of the iOS "Set Marker"
    // on-set timecode feature — see project memory) ─────────────────────
    sceneMarkers: (sectionId: string) => request<SceneMarker[]>(`sections/${sectionId}/markers`),
    createSceneMarker: (sectionId: string, body: { timecode: string; fps: number; label?: string | null; color?: string | null }) =>
      request<SceneMarker>(`sections/${sectionId}/markers`, { method: "POST", body: JSON.stringify(body) }),
    deleteSceneMarker: (sectionId: string, markerId: string) =>
      request<void>(`sections/${sectionId}/markers/${markerId}`, { method: "DELETE" }),
    // "Reset" — deletes ALL markers for ONE section (never project-wide,
    // Lino was explicit about this scope), bulk endpoint not a client loop.
    resetSceneMarkers: (sectionId: string) =>
      request<{ ok: boolean; deleted: number }>(`sections/${sectionId}/markers`, { method: "DELETE" }),
    // Raw CMX3600 EDL text, not JSON — same "Bearer-Auth per fetch" bypass
    // as projectPdfUrl/subtitlesDownloadUrl above, but `.text()` instead of
    // `.blob()` since this is plain text meant to be written to a real
    // `.edl` file client-side, not displayed/rendered directly.
    sceneMarkersEdlText: async (sectionId: string) => {
      const token = await getToken();
      if (!token) throw new ApiError(401, "Nicht angemeldet.");
      const res = await fetch(`${BASE_URL}/sections/${sectionId}/edl`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => res.statusText));
      return res.text();
    },

    // ── Ideas (Planungssektor, 2026-07-16) ──────────────────────────────
    listIdeas: (projectId: string) => request<Idea[]>(`projects/${projectId}/ideas`),
    createIdea: (projectId: string, title: string, text: string, sortOrder = 0) =>
      request<Idea>(`projects/${projectId}/ideas`, {
        method: "POST",
        body: JSON.stringify({ title, text, sort_order: sortOrder }),
      }),
    patchIdea: (id: string, body: Partial<{ title: string; text: string }>) =>
      request<Idea>(`ideas/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    deleteIdea: (id: string) => request<void>(`ideas/${id}`, { method: "DELETE" }),
    duplicateIdea: (id: string) => request<Idea>(`ideas/${id}/duplicate`, { method: "POST" }),
    moveIdea: (id: string, beforeIdeaId: string | null) =>
      request<Idea>(`ideas/${id}/move`, { method: "POST", body: JSON.stringify({ before_idea_id: beforeIdeaId }) }),
    approveIdea: (id: string) => request<Idea>(`ideas/${id}/approve`, { method: "POST" }),
    rejectIdea: (id: string) => request<Idea>(`ideas/${id}/reject`, { method: "POST" }),
    internalApproveIdea: (id: string) => request<Idea>(`ideas/${id}/internal-approve`, { method: "POST" }),
    internalRejectIdea: (id: string) => request<Idea>(`ideas/${id}/internal-reject`, { method: "POST" }),
    ideaFeedback: (id: string) => request<IdeaFeedback[]>(`ideas/${id}/feedback`),
    setIdeaFeedbackResolved: (ideaId: string, feedbackId: string, resolved: boolean) =>
      request<IdeaFeedback>(`ideas/${ideaId}/feedback/${feedbackId}`, {
        method: "PATCH",
        body: JSON.stringify({ resolved }),
      }),
    // 2026-09-08, Lino: "als admin muss man kommentare auch löschen können
    // egal was für einen status sie haben" — plain IdeaFeedback had no
    // delete at all from the app before (only the public share page's
    // draft-only one), counterpart to deleteAnnotation below.
    deleteIdeaFeedback: (ideaId: string, feedbackId: string) =>
      request<void>(`ideas/${ideaId}/feedback/${feedbackId}`, { method: "DELETE" }),
    uploadIdeaImage: (id: string, file: File) => {
      const form = new FormData();
      form.append("file", file);
      return request<IdeaImage>(`ideas/${id}/images`, { method: "POST", body: form });
    },
    // Fire-and-forget, same shape as generateSceneImage above — the image
    // shows up as a 'ready' IdeaImage row via the next listIdeas poll.
    generateIdeaImage: (id: string, style: "realistic" | "sketch" | "funny_sketch", aspectRatio: "16:9" | "9:16", prompt?: string) =>
      request<{ status: string; image_id: string }>(`ideas/${id}/images/generate`, {
        method: "POST",
        body: JSON.stringify({ style, aspect_ratio: aspectRatio, prompt }),
      }),
    deleteIdeaImage: (ideaId: string, imageId: string) =>
      request<void>(`ideas/${ideaId}/images/${imageId}`, { method: "DELETE" }),
    reorderIdeaImages: (ideaId: string, orderedImageIds: string[]) =>
      request<Idea>(`ideas/${ideaId}/images/reorder`, {
        method: "POST",
        body: JSON.stringify({ ordered_image_ids: orderedImageIds }),
      }),

    // ── Todo lists ───────────────────────────────────────────────────────
    createTodoList: (projectId: string, name: string, sortOrder = 0) =>
      request<TodoList>(`projects/${projectId}/todo-lists`, {
        method: "POST",
        body: JSON.stringify({ name, sort_order: sortOrder }),
      }),
    // Same shape as createTodoList above, but scoped to a section's own
    // project-info box (multi-day shoots) instead of the project-level one.
    // Old mechanism, kept only for any pre-existing rows — see
    // createSceneTodoList for the current one.
    createSectionTodoList: (sectionId: string, name: string, sortOrder = 0) =>
      request<TodoList>(`sections/${sectionId}/todo-lists`, {
        method: "POST",
        body: JSON.stringify({ name, sort_order: sortOrder }),
      }),
    // Scoped to a "Projektinfo" scene tile's own todo section (2026-07-10
    // redesign — see Scene.is_project_info).
    createSceneTodoList: (sceneId: string, name: string, sortOrder = 0) =>
      request<TodoList>(`scenes/${sceneId}/todo-lists`, {
        method: "POST",
        body: JSON.stringify({ name, sort_order: sortOrder }),
      }),
    patchTodoList: (id: string, body: Partial<{ name: string; sort_order: number }>) =>
      request<TodoList>(`todo-lists/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    deleteTodoList: (id: string) => request<void>(`todo-lists/${id}`, { method: "DELETE" }),
    createTodoItem: (todoListId: string, text: string, assigneeId?: string, sortOrder = 0) =>
      request<TodoItem>(`todo-lists/${todoListId}/items`, {
        method: "POST",
        body: JSON.stringify({ text, assignee_id: assigneeId, sort_order: sortOrder }),
      }),
    patchTodoItem: (
      id: string,
      body: Partial<{ text: string; done: boolean; assignee_id: string | null; sort_order: number; due_at: string | null }>
    ) => {
      const { assignee_id, due_at, ...rest } = body;
      return request<TodoItem>(`todo-items/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...rest,
          assignee_id: assignee_id ?? undefined,
          clear_assignee: assignee_id === null,
          due_at: due_at ?? undefined,
          clear_due_at: due_at === null,
        }),
      });
    },
    deleteTodoItem: (id: string) => request<void>(`todo-items/${id}`, { method: "DELETE" }),

    // ── Team ─────────────────────────────────────────────────────────────
    members: (projectId: string) => request<Member[]>(`projects/${projectId}/members`),
    invite: (projectId: string, email: string, role: "projektleiter" | "editor") =>
      request<Invite>(`projects/${projectId}/invite`, { method: "POST", body: JSON.stringify({ email, role }) }),
    removeMember: (projectId: string, userId: string) =>
      request<void>(`projects/${projectId}/members/${userId}`, { method: "DELETE" }),
    // 2026-08-09 (#27) — separate roster from members() above, see
    // InfoMember's own doc comment in lib/types.ts.
    infoMembers: (projectId: string) => request<InfoMember[]>(`projects/${projectId}/info-members`),
    addInfoMember: (projectId: string, userId: string) =>
      request<InfoMember>(`projects/${projectId}/info-members`, { method: "POST", body: JSON.stringify({ user_id: userId }) }),
    removeInfoMember: (projectId: string, userId: string) =>
      request<void>(`projects/${projectId}/info-members/${userId}`, { method: "DELETE" }),
    // 2026-08-06: destination of an invite email's link (see app/invites/[token]/page.tsx).
    invitePreview: (token: string) => request<InvitePreview>(`invites/${token}`),
    acceptInvite: (token: string) => request<Member>(`invites/${token}/accept`, { method: "POST" }),

    // ── Notion import ────────────────────────────────────────────────────
    setNotionToken: (token: string) =>
      request<void>("me/notion-token", { method: "POST", body: JSON.stringify({ token }) }),
    notionDatabases: () => request<NotionDatabase[]>("me/notion-databases"),
    // databaseId omitted re-uses the project's already-linked database (see
    // Project.notion_database_id) - only required the very first time.
    importNotion: (projectId: string, databaseId?: string) =>
      request<{ imported: number; updated: number }>(`projects/${projectId}/import-notion`, {
        method: "POST",
        body: JSON.stringify({ database_id: databaseId }),
      }),

    // fetchImageBlobUrl removed 2026-07-22 (#248) — Scene/Shot/Folder/
    // IdeaImage image_url fields are presigned R2 URLs now, computed fresh
    // per response (same scheme video's playback_url already used), so
    // AuthImage.tsx/AuthVideo.tsx/*EditModal.tsx just use them directly as
    // a plain <img>/<video> src instead of fetching the bytes themselves
    // through this Bearer-token proxy.

    // ── Teams (seat billing) ────────────────────────────────────────────────
    seatPrice: (seatCount: number, storageTierGb: number) =>
      request<SeatPrice>(`seat-price?seat_count=${seatCount}&storage_tier_gb=${storageTierGb}`),
    myTeams: () => request<Team[]>("teams/mine"),
    teamCheckout: (name: string, seatCount: number, storageTierGb: number) =>
      request<{ url: string }>("teams/checkout", {
        method: "POST",
        body: JSON.stringify({ name, seat_count: seatCount, storage_tier_gb: storageTierGb }),
      }),
    changeTeamSeats: (teamId: string, seatCount: number) =>
      request<Team>(`teams/${teamId}/seats`, { method: "PATCH", body: JSON.stringify({ seat_count: seatCount }) }),
    changeTeamStorageTier: (teamId: string, storageTierGb: number) =>
      request<Team>(`teams/${teamId}/storage-tier`, { method: "PATCH", body: JSON.stringify({ storage_tier_gb: storageTierGb }) }),
    teamStorageUsage: (teamId: string) => request<TeamStorageUsage>(`teams/${teamId}/storage-usage`),
    cancelTeam: (teamId: string) => request<Team>(`teams/${teamId}/cancel`, { method: "POST" }),
    patchTeam: (teamId: string, patch: { name?: string; all_members_see_all_projects?: boolean }) =>
      request<Team>(`teams/${teamId}`, { method: "PATCH", body: JSON.stringify(patch) }),
    uploadTeamLogo: (teamId: string, file: File) => {
      const form = new FormData();
      form.append("file", file);
      return request<Team>(`teams/${teamId}/logo`, { method: "POST", body: form });
    },
    deleteTeamLogo: (teamId: string) => request<Team>(`teams/${teamId}/logo`, { method: "DELETE" }),
    teamMembers: (teamId: string) => request<TeamMember[]>(`teams/${teamId}/members`),
    inviteTeamMember: (teamId: string, email: string, role: TeamRole) =>
      request<{ id: string; invited_email: string; role: TeamRole; status: string; token: string | null; invited_at: string }>(
        `teams/${teamId}/invites`,
        { method: "POST", body: JSON.stringify({ email, role }) }
      ),
    changeTeamMemberRole: (teamId: string, membershipId: string, role: TeamRole) =>
      request<TeamMember>(`teams/${teamId}/members/${membershipId}/role`, { method: "PATCH", body: JSON.stringify({ role }) }),
    removeTeamMember: (teamId: string, membershipId: string) =>
      request<void>(`teams/${teamId}/members/${membershipId}`, { method: "DELETE" }),
    // 2026-08-06: destination of a team-invite email's link (see app/team-invites/[token]/page.tsx).
    teamInvitePreview: (token: string) => request<TeamInvitePreview>(`team-invites/${token}`),
    acceptTeamInvite: (token: string) => request<TeamMember>(`team-invites/${token}/accept`, { method: "POST" }),

    // ── Location (Google Places Autocomplete server-side when configured -
    // real business/POI coverage, e.g. company names Nominatim never had -
    // OSM static tiles either way). `place_id` is only set on a Google
    // result (Nominatim gives lat/lng inline, no separate resolve needed) -
    // see mapping.py's geocode_search doc comment on the backend. ──
    geocodeSearch: (q: string, sessionToken?: string) =>
      request<{ display_name: string; lat: number | null; lng: number | null; place_id: string | null }[]>(
        `geocode/search?q=${encodeURIComponent(q)}${sessionToken ? `&session_token=${sessionToken}` : ""}`
      ),
    geocodeResolve: (placeId: string, sessionToken?: string) =>
      request<{ display_name: string; lat: number; lng: number }>(
        `geocode/resolve?place_id=${encodeURIComponent(placeId)}${sessionToken ? `&session_token=${sessionToken}` : ""}`
      ),
    async fetchStaticMapBlobUrl(lat: number, lng: number): Promise<string> {
      const token = await getToken();
      if (!token) throw new ApiError(401, "Nicht angemeldet.");
      const res = await fetch(`${BASE_URL}/static-map?lat=${lat}&lng=${lng}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => res.statusText));
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    },

    // ── Feedback ─────────────────────────────────────────────────────────
    feedback: () => request<Feedback[]>("feedback"),
    createFeedback: (text: string) => request<Feedback>("feedback", { method: "POST", body: JSON.stringify({ text }) }),
    voteFeedback: (id: string) => request<{ ok: true; voted: boolean; votes: number }>(`feedback/${id}/vote`, { method: "POST" }),
    feedbackPending: () => request<FeedbackAdmin[]>("feedback/admin/pending"),
    approveFeedback: (id: string) => request<{ ok: true }>(`feedback/${id}/approve`, { method: "POST" }),
    deleteFeedback: (id: string) => request<{ ok: true }>(`feedback/${id}/delete`, { method: "POST" }),
    blockFeedbackUser: (userId: string) => request<{ ok: true }>(`feedback/block/${userId}`, { method: "POST" }),
    setFeedbackStatus: (id: string, status: "open" | "todo" | "in_progress" | "implemented" | "reopen") =>
      request<{ ok: true }>(`feedback/${id}/status`, { method: "POST", body: JSON.stringify({ status }) }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
