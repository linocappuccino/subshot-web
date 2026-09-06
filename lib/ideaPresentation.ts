/** 2026-07-18 (Todoist #208, Lino: "die Symbole und Markierungen von /
 * werden im Präsentationsmodus NICHT dargestellt... man sieht also nur
 * den reinen Text") — a read-only, cleaned-up rendering of Idea.text for
 * IdeaFloatingCard's Präsentationsmodus. Mirrors the shape of the
 * backend's _parse_idea_scene_markers (app/main.py) closely enough to
 * recognize the same markers, but for DISPLAY only: no data extraction,
 * just deciding what to hide/style per line.
 *
 * "Titel wird... immer grösser und dicker dargestellt, Dialoge werden
 * immer kursiv dargestellt" — the Titel value gets bold+larger text, each
 * Dialog line gets italic; every /-marker (icon+label) and every end-cap
 * (see #205) is dropped entirely, never rendered. */

const SCENE_MARKER = "🎬 Szene/Shot:";
const INTERMEDIATE_MARKER = "🔀 Zwischenschritt:";
const DIALOG_MARKER = "🗣️ Dialog:";
const TITLE_MARKER = "📝 Titel:";
// 2026-07-28, Lino: description markers weren't being hidden at all — the
// "/" Beschreibung option (RichTextEditor.tsx's DESCRIPTION_OPTION, added
// 2026-07-21 #266, after this file was first written 2026-07-18) had no
// counterpart here, so both "📄 Beschreibung:" and its end-cap fell through
// to the generic default branch below and rendered as literal visible text.
const DESCRIPTION_MARKER = "📄 Beschreibung:";
const DIALOG_LINE_PREFIX_RE = /^🗣️\s*/;
// 2026-07-18, Todoist #209 — dash/dot/underscore runs replaced with
// readable text ("-- end scene" etc.), same case-insensitive/whitespace-
// tolerant pattern as the backend's own three regexes in app/main.py.
const SCENE_END_RE = /^-+\s*end\s*scene$/i;
const DIALOG_END_RE = /^-+\s*end\s*dialog$/i;
const TITLE_END_RE = /^-+\s*end\s*title$/i;
const DESCRIPTION_END_RE = /^-+\s*end\s*description$/i;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

type Line = { text: string; html: string };

/** Groups the editor's top-level DOM children into one entry per visual
 * line: any run of loose (non-<div>) nodes before the first <div> is the
 * FIRST line (RichTextEditor never wraps the very first line in its own
 * <div> until a real Enter has been pressed), every subsequent <div> is
 * its own line after that. */
function extractLines(container: HTMLElement): Line[] {
  const lines: Line[] = [];
  let loose: Node[] = [];
  function flushLoose() {
    if (loose.length === 0) return;
    const wrapper = document.createElement("div");
    loose.forEach((n) => wrapper.appendChild(n.cloneNode(true)));
    lines.push({ text: (wrapper.textContent ?? "").trim(), html: wrapper.innerHTML });
    loose = [];
  }
  Array.from(container.childNodes).forEach((child) => {
    if (child.nodeType === Node.ELEMENT_NODE && (child as Element).tagName === "DIV") {
      flushLoose();
      const el = child as HTMLElement;
      lines.push({ text: (el.textContent ?? "").trim(), html: el.innerHTML });
    } else {
      loose.push(child);
    }
  });
  flushLoose();
  return lines;
}

export function renderIdeaForPresentation(html: string): string {
  if (typeof document === "undefined") return html;
  const container = document.createElement("div");
  container.innerHTML = html;
  const lines = extractLines(container);

  const out: string[] = [];
  let inDialog = false;
  let titlePending = false;

  for (const line of lines) {
    const { text, html: lineHtml } = line;

    // Purely cosmetic, never real content — always dropped.
    if (TITLE_END_RE.test(text) || DESCRIPTION_END_RE.test(text)) continue;
    if (text === "" || SCENE_END_RE.test(text) || DIALOG_END_RE.test(text)) {
      inDialog = false; // closes a dialog if one was open, no-op otherwise
      continue;
    }

    if (titlePending) {
      // 2026-07-19, Lino: immer ein Zeilenumbruch vor einem Titel — auch
      // dann, wenn direkt davor schon Text stand.
      if (out.length > 0) out.push("<div><br></div>");
      out.push(`<div class="font-bold text-xl">${lineHtml}</div>`);
      titlePending = false;
      continue;
    }
    if (!inDialog && text.startsWith(TITLE_MARKER)) {
      const rest = text.slice(TITLE_MARKER.length).trim();
      if (rest) {
        if (out.length > 0) out.push("<div><br></div>");
        out.push(`<div class="font-bold text-xl">${escapeHtml(rest)}</div>`);
      } else titlePending = true;
      continue;
    }
    if (!inDialog && text.startsWith(DIALOG_MARKER)) {
      inDialog = true;
      const rest = text.slice(DIALOG_MARKER.length).trim();
      if (rest) out.push(`<div class="italic">${escapeHtml(rest)}</div>`);
      continue;
    }
    if (!inDialog && text.startsWith(DESCRIPTION_MARKER)) {
      // Description gets no special class ("Beschreibung normal" per
      // Lino's own spec) — only the marker itself is hidden, any inline
      // text after it (rare — normally the marker sits on its own line and
      // the description text follows as its own line, which already falls
      // through to the generic default branch below) is kept as-is.
      const rest = text.slice(DESCRIPTION_MARKER.length).trim();
      if (rest) out.push(`<div>${escapeHtml(rest)}</div>`);
      continue;
    }
    if (!inDialog && (text.startsWith(SCENE_MARKER) || text.startsWith(INTERMEDIATE_MARKER))) {
      const marker = text.startsWith(SCENE_MARKER) ? SCENE_MARKER : INTERMEDIATE_MARKER;
      const rest = text.slice(marker.length).trim();
      if (rest) out.push(`<div>${escapeHtml(rest)}</div>`);
      continue;
    }
    if (inDialog) {
      out.push(`<div class="italic">${lineHtml.replace(DIALOG_LINE_PREFIX_RE, "")}</div>`);
      continue;
    }
    out.push(`<div>${lineHtml}</div>`);
  }
  return out.join("");
}
