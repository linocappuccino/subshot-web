// Mirrors app/schemas.py's *Out models on the FastAPI backend — kept in one
// file, same reasoning as the iOS app's Models.swift: one source of truth
// for what the wire format looks like, since both clients talk to the same
// backend.

export type Priority = "must" | "should" | "optional";
export type CameraSupport = "gimbal" | "handheld" | "tripod";
export type ShotStatus = "open" | "done" | "deleted";
export type MemberRole = "owner" | "projektleiter" | "editor";
export type InviteRole = "projektleiter" | "editor";

export interface ProjectFolder {
  id: string;
  name: string;
  color: string;
  emoji: string | null;
  sort_order: number;
  /** 2026-07-19 — folders can nest; null means this folder lives at the
   * root. See app/models.py Folder.parent_folder_id. */
  parent_folder_id: string | null;
  background_image_url: string | null;
  /** Fractional (0-1) face-detected focus point within the cover image, or
   * null when no face was found (plain center crop then). See
   * app/face_detect.py on the backend. */
  background_image_focus_x: number | null;
  background_image_focus_y: number | null;
  project_count: number;
  /** Number of direct sub-folders (not recursive). */
  folder_count: number;
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
  /** 2026-07-18 (Todoist #193) — small pre-encoded data URI shipped inline
   * so the project tile can render it immediately, no separate AuthImage
   * fetch needed for this specific low-res use. */
  thumbnail_data_uri: string | null;
  notion_database_id: string | null;
  notion_last_synced_at: string | null;
  last_opened_at: string;
  created_at: string;
  /** Pipeline-Module-Checkboxen (2026-07-17, #96) — welche Stufen der
   * "Grossen Pipeline-Vision" dieses Projekt durchlaeuft. Seit 2026-07-19
   * ein echtes Freischalt-Gate für die jeweilige Route (siehe
   * projects/[id]/page.tsx und postproduction/page.tsx), nicht mehr nur
   * kosmetisch. */
  module_concept: boolean;
  module_scripting: boolean;
  module_postproduction: boolean;
  /** 2026-07-19 — Pipeline-Fortschritt fürs Projektkachel-Badge, berechnet
   * server-seitig (_set_project_pipeline_stage in main.py), nicht editierbar. */
  pipeline_stage: "idea" | "scripting" | "postproduction" | "done";
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
  /** Survives modal close/reopen + reload (backend-tracked, not component
   * state) — see Scene.image_generating in models.py for why. */
  image_generating: boolean;
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
  /** 2026-07-27 — same round-advance/unlock mechanic as
   * Idea.feedback_round/round_advance_pending, see isSceneFeedbackLocked
   * and Scene.feedback_round's own doc comment in models.py. */
  feedback_round: number;
  round_advance_pending: boolean;
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
  /** Postproduction-Tracking (2026-07-17, #11 Schritt 5+6). Section wandert
   * erst nach expliziter Bestaetigung ("Alle Szenen im Kasten? Ab in die
   * Postproduction?") ins Tracking, nicht automatisch bei Anlage. */
  in_postproduction: boolean;
  postproduction_status: PostproductionStatus | null;
  postproduction_deadline: string | null;
  /** 2026-07-19 — created via the Postproduction page's "+ Video" button for
   * a video that never went through Idea->Scene, no separate visible
   * "section box": the postproduction page never shows an empty-state tile
   * for one of these, and deletes the section itself once its one video is
   * deleted (see postproduction/page.tsx's deleteVideo). */
  is_unplanned: boolean;
  /** 2026-08-31, Todoist #96 — same round-advance/unlock mechanic as
   * Scene.feedback_round/round_advance_pending below (see Section.
   * feedback_round's own doc comment in models.py); drives the public
   * storyboard preview's new per-section comment thread. */
  feedback_round: number;
  round_advance_pending: boolean;
  /** 2026-08-31 — shared Mark-Clip timecode session (fps + a wall-clock
   * correction offset from the iOS camera-sync flow, or 0 for a plain
   * manual "Set Framerate" pick) — see Section.timecode_fps's own doc
   * comment (models.py). `null` fps = no session currently running. */
  timecode_fps: number | null;
  timecode_offset_seconds: number;
  timecode_synced_at: string | null;
}

export type PostproductionStatus = "wartend" | "in_bearbeitung" | "wartet_auf_feedback" | "abgeschlossen" | "abgelehnt";

/** Video-Feedback-Tool (2026-07-17, #11 Schritt 7) — haengt an einer
 * Section, siehe backend Video's Doc-Kommentar. */
export interface VideoComment {
  id: string;
  version_id: string;
  user_id: string | null;
  /** Reply-Button (2026-07-17) — zeigt immer auf den WURZEL-Kommentar,
   * keine mehrstufige Baumstruktur. */
  parent_comment_id: string | null;
  /** null nur für einen system_kind-Hinweis (siehe unten) — jeder echte
   * Kommentar hat immer einen Timecode. */
  timestamp_seconds: number | null;
  author_name: string;
  comment: string;
  /** "open" | "resolved" — Abhaken in der Kommentarspalte (2026-07-17). */
  status: "open" | "resolved";
  created_at: string;
  /** Aus der User-Relationship gezogen (null bei anonymen Share-Link-
   * Kommentaren oder falls der Account kein Bild hat). */
  avatar_url: string | null;
  /** 2026-07-26 (#330) — wer den Kommentar abgehakt hat (name/email des
   * eingeloggten Teammitglieds via resolved_by_user_id), null solange
   * status="open" oder für alte Kommentare vor diesem Feld. */
  resolved_by_name: string | null;
  /** 2026-07-29 — gesetzt nur für automatisch erzeugte System-Hinweise
   * (siehe VideoComment.system_kind in models.py). `comment` ist dann nur
   * ein fixer, nicht lokalisierter Fallback-Text — die UI rendert den
   * echten Text aus diesem Feld via i18n, damit er immer in der Sprache
   * des Betrachters erscheint. 2026-08-07: `subtitle_translation_edited`
   * dazugekommen — ein separater Hinweis pro Sprache, sobald jemand (App
   * oder Preview-Seite) eine Übersetzung korrigiert. */
  system_kind: "subtitle_edited" | "subtitle_translation_edited" | null;
  /** Nur gesetzt bei system_kind === "subtitle_translation_edited" — ISO
   * 639-1 Code (z.B. "fr") der korrigierten Sprache. */
  system_kind_lang: string | null;
}

/** SRT-Untertitel-Segment (2026-07-28) of the ORIGINAL transcript, scoped
 * per VideoVersion — siehe SubtitleSegment's Doc-Kommentar in models.py.
 * `start_ms`/`end_ms` sind NIE ueber die API editierbar (siehe
 * SubtitleSegmentPatch), nur `text`. */
export interface SubtitleSegment {
  id: string;
  version_id: string;
  sort_order: number;
  start_ms: number;
  end_ms: number;
  text: string;
  /** true once this segment's text has ever been changed from the
   * originally-uploaded SRT wording via a PATCH (team or public-preview
   * side) — set server-side, never reset back to false. */
  edited: boolean;
}

/** One cue of an ALTERNATE-language track — own start_ms/end_ms/id, NOT
 * shared with the original's (2026-08-08, Lino: "man soll mehr als eine
 * SRT hochladen können, das Tool soll erkennen welche Sprache" — a real
 * per-language SRT, machine-translated OR directly uploaded, doesn't have
 * to share the original's cue count/timing, see SubtitleTranslation's own
 * doc comment in models.py). Correct via PATCH /subtitle-translations/{id}
 * (its own id, not the original segment's). */
export interface SubtitleTranslationCue {
  id: string;
  sort_order: number;
  start_ms: number;
  end_ms: number;
  text: string;
  edited: boolean;
}

/** Response shape of every subtitle-listing endpoint — the original track
 * plus zero or more alternate-language tracks, each keyed by ISO 639-1
 * code (whatever detect_language()/the translate target produced). */
export interface SubtitlesData {
  original: SubtitleSegment[];
  /** 2026-08-08, Lino: "es soll nicht Original heissen sondern auch
   * einfach die Sprache die es ist wenn man mehrere Sprachen hochlädt" —
   * the original's own auto-detected language (ISO 639-1, e.g. "en"), used
   * to label its tab like every other language instead of a generic
   * "Original" string. null for an empty track, one uploaded before this
   * field existed, or one whose language couldn't be detected — the UI
   * falls back to the generic label in that case. */
  original_lang: string | null;
  translations: Record<string, SubtitleTranslationCue[]>;
}

export interface VideoVersion {
  id: string;
  video_id: string;
  version_number: number;
  original_filename: string | null;
  content_type: string | null;
  file_size_bytes: number | null;
  duration_seconds: number | null;
  status: "uploading" | "ready";
  created_at: string;
  /** Presigned R2 URL, freshly generated per response — for a 'ready'
   * version this plays the file; for an 'uploading' one (right after
   * create_video_version) this IS the upload target (a presigned PUT URL,
   * not a GET one) — same field reused for both directions, see backend
   * create_video_version's own doc comment. */
  playback_url: string | null;
  /** 2026-07-17, Kachel-Grid mit Gesichts-Frame + Hover-Scrubbing +
   * Timeline-Hover-Vorschau (siehe app/video_processing.py im Backend).
   * Beide null solange die Background-Task nach dem Upload noch nicht
   * durchgelaufen ist. filmstrip_url ist EIN horizontales Sprite-Bild aus
   * filmstrip_frame_count Frames à filmstrip_frame_width px Breite —
   * Frontend berechnet den sichtbaren Ausschnitt selbst per
   * background-position. */
  thumbnail_url: string | null;
  filmstrip_url: string | null;
  filmstrip_frame_count: number | null;
  filmstrip_frame_width: number | null;
  filmstrip_frame_height: number | null;
  /** Nur relevant fuer den oeffentlichen Preview-Viewer (#254) — sperrt
   * weitere Kommentare auf DIESER Version, bis eine neue hochgeladen wird
   * (siehe VideoVersion.feedback_locked im Backend). Im eingeloggten Review-
   * Modal immer false, da dort nie gesetzt wird. */
  feedback_locked: boolean;
  comments: VideoComment[];
  /** 2026-07-29, Übersetzungs-Button — target language (ISO 639-1, e.g.
   * "en") of the most recent subtitle translate run, null if none yet. */
  subtitle_target_lang: string | null;
}

/** On-set take marker (2026-08-29, iOS-first — see project memory).
 * `fps` is a real float since 2026-08-30 (Nikon ZR's actual rates like
 * 23.976/29.97/59.94 aren't whole numbers), not just a stored default. */
export interface SceneMarker {
  id: string;
  section_id: string;
  timecode: string;
  fps: number;
  label: string | null;
  color: string | null;
  created_at: string;
  created_by_user_id: string | null;
}

export interface Video {
  id: string;
  section_id: string;
  title: string;
  sort_order: number;
  created_at: string;
  /** 2026-07-21 — "Wasserzeichen"-Switch, siehe VideoReviewModal.tsx. Gilt
   * fuer alle Versionen dieses Videos, wirkt nur auf den Download ueber den
   * oeffentlichen Preview-Link. */
  watermark_enabled: boolean;
  /** 2026-08-06, Lino: "wer verantwortlich ist für das video: da soll
   * Editor stehen" — one Team member, nullable until picked. Resolved to a
   * display name/avatar client-side via the already-fetched `members` list
   * (same convention as Scene's own assignee fields), not echoed by name here. */
  assignee_id: string | null;
  versions: VideoVersion[];
}

/** Response shape of GET /share/{token}/video-preview (#254) — the public
 * no-login preview page's only data source, `videos` reuses the exact same
 * `Video` shape the authenticated app gets from listVideos, so VideoTile/
 * VideoReviewModal need zero mapping to render it. Status/deadline live on
 * the SECTION (not the video, see postproduction/page.tsx's own
 * VideoTile-building logic) — `sections` is the join table the page builds
 * a lookup map from, same as the authenticated page does. */
export interface SharedVideoPreviewSection {
  id: string;
  name: string;
  postproduction_status: PostproductionStatus | null;
  postproduction_deadline: string | null;
}

export interface SharedVideoPreviewData {
  project_id: string;
  project_name: string;
  client_name: string | null;
  project_color: string;
  team_name: string | null;
  team_logo_url: string | null;
  /** Project owner's current language ("de"/"en") — see the backend's
   * `_project_owner_language`. The page calls `setPreviewLanguage(language)`
   * once this loads, per Lino: a preview link's language follows whatever
   * language the SHARER's account is set to, not always German. */
  language: "de" | "en";
  sections: SharedVideoPreviewSection[];
  videos: Video[];
}

/** Up to 10 images per Idea (2026-07-16) — uploaded or AI-generated (Gemini/
 * Nano Banana 2, same engine as Scene's AI image). status 'generating' is a
 * reserved-slot placeholder (image_url still null) shown as a spinner until
 * the next poll picks up 'ready' + the real image_url. */
export interface IdeaImage {
  id: string;
  idea_id: string;
  image_url: string | null;
  source: "upload" | "ai";
  status: "ready" | "generating";
  sort_order: number;
  created_at: string;
  /** 2026-07-30 (#388) — face-detected auto-focus point, same shape as
   * ProjectFolder.background_image_focus_x/y, null when no face was found. */
  focus_x: number | null;
  focus_y: number | null;
}

/** Freeform idea tile in a project's "Planungssektor" (2026-07-16) — the
 * step before the Scripting-Tool. "Abgenommen" (approve) converts it into a
 * real Scene (title/text/cover image copied over), see scene_id. */
export interface Idea {
  id: string;
  project_id: string;
  title: string;
  text: string;
  sort_order: number;
  status: "open" | "approved" | "rejected";
  section_id: string | null;
  scene_id: string | null;
  created_at: string;
  /** Wann die Idee angenommen wurde (2026-07-17) — null solange status
   * "open" ist, gesetzt einmalig beim Wechsel zu "approved". */
  approved_at: string | null;
  /** Separate internal PL/Admin review gate (2026-07-27, #356) — blocks
   * creating the Ideas preview ShareLink until every open idea has one.
   * "rejected" also sets status to "rejected" (hidden from the client
   * preview + rest of the pipeline), same as the standalone Abgelehnt
   * button. Set once, no undo. */
  internal_status: "approved" | "rejected" | null;
  internal_reviewed_at: string | null;
  internal_reviewed_by_name: string | null;
  images: IdeaImage[];
  /** Total client feedback entries on this idea — drives the Ideen
   * overview's Idee/1. Feedback/2. Feedback/Abgenommen grouping. */
  feedback_count: number;
  /** 2026-08-09 — sent AND unresolved only, mirrors VideoTile's own open-
   * comment count. Drives IdeaTile's top-right "💬 {n}" badge. */
  open_feedback_count: number;
}

/** Client comment on an Idea, left from the public "ideas" share page (no
 * login — same free-text author_name convention as Annotation). */
export interface IdeaFeedback {
  id: string;
  idea_id: string;
  author_name: string;
  comment: string;
  /** "draft" (saved but not yet sent, still editable/deletable by anyone
   * with the link — see delete_share_idea_feedback_json's no-ownership-
   * check doc comment) or "sent" (locked into a numbered round, permanent).
   * The authenticated app's own list_idea_feedback only ever returns
   * "sent" rows (drafts aren't real feedback yet), so this was never read
   * there before — added for the public ideas-preview page (#262), which
   * needs it to gate its own delete button and group the feedback list. */
  status: "draft" | "sent";
  /** 1-basiert, welche Feedback-Runde ("01 Feedback"/"02 Feedback"...) —
   * neue Runde startet, sobald nach einer bereits gesendeten Runde noch
   * einmal Text/Bilder geändert und danach wieder Feedback gesendet wird. */
  round: number;
  /** Zum Abarbeiten abgehakt (PL-seitig) — durchgestrichen dargestellt. */
  resolved: boolean;
  created_at: string;
  /** 2026-07-26 (#330) — wer resolved auf true gesetzt hat, null solange
   * unresolved oder für alte Zeilen vor diesem Feld. */
  resolved_by_name: string | null;
}

/** Response shape of GET /share/{token}/ideas-preview (#262) — the public
 * no-login "Ideen-Preview" page's data source (idea_share_view.py's React
 * replacement). Distinct from `Idea` (the authenticated app's own shape,
 * from listIdeas): carries the idea's FULL feedback list (not just
 * feedback_count) plus feedback_round/round_advance_pending, the two
 * fields the page needs to decide for itself whether to show or hide its
 * own feedback form — mirrors idea_share_view.py's `round_closed` boolean,
 * the authoritative spec for that gating logic (see that module's
 * _idea_lightbox_html). No section_id/scene_id/created_at — a visitor
 * never needs them. */
export interface IdeaPreview {
  id: string;
  project_id: string;
  title: string;
  text: string;
  sort_order: number;
  status: "open" | "approved" | "rejected";
  approved_at: string | null;
  feedback_round: number;
  round_advance_pending: boolean;
  images: IdeaImage[];
  feedback: IdeaFeedback[];
}

export interface SharedIdeasPreviewData {
  project_id: string;
  project_name: string;
  client_name: string | null;
  project_color: string;
  team_name: string | null;
  team_logo_url: string | null;
  /** See SharedVideoPreviewData.language's doc comment — same convention. */
  language: "de" | "en";
  expires_at: string;
  ideas: IdeaPreview[];
}

/** Response of POST /share/{token}/ideas/{idea_id}/feedback/send-json —
 * the "Feedback senden" action. Returns the idea's WHOLE feedback list
 * (not just the newly-sent rows) plus the two fields that just changed, so
 * the page can replace its local idea.feedback/feedback_round/
 * round_advance_pending wholesale instead of hand-merging deltas. */
export interface IdeaFeedbackSendResult {
  ok: boolean;
  feedback: IdeaFeedback[];
  feedback_round: number;
  round_advance_pending: boolean;
}

/** Response shape of POST /share/{token}/scenes/{scene_id}/comment/send-json
 * — the Scene counterpart of IdeaFeedbackSendResult above. */
export interface SceneCommentSendResult {
  ok: boolean;
  comments: Annotation[];
  feedback_round: number;
  round_advance_pending: boolean;
}

/** Response shape of GET /share/{token}/scenes-preview (#268) — the public
 * no-login "Szenenpreview" (storyboard) page's data source, app/share_view.py's
 * React replacement (same pairing as SharedIdeasPreviewData above for #262).
 * Reuses the authenticated app's own Scene/Shot/Section/TodoList shapes
 * as-is (no visitor-specific trimming needed, same reasoning as
 * IdeaPreview reusing IdeaImage) — the page groups scenes into sections and
 * shots into scenes client-side, same as ProjectDetail already implies for
 * the logged-in project page. `team` is owner + members flattened into one
 * list (MemberOut shape, role "owner"/"projektleiter"/"editor") for the
 * Team info block, mirrors _team_html exactly. Annotations are NOT part of
 * this response — GET /share/{token}/annotations (existing, generic to any
 * ShareLink) is fetched separately, same endpoint AnnotationsPanel already
 * uses in the authenticated app. Per Lino's explicit scope decision for
 * #268, only kind:"highlight" annotations are ever created or rendered from
 * this page — any pre-existing kind:"pen" rows are left in the DB
 * untouched but filtered out client-side wherever annotations are read. */
export interface ScenesPreviewData {
  project_id: string;
  project_name: string;
  client_name: string | null;
  project_color: string;
  team_name: string | null;
  team_logo_url: string | null;
  /** See SharedVideoPreviewData.language's doc comment — same convention. */
  language: "de" | "en";
  expires_at: string;
  shoot_date: string | null;
  location_address: string | null;
  location_lat: number | null;
  location_lng: number | null;
  sections: Section[];
  scenes: Scene[];
  shots: Shot[];
  todo_lists: TodoList[];
  team: Member[];
}

// ── Deliver (2026-09-06) ────────────────────────────────────────────────────
// A collective, project-scoped download link (ShareLink.kind === "deliver")
// — alongside (not replacing) the existing per-video "video" feedback link.
// See app/schemas.py's own header comment on this feature for the full story.

export interface DeliverVideo {
  id: string;
  title: string;
  section_id: string;
  section_name: string;
  latest_version: VideoVersion | null;
}

export interface DeliverLink {
  url: string;
  token: string;
  expires_at: string;
  has_password: boolean;
  cover_video_version_id: string | null;
}

/** GET /projects/{id}/deliver — the internal "Deliver" tab's own data:
 * current link settings (if any) plus the live list of currently-eligible
 * videos, so the tab can show both "here's your link" and "here's what's
 * actually in it right now" in one request. */
export interface DeliverStatus {
  project_name: string;
  client_name: string | null;
  project_color: string;
  project_emoji: string | null;
  link: DeliverLink | null;
  videos: DeliverVideo[];
}

/** GET /share/{token}/deliver-preview — the public, no-login payload. */
export interface DeliverPreviewData {
  project_id: string;
  project_name: string;
  client_name: string | null;
  project_color: string;
  team_name: string | null;
  team_logo_url: string | null;
  language: string;
  expires_at: string;
  videos: DeliverVideo[];
  cover_video_version_id: string | null;
  cover_thumbnail_url: string | null;
  total_size_bytes: number;
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
  due_at: string | null;
}

/** One TodoItem assigned to the current user, cross-project — see
 * TodoSidebar (#305). */
export interface MyTodo {
  id: string;
  text: string;
  done: boolean;
  due_at: string | null;
  project_id: string;
  project_name: string;
  project_client_name: string | null;
  project_color: string;
  todo_list_id: string;
  todo_list_name: string;
  pipeline_stage: Project["pipeline_stage"];
  /** 2026-08-26 — see Notification's identical fields' doc comment. */
  project_module_concept: boolean;
  project_module_scripting: boolean;
  project_module_postproduction: boolean;
}

/** One Video whose parent Section is in postproduction with a deadline set
 * — the deadline itself lives on the Section (shared by every video in
 * it), surfaced per-video for the sidebar (#305). */
export interface PostproductionVideoDeadline {
  video_id: string;
  video_title: string;
  section_id: string;
  section_name: string;
  project_id: string;
  project_name: string;
  project_client_name: string | null;
  project_color: string;
  postproduction_status: PostproductionStatus | null;
  postproduction_deadline: string;
  pipeline_stage: Project["pipeline_stage"];
  /** 2026-08-06 — the video's own latest version (regardless of upload
   * status) / that same version's open (not resolved) comment count, same
   * "open" definition VideoTile.tsx already uses. */
  video_version_number: number | null;
  open_comment_count: number;
}

/** One still-open client comment — plain IdeaFeedback or a highlight/
 * comment-kind Annotation on an idea (both merged in the authenticated
 * feedback list already, see idea's own feedback panel), or a scene
 * Annotation. No assignee to filter on like MyTodo/PostproductionVideoDeadline
 * above — scoped server-side to projects the caller is at least
 * "projektleiter" on (2026-08-09). */
export interface OpenCommentTodo {
  id: string;
  kind: "idea" | "scene";
  entity_id: string;
  entity_title: string;
  author_name: string;
  comment_preview: string;
  created_at: string;
  project_id: string;
  project_name: string;
  project_client_name: string | null;
  project_color: string;
  pipeline_stage: Project["pipeline_stage"];
}

export interface TodoSidebarData {
  todos: MyTodo[];
  postproduction_deadlines: PostproductionVideoDeadline[];
  open_comments: OpenCommentTodo[];
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

/** One person shown in the Projektinfo box (2026-08-09, #27) — separate
 * from Member above, which is the ProjectMember/role roster; being an info
 * member has no role, it's purely who's shown as the point of contact.
 * The owner is always included (is_owner true), everyone else is someone
 * explicitly added via POST /projects/{id}/info-members. */
export interface InfoMember {
  user_id: string;
  name: string | null;
  email: string;
  avatar_url: string | null;
  is_owner: boolean;
}

export interface Invite {
  id: string;
  email: string;
  role: string;
  token: string;
  created_at: string;
  accepted_at: string | null;
}

export interface InvitePreview {
  project_id: string;
  project_name: string;
  email: string;
  role: string;
  accepted_at: string | null;
  /** 2026-08-26 — see Notification's identical fields' doc comment. */
  project_module_concept: boolean;
  project_module_scripting: boolean;
  project_module_postproduction: boolean;
}

export interface TeamInvitePreview {
  team_id: string;
  team_name: string;
  email: string;
  role: string;
  status: string;
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
  /** 2026-07-17, Lino: "Alle User können alle Projekte sehen Ja/Nein" —
   * Default false = strikte ProjectMember-Sichtbarkeit. */
  all_members_see_all_projects: boolean;
  /** 2026-07-27 — storage tariff chosen once at Team creation, never
   * changed afterward (no PATCH endpoint for it, unlike seat_count). See
   * STORAGE_TIERS_GB in lib/seats.ts / STORAGE_TIER_PRICE_RAPPEN in
   * app/seats.py. */
  storage_tier_gb: number;
  /** Set only for a scheduled DECREASE (see change_team_storage_tier's own
   * doc comment on the backend) — an increase applies immediately. */
  pending_storage_tier_gb: number | null;
  seats_price_rappen: number;
  storage_tier_price_rappen: number;
  /** 2026-09-06 — presigned URL of the team's uploaded logo (see
   * Team.logo_key on the backend), shown on public preview links instead
   * of the plain "Subshot - {team name}" text. Null until uploaded. */
  logo_url: string | null;
}

/** Response shape of GET /teams/{team_id}/storage-usage — small status bar
 * on the Projektübersicht, "wie viel GB man schon belegt hat" (2026-07-27). */
export interface TeamStorageUsage {
  used_bytes: number;
  tier_gb: number;
  tier_bytes: number;
}

export interface SeatPrice {
  seat_count: number;
  unit_price_rappen: number;
  storage_tier_gb: number;
  seats_price_rappen: number;
  storage_tier_price_rappen: number;
  monthly_total_rappen: number;
}

export type TeamMemberStatus = "invited" | "active";

/** 2026-07-17, Lino's Rollen-Spezifikation — team-weite Rolle, siehe
 * TeamMembership.role's Backend-Doc-Kommentar. Admin: alle Rechte +
 * exklusiv Abo/Seats. Projektleiter: Deadlines ändern + Team einladen.
 * Editor: weder noch. */
export type TeamRole = "admin" | "projektleiter" | "editor";

export interface TeamMember {
  id: string;
  user_id: string | null;
  email: string;
  name: string | null;
  avatar_url: string | null;
  role: TeamRole;
  status: TeamMemberStatus;
  invited_at: string;
  joined_at: string | null;
  /** Der Team-Käufer bekommt eine synthetische Zeile (id "owner:<id>")
   * statt einer echten TeamMembership — kann nicht entfernt/degradiert
   * werden. */
  is_owner: boolean;
}

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
  /** An idea-tile highlight (2026-07-21, #268 follow-up — Ideen-Preview
   * gets the same text-highlight annotations Szenen-Preview shipped with)
   * sets this instead of scene_id. Exactly one of scene_id/idea_id is ever
   * set for a "highlight" kind annotation, never both. */
  idea_id: string | null;
  /** 2026-08-31, Todoist #96 — a plain (non-highlighted) comment scoped to a
   * whole Section ("Skript"/Shotlist), the Section counterpart of the
   * scene/idea comment shapes above. Exactly one of scene_id/idea_id/
   * section_id is ever set for any one row. */
  section_id: string | null;
  author_name: string;
  /** 2026-07-27 — "comment" added: a plain (non-highlighted) scene comment,
   * the Scene counterpart of IdeaFeedback, reuses this same row shape
   * instead of a parallel type (see the backend's Annotation model doc
   * comment). field/text/pen_path stay null for it, same as they already
   * are for "pen". */
  kind: "highlight" | "pen" | "comment";
  field: string | null;
  text: string | null;
  pen_path: string | null;
  comment: string | null;
  /** "draft" only ever applies to kind="comment" — same "saved but not yet
   * sent" stage as IdeaFeedback.status, see that field's own doc comment.
   * The general list endpoints (list_share_annotations/
   * list_project_annotations) never return draft rows; only the
   * create-comment response does, straight back to whoever just wrote it. */
  status: "draft" | "open" | "resolved" | "rejected";
  created_at: string;
  /** 2026-07-22 — only ever set for idea-scoped highlight-comments, stamped
   * at creation with the idea's feedback_round so it groups into the same
   * "01/02 Feedback" round blocks as sent IdeaFeedback. Null for every
   * scene-scoped annotation and for idea-scoped ones created before this
   * field existed. */
  round: number | null;
  /** 2026-07-26 (#330) — wer status auf "resolved"/"rejected" gesetzt hat,
   * null solange status="open" oder für alte Zeilen vor diesem Feld. */
  resolved_by_name: string | null;
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
  /** 2026-07-18: "idea" | "scene" | "video" | "postproduction" | null —
   * drives NotificationBell's deep-link, see its own doc comment. */
  entity_kind: string | null;
  entity_id: string | null;
  /** 2026-07-31 — the specific IdeaFeedback/Annotation/VideoComment that
   * triggered this notification (polymorphic on entity_kind, see backend
   * Notification.comment_id's own doc comment), null for notification
   * kinds with no single comment (todo assignment, postproduction status). */
  comment_id: string | null;
  /** 2026-08-26 — lets the generic fallback link (no entity_kind) route a
   * postproduction-only project straight to /postproduction, same fix as
   * projects/page.tsx's targetHref — see lib/projectLink.ts. */
  project_module_concept: boolean;
  project_module_scripting: boolean;
  project_module_postproduction: boolean;
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

/** GET/PATCH /me — mirrors the backend's MeOut (app/schemas.py). The three
 * email_notify_* fields (2026-07-28) gate ONLY the outgoing email for that
 * kind — in-app Notification rows + push always fire regardless, see
 * app/main.py's _notify_idea_feedback/_notify_video_feedback/
 * _notify_postproduction_change. */
export interface Me {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  has_notion_token: boolean;
  language: "de" | "en";
  email_notify_idea_feedback: boolean;
  email_notify_video_feedback: boolean;
  email_notify_postproduction_status: boolean;
}

/** PATCH /me body — mirrors the backend's MePatch. Every field optional,
 * omitted = "don't touch" (not "reset to default"). */
export type MePatch = Partial<
  Pick<Me, "language" | "email_notify_idea_feedback" | "email_notify_video_feedback" | "email_notify_postproduction_status">
>;
