import type {
  Invite,
  Member,
  NotionDatabase,
  Project,
  ProjectDetail,
  ProjectFolder,
  Scene,
  SceneDialogue,
  Section,
  Shot,
  TodoItem,
  TodoList,
} from "./types";

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL!;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Same shape as the iOS APIClient: one authorizedRequest-style fetch
 * wrapper, all endpoint methods built on top of it. `getToken` is Clerk's
 * useAuth().getToken, injected by useApi() rather than imported directly so
 * this file has no hard dependency on being called from a Client Component. */
export function createApiClient(getToken: () => Promise<string | null>) {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
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
      throw new ApiError(res.status, text || res.statusText);
    }
    if (res.status === 204) return undefined as T;
    return res.json();
  }

  return {
    me: () => request<{ id: string; email: string; name: string | null; avatar_url: string | null }>("me"),
    knownCollaborators: () => request<Member[]>("me/known-collaborators"),

    // ── Folders ──────────────────────────────────────────────────────────
    folders: () => request<ProjectFolder[]>("folders"),
    createFolder: (name: string, color?: string, emoji?: string, sortOrder = 0) =>
      request<ProjectFolder>("folders", {
        method: "POST",
        body: JSON.stringify({ name, color, emoji, sort_order: sortOrder }),
      }),
    patchFolder: (
      id: string,
      body: Partial<{ name: string; color: string; emoji: string | null; sort_order: number }>
    ) => {
      const { emoji, ...rest } = body;
      return request<ProjectFolder>(`folders/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...rest, emoji: emoji ?? undefined, clear_emoji: emoji === null }),
      });
    },
    deleteFolder: (id: string) => request<void>(`folders/${id}`, { method: "DELETE" }),

    // ── Projects ─────────────────────────────────────────────────────────
    projects: (folderId?: string) =>
      request<Project[]>(`projects${folderId ? `?folder_id=${folderId}` : ""}`),
    createProject: (name: string, color?: string, emoji?: string) =>
      request<Project>("projects", { method: "POST", body: JSON.stringify({ name, color, emoji }) }),
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
        folder_id: string | null;
      }>
    ) => {
      const { emoji, folder_id, ...rest } = body;
      return request<Project>(`projects/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...rest,
          emoji: emoji ?? undefined,
          clear_emoji: emoji === null,
          folder_id: folder_id ?? undefined,
          clear_folder: folder_id === null,
        }),
      });
    },
    deleteProject: (id: string) => request<void>(`projects/${id}`, { method: "DELETE" }),
    projectPdfUrl: async (id: string) => {
      // Downloaded (not just linked) because the endpoint needs the same
      // Bearer auth as everything else — a plain <a href> can't attach one.
      const token = await getToken();
      if (!token) throw new ApiError(401, "Nicht angemeldet.");
      const res = await fetch(`${BASE_URL}/projects/${id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => res.statusText));
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    },
    shareLink: (projectId: string) =>
      request<{ url: string; expires_at: string }>(`projects/${projectId}/share-link`, { method: "POST" }),

    // ── Scenes ───────────────────────────────────────────────────────────
    createScene: (projectId: string, body: Record<string, unknown>) =>
      request<Scene>(`projects/${projectId}/scenes`, { method: "POST", body: JSON.stringify(body) }),
    patchScene: (id: string, body: Record<string, unknown>) =>
      request<Scene>(`scenes/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    deleteScene: (id: string) => request<void>(`scenes/${id}`, { method: "DELETE" }),
    moveScene: (id: string, beforeSceneId: string | null) =>
      request<Scene>(`scenes/${id}/move`, { method: "POST", body: JSON.stringify({ before_scene_id: beforeSceneId }) }),
    uploadSceneImage: (id: string, file: File) => {
      const form = new FormData();
      form.append("file", file);
      return request<Scene>(`scenes/${id}/image`, { method: "POST", body: form });
    },

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
    uploadShotImage: (id: string, file: File) => {
      const form = new FormData();
      form.append("file", file);
      return request<Shot>(`shots/${id}/image`, { method: "POST", body: form });
    },

    // ── Sections ─────────────────────────────────────────────────────────
    createSection: (projectId: string, name: string, sortOrder = 0) =>
      request<Section>(`projects/${projectId}/sections`, { method: "POST", body: JSON.stringify({ name, sort_order: sortOrder }) }),
    patchSection: (id: string, body: Partial<{ name: string; sort_order: number }>) =>
      request<Section>(`sections/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    deleteSection: (id: string) => request<void>(`sections/${id}`, { method: "DELETE" }),

    // ── Todo lists ───────────────────────────────────────────────────────
    createTodoList: (projectId: string, name: string, sortOrder = 0) =>
      request<TodoList>(`projects/${projectId}/todo-lists`, {
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
      body: Partial<{ text: string; done: boolean; assignee_id: string | null; sort_order: number }>
    ) => {
      const { assignee_id, ...rest } = body;
      return request<TodoItem>(`todo-items/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...rest, assignee_id: assignee_id ?? undefined, clear_assignee: assignee_id === null }),
      });
    },
    deleteTodoItem: (id: string) => request<void>(`todo-items/${id}`, { method: "DELETE" }),

    // ── Team ─────────────────────────────────────────────────────────────
    members: (projectId: string) => request<Member[]>(`projects/${projectId}/members`),
    invite: (projectId: string, email: string, role: "editor" | "viewer") =>
      request<Invite>(`projects/${projectId}/invite`, { method: "POST", body: JSON.stringify({ email, role }) }),
    removeMember: (projectId: string, userId: string) =>
      request<void>(`projects/${projectId}/members/${userId}`, { method: "DELETE" }),

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

    /** Scene/shot images need the same Bearer auth as everything else (see
     * get_scene_image/get_shot_image on the backend) — a plain <img src>
     * can't attach a header, so this fetches the bytes and hands back an
     * object URL for the caller to use as the src instead. Mirrors the iOS
     * app's AsyncShotThumbnail, which has the exact same constraint. */
    async fetchImageBlobUrl(path: string): Promise<string> {
      const token = await getToken();
      if (!token) throw new ApiError(401, "Nicht angemeldet.");
      const res = await fetch(`${BASE_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => res.statusText));
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    },

    // ── Location (no paid API key - Nominatim search + OSM static tiles,
    // same reasoning as the iOS app using MapKit instead of a Google key) ──
    geocodeSearch: (q: string) => request<{ display_name: string; lat: number; lng: number }[]>(`geocode/search?q=${encodeURIComponent(q)}`),
    async fetchStaticMapBlobUrl(lat: number, lng: number): Promise<string> {
      const token = await getToken();
      if (!token) throw new ApiError(401, "Nicht angemeldet.");
      const res = await fetch(`${BASE_URL}/static-map?lat=${lat}&lng=${lng}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => res.statusText));
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
