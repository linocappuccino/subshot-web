"use client";

import { useEffect, useRef, useState } from "react";
import { sanitizeRichTextHtml } from "@/lib/richText";
import { useLanguage } from "@/lib/i18n";

type SlashOption = { label: string; icon: string; kind: "scene" | "dialog" | "title" | "description" };

// icon+label here must match the backend's marker prefixes exactly
// (_IDEA_SCENE_MARKER/_IDEA_INTERMEDIATE_MARKER in app/main.py) — the emoji
// is part of the literal marker text, not just decoration, so a block's
// start is visible in the text itself the instant it's inserted (2026-07-18,
// Todoist #184: "Anfang... soll mit einem kleinen Symbol im Text sichtbar
// dargestellt werden").
const TOP_LEVEL_OPTIONS: SlashOption[] = [
  { label: "Szene/Shot", icon: "🎬", kind: "scene" },
  { label: "Zwischenschritt", icon: "🔀", kind: "scene" },
];
// 2026-07-18, Todoist #200 — offered INSTEAD of the top-level options while
// already inside an open scene/Zwischenschritt block (nesting Szene/
// Zwischenschritt again inside one wouldn't make sense). Must match
// _IDEA_DIALOG_MARKER/_IDEA_TITLE_MARKER in app/main.py.
const DIALOG_OPTION: SlashOption = { label: "Dialog", icon: "🗣️", kind: "dialog" };
const TITLE_OPTION: SlashOption = { label: "Titel", icon: "📝", kind: "title" };
// 2026-07-21 (#266) — same one-level nesting as Dialog/Titel. Must match
// _IDEA_DESCRIPTION_MARKER in app/main.py. Functionally this doesn't change
// WHERE the text ends up (a plain scene-body line already becomes
// Scene.description with or without this marker, see main.py's own doc
// comment) — it only gives that text its own visible open/close boundary,
// so closing it doesn't also close the enclosing scene.
const DESCRIPTION_OPTION: SlashOption = { label: "Beschreibung", icon: "📄", kind: "description" };
// End-of-block cap (2026-07-18, Todoist #184) — inserted automatically when
// Enter is pressed on an already-blank line while a block is still open
// (see insertEndMarker below), so "Anfang und Ende" both get a visible
// symbol, not just the start. Neutralized back to a blank line server-side
// before block-splitting (see _idea_plain_text's own doc comment in
// app/main.py) — purely cosmetic, never leaks into a scene's description.
// 2026-07-18, Todoist #196 (Lino: "das Symbol... ist zu gross, können wir
// hier keine dezente ---- Linie machen?") — the ⏹ glyph rendered too big/
// heavy; a plain dash run reads as a subtle divider instead.
// 2026-07-18, Todoist #205 (Lino: "es braucht für alles unterschiedliche
// Markierungen damit man sieht was zu was gehört") — one distinct pattern
// per block type that can close.
// 2026-07-18, Todoist #209 (Lino) — dash/dot/underscore runs replaced with
// readable text, matching the backend's own three regexes exactly
// (_IDEA_SCENE_END_MARKER_RE/_IDEA_DIALOG_END_MARKER_RE/
// _IDEA_TITLE_END_MARKER_RE in app/main.py, all case-insensitive and
// tolerant of dash count/whitespace — this exact string isn't
// load-bearing, just needs to match "-+\s*end\s*<word>").
const SCENE_END_MARKER = "-- end scene";
const DIALOG_END_MARKER = "--- end dialog";
const TITLE_END_MARKER = "--- end title";
const DESCRIPTION_END_MARKER = "--- end description";
// 2026-07-18, Todoist #209/#211 — one regex per marker type (shared by
// isOnMarkerLine, tryUndoClose and reopenEnclosingBlock below, so there's
// exactly one place that defines what each marker looks like), plus a
// combined one matching any of the three. All tolerant of dash count/
// whitespace, same as the backend's own three regexes.
const SCENE_END_RE = /^-+\s*end\s*scene$/i;
const DIALOG_END_RE = /^-+\s*end\s*dialog$/i;
const TITLE_END_RE = /^-+\s*end\s*title$/i;
const DESCRIPTION_END_RE = /^-+\s*end\s*description$/i;
const MARKER_LINE_RE = /^-+\s*end\s*(scene|dialog|title|description)$/i;
// 2026-07-21 (#265) — shared opener-prefix strings, used by
// cleanupOrphanedEndMarkers below to detect whether a line is still a real
// opening marker for its kind (also mirrors the prefixes
// deriveOpenBlockFromContent derives locally further down).
const SCENE_PREFIXES = TOP_LEVEL_OPTIONS.map((o) => `${o.icon} ${o.label}:`);
const DIALOG_PREFIX = `${DIALOG_OPTION.icon} ${DIALOG_OPTION.label}:`;
const TITLE_PREFIX = `${TITLE_OPTION.icon} ${TITLE_OPTION.label}:`;
const DESCRIPTION_PREFIX = `${DESCRIPTION_OPTION.icon} ${DESCRIPTION_OPTION.label}:`;

/** Finds the first occurrence of `searchText` across ALL of `container`'s
 * text nodes (in document order) and returns a Range spanning it, or null
 * if it can't be found — e.g. it's been edited away, or (same limitation
 * PublicHighlightedText.tsx's own wrapHighlights/wrapHighlightsInHtml
 * already document) it crosses a tag boundary like a <b>/<i> the saved
 * substring didn't originally respect. First-match-only, same convention
 * those two use. */
function findTextRange(container: Node, searchText: string): Range | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let fullText = "";
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const textNode = node as Text;
    textNodes.push(textNode);
    fullText += textNode.textContent ?? "";
  }
  const startIdx = fullText.indexOf(searchText);
  if (startIdx === -1) return null;
  const endIdx = startIdx + searchText.length;

  let offset = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;
  for (const textNode of textNodes) {
    const len = textNode.textContent?.length ?? 0;
    if (startNode === null && offset + len > startIdx) {
      startNode = textNode;
      startOffset = startIdx - offset;
    }
    if (endNode === null && offset + len >= endIdx) {
      endNode = textNode;
      endOffset = endIdx - offset;
      break;
    }
    offset += len;
  }
  if (!startNode || !endNode) return null;
  const range = new Range();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}

/** Selection-triggered formatting toolbar (Bold/Italic) over a
 * contentEditable field — the WYSIWYG counterpart to the plain Textarea
 * used everywhere else, only for Idea.text (2026-07-17). Uses the
 * browser's own document.execCommand for bold/italic — deprecated API,
 * but still universally supported for exactly this narrow case (no rich
 * text library pulled in for two buttons), and every edit is re-sanitized
 * down to a tiny tag whitelist before it's ever saved (see richText.ts). */
export type TextHighlight = { id: string; text: string };

export function RichTextEditor({
  value,
  onChange,
  disabled,
  placeholder,
  className,
  highlights,
  activeHighlightId,
}: {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /** 2026-07-31, Lino: "man muss die Text-Markierung immer so sehen wie sie
   * auch gemacht wurde" — Textmarker-Kommentare (from the public preview,
   * see PublicHighlightedText.tsx) rendered here via the CSS Custom
   * Highlight API (`CSS.highlights`/`Highlight`) rather than injecting real
   * `<mark>` elements into the DOM: that would mean mutating THIS
   * component's own contentEditable content, which risks corrupting the
   * caret position / the "/" marker-scanning state this file's refs track
   * (see the file-level doc comment on why this component exists in the
   * first place) — exactly what the old read-only-overlay-instead-of-the-
   * editor workaround was built to avoid. A registered Highlight is a pure
   * PAINT layer on top of the existing DOM/text nodes — it never touches
   * `ref.current`'s actual structure, so it's safe to keep active while
   * the user is mid-edit. Gracefully does nothing in a browser without
   * CSS.highlights support (rare in 2026, but if it happens the text is
   * still fully readable/editable, just without the highlight color). */
  highlights?: TextHighlight[];
  /** The one highlight (if any) to render brighter — e.g. just clicked from
   * the feedback panel below. */
  activeHighlightId?: string | null;
}) {
  const { t } = useLanguage();
  const ref = useRef<HTMLDivElement>(null);
  // Starts at `null`, NOT `value` — the contentEditable div never gets its
  // initial content from React's own render (no children/
  // dangerouslySetInnerHTML on it, only the imperative innerHTML write
  // below), so the first sync run must always fire to actually populate
  // it. Initializing this ref to `value` made that first check
  // (`value !== lastValue.current`) false, skipping the write entirely —
  // real bug found 2026-07-17: an idea's saved text never appeared at all
  // when the card was reopened, only after the NEXT edit changed it.
  const lastValue = useRef<string | null>(null);
  const [toolbarPos, setToolbarPos] = useState<{ top: number; left: number } | null>(null);
  // 2026-07-18, Lino: "wenn man eine Idee im Textfeld schreibt soll man mit
  // / ein kleines Untermenü aufmachen können (wie beim Code schreiben)...
  // Szene/Shot, Zwischenschritt... mit Tab oder Pfeiltasten nach unten
  // wechseln, mit Enter bestätigen" — matching markers parsed server-side
  // at "Abgenommen" time (see approve_idea/_parse_idea_scene_markers in
  // app/main.py) to auto-generate ordered Scene/Zwischenschritt tiles.
  const [slashMenu, setSlashMenu] = useState<{ top: number; left: number; index: number; options: SlashOption[] } | null>(null);
  // 2026-07-18 (Todoist #184) — true from the moment a slash marker is
  // inserted until its block gets an end cap (see closeInnermostBlock), so
  // a second Enter-on-blank-line knows there's an open block to close.
  const openMarkerRef = useRef(false);
  // 2026-07-18 (Todoist #200) — nesting state for the /Dialog and /Titel
  // sub-markers, only reachable while openMarkerRef is true:
  // - openDialogRef: inside a /Dialog sub-block. A blank-line-or-dash-cap
  //   Enter here closes JUST the dialog (scene stays open); a plain Enter
  //   on a non-empty dialogue line instead starts the NEXT dialogue line.
  // - inTitleRef: inside a /Titel sub-block. ANY Enter here ends title
  //   mode immediately (single line break, not double — a title is always
  //   exactly one line) and returns to plain scene-description text.
  // - hasTitleRef: this scene block already used its one allowed /Titel —
  //   reset to false only when a NEW /Szene or /Zwischenschritt is
  //   inserted (see confirmSlash's "scene" branch).
  const openDialogRef = useRef(false);
  const inTitleRef = useRef(false);
  const hasTitleRef = useRef(false);
  // 2026-07-21 (#266) — /beschreibung nesting, same shape as the Dialog
  // refs above: openDescriptionRef true while inside an open /beschreibung
  // block, hasDescriptionRef true once this scene has used its one
  // (single-use, like Titel — reset only by a new /Szene, see confirmSlash).
  const openDescriptionRef = useRef(false);
  const hasDescriptionRef = useRef(false);
  // 2026-07-19, Lino: "kann man den cursor reinsetzen aber keine
  // Zeilenumbrüche hinzufügen" turned out to be this — confirmSlash already
  // seeds a blank line right after the marker for the user to type into;
  // pressing Enter on THAT still-pristine blank line used to close the
  // scene immediately (isCurrentLineEmpty() was true from the very start,
  // no typing or Enter required first), so a user whose first action was
  // Enter got an instant close instead of a second blank line to write on —
  // reads exactly like "Enter does nothing useful here". Also the reason
  // #233 ("IMMER mit 2 Zeilenschlägen schliessbar") wasn't quite true:
  // closing only needed ONE Enter in this specific case. True from
  // confirmSlash's "scene" branch until the block's first real interaction
  // (any typed character, or any Enter press) — after that, the ORIGINAL
  // isCurrentLineEmpty()-closes-on-Enter logic is exactly double-Enter
  // already (Enter #1 turns a content line blank, Enter #2 closes it), so
  // this flag only ever needs to absorb that one specific pristine case.
  const sceneNeverTouchedRef = useRef(false);
  // 2026-07-19, Lino: "wenn man bei /dialog direkt nach dem dialog: klickt
  // und Enter drückt, wird auf der nächsten Zeile kein Dialog generiert" —
  // exact same root cause as sceneNeverTouchedRef above, one level deeper:
  // confirmSlash's "dialog" branch ALSO seeds a pristine continuation line
  // (insertDialogContinuation, seeded with just the icon) — pressing Enter
  // on it before typing any real dialogue is indistinguishable from
  // isDialogLineEmpty()'s "blank, close it" case, so the dialog closed
  // instantly instead of getting a second line to actually write on. Only
  // ever needs to absorb that one pristine case, same shape as the scene
  // version — cleared on real typing, only set by confirmSlash (NOT by
  // reopenEnclosingBlock's dialog-reopen branch: reopening means the
  // dialog already had real content before, that's the normal
  // one-more-Enter-closes-it case, not a pristine one).
  const dialogNeverTouchedRef = useRef(false);
  // 2026-07-21 (#266) — same pristine-first-Enter fix as
  // sceneNeverTouchedRef, one nesting level over: confirmSlash's
  // "description" branch also seeds a blank (non-prefixed) continuation
  // line, so the very first Enter needs to be absorbed as real interaction
  // instead of closing the still-empty block immediately.
  const descriptionNeverTouchedRef = useRef(false);
  const [shiftHint, setShiftHint] = useState(false);

  // Sync external value changes (switching idea, external autosave echo)
  // WITHOUT resetting the caret mid-typing — only touches innerHTML when
  // the incoming value differs from what THIS component itself last
  // produced (see handleInput's lastValue.current write, same instant it
  // calls onChange).
  useEffect(() => {
    if (ref.current && value !== lastValue.current) {
      // 2026-07-22 (security audit finding, CRITICAL) — sanitizeRichTextHtml
      // used to only run in handleInput (i.e. starting from the NEXT
      // keystroke) — the very first load of any external value (switching
      // idea, an autosave echo, or data that arrived via any path other
      // than typing in THIS editor, e.g. a direct API call) went straight
      // into innerHTML unsanitized. Defense-in-depth alongside the
      // server-side sanitization added the same day in main.py's
      // create_idea/patch_idea.
      const clean = sanitizeRichTextHtml(value);
      ref.current.innerHTML = clean;
      lastValue.current = clean;
    }
  }, [value]);

  // Paints `highlights` over the CURRENT dom text nodes — see this
  // component's own `highlights` prop doc comment for why this uses
  // CSS.highlights instead of real <mark> elements. Re-runs on every
  // `value` change (both external syncs above AND the user's own typing,
  // which round-trips through the parent's onChange back into this same
  // prop) so a highlight keeps tracking its text as long as that text still
  // exists somewhere in the document, and simply stops rendering (no error)
  // once it's been edited away.
  useEffect(() => {
    const container = ref.current;
    if (!container || typeof CSS === "undefined" || !CSS.highlights || typeof Highlight === "undefined") return;
    const normalRanges: Range[] = [];
    let activeRange: Range | null = null;
    for (const h of highlights ?? []) {
      if (!h.text) continue;
      const range = findTextRange(container, h.text);
      if (!range) continue;
      if (h.id === activeHighlightId) activeRange = range;
      else normalRanges.push(range);
    }
    if (normalRanges.length > 0 || activeRange) {
      CSS.highlights.set("subshot-idea-highlight", new Highlight(...normalRanges, ...(activeRange ? [activeRange] : [])));
    } else {
      CSS.highlights.delete("subshot-idea-highlight");
    }
    if (activeRange) {
      CSS.highlights.set("subshot-idea-highlight-active", new Highlight(activeRange));
      // Bring the actual highlighted text into view — same "clicked a
      // comment below, scroll to its mark above" behavior the old
      // read-only-overlay version had, just computed from the Range
      // instead of a real DOM element.
      (activeRange.startContainer.parentElement ?? container).scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      CSS.highlights.delete("subshot-idea-highlight-active");
    }
    return () => {
      CSS.highlights.delete("subshot-idea-highlight");
      CSS.highlights.delete("subshot-idea-highlight-active");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, highlights, activeHighlightId]);

  function updateToolbar() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount || !ref.current) {
      setToolbarPos(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!ref.current.contains(range.commonAncestorContainer)) {
      setToolbarPos(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    const containerRect = ref.current.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      setToolbarPos(null);
      return;
    }
    // 2026-07-18, Lino: "hat man einen Text ganz oben im Textfeld
    // geschrieben und markiert ihn... verschwindet das Menü hinter dem
    // Bild hochladen/AI-Button" — root cause: the toolbar always rendered
    // ABOVE the selection (top - 42px), which for a selection near the
    // very top of the field lands the toolbar ABOVE the field's own box
    // entirely, under whatever sits there instead (the upload/AI button
    // row in IdeaFloatingCard). Flip below the selection when there isn't
    // enough room above it, and bump z-index so it's never masked by a
    // sibling either way.
    const relativeTop = rect.top - containerRect.top;
    const toolbarHeight = 42;
    setToolbarPos({
      top: relativeTop >= toolbarHeight ? relativeTop - toolbarHeight : rect.bottom - containerRect.top + 8,
      left: Math.max(0, Math.min(rect.left - containerRect.left, containerRect.width - 120)),
    });
  }

  function handleInput() {
    if (!ref.current) return;
    // 2026-07-21 (#265) — BEFORE reading innerHTML for sanitization/save,
    // so an orphan-cleanup removal is reflected in what actually gets
    // persisted, not left stranded until the NEXT edit.
    cleanupOrphanedEndMarkers();
    const clean = sanitizeRichTextHtml(ref.current.innerHTML);
    lastValue.current = clean;
    onChange(clean);
    checkSlashTrigger();
    // Any real typed character is "touching" the block — see
    // sceneNeverTouchedRef's/dialogNeverTouchedRef's own doc comments.
    sceneNeverTouchedRef.current = false;
    dialogNeverTouchedRef.current = false;
    descriptionNeverTouchedRef.current = false;
  }

  /** 2026-07-21 (#265, Lino: "wenn ich einen dialog lösche bleibt der end
   * dialog text trotzdem bestehen... dies muss bei allen / optionen so
   * passieren") — deleting an OPENING marker line (select it + Backspace,
   * Delete, cut, typing over a selection spanning it — all reach here via
   * the same onInput) used to leave its end-marker line stranded further
   * down, since nothing ever re-validated that a still-present end-marker
   * still has a matching, still-open opener before it. Runs a full
   * top-to-bottom rescan on EVERY input instead of trying to special-case
   * each possible deletion gesture: any end-marker line encountered while
   * its kind isn't currently "open" (per this same scan) is orphaned and
   * gets removed; the three openXRef flags are re-synced to whatever's
   * genuinely still open once the scan finishes, so refs can never drift
   * from the actual document content. Mirrors the one-level nesting rule
   * used everywhere else in this file (Dialog/Titel/Beschreibung only
   * nest inside Szene/Zwischenschritt, never inside each other). */
  function cleanupOrphanedEndMarkers() {
    if (!ref.current) return;
    // childNodes (not `.children`) — confirmSlash inserts the VERY FIRST
    // marker of a fresh editor as a bare top-level Text node (whatever the
    // caret's insertion point already was, no wrapping <div>), only every
    // SUBSEQUENT line via insertLineAfter is a real <div> — `.children`
    // silently skips that first line entirely, which made this scan think
    // there was never an opener at all and wrongly reset openMarkerRef to
    // false on every single keystroke after the first (real bug hit while
    // testing this: the slash-menu's nested Beschreibung/Titel/Dialog
    // options disappeared again after the first character typed following
    // the initial marker insert).
    const lines = Array.from(ref.current.childNodes);
    // 2026-07-27 (Lino: "benutzt man die / funktion... geht dann auf den
    // präsentationsmodus und wieder zurück, funktionieren die gesetzten /
    // funktionen nicht mehr") — root cause, found via a Playwright repro
    // (byte-identical before/after the presenting round-trip ruled out any
    // actual data corruption; the bug is state-only): this scan used to
    // ALWAYS write the openXRef flags as whatever they were at the very
    // END of the whole document, regardless of where the caret currently
    // sits. That's correct for the common case (caret at the true end,
    // past every closed block), but wrong the moment the caret is
    // positioned INSIDE an earlier block that already has its own valid,
    // still-present end-marker further down (e.g.: click back onto an
    // already-closed scene's last content line and press Enter to add one
    // more line — completely normal multi-line editing). The scan walked
    // straight past that end-marker to reach the document's end, saw the
    // block as closed there, and stomped openMarkerRef back to false even
    // though the caret never left it — the very next "/" then wrongly
    // offered the top-level Szene/Zwischenschritt menu instead of the
    // nested Dialog/Titel/Beschreibung one. Reproduced identically with NO
    // presenting toggle involved at all (just click-back-in + Enter), so
    // presenting isn't the actual trigger — it just makes clicking back
    // into earlier content likely, since remounting loses the caret's old
    // position. Fix: track state as of the caret's OWN line (found via the
    // same childNodes list, so the bare-first-line-marker case above is
    // still handled) separately from the full-document scan the orphan
    // removal below still needs; the refs reflect THAT, not the document's
    // end, whenever there's a live caret inside this editor to anchor to.
    let caretNode: Node | null = null;
    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      let n: Node | null = sel.getRangeAt(0).startContainer;
      while (n && n.parentNode !== ref.current) n = n.parentNode;
      if (n && n.parentNode === ref.current) caretNode = n;
    }
    let sceneOpen = false;
    let dialogOpen = false;
    let titleOpen = false;
    let descriptionOpen = false;
    let caretState: { scene: boolean; dialog: boolean; title: boolean; description: boolean } | null = null;
    const toRemove: ChildNode[] = [];
    for (const line of lines) {
      const text = (line.textContent ?? "").trim();
      if (DIALOG_END_RE.test(text)) {
        if (dialogOpen) dialogOpen = false;
        else toRemove.push(line);
      } else if (TITLE_END_RE.test(text)) {
        if (titleOpen) titleOpen = false;
        else toRemove.push(line);
      } else if (DESCRIPTION_END_RE.test(text)) {
        if (descriptionOpen) descriptionOpen = false;
        else toRemove.push(line);
      } else if (SCENE_END_RE.test(text)) {
        if (sceneOpen) {
          sceneOpen = false;
          dialogOpen = false;
          titleOpen = false;
          descriptionOpen = false;
        } else {
          toRemove.push(line);
        }
      } else if (text.startsWith(DIALOG_PREFIX)) {
        dialogOpen = true;
      } else if (text.startsWith(TITLE_PREFIX)) {
        titleOpen = true;
      } else if (text.startsWith(DESCRIPTION_PREFIX)) {
        descriptionOpen = true;
      } else if (SCENE_PREFIXES.some((p) => text.startsWith(p))) {
        sceneOpen = true;
        dialogOpen = false;
        titleOpen = false;
        descriptionOpen = false;
      }
      // Snapshot AFTER this line's own effects are applied — landing
      // exactly ON an opener line reads as "inside" it (correct: the next
      // "/" typed right after inserting a marker must see it as open),
      // landing ON an end-marker line reads as "not inside" (also correct,
      // isOnMarkerLine's own dedicated handling covers that caret position
      // separately anyway).
      if (!caretState && line === caretNode) {
        caretState = { scene: sceneOpen, dialog: dialogOpen, title: titleOpen, description: descriptionOpen };
      }
    }
    toRemove.forEach((line) => line.remove());
    const finalState = caretState ?? { scene: sceneOpen, dialog: dialogOpen, title: titleOpen, description: descriptionOpen };
    openMarkerRef.current = finalState.scene;
    openDialogRef.current = finalState.dialog;
    inTitleRef.current = finalState.title;
    openDescriptionRef.current = finalState.description;
  }

  // Opens the slash menu right after a "/" is typed at the start of a
  // line/word (not mid-word — "10/07" shouldn't trigger it). Deliberately
  // does NOT support filtering by typing after the "/": the menu closes the
  // moment the caret moves or another character is typed (see onKeyDown/
  // onSelect below), keeping the invariant that "the character immediately
  // before the caret is the triggering slash" valid for confirmSlash's
  // delete-1-char-back logic.
  function checkSlashTrigger() {
    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed || !sel.rangeCount || !ref.current) {
      setSlashMenu(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (!ref.current.contains(node) || node.nodeType !== Node.TEXT_NODE) {
      setSlashMenu(null);
      return;
    }
    const offset = range.startOffset;
    const textBefore = (node.textContent ?? "").slice(0, offset);
    const charBeforeSlash = textBefore.slice(-2, -1);
    const isTrigger = textBefore.endsWith("/") && (offset === 1 || /\s/.test(charBeforeSlash));
    if (!isTrigger) {
      setSlashMenu(null);
      return;
    }
    // 2026-07-18, Todoist #200 — which options the menu offers depends on
    // nesting: no menu at all while inside /Dialog or /Titel (neither
    // supports its own nested slash command), just "Dialog"+"Titel" (minus
    // Titel if this block already used its one) while inside an open
    // scene/Zwischenschritt, otherwise the original top-level pair.
    let options: SlashOption[];
    if (openDialogRef.current || inTitleRef.current || openDescriptionRef.current) {
      setSlashMenu(null);
      return;
    } else if (openMarkerRef.current) {
      // 2026-07-19, Lino: Titel soll vor Dialog stehen (vorher umgekehrt).
      // 2026-07-21 (#266): Beschreibung zuerst, dann Titel, dann Dialog.
      // 2026-07-30 (#383): korrigiert auf Titel, dann Beschreibung, dann
      // Dialog — beide Titel/Beschreibung sind single-use pro Szene, fallen
      // aus dem Menü sobald einmal benutzt (hasTitleRef/hasDescriptionRef).
      options = [
        ...(hasTitleRef.current ? [] : [TITLE_OPTION]),
        ...(hasDescriptionRef.current ? [] : [DESCRIPTION_OPTION]),
        DIALOG_OPTION,
      ];
    } else {
      options = TOP_LEVEL_OPTIONS;
    }
    // 2026-07-27, Lino: "der / dialog... ist viel zu weit oben" — a
    // collapsed Range's getBoundingClientRect() is a known Chrome/WebKit
    // quirk: it can come back with top=0 (rest of the box may look fine)
    // exactly at the "/" trigger moment, which silently made `top` collapse
    // to roughly `-containerRect.top` — miles above the caret for any
    // editor not pinned to the top of the page. getClientRects()[0] (the
    // caret's own line-box rect, not the Range's overall bounding box)
    // doesn't have this quirk and is the standard workaround other
    // contentEditable editors use here — prefer it, falling back to
    // getBoundingClientRect only if it's unavailable (e.g. an empty line).
    const clientRects = range.getClientRects();
    const rect = clientRects.length > 0 ? clientRects[0] : range.getBoundingClientRect();
    const containerRect = ref.current.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0 && rect.top === 0 && rect.left === 0) {
      setSlashMenu(null);
      return;
    }
    // 2026-07-30, Lino: "am unteren text rand wird das / menü im textfeld
    // abgeschnitten" — the menu is `position: absolute` inside this editor's
    // own relatively-positioned wrapper, so it gets clipped by whichever
    // ancestor actually scrolls (IdeaFloatingCard's text column is
    // `overflow-y-auto`), not just by the browser viewport. Opening
    // downward near the bottom of that visible scroll area ran the menu
    // straight past its clipping edge. Same flip-to-above pattern any
    // dropdown uses once it detects too little room below: measure the
    // nearest scrollable ancestor's visible bottom edge (falling back to
    // the viewport if none), and open the menu ABOVE the caret line instead
    // whenever there isn't enough space below it.
    const estimatedMenuHeight = options.length * 30 + 8;
    const clipBottom = getScrollClipBottom(ref.current);
    const spaceBelow = clipBottom - rect.bottom;
    const openAbove = spaceBelow < estimatedMenuHeight + 8 && rect.top - containerRect.top > estimatedMenuHeight;
    const top = openAbove ? rect.top - containerRect.top - estimatedMenuHeight - 4 : rect.top - containerRect.top + 20;
    setSlashMenu({ top, left: Math.max(0, rect.left - containerRect.left), index: 0, options });
  }

  /** 2026-07-18 (Todoist #184/#200) — walks up from `node` to the direct
   * <div> child of the editor root it lives in (a "line"), or null if
   * there isn't one (e.g. `node` already IS the root). Shared by every
   * function below that needs to insert/replace content one line at a
   * time. */
  function findLineNode(node: Node | null): HTMLElement | null {
    while (node && node.parentNode !== ref.current && node !== ref.current) {
      node = node.parentNode;
    }
    return node && node !== ref.current && node instanceof HTMLElement ? node : null;
  }

  /** Inserts a new empty (or text-seeded) line right after `afterLine`
   * (or as the last child if there's no such line yet) and moves the
   * caret into it. Returns the new line so callers can seed it further. */
  function insertLineAfter(sel: Selection, afterLine: HTMLElement | null, seedText?: string): HTMLDivElement {
    const newLine = document.createElement("div");
    if (seedText) newLine.appendChild(document.createTextNode(seedText));
    else newLine.appendChild(document.createElement("br"));
    if (afterLine) afterLine.after(newLine);
    else ref.current?.appendChild(newLine);
    const range = document.createRange();
    if (seedText && newLine.firstChild) range.setStart(newLine.firstChild, seedText.length);
    else range.setStart(newLine, 0);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    return newLine;
  }

  function confirmSlash(index: number) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !ref.current || !slashMenu) {
      setSlashMenu(null);
      return;
    }
    const range = sel.getRangeAt(0);
    // Delete the triggering "/" immediately before the caret (see
    // checkSlashTrigger's invariant note above), then insert the marker.
    const editRange = range.cloneRange();
    editRange.setStart(range.startContainer, Math.max(0, range.startOffset - 1));
    editRange.deleteContents();
    const opt = slashMenu.options[index];
    const textNode = document.createTextNode(`${opt.icon} ${opt.label}:`);
    editRange.insertNode(textNode);
    // 2026-07-18 (Todoist #195): the marker used to leave the caret right
    // after "Szene/Shot: ", so the FIRST thing typed sat on the same line
    // as the marker itself — moved to its own fresh line instead, so
    // writing always starts directly under the marker (Dialog/Titel too).
    // 2026-07-18 (Todoist #209, Lino: "er muss dann direkt den ersten
    // Dialog beginnen") — for Dialog specifically, that fresh line is
    // ALSO seeded with the icon prefix right away, same as every
    // continuation line insertDialogContinuation adds later; the first
    // dialogue entry used to be the one line with no icon at all.
    insertLineAfter(sel, findLineNode(textNode.parentNode), opt.kind === "dialog" ? `${opt.icon} ` : undefined);
    setSlashMenu(null);
    ref.current.focus();
    handleInput();
    if (opt.kind === "scene") {
      // 2026-07-18 (Todoist #184): mark the block open + surface the
      // Shift+Enter hint for a few seconds — "sofort... angelegt" applies
      // to both, right when the marker itself appears, not once the block
      // eventually closes. 2026-07-18 (Todoist #200): a brand-new scene
      // resets hasTitleRef — a NEW block gets its own fresh /Titel slot.
      // 2026-07-21 (#266): same fresh-slot reset for Beschreibung.
      openMarkerRef.current = true;
      openDialogRef.current = false;
      inTitleRef.current = false;
      hasTitleRef.current = false;
      openDescriptionRef.current = false;
      hasDescriptionRef.current = false;
      sceneNeverTouchedRef.current = true;
      setShiftHint(true);
      setTimeout(() => setShiftHint(false), 5000);
    } else if (opt.kind === "dialog") {
      openDialogRef.current = true;
      dialogNeverTouchedRef.current = true;
    } else if (opt.kind === "description") {
      // 2026-07-21 (#266) — same pristine-seeded-blank-line shape as scene
      // itself (confirmSlash inserts a blank, non-prefixed line to write
      // into), single-use per scene like Titel.
      openDescriptionRef.current = true;
      hasDescriptionRef.current = true;
      descriptionNeverTouchedRef.current = true;
    } else {
      // "title" — consumed the instant it's inserted, not once the user
      // finishes typing it (Lino: "taucht Titel nicht mehr in der /
      // Funktion auf" applies right away, so a second /-press mid-typing
      // still correctly excludes it).
      inTitleRef.current = true;
      hasTitleRef.current = true;
    }
  }

  /** 2026-07-18 (Todoist #184) — is the caret currently on an empty
   * top-level line (a direct <div> child of the editor, or the editor root
   * itself when there's no wrapping div yet)? Enter on such a line is the
   * "confirm blank paragraph" gesture that ends a marker's block. */
  function isCurrentLineEmpty(): boolean {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !ref.current) return false;
    const line = findLineNode(sel.getRangeAt(0).startContainer) ?? ref.current;
    return (line.textContent ?? "").trim().length === 0;
  }

  /** 2026-07-18 (Todoist #207) — same as isCurrentLineEmpty, but ALSO
   * treats a line containing only the dialog icon prefix (no real
   * dialogue text after it yet) as empty. Without this, Dialog could
   * never actually close: insertDialogContinuation seeds every new line
   * with "🗣️ " before the user types anything, so isCurrentLineEmpty saw
   * that icon as real content and kept starting yet another continuation
   * line forever instead of ever reaching the "close" branch below. */
  function isDialogLineEmpty(): boolean {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !ref.current) return false;
    const line = findLineNode(sel.getRangeAt(0).startContainer) ?? ref.current;
    const text = (line.textContent ?? "").trim();
    return text.length === 0 || text === DIALOG_OPTION.icon;
  }

  /** 2026-07-18 (Todoist #209, Lino: "man kann sie nicht löschen") — true
   * while the caret sits on a line that IS one of the three end-markers.
   * Guards handleEditorKeyDown against editing them directly (typing over
   * them, Backspace/Delete from inside their own line) — the ONLY
   * sanctioned way to remove one is tryUndoClose's dedicated gesture from
   * the EMPTY line right after it (unaffected by this, since that's a
   * different line). Direct edits would corrupt the exact text the
   * backend's regex needs to match, silently breaking block-parsing. */
  function isOnMarkerLine(): boolean {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !ref.current) return false;
    const line = findLineNode(sel.getRangeAt(0).startContainer);
    if (!line) return false;
    return MARKER_LINE_RE.test((line.textContent ?? "").trim());
  }

  /** Replaces the current (blank) line with `marker` (wrapped in <code>,
   * see #196/#209) and opens a fresh blank line right after it for continued
   * typing — same shape a plain Enter press would have left behind, just
   * with the cap inserted into the line that would otherwise have stayed
   * empty. 2026-07-18 (Todoist #200): closes whichever is innermost — a
   * call site decides that by which ref it clears via `onClosed`.
   * 2026-07-18 (Todoist #205): `marker` is now a parameter, not a single
   * constant — Dialog and Szene/Zwischenschritt each need their OWN
   * distinct cap so it's visible which one just closed. */
  function closeInnermostBlock(marker: string, onClosed: () => void) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !ref.current) return;
    const lineNode = findLineNode(sel.getRangeAt(0).startContainer);
    if (!lineNode) return;
    // 2026-07-18, Todoist #196/#209 — wrapped in <code> (whitelisted by the
    // rich-text sanitizer specifically for this, see richText.ts/
    // idea_share_view.py) + a scoped CSS rule (globals.css/.idea-text code)
    // so the marker line reads as a small, greyed-out system line, not
    // regular editable-looking text.
    lineNode.innerHTML = "";
    const code = document.createElement("code");
    code.textContent = marker;
    lineNode.appendChild(code);
    insertLineAfter(sel, lineNode);
    onClosed();
    handleInput();
  }

  /** 2026-07-18 (Todoist #200) — the "next dialogue line" gesture: plain
   * Enter on a NON-empty line while /Dialog is still open. Each
   * continuation line is re-prefixed with the dialog icon (not the full
   * "Dialog:" label, which only the header line carries — see
   * _IDEA_DIALOG_MARKER/_IDEA_DIALOG_LINE_PREFIX_RE in app/main.py), so
   * every individual dialogue entry stays visibly marked, not just the
   * first one. */
  function insertDialogContinuation() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !ref.current) return;
    insertLineAfter(sel, findLineNode(sel.getRangeAt(0).startContainer), `${DIALOG_OPTION.icon} `);
    handleInput();
  }

  /** 2026-07-18 (Todoist #200) — ends /Titel mode: unlike Dialog/scene
   * blocks, a title is always exactly one line, so the "boundary" a Dialog/
   * Szene block needs doesn't apply here at all — the backend takes the
   * SINGLE line right after "Titel:" as-is regardless of what follows (see
   * title_pending in _parse_idea_scene_markers). 2026-07-18 (Todoist #205):
   * still gets its OWN visible end cap now (an underscore run, recognized
   * server-side purely as "skip this line", never as a boundary — see
   * _IDEA_TITLE_END_MARKER_RE) so title endings are visible same as
   * Dialog/Szene ones, inserted as an EXTRA line after the title text
   * rather than replacing the (still-needed) blank line the way
   * closeInnermostBlock does. */
  function closeTitleMode() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !ref.current) return;
    const titleLine = findLineNode(sel.getRangeAt(0).startContainer);
    const markerLine = document.createElement("div");
    const code = document.createElement("code");
    code.textContent = TITLE_END_MARKER;
    markerLine.appendChild(code);
    if (titleLine) titleLine.after(markerLine);
    else ref.current.appendChild(markerLine);
    insertLineAfter(sel, markerLine);
    handleInput();
  }

  /** 2026-07-18 (Todoist #206, Lino: "sieht man die Endmarkierung, kann
   * man mit Backspace das Symbol löschen und ist wieder im vorherigen
   * Modus") — Backspace on an empty line whose PRECEDING line is exactly
   * one of the three end-cap patterns removes that marker line (and this
   * empty one) and restores whichever mode it closed, cursor landing at
   * the end of whatever came before the marker. Returns whether it
   * actually undid something, so the caller only preventDefault()s the
   * native Backspace when this really applies — every other Backspace
   * keeps its normal browser behavior untouched. */
  function tryUndoClose(): boolean {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !ref.current) return false;
    const currentLine = findLineNode(sel.getRangeAt(0).startContainer);
    if (!currentLine || (currentLine.textContent ?? "").trim().length !== 0) return false;
    const prevLine = currentLine.previousElementSibling;
    if (!prevLine || !(prevLine instanceof HTMLElement)) return false;
    const text = (prevLine.textContent ?? "").trim();
    // 2026-07-18 (Todoist #211) — this used to re-derive a dash/dot/
    // underscore-run pattern from the marker constants' first character,
    // which stopped matching anything the moment #209 changed those
    // constants to readable text ("-- end scene" etc.) — tryUndoClose has
    // silently done nothing since, found while investigating why
    // Backspace-then-stuck was happening. Reuses the same three regexes
    // isOnMarkerLine/reopenEnclosingBlock already share.
    let restore: (() => void) | null = null;
    if (SCENE_END_RE.test(text)) restore = () => (openMarkerRef.current = true);
    else if (DIALOG_END_RE.test(text)) restore = () => (openDialogRef.current = true);
    else if (TITLE_END_RE.test(text)) restore = () => (inTitleRef.current = true);
    else if (DESCRIPTION_END_RE.test(text)) restore = () => (openDescriptionRef.current = true);
    if (!restore) return false;
    const beforeMarker = prevLine.previousElementSibling;
    prevLine.remove();
    currentLine.remove();
    const range = document.createRange();
    if (beforeMarker) range.selectNodeContents(beforeMarker);
    else range.selectNodeContents(ref.current);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    restore();
    handleInput();
    return true;
  }

  /** 2026-07-18 (Todoist #211) — moves the caret to the END of the
   * CURRENT line's preceding sibling. Used right before
   * reopenEnclosingBlock when the caret started out sitting ON a marker
   * line itself (isOnMarkerLine), so that function only ever has to look
   * at "real content, marker somewhere after it" (its one case), not
   * "caret directly on the marker" as a second case — landing on a marker
   * and pressing Enter should behave exactly like clicking the last real
   * line right before it and pressing Enter there. */
  function moveCaretToEndOfPrecedingLine() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !ref.current) return;
    const currentLine = findLineNode(sel.getRangeAt(0).startContainer);
    const prev = currentLine?.previousElementSibling;
    if (!prev) return;
    const range = document.createRange();
    range.selectNodeContents(prev);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /** 2026-07-18 (Todoist #211, Lino: "klickt man zurück in einen bereits
   * abgeschlossenen Block... soll der Block wieder geöffnet werden... die
   * Endmarkierung verschiebt sich dann logischerweise mit dem Text") —
   * walks forward from the CURRENT line through its following siblings,
   * stopping at the first blank line (nothing to reopen, we're not inside
   * a closed block) or the first end-marker found (removes it and
   * reopens the matching mode — no explicit "move" needed: the marker
   * naturally ends up after whatever gets typed next, since it's just a
   * later DOM sibling of the insertion point). A no-op if that mode is
   * already open (nothing to reopen). Returns which kind was reopened, or
   * null if none was. */
  function reopenEnclosingBlock(): "scene" | "dialog" | "title" | "description" | null {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !ref.current) return null;
    const currentLine = findLineNode(sel.getRangeAt(0).startContainer);
    if (!currentLine || (currentLine.textContent ?? "").trim().length === 0) return null;
    // 2026-07-19, Lino: "hat man eine Szene geschlossen... klickt man oben
    // in einen normalen Text und drückt Enter, verschwindet die Schliess-
    // Markierung" — this used to scan forward through EVERY following
    // sibling, silently skipping past any real (non-blank, non-marker)
    // content line to find an end-marker however far below, so pressing
    // Enter anywhere inside an already-closed block's own content — not
    // just right at its boundary — reopened it. Only the line
    // IMMEDIATELY after the caret's line can legitimately be "the marker
    // this Enter is meant to reopen": either isOnMarkerLine's own Enter-
    // exemption already moved the caret to end directly ON the line
    // before a real marker (see moveCaretToEndOfPrecedingLine above), or
    // there's nothing to reopen at all. A real content line found here
    // (as opposed to blank) is exactly the "we're mid-block, not at its
    // edge" case and must return null, not keep searching past it.
    const node = currentLine.nextElementSibling;
    if (!node) return null;
    const text = (node.textContent ?? "").trim();
    if (DIALOG_END_RE.test(text)) {
      if (openDialogRef.current) return null;
      node.remove();
      openDialogRef.current = true;
      return "dialog";
    }
    if (DESCRIPTION_END_RE.test(text)) {
      if (openDescriptionRef.current) return null;
      node.remove();
      openDescriptionRef.current = true;
      return "description";
    }
    if (SCENE_END_RE.test(text)) {
      if (openMarkerRef.current) return null;
      node.remove();
      openMarkerRef.current = true;
      return "scene";
    }
    if (TITLE_END_RE.test(text)) {
      if (inTitleRef.current) return null;
      node.remove();
      inTitleRef.current = true;
      return "title";
    }
    return null;
  }

  /** 2026-07-19, Lino: "muss diese IMMER mit 2 Zeilenschlägen schliessbar
   * sein, auch wenn das die Schliessung mal gelöscht wurde" — openMarkerRef/
   * openDialogRef only ever get set true by confirmSlash or
   * reopenEnclosingBlock (landing exactly ON a leftover end-marker line);
   * neither helps once that end-marker line has been deleted outright (no
   * marker left to land on/reopen) or the component simply remounted (an
   * idea reopened fresh has every ref back at its initial `false`,
   * regardless of what its saved content actually contains). Without this,
   * double-Enter silently did nothing in exactly that case — looked like
   * the block could never be closed again. Scans backward from the current
   * line for the nearest scene/dialog marker that isn't already followed by
   * its own end-marker before reaching here; a real find "reopens" it the
   * same way landing on a marker line does, just via content instead of a
   * literal leftover cap. */
  function deriveOpenBlockFromContent(): { scene: boolean; dialog: boolean } {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !ref.current) return { scene: false, dialog: false };
    const currentLine = findLineNode(sel.getRangeAt(0).startContainer);
    const scenePrefixes = TOP_LEVEL_OPTIONS.map((o) => `${o.icon} ${o.label}:`);
    const dialogPrefix = `${DIALOG_OPTION.icon} ${DIALOG_OPTION.label}:`;
    // 2026-07-27 (Lino's presenting-round-trip report, second mechanism
    // found alongside cleanupOrphanedEndMarkers's own fix above) —
    // childNodes-backed backward walk, not `previousElementSibling`: same
    // bare-first-line-Text-node issue cleanupOrphanedEndMarkers's own doc
    // comment already covers (confirmSlash inserts a fresh editor's VERY
    // FIRST marker as a bare top-level Text node, not a <div>).
    // previousElementSibling silently skips Text-node siblings, so walking
    // backward from a scene's own (still-open, saved) continuation line
    // straight past that first Text-node marker landed on nothing —
    // returning "not open" for exactly the reopened-idea/remount case this
    // function exists for. Confirmed live: after a presenting round-trip,
    // clicking onto a still-open FIRST scene's blank continuation line and
    // pressing Enter (meant to close it) silently did nothing — needed one
    // extra, otherwise-inexplicable Enter press before it worked, because
    // by then a real DOM-mutating input event had already run
    // cleanupOrphanedEndMarkers once and self-healed the ref that way
    // instead.
    const nodes = Array.from(ref.current.childNodes);
    const startIndex = currentLine ? nodes.indexOf(currentLine) : nodes.length;
    let dialog = false;
    let dialogDecided = false;
    for (let i = startIndex - 1; i >= 0; i--) {
      const text = (nodes[i].textContent ?? "").trim();
      if (!dialogDecided) {
        if (DIALOG_END_RE.test(text)) dialogDecided = true;
        else if (text.startsWith(dialogPrefix)) {
          dialog = true;
          dialogDecided = true;
        }
      }
      if (SCENE_END_RE.test(text)) return { scene: false, dialog: false };
      if (scenePrefixes.some((p) => text.startsWith(p))) return { scene: true, dialog };
    }
    return { scene: false, dialog };
  }

  function handleEditorKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // 2026-07-18 (Todoist #209/#211) — see isOnMarkerLine's own doc
    // comment. Checked before everything else, including the slash-menu
    // branch below, since an end-marker line should never be directly
    // editable regardless of what else might be going on. Enter is
    // exempt — landing on a marker and pressing Enter is the sanctioned
    // way to "escape" it and reopen the block it closed (see
    // reopenEnclosingBlock below), not blocked like every other key.
    const NAV_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Tab", "Escape"];
    if (!e.metaKey && !e.ctrlKey && e.key !== "Enter" && !NAV_KEYS.includes(e.key) && isOnMarkerLine()) {
      e.preventDefault();
      return;
    }
    if (!slashMenu) {
      // 2026-07-18 (Todoist #184/#200/#211): plain Enter (not Shift+Enter,
      // which stays a normal in-block line break — contentEditable's own
      // default <br>-not-<div> behavior already does the right thing)
      // drives all the nested block/sub-mode transitions below. First,
      // reopen whatever this Enter's line belongs to if it was already
      // closed (a no-op if nothing needs reopening); THEN dispatch on the
      // now-current ref state, checked innermost first: title mode always
      // ends immediately; an open dialog either starts its next line
      // (non-empty current line) or closes (empty); only once neither of
      // those applies does a blank line close the scene block itself.
      if (e.key === "Enter" && !e.shiftKey) {
        // 2026-07-19 — capture BEFORE moving the caret: reopenEnclosingBlock
        // only checks the immediate next sibling, and the ONLY legitimate
        // way to land with an end-marker as your immediate next sibling
        // while still meaning "reopen it" is having been ON that marker
        // line yourself (moveCaretToEndOfPrecedingLine then steps back to
        // right before it). Editing the last real content line of an
        // already-closed block (whose next sibling genuinely IS that
        // block's own end-marker) is a normal Enter, not a reopen request —
        // without this guard the two were indistinguishable to
        // reopenEnclosingBlock.
        const onMarker = isOnMarkerLine();
        if (onMarker) moveCaretToEndOfPrecedingLine();
        const reopened = onMarker ? reopenEnclosingBlock() : null;
        // Refs alone can lie (deleted end-marker, or a fresh mount) — only
        // trust them once content-derived state agrees at least as far as
        // "we're inside a scene at all". A false-negative here (refs say
        // closed, content says open) gets corrected before dispatching;
        // refs already agreeing is left untouched, so nothing about
        // existing interactive behavior changes mid-session.
        if (!reopened && !openMarkerRef.current) {
          const derived = deriveOpenBlockFromContent();
          if (derived.scene) {
            openMarkerRef.current = true;
            openDialogRef.current = derived.dialog;
          }
        }
        if (reopened === "dialog") {
          e.preventDefault();
          insertDialogContinuation();
        } else if (reopened === "title") {
          e.preventDefault();
          closeTitleMode();
        } else if (reopened === "description") {
          // 2026-07-21 (#266) — same plain-line reopen shape as "scene"
          // below (no icon-prefixed continuation like dialog needs).
          e.preventDefault();
          const sel = window.getSelection();
          if (sel && sel.rangeCount && ref.current) {
            insertLineAfter(sel, findLineNode(sel.getRangeAt(0).startContainer));
            handleInput();
          }
        } else if (reopened === "scene") {
          e.preventDefault();
          const sel = window.getSelection();
          if (sel && sel.rangeCount && ref.current) {
            insertLineAfter(sel, findLineNode(sel.getRangeAt(0).startContainer));
            handleInput();
          }
        } else if (inTitleRef.current) {
          e.preventDefault();
          inTitleRef.current = false;
          closeTitleMode();
        } else if (openDialogRef.current && !isDialogLineEmpty()) {
          e.preventDefault();
          insertDialogContinuation();
        } else if (openDialogRef.current && isDialogLineEmpty()) {
          e.preventDefault();
          if (dialogNeverTouchedRef.current) {
            // The still-pristine seeded "🗣️ " line, never typed into —
            // give it one real continuation line instead of closing on
            // the very first Enter (see dialogNeverTouchedRef's own doc
            // comment). Explicit insertDialogContinuation, not the
            // default Enter behavior sceneNeverTouchedRef relies on —
            // a dialogue line needs its icon PREFIX seeded, which only
            // this helper does.
            dialogNeverTouchedRef.current = false;
            insertDialogContinuation();
          } else {
            closeInnermostBlock(DIALOG_END_MARKER, () => {
              openDialogRef.current = false;
            });
            // 2026-07-27, Lino: "/dialog schliesst zwei mal mit end
            // dialog" — closeInnermostBlock leaves the caret on a fresh
            // blank line right after the new "--- end dialog" marker;
            // without this, that blank line was indistinguishable from an
            // ALREADY-double-Entered blank scene line, so one more Enter
            // (a very natural continuation of the same close gesture)
            // immediately ALSO closed the enclosing scene — one extra
            // press doing two closes back to back, instead of the
            // documented "a second double-Enter afterward closes the
            // Scene" (i.e. a FRESH double-Enter, not one leftover press).
            // Same pristine-line absorption sceneNeverTouchedRef already
            // does for a brand-new scene. Set AFTER closeInnermostBlock
            // returns, not inside onClosed — closeInnermostBlock's own
            // trailing handleInput() call unconditionally resets this same
            // ref to false, which silently undid this when set earlier.
            if (openMarkerRef.current) sceneNeverTouchedRef.current = true;
          }
        } else if (openDescriptionRef.current && isCurrentLineEmpty()) {
          // 2026-07-21 (#266) — closes JUST the /beschreibung nesting, same
          // shape as the scene-close branch below (plain free text, no
          // per-line icon prefix like Dialog — a non-empty line here just
          // falls through to the browser's normal Enter/new-line behavior,
          // unintercepted, exactly like ordinary scene-body text already
          // does when neither Dialog nor Titel is open).
          e.preventDefault();
          if (descriptionNeverTouchedRef.current) {
            descriptionNeverTouchedRef.current = false;
          } else {
            closeInnermostBlock(DESCRIPTION_END_MARKER, () => {
              openDescriptionRef.current = false;
            });
            // Same cascading-close gap as the Dialog fix above, set after
            // closeInnermostBlock returns for the same reason.
            if (openMarkerRef.current) sceneNeverTouchedRef.current = true;
          }
        } else if (openMarkerRef.current && isCurrentLineEmpty()) {
          if (sceneNeverTouchedRef.current) {
            // The still-pristine seeded blank line, never typed into and
            // never Entered on before — consume this Enter as the block's
            // first real interaction (one more blank line to write on, via
            // the default Enter behavior) instead of closing on it.
            sceneNeverTouchedRef.current = false;
          } else {
            e.preventDefault();
            closeInnermostBlock(SCENE_END_MARKER, () => {
              openMarkerRef.current = false;
            });
          }
        }
      } else if (e.key === "Backspace" && tryUndoClose()) {
        e.preventDefault();
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "Tab") {
      e.preventDefault();
      setSlashMenu((m) => (m ? { ...m, index: (m.index + 1) % m.options.length } : m));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSlashMenu((m) => (m ? { ...m, index: (m.index - 1 + m.options.length) % m.options.length } : m));
    } else if (e.key === "Enter") {
      e.preventDefault();
      confirmSlash(slashMenu.index);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setSlashMenu(null);
    }
  }

  function applyFormat(command: "bold" | "italic") {
    ref.current?.focus();
    document.execCommand(command);
    handleInput();
  }

  // 2026-07-18, Lino: "wenn man im Textfeld Text markiert soll man den Text
  // noch etwas grösser darstellen können (also da wo man fett, kursiv
  // einstellen kann)" — no execCommand for this (fontSize only does the
  // deprecated size=1-7 <font> attribute route, which the sanitizer would
  // strip anyway, see richText.ts). Manual DOM wrap instead:
  // extractContents (not surroundContents — that throws when the selection
  // partially crosses element boundaries, e.g. selecting across a bold
  // span) + wrap in a bare <big>, then re-select the new node so a second
  // click on Bold/Italic still applies to the just-enlarged text.
  function applyBigger() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount || !ref.current) return;
    const range = sel.getRangeAt(0);
    if (!ref.current.contains(range.commonAncestorContainer)) return;
    ref.current.focus();
    const big = document.createElement("big");
    big.appendChild(range.extractContents());
    range.insertNode(big);
    const newRange = document.createRange();
    newRange.selectNodeContents(big);
    sel.removeAllRanges();
    sel.addRange(newRange);
    handleInput();
  }

  // 2026-07-18, Lino: "man kann jetzt den Text grösser machen, aber nicht
  // kleiner, für das muss auch ein Button her" — same wrap technique as
  // applyBigger, just with the native <small> tag instead.
  function applySmaller() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount || !ref.current) return;
    const range = sel.getRangeAt(0);
    if (!ref.current.contains(range.commonAncestorContainer)) return;
    ref.current.focus();
    const small = document.createElement("small");
    small.appendChild(range.extractContents());
    range.insertNode(small);
    const newRange = document.createRange();
    newRange.selectNodeContents(small);
    sel.removeAllRanges();
    sel.addRange(newRange);
    handleInput();
  }

  return (
    <div className="relative rich-text-editor">
      {toolbarPos && !disabled && (
        <div
          className="absolute z-30 flex gap-0.5 bg-[#242426] border border-white/10 rounded-lg shadow-xl p-1"
          style={{ top: toolbarPos.top, left: toolbarPos.left }}
        >
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              applyFormat("bold");
            }}
            className="w-7 h-7 rounded-md hover:bg-white/10 font-bold text-sm text-white/90"
            aria-label={t("richTextEditor.bold")}
          >
            B
          </button>
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              applyFormat("italic");
            }}
            className="w-7 h-7 rounded-md hover:bg-white/10 italic text-sm text-white/90"
            aria-label={t("richTextEditor.italic")}
          >
            I
          </button>
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              applyBigger();
            }}
            className="w-7 h-7 rounded-md hover:bg-white/10 text-base font-bold text-white/90"
            aria-label={t("richTextEditor.bigger")}
            title={t("richTextEditor.biggerTitle")}
          >
            A+
          </button>
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              applySmaller();
            }}
            className="w-7 h-7 rounded-md hover:bg-white/10 text-xs font-bold text-white/90"
            aria-label={t("richTextEditor.smaller")}
            title={t("richTextEditor.smallerTitle")}
          >
            A-
          </button>
        </div>
      )}
      {slashMenu && !disabled && (
        <div
          className="absolute z-10 w-44 bg-[#242426] border border-white/10 rounded-lg shadow-xl py-1 overflow-hidden"
          style={{ top: slashMenu.top, left: slashMenu.left }}
        >
          {slashMenu.options.map((opt, i) => (
            <button
              key={opt.label}
              onMouseDown={(e) => {
                e.preventDefault();
                confirmSlash(i);
              }}
              onMouseEnter={() => setSlashMenu((m) => (m ? { ...m, index: i } : m))}
              className={`w-full text-left px-3 py-1.5 text-sm ${i === slashMenu.index ? "bg-blue-500/20 text-white" : "text-white/70"}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
      {shiftHint && !disabled && (
        <div className="absolute bottom-1.5 left-1.5 z-20 text-[11px] text-white/50 bg-[#242426] border border-white/10 rounded-md px-2 py-1 pointer-events-none">
          {t("richTextEditor.shiftEnterHint")}
        </div>
      )}
      <div
        ref={ref}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={handleInput}
        onSelect={() => {
          updateToolbar();
          checkSlashTrigger();
        }}
        onMouseUp={() => {
          updateToolbar();
          checkSlashTrigger();
        }}
        onKeyUp={updateToolbar}
        onKeyDown={handleEditorKeyDown}
        onBlur={() => {
          setToolbarPos(null);
          setSlashMenu(null);
        }}
        className={
          className ??
          "min-h-[240px] w-full bg-white/[0.05] border border-white/10 rounded-xl px-3.5 py-3 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-blue-500/50 whitespace-pre-wrap"
        }
      />
      {isEmptyValue(value) && placeholder && (
        <div className="absolute top-3 left-3.5 text-sm text-white/30 pointer-events-none">{placeholder}</div>
      )}
    </div>
  );
}

function isEmptyValue(html: string): boolean {
  return !html || html.replace(/<[^>]*>/g, "").trim().length === 0;
}

/** Walks up from the editor root to the nearest ancestor that actually
 * clips overflow (overflow-y auto/scroll/hidden), returning its visible
 * bottom edge — falls back to the viewport height if the editor isn't
 * inside a scrollable container at all. See checkSlashTrigger's own
 * comment for why this matters over just comparing against window height. */
function getScrollClipBottom(el: HTMLElement): number {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const overflowY = window.getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "hidden") {
      return node.getBoundingClientRect().bottom;
    }
    node = node.parentElement;
  }
  return window.innerHeight;
}
