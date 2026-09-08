"use client";

import { useAuth } from "@clerk/nextjs";
import { useMemo } from "react";
import { createApiClient } from "./api";

export function useApi() {
  const { getToken, userId } = useAuth();
  // 2026-09-08 (security audit finding, MEDIUM) — userId scopes the shared
  // module-level GET cache in lib/api.ts per signed-in user (see keyFor's
  // own doc comment there), so a fast sign-out+different-sign-in in one tab
  // can't serve a stale response cached for the PREVIOUS user. Included in
  // the useMemo deps so a user switch (userId changes) creates a fresh
  // client keyed to the new identity, same as the existing getToken dep.
  return useMemo(() => createApiClient(() => getToken(), userId), [getToken, userId]);
}
