"use client";

import { PRIORITY_COLORS, type Priority } from "@/lib/types";
import DOMPurify from "dompurify";
import { TodoNode, type TodoLabels } from "./BoardTodo";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  TEXT_COLOR_STYLES,
  formatBytes,
  hostOf,
  videoEmbedFor,
  type BoardElement,
  type DrawingElement,
  type LinkElement,
  type GroupElement,
  type MediaElement,
  type SceneElement,
  type TextElement,
} from "@/lib/board";

/** Renders one board element's CONTENT (the board engine in IdeaBoard.tsx owns
 * the positioned wrapper, selection outline and handles around it). */

const ALLOWED_TAGS = [
  "b", "strong", "i", "em", "u", "s", "strike", "br", "div", "p", "big", "small", "code",
  "ul", "ol", "li", "h1", "h2", "h3", "blockquote",
];

export function sanitizeBoardHtml(html: string): string {
  return DOMPurify.sanitize(html ?? "", { ALLOWED_TAGS, ALLOWED_ATTR: [] });
}

export function boardHtmlToPlain(html: string): string {
  if (typeof document === "undefined") return html.replace(/<[^>]*>/g, " ").trim();
  const div = document.createElement("div");
  div.innerHTML = sanitizeBoardHtml(html);
  return (div.innerText || div.textContent || "").trim();
}

export const VIDEO_HEADER = 32;

export interface ElementViewLabels extends TodoLabels {
  textPlaceholder: string;
  open: string;
  download: string;
  missingFile: string;
  scene: string;
  priorities: Record<Priority, string>;
  sceneTitlePlaceholder: string;
  sceneTextPlaceholder: string;
  addImage: string;
  addDialogue: string;
  uploadImage: string;
  aiImage: string;
  aiGenerating: string;
  dialoguePlaceholder: string;
  removeDialogue: string;
  play: string;
  stop: string;
  group: string;
  groupNamePlaceholder: string;
  groupItems: string;
  collapse: string;
  expand: string;
}

export function BoardElementView({
  el,
  editing,
  editable,
  labels,
  onCommitText,
  onCommitScene,
  onRequestDialogue,
  addDialogueOnEdit,
  onGenerateSceneImage,
  sceneGenerating,
  onPickSceneImage,
  groupMembers,
  onToggleGroup,
  onCommitGroupTitle,
  onMeasure,
  onNaturalSize,
}: {
  el: BoardElement;
  editing: boolean;
  editable: boolean;
  labels: ElementViewLabels;
  onCommitText: (html: string) => void;
  onCommitScene?: (patch: { title?: string; html?: string; dialogues?: string[] }) => void;
  onRequestDialogue?: () => void;
  addDialogueOnEdit?: boolean;
  onGenerateSceneImage?: () => void;
  sceneGenerating?: boolean;
  onPickSceneImage?: () => void;
  groupMembers?: BoardElement[];
  onToggleGroup?: () => void;
  onCommitGroupTitle?: (title: string) => void;
  /** content needs more height than el.h (text/link cards grow with content) */
  onMeasure: (height: number) => void;
  /** media reported its real pixel size (used to fix the element's aspect ratio) */
  onNaturalSize: (w: number, h: number) => void;
}) {
  switch (el.type) {
    case "text":
      return <TextNode el={el} editing={editing} placeholder={labels.textPlaceholder} onCommit={onCommitText} onMeasure={onMeasure} />;
    case "image":
      return <ImageNode el={el} onNaturalSize={onNaturalSize} missing={labels.missingFile} />;
    case "video":
      return <VideoNode el={el} onNaturalSize={onNaturalSize} />;
    case "audio":
      return <AudioNode el={el} />;
    case "pdf":
    case "file":
      return <FileNode el={el} labels={labels} />;
    case "link":
      return <LinkNode el={el} onMeasure={onMeasure} editable={editable} labels={labels} />;
    case "drawing":
      return <DrawingNode el={el} />;
    case "todo":
      return <TodoWrapper el={el} editable={editable} labels={labels} onMeasure={onMeasure} />;
    case "group":
      return (
        <GroupNode
          el={el}
          members={groupMembers ?? []}
          editing={editing}
          labels={labels}
          onToggle={() => onToggleGroup?.()}
          onCommitTitle={(title) => onCommitGroupTitle?.(title)}
        />
      );
    case "scene":
      return (
        <SceneNode
          el={el}
          editing={editing}
          editable={editable}
          labels={labels}
          onCommit={(patch) => onCommitScene?.(patch)}
          onPickImage={() => onPickSceneImage?.()}
          onRequestDialogue={() => onRequestDialogue?.()}
          addDialogueOnEdit={!!addDialogueOnEdit}
          onGenerate={onGenerateSceneImage}
          generating={!!sceneGenerating}
          onImageSize={onNaturalSize}
          onMeasure={onMeasure}
        />
      );
  }
}

function SceneNode({
  el,
  editing,
  editable,
  labels,
  onCommit,
  onPickImage,
  onRequestDialogue,
  addDialogueOnEdit,
  onGenerate,
  generating,
  onImageSize,
  onMeasure,
}: {
  el: SceneElement;
  editing: boolean;
  editable: boolean;
  labels: ElementViewLabels;
  onCommit: (patch: { title?: string; html?: string; dialogues?: string[] }) => void;
  onPickImage: () => void;
  onRequestDialogue: () => void;
  addDialogueOnEdit: boolean;
  onGenerate?: () => void;
  generating: boolean;
  onImageSize: (w: number, h: number) => void;
  onMeasure: (h: number) => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  // the card follows its content both ways (dialogue lines come and go)
  useGrowToContent(cardRef, el.h, onMeasure, true);

  // dialogue lines being edited (only while the card is in edit mode)
  const [lines, setLines] = useState<string[]>([]);
  const linesRef = useRef<string[]>([]);
  linesRef.current = lines;
  const lineRefs = useRef<(HTMLInputElement | null)[]>([]);
  const focusLine = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (!editing) return;
    if (editorRef.current) editorRef.current.innerHTML = sanitizeBoardHtml(el.html);
    const start = [...(el.dialogues ?? [])];
    if (addDialogueOnEdit) {
      start.push("");
      focusLine.current = start.length - 1;
    }
    setLines(start);
    const title = titleRef.current;
    if (title && !addDialogueOnEdit) {
      title.focus({ preventScroll: true });
      title.select();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  useLayoutEffect(() => {
    if (focusLine.current === null) return;
    lineRefs.current[focusLine.current]?.focus({ preventScroll: true });
    focusLine.current = null;
  }, [lines]);

  function addLine() {
    focusLine.current = linesRef.current.length;
    setLines([...linesRef.current, ""]);
  }
  function commitLines(next: string[]) {
    onCommit({ dialogues: next });
  }

  const textEmpty = !el.html || !el.html.replace(/<[^>]*>/g, "").trim();
  return (
    <div
      ref={cardRef}
      className="rounded-lg bg-[#232325] border border-white/10 overflow-hidden shadow-[0_2px_10px_rgba(0,0,0,0.35)]"
    >
      <div className="flex items-center gap-2.5 px-3 pt-3 pb-2">
        <div
          className="shrink-0 h-7 min-w-7 px-2 rounded-md text-white text-sm font-bold flex items-center justify-center tabular-nums"
          style={{ background: PRIORITY_COLORS[el.priority ?? "none"] }}
        >
          {el.number}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-white/40 leading-none mb-1">
            {labels.scene}
            {el.priority && (
              <span style={{ color: PRIORITY_COLORS[el.priority] }}>
                {" · "}
                {labels.priorities[el.priority]}
              </span>
            )}
          </div>
          {editing ? (
            <input
              ref={titleRef}
              defaultValue={el.title}
              placeholder={labels.sceneTitlePlaceholder}
              onBlur={(e) => onCommit({ title: e.currentTarget.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  editorRef.current?.focus();
                }
              }}
              className="w-full bg-transparent text-[15px] font-semibold text-white/90 outline-none placeholder:text-white/30 select-text"
            />
          ) : (
            <div className={`text-[15px] font-semibold truncate ${el.title ? "text-white/90" : "text-white/30"}`}>
              {el.title || labels.sceneTitlePlaceholder}
            </div>
          )}
        </div>
      </div>
      <div className="px-3">
        {generating ? (
          <div className="w-full aspect-video rounded-md bg-gradient-to-br from-violet-500/25 via-blue-500/15 to-transparent animate-pulse flex flex-col items-center justify-center gap-1.5 text-xs text-white/70">
            <span className="text-lg">✨</span>
            {labels.aiGenerating}
          </div>
        ) : el.image_src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={el.image_src}
            alt=""
            draggable={false}
            onLoad={(e) => onImageSize(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
            // the image's own format; only extreme panoramas/strips get cropped
            style={{ aspectRatio: Math.min(3, Math.max(0.5, el.image_ratio ?? 16 / 9)) }}
            className="w-full object-cover rounded-md bg-white/5 pointer-events-none select-none"
          />
        ) : editable ? (
          <div className="w-full aspect-video rounded-md border border-dashed border-white/20 flex flex-col items-center justify-center gap-2 p-2">
            <span className="text-xs text-white/40">{labels.addImage}</span>
            <div className="flex gap-1.5">
              <button
                data-no-drag
                onClick={onPickImage}
                className="flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/15 px-2.5 py-1.5 text-xs font-semibold text-white/80"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4M7 9l5-5 5 5M4 20h16" /></svg>
                {labels.uploadImage}
              </button>
              {onGenerate && (
                <button
                  data-no-drag
                  onClick={onGenerate}
                  className="flex items-center gap-1.5 rounded-lg bg-violet-500/20 hover:bg-violet-500/30 px-2.5 py-1.5 text-xs font-semibold text-violet-200"
                >
                  ✨ {labels.aiImage}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="w-full aspect-video rounded-md bg-white/5" />
        )}
      </div>
      <div className="px-3.5 pt-2.5 pb-3 text-white/85">
        {editing ? (
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            data-placeholder={labels.sceneTextPlaceholder}
            className="board-text outline-none cursor-text select-text min-h-[1.5em]"
            onInput={(e) => {
              e.currentTarget.dataset.empty = String(!e.currentTarget.textContent);
            }}
            onBlur={(e) => onCommit({ html: e.currentTarget.innerHTML })}
          />
        ) : (
          <div
            className="board-text"
            data-empty={textEmpty ? "true" : "false"}
            data-placeholder={labels.sceneTextPlaceholder}
            dangerouslySetInnerHTML={{ __html: sanitizeBoardHtml(el.html) }}
          />
        )}
      </div>
      {(editing ? lines.length > 0 : (el.dialogues?.length ?? 0) > 0) && (
        <div className="px-3 pb-2 flex flex-col gap-1.5">
          {(editing ? lines : el.dialogues ?? []).map((line, i) => (
            <div key={i} className="flex items-start gap-2 rounded-md bg-white/[0.05] border border-white/10 px-2.5 py-1.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-[3px] text-violet-300">
                <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 1 1 21 11.5z" />
              </svg>
              {editing ? (
                <>
                  <input
                    ref={(n) => {
                      lineRefs.current[i] = n;
                    }}
                    value={line}
                    placeholder={labels.dialoguePlaceholder}
                    onChange={(e) => setLines(linesRef.current.map((l, j) => (j === i ? e.target.value : l)))}
                    onBlur={() => commitLines(linesRef.current)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addLine();
                      }
                    }}
                    className="min-w-0 flex-1 bg-transparent text-sm italic text-white/90 outline-none placeholder:text-white/30 select-text"
                  />
                  <button
                    data-no-drag
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      const next = linesRef.current.filter((_, j) => j !== i);
                      setLines(next);
                      commitLines(next);
                    }}
                    title={labels.removeDialogue}
                    aria-label={labels.removeDialogue}
                    className="shrink-0 w-5 h-5 rounded-md text-white/40 hover:text-white hover:bg-white/10 flex items-center justify-center"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                  </button>
                </>
              ) : (
                <span className="min-w-0 flex-1 text-sm italic text-white/80 break-words">{line}</span>
              )}
            </div>
          ))}
        </div>
      )}
      {editable && (
        <div className="px-3 pb-3">
          <button
            data-no-drag
            onMouseDown={(e) => editing && e.preventDefault()}
            onClick={() => (editing ? addLine() : onRequestDialogue())}
            className="w-full rounded-lg border border-dashed border-white/15 text-white/45 hover:text-white/80 hover:border-white/35 text-xs font-semibold py-1.5 flex items-center justify-center gap-1.5 transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            {labels.addDialogue}
          </button>
        </div>
      )}
    </div>
  );
}

/** Reports the content's height when it needs more than el.h (text grows).
 * With `exact`, also when it needs less — link cards follow their content
 * both ways (a playing video makes them taller, closing it shrinks them). */
function useGrowToContent(ref: React.RefObject<HTMLElement | null>, height: number, onMeasure: (h: number) => void, exact = false) {
  const heightRef = useRef(height);
  heightRef.current = height;
  const cb = useRef(onMeasure);
  cb.current = onMeasure;
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const check = () => {
      // offsetHeight is layout size, unaffected by the board's scale transform
      const h = node.offsetHeight;
      if (h > heightRef.current + 1 || (exact && h < heightRef.current - 1)) cb.current(h);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(node);
    return () => ro.disconnect();
  }, [ref, exact]);
}

function TextNode({
  el,
  editing,
  placeholder,
  onCommit,
  onMeasure,
}: {
  el: TextElement;
  editing: boolean;
  placeholder: string;
  onCommit: (html: string) => void;
  onMeasure: (h: number) => void;
}) {
  const style = TEXT_COLOR_STYLES[el.color] ?? TEXT_COLOR_STYLES.default;
  const cardRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  useGrowToContent(cardRef, el.h, onMeasure);

  useLayoutEffect(() => {
    const node = editorRef.current;
    if (!editing || !node) return;
    node.innerHTML = sanitizeBoardHtml(el.html);
    node.dataset.empty = String(!node.textContent);
    node.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    try {
      document.execCommand("styleWithCSS", false, "false");
      document.execCommand("defaultParagraphSeparator", false, "div");
    } catch {
      // older engines — harmless
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const isEmpty = !el.html || !el.html.replace(/<[^>]*>/g, "").trim();
  return (
    <div
      ref={cardRef}
      className="rounded-lg px-3.5 py-3 shadow-[0_2px_10px_rgba(0,0,0,0.35)]"
      style={{
        background: style.bg,
        color: style.fg,
        border: `1px solid ${style.border}`,
        minHeight: el.h,
        textAlign: el.align ?? "left",
        boxShadow: el.color === "transparent" ? "none" : undefined,
      }}
    >
      {editing ? (
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          data-placeholder={placeholder}
          className="board-text outline-none cursor-text select-text min-h-[1.5em]"
          onInput={(e) => {
            const node = e.currentTarget;
            node.dataset.empty = String(!node.textContent);
          }}
          onBlur={(e) => onCommit(e.currentTarget.innerHTML)}
        />
      ) : (
        <div
          className="board-text"
          data-empty={isEmpty ? "true" : "false"}
          data-placeholder={placeholder}
          dangerouslySetInnerHTML={{ __html: sanitizeBoardHtml(el.html) }}
        />
      )}
    </div>
  );
}

function ImageNode({ el, onNaturalSize, missing }: { el: MediaElement; onNaturalSize: (w: number, h: number) => void; missing: string }) {
  if (!el.src) {
    return (
      <div className="w-full h-full rounded-lg bg-[#232325] border border-white/10 flex items-center justify-center text-xs text-white/40">
        {missing}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={el.src}
      alt={el.name || ""}
      draggable={false}
      className="w-full h-full object-cover rounded-lg shadow-[0_2px_10px_rgba(0,0,0,0.35)] bg-white/5 pointer-events-none select-none"
      onLoad={(e) => onNaturalSize(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
    />
  );
}

function VideoNode({ el, onNaturalSize }: { el: MediaElement; onNaturalSize: (w: number, h: number) => void }) {
  return (
    <div className="w-full h-full rounded-lg overflow-hidden bg-[#232325] border border-white/10 flex flex-col shadow-[0_2px_10px_rgba(0,0,0,0.35)]">
      <div className="shrink-0 flex items-center gap-2 px-3 text-xs text-white/60" style={{ height: VIDEO_HEADER }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="shrink-0 opacity-70"><path d="M8 5v14l11-7z" /></svg>
        <span className="truncate">{el.name || "Video"}</span>
      </div>
      {el.src ? (
        <video
          src={el.src}
          controls
          playsInline
          preload="metadata"
          data-no-drag
          className="flex-1 min-h-0 w-full bg-black object-contain"
          onLoadedMetadata={(e) => onNaturalSize(e.currentTarget.videoWidth, e.currentTarget.videoHeight)}
        />
      ) : (
        <div className="flex-1 bg-black" />
      )}
    </div>
  );
}

function AudioNode({ el }: { el: MediaElement }) {
  return (
    <div className="w-full h-full rounded-lg bg-[#232325] border border-white/10 p-3 flex flex-col justify-between gap-2 shadow-[0_2px_10px_rgba(0,0,0,0.35)]">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-9 h-9 shrink-0 rounded-lg bg-violet-500/20 text-violet-300 flex items-center justify-center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
        </div>
        <span className="text-sm text-white/85 truncate">{el.name || "Audio"}</span>
      </div>
      {el.src && <audio src={el.src} controls preload="metadata" data-no-drag className="w-full h-9" />}
    </div>
  );
}

function FileNode({ el, labels }: { el: MediaElement; labels: ElementViewLabels }) {
  const isPdf = el.type === "pdf";
  return (
    <div className="w-full h-full rounded-lg bg-[#232325] border border-white/10 p-3 flex items-center gap-3 shadow-[0_2px_10px_rgba(0,0,0,0.35)]">
      <div className={`w-11 h-14 shrink-0 rounded-md flex items-end justify-center pb-1.5 text-[10px] font-bold ${isPdf ? "bg-red-500/20 text-red-300" : "bg-white/10 text-white/60"}`}>
        {isPdf ? "PDF" : (el.name.split(".").pop() ?? "").slice(0, 4).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-white/90 font-medium line-clamp-2 break-words">{el.name || "Datei"}</div>
        <div className="text-xs text-white/40 mt-0.5">{formatBytes(el.size)}</div>
        {el.src && (
          <a
            href={el.src}
            target="_blank"
            rel="noopener noreferrer"
            data-no-drag
            className="inline-block mt-1.5 text-xs font-semibold text-blue-400 hover:text-blue-300"
          >
            {labels.open} ↗
          </a>
        )}
      </div>
    </div>
  );
}

function LinkNode({
  el,
  onMeasure,
  labels,
}: {
  el: LinkElement;
  onMeasure: (h: number) => void;
  editable: boolean;
  labels: ElementViewLabels;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useGrowToContent(ref, el.h, onMeasure, true);
  const embed = videoEmbedFor(el.url);
  const [playing, setPlaying] = useState(false);
  return (
    <div
      ref={ref}
      className="rounded-lg bg-[#232325] border border-white/10 overflow-hidden shadow-[0_2px_10px_rgba(0,0,0,0.35)]"
    >
      {embed && playing ? (
        <div className="relative w-full bg-black" style={{ aspectRatio: String(embed.aspect) }} data-no-drag>
          {embed.kind === "iframe" ? (
            <iframe
              src={embed.src}
              title={el.title || el.url}
              className="absolute inset-0 w-full h-full"
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write"
              allowFullScreen
            />
          ) : (
            <video src={embed.src} controls autoPlay playsInline className="absolute inset-0 w-full h-full object-contain" />
          )}
          <button
            data-no-drag
            onClick={() => setPlaying(false)}
            aria-label={labels.stop}
            title={labels.stop}
            className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
      ) : embed ? (
        <div className="relative w-full aspect-[1.91/1] bg-black/40">
          {el.image_src && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={el.image_src} alt="" draggable={false} className="absolute inset-0 w-full h-full object-cover pointer-events-none select-none" />
          )}
          <button
            data-no-drag
            onClick={() => setPlaying(true)}
            aria-label={labels.play}
            title={labels.play}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-14 h-14 rounded-full bg-black/60 hover:bg-black/80 hover:scale-105 transition-transform text-white flex items-center justify-center shadow-xl backdrop-blur-sm"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          </button>
        </div>
      ) : (
        el.image_src && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={el.image_src} alt="" draggable={false} className="w-full aspect-[1.91/1] object-cover bg-white/5 pointer-events-none select-none" />
        )
      )}
      <div className="p-3">
        <div className="text-sm font-semibold text-white/90 line-clamp-2 break-words">{el.title || hostOf(el.url)}</div>
        {el.description && <div className="text-xs text-white/55 mt-1 line-clamp-3 break-words">{el.description}</div>}
        <a
          href={el.url}
          target="_blank"
          rel="noopener noreferrer"
          data-no-drag
          title={labels.open}
          className="mt-2 flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 min-w-0"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
          <span className="truncate">{el.site_name || hostOf(el.url)}</span>
        </a>
      </div>
    </div>
  );
}

export function strokePath(points: [number, number][]): string {
  if (points.length === 0) return "";
  if (points.length === 1) {
    const [x, y] = points[0];
    return `M ${x} ${y} L ${x + 0.01} ${y + 0.01}`;
  }
  // quadratic curves through midpoints — smooth without a dependency
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i];
    const [nx, ny] = points[i + 1];
    d += ` Q ${x} ${y} ${(x + nx) / 2} ${(y + ny) / 2}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last[0]} ${last[1]}`;
  return d;
}

function DrawingNode({ el }: { el: DrawingElement }) {
  const d = strokePath(el.points);
  return (
    <svg width={el.w} height={el.h} className="absolute inset-0 overflow-visible pointer-events-none">
      {/* wide invisible path = comfortable hit area for selecting a thin stroke */}
      <path d={d} fill="none" stroke="transparent" strokeWidth={el.stroke_width + 14} strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: "stroke" }} />
      <path d={d} fill="none" stroke={el.color} strokeWidth={el.stroke_width} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TodoWrapper({ el, editable, labels, onMeasure }: { el: Extract<BoardElement, { type: "todo" }>; editable: boolean; labels: ElementViewLabels; onMeasure: (h: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // follows its content both ways (items come and go, the @ picker opens)
  useGrowToContent(ref, el.h, onMeasure, true);
  return (
    <div ref={ref}>
      <TodoNode el={el} editable={editable} labels={labels} />
    </div>
  );
}

function previewOf(el: BoardElement): string | null {
  if (el.type === "image") return el.src ?? null;
  if (el.type === "scene" || el.type === "link") return el.image_src ?? null;
  return null;
}

function GroupNode({
  el,
  members,
  editing,
  labels,
  onToggle,
  onCommitTitle,
}: {
  el: GroupElement;
  members: BoardElement[];
  editing: boolean;
  labels: ElementViewLabels;
  onToggle: () => void;
  onCommitTitle: (title: string) => void;
}) {
  const titleRef = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (editing && titleRef.current) {
      titleRef.current.focus({ preventScroll: true });
      titleRef.current.select();
    }
  }, [editing]);

  const title = editing ? (
    <input
      ref={titleRef}
      defaultValue={el.title}
      placeholder={labels.groupNamePlaceholder}
      onBlur={(e) => onCommitTitle(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-white/90 outline-none select-text"
    />
  ) : (
    <span data-group-title className={`min-w-0 flex-1 truncate text-sm font-semibold ${el.title ? "text-white/85" : "text-white/40"}`}>{el.title || labels.group}</span>
  );
  const count = <span className="shrink-0 text-xs text-white/40 tabular-nums">{labels.groupItems.replace("{count}", String(members.length))}</span>;
  const toggle = (
    <button
      data-no-drag
      onClick={onToggle}
      title={el.collapsed ? labels.expand : labels.collapse}
      aria-label={el.collapsed ? labels.expand : labels.collapse}
      className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${el.collapsed ? "-rotate-90" : ""}`}>
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
  );

  if (!el.collapsed) {
    // frame around the members, frosted: whatever lies behind the open group
    // is blurred (2026-10-08, Lino). Its empty inside behaves like the empty
    // board (data-group-body), so nothing behind the glass can be grabbed.
    return (
      <div
        data-group-body
        className="absolute inset-0 rounded-[10px] border border-white/15 pointer-events-auto"
        style={{ background: "rgba(28,28,30,0.55)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}
      >
        <div data-group-header className="pointer-events-auto flex items-center gap-2 px-2.5 h-10 rounded-t-[10px] bg-white/[0.04] border-b border-white/10 cursor-grab">
          {toggle}
          {title}
          {count}
        </div>
      </div>
    );
  }

  const thumbs = members.map(previewOf).filter((x): x is string => !!x).slice(0, 4);
  return (
    <div className="w-full h-full rounded-[10px] bg-[#232325] border border-white/15 shadow-[0_2px_10px_rgba(0,0,0,0.35)] overflow-hidden flex flex-col">
      <div className="flex items-center gap-2 px-2.5 h-10 border-b border-white/10">
        {toggle}
        {title}
        {count}
      </div>
      <div className="flex-1 min-h-0 p-2.5 flex gap-1.5">
        {thumbs.length > 0 ? (
          thumbs.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={src} alt="" draggable={false} className="h-full flex-1 min-w-0 object-cover rounded-md bg-white/5 pointer-events-none" />
          ))
        ) : (
          <div className="flex-1 rounded-md border border-dashed border-white/15 flex items-center justify-center gap-1.5 text-white/30">
            {members.slice(0, 6).map((m) => (
              <span key={m.id} className="w-2 h-2 rounded-full bg-white/25" />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
