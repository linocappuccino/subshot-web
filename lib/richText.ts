/** Minimal rich-text support for Idea.text (2026-07-17, Lino: "wenn man
 * text überfährt kommt ein kleines Menü wo man text Fett, oder schräg
 * stellen kann") — deliberately small: only bold/italic, stored as plain
 * HTML (from contentEditable + document.execCommand), whitelisted down to
 * a handful of tags before it's ever saved OR rendered anywhere else, so a
 * stray paste (or a future bug) can't smuggle in a <script>/<img onerror>/
 * arbitrary attribute. Mirrored server-side in app/idea_share_view.py for
 * the public share page (same tag whitelist, different language). */
// 2026-07-18, Lino: "wenn man im Textfeld Text markiert soll man den Text
// noch etwas grösser darstellen können" — BIG added alongside Bold/Italic,
// same no-attributes rule as the rest (see clean() below), so it can't
// smuggle a font-size style through; <big> renders larger by itself,
// natively, with zero attributes needed.
// 2026-07-18, Lino: "man kann jetzt den Text grösser machen, aber nicht
// kleiner, dafür muss auch ein Button her" — SMALL added alongside BIG,
// same no-attributes rule, native <small> renders text smaller by itself.
// 2026-07-18, Todoist #209 — CODE added specifically for the slash-menu's
// end-of-block markers (RichTextEditor.tsx's closeInnermostBlock/
// closeTitleMode), which need their own small+greyed styling distinct from
// SMALL (already spoken for by the user-facing "make text smaller"
// toolbar button, applySmaller — reusing it for markers too would grey
// out any text a user deliberately shrunk). Styled via a plain CSS
// selector scoped to the editor/preview containers (see globals.css /
// idea_share_view.py's .idea-text code rule), same no-attributes rule as
// every other tag here.
const ALLOWED_TAGS = new Set(["B", "STRONG", "I", "EM", "BR", "DIV", "BIG", "SMALL", "CODE"]);

export function sanitizeRichTextHtml(html: string): string {
  if (typeof window === "undefined" || typeof DOMParser === "undefined") return html;
  const doc = new DOMParser().parseFromString(html, "text/html");

  function clean(node: Node) {
    Array.from(node.childNodes).forEach((child) => {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement;
        if (!ALLOWED_TAGS.has(el.tagName)) {
          // Unwrap: keep the text/children, drop the disallowed wrapper itself.
          while (el.firstChild) el.parentNode?.insertBefore(el.firstChild, el);
          el.remove();
        } else {
          Array.from(el.attributes).forEach((attr) => el.removeAttribute(attr.name));
          clean(el);
        }
      } else if (child.nodeType !== Node.TEXT_NODE) {
        child.remove(); // comments etc.
      }
    });
  }
  clean(doc.body);
  return doc.body.innerHTML;
}

/** True if there's no real text content at all (used for the placeholder
 * overlay + "does this idea have a description yet" checks elsewhere,
 * e.g. before allowing an AI image generation). */
export function isRichTextEmpty(html: string): boolean {
  return !html || html.replace(/<[^>]*>/g, "").trim().length === 0;
}

/** Plain-text version, tags stripped, <div>/<br> turned into line breaks —
 * used to seed the "AI Bild generieren" popup's editable prompt from the
 * idea's own rich-text description (2026-07-17). */
export function richTextToPlainText(html: string): string {
  return html
    .replace(/<(div|br)[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
