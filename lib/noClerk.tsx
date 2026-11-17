"use client";

/* 2026-11-17 (PostFinance-Webfilter) — guest pages (preview, deliver, guest canvas, dubbing speaker link) load NO
   Clerk at all: the root layout leaves out <ClerkProvider> and wraps them in <NoClerk>. Hooks that would call
   Clerk's useAuth (lib/useApi) check this context and fall back to «signed out». */
import { createContext, useContext } from "react";

const NoClerkContext = createContext(false);

export function NoClerk({ children }: { children: React.ReactNode }) {
  return <NoClerkContext.Provider value={true}>{children}</NoClerkContext.Provider>;
}

export function useNoClerk(): boolean {
  return useContext(NoClerkContext);
}
