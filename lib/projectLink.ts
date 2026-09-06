/** Same "which page does this project actually open to" ternary as
 * projects/page.tsx's targetHref (2026-07-19, #251's pipeline-module hard
 * gate) — shared here so the 3 other navigation entry points that don't
 * already know a project's modules (generic notification fallback, todo
 * sidebar, invite-accept redirect — see
 * [[project_subshot_web_speed_and_correctness_2026-08-25]] gap (3)) land
 * directly on /postproduction for a postproduction-only project instead of
 * bouncing through /projects/{id}'s own client-side redirect + "Lädt…"
 * spinner. Keep in sync with projects/page.tsx's targetHref if that ever
 * changes — deliberately not refactored to import from there since that
 * file's local variable isn't exported and tile-click perf isn't in scope
 * here. */
export function moduleAwareProjectHref(
  projectId: string,
  modules: { project_module_concept: boolean; project_module_scripting: boolean; project_module_postproduction: boolean }
): string {
  if (modules.project_module_concept || modules.project_module_scripting) return `/projects/${projectId}`;
  if (modules.project_module_postproduction) return `/projects/${projectId}/postproduction`;
  return `/projects/${projectId}`;
}
