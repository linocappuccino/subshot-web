// Mirrors app/schemas.py's *Out models on the FastAPI backend — kept in one
// file, same reasoning as the iOS app's Models.swift: one source of truth
// for what the wire format looks like, since both clients talk to the same
// backend.

export type Priority = "must" | "should" | "optional";
export type ShotStatus = "open" | "done" | "deleted";

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
  shoot_date: string | null;
  location_address: string | null;
  location_lat: number | null;
  location_lng: number | null;
  folder_id: string | null;
  thumbnail_url: string | null;
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
  created_at: string;
}

export interface ProjectDetail extends Project {
  scenes: Scene[];
  shots: Shot[];
  sections: Section[];
}

export interface Member {
  user_id: string;
  name: string | null;
  email: string;
  avatar_url: string | null;
  role: "owner" | "editor" | "viewer";
}
