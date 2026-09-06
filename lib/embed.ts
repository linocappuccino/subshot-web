/** 2026-07-27 — detects a YouTube/TikTok/Instagram link typed anywhere in an
 * Idea's plain description text so IdeaFloatingCard can render it as a real,
 * playable embed instead of inert text. Deliberately does NOT touch
 * RichTextEditor/richText.ts's <a>-less tag whitelist at all — this scans the
 * saved `Idea.text` for a bare URL the same way a user would paste it, and
 * only the FIRST matching link (in reading order) is embedded, so an idea
 * with several links just shows the first one. */

export type EmbedProvider = "youtube" | "tiktok" | "instagram";

export interface DetectedEmbed {
  provider: EmbedProvider;
  url: string;
  youtubeId?: string;
}

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;
const YOUTUBE_ID_RE = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/i;
const TIKTOK_RE = /(?:^|\.)tiktok\.com\//i;
const INSTAGRAM_RE = /(?:^|\.)instagram\.com\/(?:p|reel|tv)\//i;

export function detectSocialEmbed(text: string): DetectedEmbed | null {
  const plain = text.replace(/<[^>]*>/g, " ");
  const urls = plain.match(URL_RE) ?? [];
  for (const raw of urls) {
    const url = raw.replace(/[.,;!?]+$/, "");
    const youtubeId = url.match(YOUTUBE_ID_RE)?.[1];
    if (youtubeId) return { provider: "youtube", url, youtubeId };
    if (TIKTOK_RE.test(url)) return { provider: "tiktok", url };
    if (INSTAGRAM_RE.test(url)) return { provider: "instagram", url };
  }
  return null;
}
