"use client";

import Pusher from "pusher-js";

/**
 * 2026-07-28, Lino: "wenn 2 Personen gleichzeitig ein Video offen haben und
 * Kommentare schreiben, sieht man das direkt in der preview seite?" ->
 * "das pusher system kann für alle kommentar seiten auf subshot aktiviert
 * werden" -> "also die preview seiten" (public share links included, not
 * just the authenticated in-app views).
 *
 * Mirrors the backend's app/realtime.py doc comment: ONE public channel per
 * commentable entity (`video-<id>`, `idea-<id>`, `scene-<id>`), ONE event
 * name ("changed") with no payload — every mutating comment/feedback/
 * annotation endpoint just pings "something on this entity changed",
 * callers refetch. Same "refetch on any event" simplicity as the sibling
 * Subtime project's `src/lib/realtime.ts` / `realtime-sync.tsx`, chosen
 * over hand-syncing three structurally different comment shapes
 * (VideoComment/IdeaFeedback+highlight Annotation/scene comment+highlight
 * Annotation) into fine-grained client-side patches.
 *
 * 2026-09-11, Lino: "jegliche Änderungen die in der Shotliste gemacht
 * werden müssen immer direkt in der Preview übernommen werden" — added
 * `project-<id>`, subscribed permanently (not just for entities currently
 * on screen) by preview-scenes/[token]/page.tsx, so structural shotlist
 * changes (new/deleted scene, reordered section, ...) reach an open
 * preview too, not just edits to a scene already loaded.
 */

let client: Pusher | null | undefined;

function getClient(): Pusher | null {
  if (client !== undefined) return client;
  const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
  const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;
  client = key && cluster ? new Pusher(key, { cluster }) : null;
  return client;
}

type EntityKind = "video" | "idea" | "scene" | "section" | "project";

/** Subscribes to `<kind>-<id>`'s "changed" event, calling `onChanged` every
 * time it fires. Returns an unsubscribe function — call it from a `useEffect`
 * cleanup. No-ops (returns a no-op cleanup) if Pusher env vars aren't
 * configured, so local dev without a Pusher key just never gets live
 * updates instead of throwing. */
export function subscribeToChanges(kind: EntityKind, id: string, onChanged: () => void): () => void {
  const pusher = getClient();
  if (!pusher) return () => {};
  const channelName = `${kind}-${id}`;
  const channel = pusher.subscribe(channelName);
  channel.bind("changed", onChanged);
  return () => {
    channel.unbind("changed", onChanged);
    pusher.unsubscribe(channelName);
  };
}
