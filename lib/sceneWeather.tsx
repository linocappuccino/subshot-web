"use client";

import { createContext, useContext } from "react";

// 2026-10-12, Lino: "das Wetter in der Shotlist per Emoji oder Symbol" — weather at each scene's
// start time and place (backend GET /projects/{id}/scene-weather, Open-Meteo, up to 16 days ahead).
// Provided once by the project page, read by SceneCard / SceneTable.

export type SceneWeather = { emoji: string; temp: number; rain_prob: number | null; wind: number | null; text: string };

export const SceneWeatherContext = createContext<Record<string, SceneWeather>>({});

export function useSceneWeather(sceneId: string): SceneWeather | undefined {
  return useContext(SceneWeatherContext)[sceneId];
}

/** "🌤 14° · 10 %" */
export function weatherLabel(w: SceneWeather): string {
  return `${w.emoji} ${Math.round(w.temp)}°${w.rain_prob != null ? ` · ${w.rain_prob} %` : ""}`;
}

/** tooltip: "Überwiegend klar · 14 °C · Regen 10 % · Wind 12 km/h" */
export function weatherTitle(w: SceneWeather, rain: string, wind: string): string {
  return [w.text, `${Math.round(w.temp)} °C`, w.rain_prob != null ? `${rain} ${w.rain_prob} %` : null, w.wind != null ? `${wind} ${Math.round(w.wind)} km/h` : null]
    .filter(Boolean)
    .join(" · ");
}
