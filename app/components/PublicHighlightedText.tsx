import React, { type ReactNode } from "react";
import type { Annotation } from "@/lib/types";

/** Synthetic id for a not-yet-saved selection (2026-07-22) — see
 * wrapHighlights' own doc comment below for why this needs special-casing:
 * it has no real author/comment/created_at yet, so it can't use
 * annotationTitle or the click-to-manage popup a real mark gets. */
export const PENDING_ANNOTATION_ID = "__pending__";

/** Author (+ comment) + when it was made — mirrors share_view.py's
 * _annotation_title exactly (same hover-tooltip/sidebar text shape), so a
 * mark's title attribute and the sidebar list always show the same info. */
export function annotationTitle(ann: Annotation): string {
  const when = new Date(ann.created_at).toLocaleString("de-CH", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const who = ann.comment ? `${ann.author_name}: ${ann.comment}` : ann.author_name;
  return `${who} (${when})`;
}

/** React counterpart to share_view.py's _wrap_highlights — wraps the FIRST
 * occurrence of each highlight-annotation's saved substring in a <mark>,
 * matching by content (not a stored offset, same reasoning as the Python
 * version: this field's text can't be edited from this read-only-except-
 * comments page, so the substring is always still there to find).
 *
 * Simplification vs. the Python version: that one operates on the escaped
 * HTML STRING, so a later annotation's needle search can match text that's
 * already INSIDE an earlier <mark> (deliberately, "overlapping annotations
 * can re-wrap an already-marked span... rare, and still shows something
 * rather than silently dropping one"). Nesting a React <mark> inside
 * another isn't worth the complexity for that rare case — this version only
 * searches PLAIN (not-yet-marked) text segments, and simply skips an
 * annotation whose substring only exists inside an already-marked span
 * instead of nesting. Both are graceful degradations of the same rare edge
 * case, just a different one.
 */
export function wrapHighlights(
  rawText: string,
  annotations: Annotation[],
  onMarkClick?: (annotation: Annotation) => void,
  onMarkHoverChange?: (annotationId: string | null) => void
): ReactNode[] {
  type Segment = { text: string; ann: Annotation | null };
  let segments: Segment[] = [{ text: rawText, ann: null }];
  const sorted = [...annotations].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  for (const ann of sorted) {
    if (!ann.text) continue;
    let matched = false;
    const next: Segment[] = [];
    for (const seg of segments) {
      if (!matched && seg.ann === null) {
        const idx = seg.text.indexOf(ann.text);
        if (idx !== -1) {
          if (idx > 0) next.push({ text: seg.text.slice(0, idx), ann: null });
          next.push({ text: ann.text, ann });
          const rest = seg.text.slice(idx + ann.text.length);
          if (rest) next.push({ text: rest, ann: null });
          matched = true;
          continue;
        }
      }
      next.push(seg);
    }
    segments = next;
  }
  return segments.map((seg, i) => {
    if (!seg.ann) {
      // eslint-disable-next-line react/no-array-index-key
      return <span key={i}>{seg.text}</span>;
    }
    // 2026-07-22, Lino: "die Markierung muss auch da bleiben wenn das
    // Kommentarfeld aufgeht" — selecting text used to clear the native
    // browser selection (see preview-scenes/[token]/page.tsx's
    // handleMouseUp) with nothing rendered in its place until the comment
    // was actually saved, so the mark visibly vanished for the whole time
    // the popup was open. The caller now injects a synthetic pending
    // annotation for the in-progress selection — render it with a distinct
    // (blue, not-yet-clickable) style since it has no real author/comment/
    // id to show yet.
    if (seg.ann.id === PENDING_ANNOTATION_ID) {
      return (
        <mark key={i} className="annot-mark bg-blue-400/30 text-inherit rounded-[3px] px-0.5 box-decoration-clone">
          {seg.text}
        </mark>
      );
    }
    return (
      <mark
        key={i}
        className="annot-mark bg-yellow-400/30 text-inherit rounded-[3px] px-0.5 cursor-help box-decoration-clone"
        title={annotationTitle(seg.ann)}
        data-annotation-id={seg.ann.id}
        onClick={(e) => {
          if (onMarkClick) {
            e.stopPropagation();
            onMarkClick(seg.ann!);
          }
        }}
        onMouseEnter={() => onMarkHoverChange?.(seg.ann!.id)}
        onMouseLeave={() => onMarkHoverChange?.(null)}
      >
        {seg.text}
      </mark>
    );
  });
}

/** Idea.text counterpart to wrapHighlights (2026-07-21, #268 follow-up) —
 * idea descriptions are sanitized rich-text HTML (bold/italic/div/big/
 * small/code, see richText.ts's ALLOWED_TAGS), already run through
 * renderIdeaForPresentation + sanitizeRichTextHtml by the caller and
 * normally just dropped into dangerouslySetInnerHTML. That string approach
 * can't also carry an onClick handler or a React key per <mark>, so this
 * parses the (already-sanitized) HTML with DOMParser and rebuilds it as
 * real React elements instead, applying wrapHighlights' own segment-
 * splitting logic to each TEXT node it encounters (element nodes are just
 * recreated with their tag + class preserved, then recursed into).
 *
 * Same graceful-degradation choice wrapHighlights' own doc comment
 * describes: a highlight's substring is only ever searched for WITHIN a
 * single text node (i.e. it can't span across a <b>/<i> boundary) — a
 * selection that crossed such a boundary would already be an edge case
 * (window.getSelection().toString() ignores tags, so a saved ann.text
 * COULD span one), and silently not-rendering that one mark is preferable
 * to the complexity of splicing a <mark> across sibling elements. A
 * `usedIds` set (vs. wrapHighlights' single flat pass) makes sure a given
 * annotation is only ever wrapped once across the WHOLE tree, not once per
 * text node it happens to also textually match in (e.g. a repeated word).
 *
 * DOMParser is browser-only — SSR (or the brief window before hydration)
 * falls back to plain dangerouslySetInnerHTML, same guard
 * sanitizeRichTextHtml itself already uses for the same reason. */
export function wrapHighlightsInHtml(
  html: string,
  annotations: Annotation[],
  onMarkClick?: (annotation: Annotation) => void,
  onMarkHoverChange?: (annotationId: string | null) => void
): ReactNode {
  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    // eslint-disable-next-line react/no-danger
    return <span dangerouslySetInnerHTML={{ __html: html }} />;
  }

  const sorted = [...annotations].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const usedIds = new Set<string>();
  let keySeq = 0;

  function wrapTextContent(text: string): ReactNode[] {
    type Segment = { text: string; ann: Annotation | null };
    let segments: Segment[] = [{ text, ann: null }];
    for (const ann of sorted) {
      if (!ann.text || usedIds.has(ann.id)) continue;
      let matched = false;
      const next: Segment[] = [];
      for (const seg of segments) {
        if (!matched && seg.ann === null) {
          const idx = seg.text.indexOf(ann.text);
          if (idx !== -1) {
            if (idx > 0) next.push({ text: seg.text.slice(0, idx), ann: null });
            next.push({ text: ann.text, ann });
            const rest = seg.text.slice(idx + ann.text.length);
            if (rest) next.push({ text: rest, ann: null });
            matched = true;
            usedIds.add(ann.id);
            continue;
          }
        }
        next.push(seg);
      }
      segments = next;
    }
    return segments.map((seg) => {
      const key = `s${keySeq++}`;
      if (!seg.ann) return <React.Fragment key={key}>{seg.text}</React.Fragment>;
      const ann = seg.ann;
      // See wrapHighlights' own PENDING_ANNOTATION_ID branch — same
      // not-yet-saved-selection case, just on the idea title/text side.
      if (ann.id === PENDING_ANNOTATION_ID) {
        return (
          <mark key={key} className="annot-mark bg-blue-400/30 text-inherit rounded-[3px] px-0.5 box-decoration-clone">
            {seg.text}
          </mark>
        );
      }
      return (
        <mark
          key={key}
          className="annot-mark bg-yellow-400/30 text-inherit rounded-[3px] px-0.5 cursor-help box-decoration-clone"
          title={annotationTitle(ann)}
          data-annotation-id={ann.id}
          onClick={(e) => {
            if (onMarkClick) {
              e.stopPropagation();
              onMarkClick(ann);
            }
          }}
          onMouseEnter={() => onMarkHoverChange?.(ann.id)}
          onMouseLeave={() => onMarkHoverChange?.(null)}
        >
          {seg.text}
        </mark>
      );
    });
  }

  function renderNode(node: ChildNode): ReactNode {
    if (node.nodeType === Node.TEXT_NODE) {
      return wrapTextContent(node.textContent ?? "");
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();
      const props: Record<string, unknown> = { key: `e${keySeq++}` };
      if (el.className) props.className = el.className;
      // Void elements (only <br> can occur here, see richText.ts's
      // ALLOWED_TAGS) MUST NOT be given a children prop at all — not even
      // an empty array — or React throws "voidElementTag must neither
      // have children nor use dangerouslySetInnerHTML" (minified error
      // #137). el.childNodes is always empty for <br> anyway (void in
      // HTML), so this only ever changes behavior for that one tag.
      if (tag === "br") return React.createElement(tag, props);
      const children = Array.from(el.childNodes).map((c) => renderNode(c));
      return React.createElement(tag, props, children);
    }
    return null;
  }

  const doc = new DOMParser().parseFromString(html, "text/html");
  return <>{Array.from(doc.body.childNodes).map((n) => renderNode(n))}</>;
}
