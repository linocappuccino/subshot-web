// Mirrors app/schemas.py's *Out models on the FastAPI backend — kept in one
// file, same reasoning as the iOS app's Models.swift: one source of truth
// for what the wire format looks like, since both clients talk to the same
// backend.

export type Priority = "must" | "should" | "optional";
export type ShotStatus = "open" | "done" | "deleted";
export type MemberRole = "owner" | "editor" | "viewer";
export type InviteRole = "editor" | "viewer";

export interface ProjectFolder {
  id: string;
  name: string;
  color: string;
  emoji: string | null;
  sort_order: number;
  project_count: number;
  created_at: string;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  emoji: string | null;
  shoot_date: string | null;
  location_address: string | null;
  location_lat: number | null;
  location_lng: number | null;
  folder_id: string | null;
  team_id: string | null;
  thumbnail_url: string | null;
  notion_database_id: string | null;
  notion_last_synced_at: string | null;
  last_opened_at: string;
  created_at: string;
}

export interface SceneDialogue {
  id: string;
  scene_id: string;
  text: string;
  done: boolean;
  sort_order: number;
  created_at: string;
}

export interface Scene {
  id: string;
  project_id: string;
  name: string | null;
  color: string;
  description: string | null;
  dialogue: string | null;
  focal_length_mm: number | null;
  scheduled_at: string | null;
  duration_minutes: number | null;
  image_url: string | null;
  completed: boolean;
  sort_order: number;
  assignee_id: string | null;
  section_id: string | null;
  priority: Priority | null;
  location_address: string | null;
  location_lat: number | null;
  location_lng: number | null;
  good_take_filename: string | null;
  number: number;
  letter: string | null;
  is_intermediate_step: boolean;
  dialogues: SceneDialogue[];
}

export interface Shot {
  id: string;
  project_id: string;
  scene_id: string | null;
  image_url: string | null;
  description: string | null;
  duration_seconds: number | null;
  camera_angle: string | null;
  priority: Priority | null;
  status: ShotStatus;
  sort_order: number;
  good_take_filename: string | null;
  created_at: string;
  updated_at: string;
}

export interface Section {
  id: string;
  project_id: string;
  name: string;
  sort_order: number;
}

export interface TodoItem {
  id: string;
  todo_list_id: string;
  text: string;
  done: boolean;
  assignee_id: string | null;
  sort_order: number;
  created_at: string;
  completed_at: string | null;
}

export interface TodoList {
  id: string;
  project_id: string;
  name: string;
  sort_order: number;
  items: TodoItem[];
}

export interface ProjectDetail extends Project {
  scenes: Scene[];
  shots: Shot[];
  sections: Section[];
  todo_lists: TodoList[];
}

export interface Member {
  user_id: string;
  name: string | null;
  email: string;
  avatar_url: string | null;
  role: MemberRole;
}

export interface Invite {
  id: string;
  email: string;
  role: string;
  token: string;
  created_at: string;
  accepted_at: string | null;
}

export interface NotionDatabase {
  id: string;
  title: string;
}

export type TeamStatus = "inactive" | "active" | "past_due" | "canceled";

export interface Team {
  id: string;
  name: string;
  owner_id: string;
  seat_count: number;
  pending_seat_count: number | null;
  status: TeamStatus;
  cancel_at_period_end: boolean;
  current_period_end: string | null;
  unit_price_rappen: number;
  monthly_total_rappen: number;
  seats_used: number;
  created_at: string;
}

export interface SeatPrice {
  seat_count: number;
  unit_price_rappen: number;
  monthly_total_rappen: number;
}

export type TeamMemberStatus = "invited" | "active";

export interface TeamMember {
  id: string;
  user_id: string | null;
  email: string;
  name: string | null;
  avatar_url: string | null;
  status: TeamMemberStatus;
  invited_at: string;
  joined_at: string | null;
}

export const PRIORITY_LABELS: Record<Priority, string> = {
  must: "Muss",
  should: "Sollte",
  optional: "Optional",
};

export const PRIORITY_COLORS: Record<Priority | "none", string> = {
  must: "#d1504f",
  should: "#e08a3c",
  optional: "#3d84d8",
  none: "#7a7a7a",
};

// Same swatch set the iOS app offers in its color grids (Color.subshotPalette
// in ColorHex.swift) — kept identical so a project/scene color picked on
// either client looks the same on both.
export const PALETTE = ["#3875bd", "#0f7e55", "#4e4295", "#d1504f", "#b9507b", "#a64c22"];
