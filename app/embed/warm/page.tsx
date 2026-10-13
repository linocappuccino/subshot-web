"use client";

import { useEffect } from "react";
import { useAuth } from "@clerk/nextjs";

// 2026-10-13, Lino: "ist es möglich, dass die app das board schneller lädt?" — the iOS app keeps one
// web view around and opens this page in the background when a project is opened: Clerk starts and
// the idea-window code (the heavy part) is downloaded + compiled ahead of time, so tapping an idea
// only has to fetch its data. Tells the app whether the web session is signed in.

type IOSBridge = { webkit?: { messageHandlers?: { subshot?: { postMessage: (m: unknown) => void } } } };

export default function EmbedWarmPage() {
  const { isLoaded, isSignedIn } = useAuth();
  useEffect(() => {
    // fetch + compile the idea window's code now (not rendered)
    void import("@/app/components/IdeaFocusView");
  }, []);
  useEffect(() => {
    if (!isLoaded) return;
    (window as unknown as IOSBridge).webkit?.messageHandlers?.subshot?.postMessage({ type: "warm", signedIn: !!isSignedIn });
  }, [isLoaded, isSignedIn]);
  return <div className="min-h-screen bg-[#161616]" />;
}
