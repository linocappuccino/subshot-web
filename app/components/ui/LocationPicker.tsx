"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useApi } from "@/lib/useApi";
import { Input } from "./Field";

interface GeocodeResult {
  display_name: string;
  lat: number | null;
  lng: number | null;
  place_id: string | null;
}

/** Address/business-name search-as-you-type — Google Places Autocomplete
 * server-side when configured (real business/POI coverage; see
 * mapping.py's geocode_search doc comment), Nominatim as the automatic
 * fallback — plus a map thumbnail once a result is picked, matching the
 * app's own SceneLocationSection/ProjectInfoBox (map image, tap to open
 * Google Maps).
 *
 * A Google result only carries a `place_id`, not coordinates (see the
 * backend doc comment on why) — picking one needs a second `geocodeResolve`
 * call. `sessionTokenRef` is one UUID reused across every keystroke of a
 * single search and passed to both calls, then replaced after a pick or a
 * field blur/clear — that's what makes Google bill the Autocomplete
 * keystrokes themselves as free/near-free, with only the one terminating
 * resolve call actually billed. */
export function LocationPicker({
  address,
  lat,
  lng,
  onChange,
}: {
  address: string;
  lat: number | null;
  lng: number | null;
  onChange: (address: string, lat: number | null, lng: number | null) => void;
}) {
  const api = useApi();
  const [query, setQuery] = useState(address);
  const [prevAddress, setPrevAddress] = useState(address);
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [open, setOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [mapUrl, setMapUrl] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputWrapRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionTokenRef = useRef<string>(crypto.randomUUID());
  // Screen-space position of the results dropdown, recomputed whenever it
  // opens/closes and while scrolling. Used to render the dropdown through a
  // portal (see below) instead of as a normal `position: absolute` child.
  const [dropdownRect, setDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);

  // Resets the local query text whenever the address prop changes from the
  // outside (e.g. the parent scene/project reloads) - done during render,
  // React's own documented pattern for "adjust state when a prop changes"
  // (see react.dev/learn/you-might-not-need-an-effect), not in an effect.
  if (address !== prevAddress) {
    setPrevAddress(address);
    setQuery(address);
  }

  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      const target = e.target as Node;
      // dropdownRef, not just containerRef — the results list now renders
      // through a portal (see below), so it's no longer a DOM descendant of
      // containerRef and needs its own explicit "inside" check, or every
      // click on a result would register as "outside" and close the list on
      // mousedown before its own onClick (which picks the result) ever runs.
      if (containerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Positions the results dropdown in VIEWPORT (not document/ancestor)
  // coordinates so it can be rendered through a portal straight to
  // document.body — see the portal's own comment below for why. Recomputed
  // whenever the dropdown opens and on every scroll/resize while it's open
  // (capture: true on the scroll listener so it also fires for scrolling
  // inside an ancestor container, e.g. a Modal's own scrollable body —
  // "scroll" doesn't bubble, but capture-phase listeners on window still see
  // it happen on any descendant).
  useEffect(() => {
    if (!open || results.length === 0) {
      setDropdownRect(null);
      return;
    }
    function reposition() {
      const rect = inputWrapRef.current?.getBoundingClientRect();
      if (rect) setDropdownRect({ top: rect.bottom + 6, left: rect.left, width: rect.width });
    }
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, results.length]);

  // No lat/lng means nothing to fetch - the effect simply doesn't run
  // rather than needing to setState back to null itself; `mapUrl` (state)
  // only ever holds the last successfully fetched blob URL, and the render
  // below only shows it when coordinates are actually present.
  useEffect(() => {
    if (lat == null || lng == null) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    api.fetchStaticMapBlobUrl(lat, lng).then((url) => {
      if (cancelled) {
        URL.revokeObjectURL(url);
        return;
      }
      objectUrl = url;
      setMapUrl(url);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);

  const effectiveMapUrl = lat != null && lng != null ? mapUrl : null;

  function handleQueryChange(value: string) {
    setQuery(value);
    onChange(value, null, null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 3) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const r = await api.geocodeSearch(value.trim(), sessionTokenRef.current);
      setResults(r);
      setOpen(true);
    }, 400);
  }

  async function pickResult(r: GeocodeResult) {
    setQuery(r.display_name);
    setOpen(false);
    setResults([]);
    // Nominatim results already carry coordinates; a Google result only has
    // a place_id and needs this second call to resolve them (see the doc
    // comment above) — this is also the call that terminates the session,
    // after which a fresh token starts the next search.
    if (r.place_id) {
      setResolving(true);
      try {
        const resolved = await api.geocodeResolve(r.place_id, sessionTokenRef.current);
        onChange(resolved.display_name, resolved.lat, resolved.lng);
      } catch {
        onChange(r.display_name, null, null);
      } finally {
        setResolving(false);
        sessionTokenRef.current = crypto.randomUUID();
      }
    } else {
      onChange(r.display_name, r.lat, r.lng);
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <div ref={inputWrapRef} className="relative">
        <Input
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Adresse suchen…"
          disabled={resolving}
        />
        {resolving && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/40">Lädt…</span>
        )}
      </div>
      {/* Portaled straight to document.body instead of rendered as a normal
          `position: absolute` child (2026-07-11 fix) — this picker is used
          inside SceneEditModal, whose scrollable body is `overflow-y-auto`
          (see Modal.tsx), and the Standort field sits near the bottom of
          that list. An absolutely-positioned dropdown anchored to it mostly
          renders BELOW the scroll container's own clipped bounds, so it was
          being silently clipped to invisible — the search request fires and
          returns real results (confirmed live: a 200 response with a real
          match came back every time), but nothing ever appeared on screen,
          which read as "die Google-Maps-Funktion funktioniert nicht"
          (Lino). A portal has no ancestor overflow/clipping to fight —
          position comes from dropdownRect (see its own effect above),
          computed straight from the input's on-screen bounding box. */}
      {dropdownRect &&
        createPortal(
          <AnimatePresence>
            {open && results.length > 0 && (
              <motion.div
                ref={dropdownRef}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15 }}
                style={{ position: "fixed", top: dropdownRect.top, left: dropdownRect.left, width: dropdownRect.width }}
                className="z-[70] bg-[#242426] border border-white/10 rounded-xl shadow-xl overflow-hidden max-h-56 overflow-y-auto"
              >
                {results.map((r, i) => (
                  <button
                    key={i}
                    onClick={() => pickResult(r)}
                    className="w-full text-left px-3.5 py-2.5 text-sm text-white/80 hover:bg-white/8 transition-colors border-b border-white/5 last:border-b-0"
                  >
                    {r.display_name}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}

      {effectiveMapUrl && (
        <motion.a
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 mt-2 rounded-xl overflow-hidden border border-white/10 hover:bg-white/5 transition-colors p-1.5"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={effectiveMapUrl} alt="" className="w-16 h-16 object-cover rounded-lg shrink-0" />
          <span className="text-sm text-white/70 leading-snug">{address}</span>
        </motion.a>
      )}
    </div>
  );
}
