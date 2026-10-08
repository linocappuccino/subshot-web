/** 2026-10-08, Lino — Milanote-style idea board. Document shape shared with
 * the backend (app/idea_board.py validates and stores exactly this). All
 * positions/sizes are in board ("world") pixels; `src`/`image_src` are
 * presigned URLs the API adds on read and strips again on save. */

export const GRID = 24;

export type TextColor = "default" | "yellow" | "green" | "blue" | "pink" | "purple" | "orange" | "red" | "transparent";
export const TEXT_COLORS: TextColor[] = ["default", "yellow", "green", "blue", "pink", "purple", "orange", "red", "transparent"];
export const TEXT_COLOR_STYLES: Record<TextColor, { bg: string; fg: string; border: string }> = {
  default: { bg: "#232325", fg: "#f0f0f0", border: "rgba(255,255,255,0.10)" },
  yellow: { bg: "#fde68a", fg: "#1f1a0a", border: "rgba(0,0,0,0.08)" },
  green: { bg: "#bbf7d0", fg: "#0b2014", border: "rgba(0,0,0,0.08)" },
  blue: { bg: "#bfdbfe", fg: "#0b1a2e", border: "rgba(0,0,0,0.08)" },
  pink: { bg: "#fbcfe8", fg: "#2a0b1c", border: "rgba(0,0,0,0.08)" },
  purple: { bg: "#ddd6fe", fg: "#1a0f33", border: "rgba(0,0,0,0.08)" },
  orange: { bg: "#fed7aa", fg: "#2a1405", border: "rgba(0,0,0,0.08)" },
  red: { bg: "#fecaca", fg: "#2e0b0b", border: "rgba(0,0,0,0.08)" },
  transparent: { bg: "transparent", fg: "#f0f0f0", border: "transparent" },
};

export const STROKE_COLORS = ["#f0f0f0", "#ff5a5f", "#ffb020", "#3ecf8e", "#3b82f6", "#a855f7", "#111111"] as const;
export type StrokeColor = (typeof STROKE_COLORS)[number];
export const STROKE_WIDTHS = [2, 4, 8, 14];

interface BaseElement {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

export interface TextElement extends BaseElement {
  type: "text";
  html: string;
  color: TextColor;
}

export interface MediaElement extends BaseElement {
  type: "image" | "video" | "audio" | "pdf" | "file";
  asset_key: string;
  name: string;
  mime: string;
  size?: number;
  src?: string | null;
}

export interface LinkElement extends BaseElement {
  type: "link";
  url: string;
  title: string;
  description: string;
  site_name: string;
  image_key?: string;
  image_src?: string | null;
}

export interface DrawingElement extends BaseElement {
  type: "drawing";
  points: [number, number][];
  color: StrokeColor;
  stroke_width: number;
}

/** 2026-10-08, Lino: a scene card — number, image, title and text. On
 * "Abgenommen" every scene card becomes its own Scene in the shot list, in
 * number order (backend: approve_idea / idea_board.scenes_for_approval). */
export interface SceneElement extends BaseElement {
  type: "scene";
  number: number;
  title: string;
  html: string;
  image_key?: string;
  image_src?: string | null;
}

/** 2026-10-08, Lino: a group — a frame drawn around its member elements
 * (expanded) or a compact card standing in for them (collapsed). While
 * expanded its x/y/w/h are derived from the members (see normalizeGroups);
 * while collapsed they are the card's own position/size and the members are
 * hidden (they keep their positions and move along with the card). */
export interface GroupElement extends BaseElement {
  type: "group";
  title: string;
  collapsed: boolean;
  children: string[];
}

export type BoardElement = TextElement | MediaElement | LinkElement | DrawingElement | SceneElement | GroupElement;

export const GROUP_PAD = 24;
export const GROUP_HEADER = 40;
export const GROUP_CARD_W = 288;
export const GROUP_CARD_H = 132;

/** Expanded groups get their frame recomputed from their members after
 * every change; members of collapsed groups are hidden. */
export function normalizeGroups(data: BoardData): BoardData {
  if (!data.elements.some((el) => el.type === "group")) return data;
  const byId = new Map(data.elements.map((el) => [el.id, el]));
  let changed = false;
  // members that no longer exist drop out; a group left with < 2 members dissolves
  const dissolved = new Set<string>();
  const elements = data.elements.flatMap((el): BoardElement[] => {
    if (el.type !== "group") return [el];
    const alive = el.children.filter((id) => byId.has(id));
    if (alive.length < 2) {
      dissolved.add(el.id);
      changed = true;
      return [];
    }
    if (alive.length !== el.children.length) {
      changed = true;
      el = { ...el, children: alive };
    }
    if (el.collapsed) return [el];
    const members = (el as GroupElement).children.map((id) => byId.get(id)).filter((m): m is BoardElement => !!m && m.type !== "group");
    const b = boundsOf(members);
    if (!b) return [el];
    const x = b.x - GROUP_PAD;
    const y = b.y - GROUP_PAD - GROUP_HEADER;
    const w = b.w + GROUP_PAD * 2;
    const h = b.h + GROUP_PAD * 2 + GROUP_HEADER;
    if (x === el.x && y === el.y && w === el.w && h === el.h) return [el];
    changed = true;
    return [{ ...el, x, y, w, h }];
  });
  if (!changed) return data;
  const connectors = dissolved.size ? data.connectors.filter((c) => !dissolved.has(c.from) && !dissolved.has(c.to)) : data.connectors;
  return { elements, connectors };
}

export function hiddenElementIds(elements: BoardElement[]): Map<string, string> {
  const hidden = new Map<string, string>();
  for (const el of elements) if (el.type === "group" && el.collapsed) for (const c of el.children) hidden.set(c, el.id);
  return hidden;
}

export function nextSceneNumber(elements: BoardElement[]): number {
  return elements.reduce((m, el) => (el.type === "scene" ? Math.max(m, el.number) : m), 0) + 1;
}

export interface Connector {
  id: string;
  from: string;
  to: string;
  color?: StrokeColor;
}

export interface BoardData {
  elements: BoardElement[];
  connectors: Connector[];
}

export interface BoardResponse {
  version: number;
  data: BoardData;
  editable?: boolean;
}

export interface BoardUploadTicket {
  key: string;
  kind: "image" | "video" | "audio" | "pdf";
  upload_url: string;
  url: string;
}

export interface LinkPreview {
  url: string;
  title: string;
  description: string;
  site_name: string;
  image_key: string | null;
  image_src: string | null;
}

export function newId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function snap(v: number, enabled = true): number {
  return enabled ? Math.round(v / GRID) * GRID : v;
}

/** Copy without the presigned URLs (the server strips them anyway — this just
 * keeps the request small). */
export function forSave(data: BoardData): BoardData {
  return {
    elements: data.elements.map((el) => {
      if (!("src" in el) && !("image_src" in el)) return el;
      const copy: Record<string, unknown> = { ...el };
      delete copy.src;
      delete copy.image_src;
      return copy as unknown as BoardElement;
    }),
    connectors: data.connectors,
  };
}

/** Browsers report "" as the type for some audio/video files (e.g. .m4a on
 * some systems) — fall back to the extension. */
export function guessMime(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", heic: "image/heic",
    mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", m4v: "video/x-m4v",
    mp3: "audio/mpeg", m4a: "audio/x-m4a", aac: "audio/aac", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac", aif: "audio/aiff", aiff: "audio/aiff",
    pdf: "application/pdf",
  };
  return map[ext] ?? "";
}

export function elementKindForMime(mime: string): MediaElement["type"] | null {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  return null;
}

export function boundsOf(elements: BoardElement[]): { x: number; y: number; w: number; h: number } | null {
  if (elements.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of elements) {
    minX = Math.min(minX, el.x);
    minY = Math.min(minY, el.y);
    maxX = Math.max(maxX, el.x + el.w);
    maxY = Math.max(maxY, el.y + el.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function formatBytes(n: number | undefined): string {
  if (!n) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function looksLikeUrl(text: string): boolean {
  const t = text.trim();
  if (/\s/.test(t) || t.length > 2000) return false;
  return /^https?:\/\/\S+\.\S+/i.test(t) || /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(t);
}

/** 2026-10-08, Lino: "Jegliche link-videos soll man per Klick auf dem Board
 * abspielen können" — the embeddable player for a link card's URL (YouTube
 * incl. Shorts, Vimeo, TikTok, Instagram posts/reels, direct video files),
 * or null for ordinary links. `aspect` = width / height of the player. */
export interface VideoEmbed {
  kind: "iframe" | "video";
  src: string;
  aspect: number;
}

export function videoEmbedFor(rawUrl: string): VideoEmbed | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m)\./, "");
  const path = url.pathname;

  if (host === "youtube.com" || host === "youtu.be" || host === "youtube-nocookie.com") {
    const id =
      (host === "youtu.be" ? path.slice(1, 12) : null) ||
      url.searchParams.get("v") ||
      path.match(/^\/(?:shorts|live|embed|v)\/([A-Za-z0-9_-]{11})/)?.[1];
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
    const start = parseInt(url.searchParams.get("t") ?? "", 10);
    return {
      kind: "iframe",
      src: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1${start > 0 ? `&start=${start}` : ""}`,
      aspect: path.startsWith("/shorts/") ? 9 / 16 : 16 / 9,
    };
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const m = path.match(/^\/(?:video\/)?(\d+)(?:\/([0-9a-f]+))?/);
    if (!m) return null;
    return { kind: "iframe", src: `https://player.vimeo.com/video/${m[1]}?autoplay=1${m[2] ? `&h=${m[2]}` : ""}`, aspect: 16 / 9 };
  }
  if (host.endsWith("tiktok.com")) {
    const id = path.match(/\/video\/(\d+)/)?.[1];
    if (!id) return null;
    return { kind: "iframe", src: `https://www.tiktok.com/player/v1/${id}?autoplay=1&music_info=1&description=1`, aspect: 9 / 16 };
  }
  if (host === "instagram.com") {
    const m = path.match(/^\/(?:[A-Za-z0-9_.]+\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
    if (!m) return null;
    const kind = m[1] === "p" ? "p" : "reel";
    return { kind: "iframe", src: `https://www.instagram.com/${kind}/${m[2]}/embed/`, aspect: kind === "reel" ? 9 / 16 : 4 / 5 };
  }
  if (/\.(mp4|mov|webm|m4v)$/i.test(path)) {
    return { kind: "video", src: url.toString(), aspect: 16 / 9 };
  }
  return null;
}
