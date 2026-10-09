import DOMPurify from "dompurify";

/** embeds we play inline; anything else in an iframe is dropped */
const EMBED_OK = /^https:\/\/(www\.youtube(-nocookie)?\.com\/embed\/|player\.vimeo\.com\/video\/|www\.loom\.com\/embed\/)/;

/** Ghost post HTML → safe HTML for this page. Ghost's video/audio cards
 * come with their own player (buttons + a script we don't load), so they
 * become plain <video controls>/<audio controls> with the card's thumbnail
 * as poster (2026-10-09, Lino: feature videos in every devlog post). */
export function renderPostHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild as HTMLElement;
  root.querySelectorAll<HTMLElement>(".kg-video-card").forEach((card) => {
    const src = card.querySelector("video")?.getAttribute("src");
    if (!src) return card.remove();
    const v = doc.createElement("video");
    v.setAttribute("src", src);
    const poster = card.getAttribute("data-kg-custom-thumbnail") || card.getAttribute("data-kg-thumbnail");
    if (poster && poster !== "undefined" && poster !== "null") v.setAttribute("poster", poster);
    v.setAttribute("controls", "");
    v.setAttribute("playsinline", "");
    v.setAttribute("preload", "metadata");
    const fig = doc.createElement("figure");
    fig.appendChild(v);
    const cap = card.querySelector("figcaption");
    if (cap) fig.appendChild(cap);
    card.replaceWith(fig);
  });
  root.querySelectorAll<HTMLElement>(".kg-audio-card").forEach((card) => {
    const src = card.querySelector("audio")?.getAttribute("src");
    if (!src) return card.remove();
    const fig = doc.createElement("figure");
    const title = card.querySelector(".kg-audio-title")?.textContent?.trim();
    if (title) {
      const cap = doc.createElement("figcaption");
      cap.textContent = title;
      fig.appendChild(cap);
    }
    const a = doc.createElement("audio");
    a.setAttribute("src", src);
    a.setAttribute("controls", "");
    a.setAttribute("preload", "metadata");
    fig.appendChild(a);
    card.replaceWith(fig);
  });
  // 2026-09-16 (security audit): Ghost HTML always goes through DOMPurify
  // with an explicit allowlist — this page is public and unauthenticated
  DOMPurify.addHook("uponSanitizeElement", (node, data) => {
    if (data.tagName === "iframe" && !EMBED_OK.test((node as Element).getAttribute("src") ?? "")) node.parentNode?.removeChild(node);
  });
  const clean = DOMPurify.sanitize(root.innerHTML, {
    ALLOWED_TAGS: [
      "p", "br", "hr", "b", "strong", "i", "em", "u", "s", "code", "pre", "blockquote",
      "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "a", "img", "figure", "figcaption", "div", "span",
      "video", "audio", "source", "iframe", "mark",
    ],
    ALLOWED_ATTR: [
      "href", "src", "alt", "title", "target", "rel", "class", "srcset", "sizes", "width", "height",
      "controls", "poster", "playsinline", "preload", "loop", "muted", "autoplay", "type", "allow", "allowfullscreen", "frameborder",
    ],
  });
  DOMPurify.removeHook("uponSanitizeElement");
  return clean;
}

