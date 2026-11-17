"use client";

import { useAuth } from "@clerk/nextjs";
import { useMemo } from "react";
import { createApiClient } from "./api";
import { useNoClerk } from "./noClerk";

const NO_AUTH = { getToken: async () => null as string | null, userId: null as string | null | undefined };

/** 2026-11-17 — on guest pages (no ClerkProvider, see lib/noClerk) this is the «signed out» client; the context
 *  value never changes within a tree, so the hook order stays stable */
function useAuthOrGuest() {
  const guest = useNoClerk();
  // eslint-disable-next-line react-hooks/rules-of-hooks -- constant per tree (guest layout vs. Clerk layout)
  return guest ? NO_AUTH : useAuth();
}

export function useApi() {
  const { getToken, userId } = useAuthOrGuest();
  // 2026-09-08 (security audit finding, MEDIUM) — userId scopes the shared
  // module-level GET cache in lib/api.ts per signed-in user (see keyFor's
  // own doc comment there), so a fast sign-out+different-sign-in in one tab
  // can't serve a stale response cached for the PREVIOUS user. Included in
  // the useMemo deps so a user switch (userId changes) creates a fresh
  // client keyed to the new identity, same as the existing getToken dep.
  return useMemo(() => createApiClient(() => getToken(), userId), [getToken, userId]);
}


/** 2026-11-17 — the Clerk session token getter (null on guest pages), e.g. for a keepalive save while the tab closes */
export function useAuthToken(): () => Promise<string | null> {
  const { getToken } = useAuthOrGuest();
  return getToken;
}
