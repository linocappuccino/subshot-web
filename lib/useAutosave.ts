import { useEffect, useRef, type DependencyList } from "react";

/**
 * Debounced autosave (2026-07-16, Lino: "es muss alles was man aendert in
 * allen Kacheln sofort gespeichert werden") — fires `save` ~`delayMs` after
 * the last change to any value in `deps`, coalescing rapid changes (typing,
 * a couple of quick picker clicks) into one request instead of one PATCH
 * per keystroke.
 *
 * `resetKey` identifies WHICH entity is currently being edited (its id, or
 * null when there's no already-created entity to save against, e.g. a
 * brand-new not-yet-saved scene). Reset-block code elsewhere in the modal
 * (the `openedFor !== existing?.id` pattern already used in
 * SceneEditModal/ShotEditModal) re-seeds local field state straight from a
 * freshly opened/switched entity in the SAME render — without tracking
 * `resetKey` separately, this hook can't tell "the user just changed the
 * priority" apart from "the modal just got reset to a different scene's own
 * priority", and would fire a spurious (harmless but wasteful, and
 * theoretically racy against a concurrent poll) save of a freshly-opened
 * entity's own unchanged data right back at itself. Checking
 * `lastResetKey.current !== resetKey` during render (not inside the effect)
 * catches this in the same render pass as the reset block, before the
 * effect that would otherwise fire ever runs.
 */
export function useAutosave(save: () => void, deps: DependencyList, resetKey: string | null, delayMs = 600) {
  const skipNext = useRef(true);
  const lastResetKey = useRef(resetKey);
  if (lastResetKey.current !== resetKey) {
    lastResetKey.current = resetKey;
    skipNext.current = true;
  }

  useEffect(() => {
    if (resetKey === null) return;
    if (skipNext.current) {
      skipNext.current = false;
      return;
    }
    const timer = setTimeout(save, delayMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, resetKey]);
}
