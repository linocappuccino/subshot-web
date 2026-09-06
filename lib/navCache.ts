// 2026-07-17, Lino: "die Transition... zu postproduction und von
// postproduction zurück zu szenenübersicht ist irgendwie komisch und
// abgehackt" — anders als Ideen<->Szenen (ein Panel-Swap innerhalb derselben
// Seite, alle Daten schon im Speicher) ist Postproduction eine echte
// Next.js-Route: die Austritts-Animation lief zu Ende, DANN kam ein
// unanimiertes "Lädt…", DANN erst (nach dem Netzwerk-Roundtrip) die
// Eintritts-Animation — genau diese Lücke wirkte abgehackt. Fix: die Ziel-
// seite wird VOR der Navigation im Hintergrund geladen (parallel zur
// Austritts-Animation) und hier zwischengespeichert, damit die Zielseite
// beim Mounten sofort Daten hat und direkt in die Eintritts-Animation
// starten kann statt erst zu laden.
const cache = new Map<string, { value: unknown; ts: number }>();

// Prefetchtes Ergebnis ist nur für den EINEN bevorstehenden Seitenwechsel
// gedacht, nicht als allgemeiner Daten-Cache — einmal abgeholt (take), sofort
// aus der Map entfernt, damit ein späterer normaler Reload derselben Seite
// wieder ganz normal frisch lädt.
export function setNavCache(key: string, value: unknown) {
  cache.set(key, { value, ts: Date.now() });
}

export function takeNavCache<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  cache.delete(key);
  // Älter als das hier ist mit ziemlicher Sicherheit ein liegengebliebener
  // Prefetch aus einer abgebrochenen Navigation, nicht mehr vertrauenswürdig
  // genug um die Zielseite ohne echten Ladevorgang zu befüllen.
  if (Date.now() - entry.ts > 15000) return null;
  return entry.value as T;
}
