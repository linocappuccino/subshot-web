"use client";

import { createContext, useContext } from "react";

// 2026-10-13, Lino: Projektübersicht — per project (from GET /projects/overview-meta): pipeline steps
// (mini rings on the tile), current step (filter), next date, client logo, archived, storage.

export type OverviewStepKey = "ideas" | "scenes" | "postproduction" | "deliver";
export type NextEvent = { kind: "shoot" | "deadline" | "deliver_expiry"; at: string; overdue: boolean; label?: string };

export interface ProjectMeta {
  id: string;
  name: string;
  client_name: string | null;
  folder_id: string | null;
  emoji: string | null;
  color: string;
  steps: { key: OverviewStepKey; total: number; decided: number; done: boolean }[];
  current_step: OverviewStepKey | "done";
  next_event: NextEvent | null;
  client_logo_url: string | null;
  archived: boolean;
  storage_bytes: number | null;
}

export interface CalendarEvent {
  kind: "shoot" | "deadline" | "deliver_expiry";
  date: string;
  start?: string;
  end?: string;
  scenes?: number;
  label?: string;
  done?: boolean;
  project_id: string;
  section_id?: string | null;
  project_name: string;
  client_name: string | null;
  color: string;
  emoji: string | null;
  archived: boolean;
}

export const ProjectMetaContext = createContext<Record<string, ProjectMeta>>({});

export function useProjectMeta(id: string): ProjectMeta | undefined {
  return useContext(ProjectMetaContext)[id];
}

/** whole days from today (local) to the given date — 0 = today, 1 = tomorrow, -1 = yesterday */
export function daysFromToday(iso: string): number {
  const d = new Date(iso);
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const n = new Date();
  const b = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  return Math.round((a - b) / 86400000);
}

export function formatStorage(bytes: number | null | undefined): string | null {
  if (bytes == null || bytes <= 0) return null;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(bytes >= 1e10 ? 0 : 1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}
