"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/app/components/AppShell";
import { Button } from "@/app/components/ui/Button";
import { useLanguage } from "@/lib/i18n";
import { buildDevlogIndex, searchDevlog, snippetFor } from "@/lib/devlogSearch";
import { renderPostHtml } from "@/lib/devlogHtml";

// Subshot's devlog (2026-07-14; since 2026-10-09 THE official devlog — every
// Ghost post shows up here, see app/main.py's devlog_posts). Public and
// unauthenticated on purpose: plain fetch, no Clerk token.
interface DevlogPost {
  id: string;
  title: string;
  slug: string;
  date: string;
  preview: string;
  cover: string | null;
  html: string;
  url: string;
  text?: string;
  tags?: string[];
  keywords?: string;
}

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL!;

/** the API serves Ghost's images under /devlog-content/ — those paths must
 * point at the API, not at this app's own domain (2026-10-09) */
const absMedia = (s: string) => s.replace(/(["'(\s])\/devlog-content\//g, `$1${BASE_URL}/devlog-content/`);
const absCover = (c: string | null) => (c && c.startsWith("/devlog-content/") ? `${BASE_URL}${c}` : c);

export default function DevlogPage() {
  return (
    <Suspense fallback={null}>
      <DevlogPageInner />
    </Suspense>
  );
}

function DevlogPageInner() {
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [posts, setPosts] = useState<DevlogPost[]>([]);
  const [open, setOpen] = useState<DevlogPost | null>(null);
  const [error, setError] = useState(false);
  // 2026-10-09, Lino: search — "?q=" keeps it in the link
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`${BASE_URL}/devlog/posts`)
      .then((r) => r.json())
      .then((data) => {
        const loaded: DevlogPost[] = (data.posts ?? []).map((p: DevlogPost) => ({ ...p, cover: absCover(p.cover), html: absMedia(` ${p.html ?? ""}`).slice(1) }));
        setPosts(loaded);
        // Direct-link support (2026-07-14): ?post=<ghost-id>
        const wanted = searchParams.get("post");
        if (wanted) {
          const match = loaded.find((p) => p.id === wanted);
          if (match) setOpen(match);
        }
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const index = useMemo(() => buildDevlogIndex(posts), [posts]);
  const shown = useMemo(() => {
    if (!query.trim()) return posts;
    const byId = new Map(posts.map((p) => [p.id, p]));
    return searchDevlog(index, query).map((id) => byId.get(id)!).filter(Boolean);
  }, [index, posts, query]);

  // keep the query in the URL (shareable, survives "back" from a post)
  useEffect(() => {
    const url = new URL(window.location.href);
    if (query.trim()) url.searchParams.set("q", query.trim());
    else url.searchParams.delete("q");
    window.history.replaceState(null, "", url.toString());
  }, [query]);

  // "/" jumps into the search field
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = document.activeElement as HTMLElement | null;
      if (e.key === "/" && !open && !(a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable))) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const postHtml = useMemo(() => (open ? renderPostHtml(open.html) : ""), [open]);

  return (
    <AppShell>
      <div className={`${open ? "max-w-2xl" : "max-w-6xl"} mx-auto w-full px-4 sm:px-6 py-8`}>
        {open ? (
          <div>
            <Button variant="ghost" size="sm" onClick={() => setOpen(null)} className="mb-4">
              {t("devlogPage.back")}
            </Button>
            <h1 className="text-xl font-bold mb-1">{open.title}</h1>
            <p className="text-xs text-white/40 mb-6">{open.date}</p>
            {/* 2026-10-09, Lino: the feature image is only the thumbnail in the
                grid, not shown in the post itself */}
            <div
              className="prose prose-invert prose-sm max-w-none prose-headings:text-white prose-a:text-blue-400 [&_video]:w-full [&_video]:rounded-xl [&_video]:bg-black [&_audio]:w-full [&_iframe]:w-full [&_iframe]:aspect-video [&_iframe]:rounded-xl [&_figure]:my-6"
              dangerouslySetInnerHTML={{ __html: postHtml }}
            />
          </div>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row sm:items-end gap-4 mb-6">
              <div className="flex-1">
                <h1 className="text-xl font-bold mb-1">Devlog</h1>
                <p className="text-sm text-white/50">{t("devlogPage.subtitle")}</p>
              </div>
              {posts.length > 0 && (
                <div className="relative w-full sm:w-80">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                  <input
                    ref={inputRef}
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Escape" && setQuery("")}
                    placeholder={t("devlogPage.searchPlaceholder")}
                    className="w-full h-10 pl-9 pr-9 rounded-xl bg-white/[0.06] border border-white/10 focus:border-white/30 outline-none text-sm placeholder:text-white/35"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  {query ? (
                    <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md text-white/50 hover:text-white hover:bg-white/10" aria-label="×">
                      ×
                    </button>
                  ) : (
                    <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-white/30 border border-white/15 rounded px-1.5">/</kbd>
                  )}
                </div>
              )}
            </div>

            {loading ? (
              <p className="text-sm text-white/40">{t("common.loading")}</p>
            ) : error ? (
              <p className="text-sm text-white/40">{t("devlogPage.loadFailed")}</p>
            ) : posts.length === 0 ? (
              <p className="text-sm text-white/40">{t("devlogPage.noEntries")}</p>
            ) : (
              <>
                {query.trim() && (
                  <p className="text-sm text-white/45 mb-4">
                    {shown.length ? t("devlogPage.results", { count: shown.length, query: query.trim() }) : t("devlogPage.noResults", { query: query.trim() })}
                  </p>
                )}
                {/* 2026-10-09, Lino: the posts as a grid; each post's feature
                    image is its preview; while searching, the matching
                    passage is shown instead of the excerpt */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {shown.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setOpen(p)}
                      className="group text-left bg-white/[0.035] border border-white/8 hover:border-white/20 rounded-2xl overflow-hidden flex flex-col transition-colors"
                    >
                      <div className="aspect-[16/10] w-full bg-gradient-to-br from-white/[0.07] to-white/[0.02] overflow-hidden">
                        {p.cover ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.cover} alt="" loading="lazy" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center font-anton uppercase text-2xl tracking-wide text-white/15 select-none">SUBSHOT</div>
                        )}
                      </div>
                      <div className="p-4 flex flex-col gap-1.5 min-w-0">
                        <p className="text-xs text-white/40">{p.date}</p>
                        <h2 className="font-semibold leading-snug line-clamp-2">{p.title}</h2>
                        {query.trim() ? (
                          <p
                            className="text-sm text-white/55 line-clamp-4 [&_mark]:bg-yellow-300/25 [&_mark]:text-white [&_mark]:rounded-sm [&_mark]:px-0.5"
                            // built from escaped plain text with <mark> only (lib/devlogSearch.ts)
                            dangerouslySetInnerHTML={{ __html: snippetFor(p, query) }}
                          />
                        ) : (
                          <p className="text-sm text-white/50 line-clamp-3">{p.preview}</p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
