import type { Project, ProjectDetail, ProjectFolder, Scene, SceneDialogue, Section, Shot } from "./types";

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
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
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

    folders: () => request<ProjectFolder[]>("folders"),
    createFolder: (name: string, color?: string, emoji?: string) =>
      request<ProjectFolder>("folders", { method: "POST", body: JSON.stringify({ name, color, emoji }) }),

    projects: (folderId?: string) =>
      request<Project[]>(`projects${folderId ? `?folder_id=${folderId}` : ""}`),
    createProject: (name: string, color?: string) =>
      request<Project>("projects", { method: "POST", body: JSON.stringify({ name, color }) }),
    projectDetail: (id: string) => request<ProjectDetail>(`projects/${id}`),
    patchProject: (id: string, body: Partial<Pick<Project, "name" | "color">>) =>
      request<Project>(`projects/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    deleteProject: (id: string) => request<void>(`projects/${id}`, { method: "DELETE" }),

    createScene: (projectId: string, body: Record<string, unknown>) =>
      request<Scene>(`projects/${projectId}/scenes`, { method: "POST", body: JSON.stringify(body) }),
    patchScene: (id: string, body: Record<string, unknown>) =>
      request<Scene>(`scenes/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    deleteScene: (id: string) => request<void>(`scenes/${id}`, { method: "DELETE" }),
    moveScene: (id: string, beforeSceneId: string | null) =>
      request<Scene>(`scenes/${id}/move`, { method: "POST", body: JSON.stringify({ before_scene_id: beforeSceneId }) }),

    addDialogue: (sceneId: string, text: string) =>
      request<SceneDialogue>(`scenes/${sceneId}/dialogues`, { method: "POST", body: JSON.stringify({ text }) }),
    patchDialogue: (id: string, body: { text?: string; done?: boolean }) =>
      request<SceneDialogue>(`dialogues/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    deleteDialogue: (id: string) => request<void>(`dialogues/${id}`, { method: "DELETE" }),

    createShot: (projectId: string, body: Record<string, unknown>) =>
      request<Shot>(`projects/${projectId}/shots`, { method: "POST", body: JSON.stringify(body) }),
    patchShot: (id: string, body: Record<string, unknown>) =>
      request<Shot>(`shots/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    deleteShot: (id: string) => request<void>(`shots/${id}`, { method: "DELETE" }),

    createSection: (projectId: string, name: string, sortOrder = 0) =>
      request<Section>(`projects/${projectId}/sections`, { method: "POST", body: JSON.stringify({ name, sort_order: sortOrder }) }),
    patchSection: (id: string, name: string) =>
      request<Section>(`sections/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
    deleteSection: (id: string) => request<void>(`sections/${id}`, { method: "DELETE" }),

    shareLink: (projectId: string) =>
      request<{ url: string; expires_at: string }>(`projects/${projectId}/share-link`, { method: "POST" }),

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
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
