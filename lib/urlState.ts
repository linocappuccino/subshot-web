"use client";

/** 2026-11-09, Lino: "immer wenn man eine Seite reloaded landet man irgendwo anders — habe ich eine Idee
 * offen und reloade, lande ich auf der Ideenübersicht". What is open on a page (view, shot list, idea
 * canvas, video review) lives in the URL query, so a reload restores it and back / forward work.
 * Native history calls integrate with the Next.js router (useSearchParams follows them). */

export function urlParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

/** set / remove query params; "push" = a real navigation (own back step), "replace" = minor state */
export function setUrlParams(updates: Record<string, string | null | undefined>, mode: "push" | "replace" = "replace") {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(updates)) {
    if (v) url.searchParams.set(k, v);
    else url.searchParams.delete(k);
  }
  if (url.href === window.location.href) return;
  if (mode === "push") window.history.pushState(null, "", url.href);
  else window.history.replaceState(null, "", url.href);
}
