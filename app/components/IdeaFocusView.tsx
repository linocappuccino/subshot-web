"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IdeaFloatingCard } from "./IdeaFloatingCard";
import { useLanguage } from "@/lib/i18n";
import type { Annotation, Idea, Member } from "@/lib/types";

/** Full-screen focused view for one idea at a time (2026-07-17 redesign) —
 * opened from a tile or "+" in the small grid overview (IdeaGrid, which
 * Lino confirmed is good as-is and stays as the default "Kachelübersicht").
 * Covers the whole viewport (no ProjectInfoBox/"+ Hinzufügen" FAB bleeding
 * through from the page underneath, per Lino's spec for this view), slides
 * left/right between ideas with a spring animation, "+" on the right edge
 * once you're on the last idea to create another. Closing returns to the
 * grid — exactly "wie jetzt schon". */
export function IdeaFocusView({
  ideas,
  index,
  autoFocusTitleId,
  onIndexChange,
  onCreateNext,
  onUpdated,
  onDeleted,
  onClose,
  annotations,
  highlightedAnnotationId,
  onDeleteAnnotation,
  onAnnotationUpdated,
  myRole,
}: {
  ideas: Idea[];
  index: number;
  autoFocusTitleId: string | null;
  onIndexChange: (index: number) => void;
  onCreateNext: () => void;
  onUpdated: (idea: Idea) => void;
  onDeleted: (id: string) => void;
  onClose: () => void;
  /** 2026-07-22 — passed straight through to IdeaFloatingCard, see
   * IdeaFeedbackPanel's own doc comment for what this powers. */
  annotations?: Annotation[];
  highlightedAnnotationId?: string | null;
  onDeleteAnnotation?: (annotation: Annotation) => void;
  onAnnotationUpdated?: (annotation: Annotation) => void;
  /** 2026-07-27, Todoist #356 — passed straight through to IdeaFloatingCard. */
  myRole?: Member["role"] | null;
}) {
  const { t } = useLanguage();
  const creatingRef = useRef(false);
  // 2026-07-18, Lino: "pro Kachel noch einen Präsentationsmodus" — lives
  // here, not inside IdeaFloatingCard, so it survives navigating to the
  // next/previous idea via the arrow buttons below (IdeaFloatingCard
  // remounts per idea, keyed by idea.id).
  const [presenting, setPresenting] = useState(false);

  // 2026-07-21, Lino: "mit einem x rechts oben oder esc kommt man aus dem
  // Präsentationsmodus wieder raus" — while presenting, the X/Esc "get me
  // out" gesture should back out of presentation mode ONE level (back to
  // the normal editing card), not skip past it and close the whole idea
  // view. Only when NOT presenting do X/Esc/backdrop-click do what they
  // always did.
  function closeOrExitPresenting() {
    if (presenting) {
      setPresenting(false);
    } else {
      onClose();
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeOrExitPresenting();
      // 2026-07-19, Lino: "ist man aktiv im Textfeld, muss man mit den
      // Pfeiltasten im Textfeld navigieren können (Textcursor bewegen);
      // ist man nicht aktiv im Textfeld, kann man mit den Pfeiltasten zur
      // nächsten Idee" — this listener is on `document`, so every
      // Left/Right press while typing in the title input or the
      // RichTextEditor used to ALSO jump between ideas instead of moving
      // the caret. Only handle idea-to-idea navigation when focus isn't
      // inside an editable element at all.
      const active = document.activeElement as HTMLElement | null;
      const editing = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable);
      if (editing) return;
      if (e.key === "ArrowLeft" && index > 0) {
        onIndexChange(index - 1);
      }
      // 2026-07-19, Lino: "ist rechts keine Kachel mehr die erstellt wurde,
      // geht es nicht weiter nach rechts. es wird KEINE neue Kachel erstellt
      // wenn man mit der Pfeiltaste weiter drückt" — used to fall through to
      // onCreateNext() here once index was already at the last idea, so
      // simply holding/pressing ArrowRight kept creating brand-new ideas.
      // Creating one is now only ever reachable via the explicit "+"
      // NavButton's click handler (createNext below) — the keyboard is a
      // no-op past the last real idea, same as ArrowLeft already is at 0.
      if (e.key === "ArrowRight" && index < ideas.length - 1) {
        onIndexChange(index + 1);
      }
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
    // presenting IS a real dependency here (closeOrExitPresenting reads it)
    // — without it, toggling presentation mode wouldn't update the already-
    // registered listener's closure until the next index/ideas.length
    // change, so Esc would keep closing the whole view instead of exiting
    // presenting mode right after you'd just turned it on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, ideas.length, presenting]);

  useEffect(() => {
    creatingRef.current = false;
  }, [ideas.length]);

  const idea = ideas[index];
  if (typeof document === "undefined" || !idea) return null;

  const hasPrev = index > 0;
  const hasNext = index < ideas.length - 1;

  function goPrev() {
    onIndexChange(index - 1);
  }
  function goNext() {
    onIndexChange(index + 1);
  }
  function createNext() {
    if (creatingRef.current) return;
    creatingRef.current = true;
    onCreateNext();
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 backdrop-blur-xl"
      onClick={(e) => {
        // 2026-07-17, Lino: "klickt man in den hintergrund kommt man auch
        // direkt zum hintergrund" — only the backdrop itself (not the card,
        // the nav buttons, or the close button) should close this. Checking
        // e.target === e.currentTarget catches exactly that: any click that
        // bubbled up from a child (card, buttons) has a different target.
        // 2026-07-21: same contextual exit-presenting-first logic as Esc.
        if (e.target === e.currentTarget) closeOrExitPresenting();
      }}
    >
      <button
        onClick={closeOrExitPresenting}
        aria-label={presenting ? t("ideaFocusView.exitPresentMode") : t("ideaFocusView.close")}
        className="absolute top-5 right-5 w-10 h-10 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors z-10"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>

      <div
        className="flex items-center gap-4 sm:gap-8 px-4 w-full justify-center"
        onClick={(e) => {
          // 2026-07-17, Lino: "wenn man in den hintergrund klickt, kommt
          // man nicht zur übersicht, es passiert nichts" — this row is
          // `w-full` (spans the whole viewport width so its children can
          // be centered), so almost every "empty-looking" click actually
          // lands on THIS div, not the true backdrop further up — the
          // backdrop's own onClick (e.target === e.currentTarget check)
          // never even saw those clicks, since they never reached it as
          // their own target. Same check, same close, one level lower.
          if (e.target === e.currentTarget) closeOrExitPresenting();
        }}
      >
        <NavButton visible={hasPrev && !presenting} onClick={goPrev} label={t("ideaFocusView.previousIdea")} direction="left" />

        {/* 2026-07-21, Lino: "wenn man den präsentieren klickt füllt sich
            die ganze seite mit dem Text und den Bildern... natürlich mit
            padding links und rechts" — was capped at max-w-[1650px], now
            fills nearly the full viewport width (a little short of 100vw so
            the fixed-position close X and the surrounding backdrop still
            read as intentional framing, not an accidental gap). Same DOM
            node the whole time presenting toggles (no remount), so the
            existing plain CSS `transition-[max-width]` already animates
            this smoothly on its own — unlike AppShell's tint-overlay bug
            fixed earlier this session, THIS isn't a fresh-mount case.
            2026-07-22: the non-presenting cap was still max-w-[900px], a
            leftover from before IdeaFloatingCard itself was widened to
            max-w-[1900px] (2026-07-21) — this OUTER wrapper silently
            overrode that the whole time, so the card never actually got
            wider outside presenting mode despite the later change. Raised
            to match. */}
        <div
          className={`relative w-full transition-[max-width] duration-500 ease-in-out ${presenting ? "max-w-[calc(100vw-180px)]" : "max-w-[1900px]"}`}
        >
          <div key={idea.id}>
            <IdeaFloatingCard
              idea={idea}
              autoFocusTitle={idea.id === autoFocusTitleId}
              presenting={presenting}
              onTogglePresenting={() => setPresenting((v) => !v)}
              onUpdated={onUpdated}
              onDeleted={(id) => {
                onDeleted(id);
                if (ideas.length <= 1) onClose();
              }}
              annotations={annotations}
              highlightedAnnotationId={highlightedAnnotationId}
              onDeleteAnnotation={onDeleteAnnotation}
              onAnnotationUpdated={onAnnotationUpdated}
              myRole={myRole}
            />
          </div>
        </div>

        {hasNext ? (
          <NavButton visible={!presenting} onClick={goNext} label={t("ideaFocusView.nextIdea")} direction="right" />
        ) : (
          <NavButton visible={!presenting} onClick={createNext} label={t("ideaFocusView.newIdea")} direction="plus" />
        )}
      </div>
    </div>,
    document.body
  );
}

function NavButton({
  visible,
  onClick,
  label,
  direction,
}: {
  visible: boolean;
  onClick: () => void;
  label: string;
  direction: "left" | "right" | "plus";
}) {
  return (
    <div className="w-12 sm:w-14 shrink-0 flex items-center justify-center">
      {visible && (
          <button
            onClick={onClick}
            aria-label={label}
            className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center text-white shadow-xl transition-transform duration-150 hover:scale-[1.08] active:scale-95 ${
              direction === "plus" ? "bg-blue-600 hover:bg-blue-500" : "bg-white/10 hover:bg-white/20 border border-white/10"
            }`}
          >
            {direction === "plus" ? (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d={direction === "left" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
              </svg>
            )}
          </button>
        )}
    </div>
  );
}
