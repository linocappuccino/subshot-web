// 2026-11-18 — /embed/auth `next`: strict allowlist of same-site relative paths (no open redirect)
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ALLOWED = [
  /^\/embed\/[A-Za-z0-9\-_/]*$/,
  new RegExp(`^/projects/${UUID}(/postproduction|/deliver)?$`),
];
const QUERY = /^[A-Za-z0-9\-_=&%.]*$/;
export function safeNext(next: string): string {
  if (!next || next.length > 300 || /[\\\s]/.test(next) || next.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(next)) return "/";
  const [path, query = "", ...rest] = next.split("?");
  if (rest.length || !QUERY.test(query) || path.includes("..") || path.includes("//")) return "/";
  if (!ALLOWED.some((re) => re.test(path))) return "/";
  return query ? `${path}?${query}` : path;
}
