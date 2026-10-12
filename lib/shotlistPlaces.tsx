"use client";

import { createContext, useContext } from "react";
import type { Scene, Section } from "./types";

// 2026-10-12, Lino: Drehorte per shotlist, "ausgeschrieben" and with their own colour — shared by the
// Drehorte window (SectionLocationButton) and the scene cards on the board (SceneCard's place pill),
// so one place has the same colour everywhere. Order = colour: the shotlist's default place first,
// then the scenes' own places in Szenen-Reihenfolge.

export const PLACE_PALETTE = ["#0a84ff", "#30d158", "#ff9f0a", "#bf5af2", "#ff375f", "#64d2ff", "#ffd60a", "#ac8e68"];

export type Place = { address: string; lat: number | null; lng: number | null };
export type ColoredPlace = Place & { color: string; isDefault: boolean };

export const shortPlace = (address: string) => address.split(",")[0];

export function buildPlaces(section: Pick<Section, "location_address" | "location_lat" | "location_lng"> | null, scenes: Scene[], extra: Place[] = []): ColoredPlace[] {
  const list: ColoredPlace[] = [];
  const push = (p: Place) => {
    if (p.address && !list.some((x) => x.address === p.address)) {
      list.push({ ...p, color: PLACE_PALETTE[list.length % PLACE_PALETTE.length], isDefault: !!section && p.address === section.location_address });
    }
  };
  if (section?.location_address) push({ address: section.location_address, lat: section.location_lat, lng: section.location_lng });
  for (const s of scenes) {
    if (!s.is_project_info && !s.is_intermediate_step && s.location_address) push({ address: s.location_address, lat: s.location_lat, lng: s.location_lng });
  }
  for (const p of extra) push(p);
  return list;
}

export type ShotlistPlaces = {
  /** the colored places of one shotlist (section) */
  placesFor: (sectionId: string | null) => ColoredPlace[];
  /** set a scene's place (the default place = no own location) */
  assign: (scene: Scene, place: Place) => void;
  /** open the Drehorte window of a shotlist (to add a place) */
  manage: (sectionId: string | null) => void;
};

export const ShotlistPlacesContext = createContext<ShotlistPlaces | null>(null);

export function useShotlistPlaces() {
  return useContext(ShotlistPlacesContext);
}
