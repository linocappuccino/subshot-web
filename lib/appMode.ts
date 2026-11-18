"use client";
// 2026-11-18, Lino (iOS hybrid app): the app opens Postproduction, Ideas and Deliver as web pages in a WKWebView.
// «App mode» hides the website's own header (storage, team, bell, avatar) and desktop-only buttons (DaVinci plugin,
// Relink all, Set order). Switched on by ?app=1 (or /embed/auth, which the app always uses) and kept in a cookie,
// so it stays on while navigating; ?app=0 switches it off again. The normal website never sets it.
import { useEffect, useState } from "react";

export const APP_COOKIE = "subshot_app";

export function setAppMode(on: boolean) {
  if (typeof document === "undefined") return;
  document.cookie = on
    ? `${APP_COOKIE}=1; path=/; max-age=31536000; SameSite=Lax; Secure`
    : `${APP_COOKIE}=; path=/; max-age=0; SameSite=Lax; Secure`;
}

export function readAppMode(): boolean {
  if (typeof window === "undefined") return false;
  const q = new URLSearchParams(window.location.search).get("app");
  if (q === "1") { setAppMode(true); return true; }
  if (q === "0") { setAppMode(false); return false; }
  return document.cookie.split(/;\s*/).includes(`${APP_COOKIE}=1`);
}

export function useAppMode(): boolean {
  const [on, setOn] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- read once on the client (cookie / URL)
  useEffect(() => setOn(readAppMode()), []);
  return on;
}
