// Mirrors app/schemas.py's *Out models on the FastAPI backend — kept in one
// file, same reasoning as the iOS app's Models.swift: one source of truth
// for what the wire format looks like, since both clients talk to the same
// backend.

export type Priority = "must" | "should" | "optional";
export type CameraSupport = "gimbal" | "handheld" | "tripod";
export type ShotStatus = "open" | "done" | "deleted";
export type MemberRole = "owner" | "editor" | "viewer";
export type InviteRole = "editor" | "viewer";

export interface ProjectFolder {
  id: string;
  name: string;
  color: string;
  emoji: string | null;
  sort_order: number;
  background_image_url: string | null;
  /** Fractional (0-1) face-detected focus point within the cover image, or
   * null when no face was found (plain center crop then). See
   * app/face_detect.py on the backend. */
  background_image_focus_x: number | null;
  background_image_focus_y: number | null;
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
  client_name: string | null;
  /** "Beschreibung / Idee" — replaces client_name in the Projektinfo tile
   * UI (2026-07-14, Lino). */
  description: string | null;
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
  assignee_ids: string[];
  section_id: string | null;
  priority: Priority | null;
  location_address: string | null;
  location_lat: number | null;
  location_lng: number | null;
  /** Auftraggeber — only ever set/shown on is_project_info tiles. */
  client_name: string | null;
  good_take_filename: string | null;
  number: number;
  letter: string | null;
  is_intermediate_step: boolean;
  /** A "Projektinfo" tile (2026-07-10 redesign, replaces the old
   * Section.has_project_info attached-box concept) — behaves exactly like
   * any other scene for drag/reorder/section-assignment purposes, but
   * always renders full-width and always sorts first within whichever
   * section (or "Ohne Abschnitt") it's in. scheduled_at, the location
   * fields, and name double as this tile's shoot-date/location fields;
   * shots/priority/dialogue/etc. are simply unused. */
  is_project_info: boolean;
  dialogues: SceneDialogue[];
  todo_lists: TodoList[];
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
  lens: string | null;
  f_stop: string | null;
  frame_rate: string | null;
  shutter_angle: number | null;
  iso: number | null;
  codec: string | null;
  camera_id: string | null;
  camera_support: CameraSupport | null;
  created_at: string;
  updated_at: string;
}

export interface Section {
  id: string;
  project_id: string;
  name: string;
  sort_order: number;
  /** Multi-day shoots (2026-07-10): a section can optionally carry its own
   * mini project-info box, same fields as Project's own top-level one.
   * has_project_info false = no box, not "box with empty fields" — see
   * backend Section.has_project_info doc. */
  has_project_info: boolean;
  shoot_date: string | null;
  location_address: string | null;
  location_lat: number | null;
  location_lng: number | null;
  client_name: string | null;
  /** "Beschreibung / Idee" — replaces client_name in the Projektinfo tile
   * UI (2026-07-14, Lino). */
  description: string | null;
  todo_lists: TodoList[];
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
  /** Old attached-to-section mechanism (2026-07-10: superseded by
   * scene_id below), kept only so any pre-existing rows still serialize. */
  section_id: string | null;
  /** Set when this list belongs to a "Projektinfo" scene tile's own todo
   * section. See Scene.is_project_info. */
  scene_id: string | null;
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
  must: "Wichtig",
  should: "Nice to have",
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

/** Comment/markup left on the public preview page (2026-07-13) — read-only
 * here (the app shows what reviewers marked up, doesn't create new ones
 * itself; that's the preview page's own job, see share_view.py). */
export interface Annotation {
  id: string;
  project_id: string;
  /** Null for a page-level pen stroke drawn outside any scene tile
   * (2026-07-14, on the public share page — see share_view.py). */
  scene_id: string | null;
  author_name: string;
  kind: "highlight" | "pen";
  field: string | null;
  text: string | null;
  pen_path: string | null;
  comment: string | null;
  status: "open" | "resolved" | "rejected";
  created_at: string;
}

/** Batched per (user, project, kind) on the backend — a burst of e.g. todo
 * assignments collapses into one row with a running `count`, not one row
 * per event. See app/models.py's Notification docstring. */
export interface Notification {
  id: string;
  project_id: string;
  kind: string;
  count: number;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
  read_at: string | null;
}

export type FeedbackStatus = "open" | "todo" | "in_progress" | "implemented" | "duplicate";

export interface Feedback {
  id: string;
  text: string;
  status: FeedbackStatus;
  created_at: string;
  vote_count: number;
  user_voted: boolean;
}

/** Admin-only view (see app/main.py's require_admin) — includes who
 * submitted it and whether it's been approved for public listing yet. */
export interface FeedbackAdmin {
  id: string;
  user_id: string;
  text: string;
  status: FeedbackStatus;
  approved: boolean;
  created_at: string;
  implemented_at: string | null;
  vote_count: number;
}
