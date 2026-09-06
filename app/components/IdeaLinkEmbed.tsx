"use client";

// 2026-07-27 — renders the social link IdeaFloatingCard detected inside an
// idea's description (see lib/embed.ts) as a real playable embed, right
// inside the opened idea card, so the video/post can be watched without
// leaving the Ideas page. YouTube is a plain iframe (no external script
// needed). TikTok/Instagram only support embedding via their own official
// widget script (blockquote + <platform>.com/embed.js) — there's no iframe
// shortcut for either. The script tag is re-appended fresh on every mount
// (parent keys this component by `embed.url`) rather than cached/de-duped,
// since both platforms' embed.js scan the DOM for unprocessed blockquotes
// the moment they run — simplest reliable way to make sure a NEWLY opened
// idea's blockquote actually gets turned into a player, not just the first
// one ever shown in the session.
import { useEffect } from "react";
import type { DetectedEmbed } from "@/lib/embed";

declare global {
  interface Window {
    instgrm?: { Embeds: { process: () => void } };
  }
}

function useEmbedScript(provider: DetectedEmbed["provider"], src: string | null) {
  useEffect(() => {
    if (!src) return;
    // 2026-07-27 follow-up — real bug report: paste an Instagram link,
    // delete it, paste the exact SAME link again — the embed never came
    // back. Root cause: Instagram's embed.js only auto-processes
    // blockquotes present in the DOM the FIRST time the script actually
    // executes; a later mount re-inserting an identical <script src> tag
    // doesn't reliably re-trigger that processing (the script itself
    // guards against re-running its init once `window.instgrm` already
    // exists). Instagram's own API for exactly this case is
    // `window.instgrm.Embeds.process()` ("script already loaded, please
    // reprocess new blockquotes") — call that directly once the global is
    // already present, only fall back to inserting a fresh script tag the
    // very first time it isn't.
    if (provider === "instagram" && window.instgrm?.Embeds) {
      window.instgrm.Embeds.process();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    document.body.appendChild(script);
    return () => {
      script.remove();
    };
  }, [provider, src]);
}

const EMBED_SCRIPT_SRC: Record<DetectedEmbed["provider"], string | null> = {
  youtube: null,
  tiktok: "https://www.tiktok.com/embed.js",
  instagram: "https://www.instagram.com/embed.js",
};

export function IdeaLinkEmbed({ embed }: { embed: DetectedEmbed }) {
  useEmbedScript(embed.provider, EMBED_SCRIPT_SRC[embed.provider]);

  if (embed.provider === "youtube") {
    return (
      <div className="w-full aspect-video rounded-xl overflow-hidden bg-black/40 mb-4">
        <iframe
          src={`https://www.youtube.com/embed/${embed.youtubeId}`}
          title="YouTube video"
          className="w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>
    );
  }

  if (embed.provider === "tiktok") {
    return (
      <div className="mb-4 flex justify-center">
        <blockquote className="tiktok-embed" cite={embed.url} style={{ maxWidth: 605, minWidth: 325 }}>
          <a href={embed.url}>{embed.url}</a>
        </blockquote>
      </div>
    );
  }

  return (
    <div className="mb-4 flex justify-center">
      <blockquote className="instagram-media" data-instgrm-permalink={embed.url} style={{ maxWidth: 540, width: "100%" }}>
        <a href={embed.url}>{embed.url}</a>
      </blockquote>
    </div>
  );
}
