"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useApi } from "@/lib/useApi";
import { Input } from "./Field";

interface GeocodeResult {
  display_name: string;
  lat: number;
  lng: number;
}

/** Address search-as-you-type (free OpenStreetMap/Nominatim search, no paid
 * key - same reasoning as the iOS app using MapKit instead of a Google Maps
 * key) plus a map thumbnail once a result is picked, matching the app's own
 * SceneLocationSection/ProjectInfoBox (map image, tap to open Google Maps). */
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
  const [mapUrl, setMapUrl] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resets the local query text whenever the address prop changes from the
  // outside (e.g. the parent scene/project reloads) - done during render,
  // React's own documented pattern for "adjust state when a prop changes"
  // (see react.dev/learn/you-might-not-need-an-effect), not in an effect.
  if (address !== prevAddress) {
    setPrevAddress(address);
    setQuery(address);
  }

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

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
      const r = await api.geocodeSearch(value.trim());
      setResults(r);
      setOpen(true);
    }, 400);
  }

  function pickResult(r: GeocodeResult) {
    setQuery(r.display_name);
    onChange(r.display_name, r.lat, r.lng);
    setOpen(false);
    setResults([]);
  }

  return (
    <div className="relative" ref={containerRef}>
      <Input
        value={query}
        onChange={(e) => handleQueryChange(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder="Adresse suchen…"
      />
      <AnimatePresence>
        {open && results.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="absolute z-30 mt-1.5 w-full bg-[#242426] border border-white/10 rounded-xl shadow-xl overflow-hidden max-h-56 overflow-y-auto"
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
      </AnimatePresence>

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
