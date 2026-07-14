"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/app/components/AppShell";
import { Button } from "@/app/components/ui/Button";

// Subshot's own devlog feed (2026-07-14) — same Ghost instance as SUBLI's,
// filtered server-side to posts tagged "subshot" (see app/main.py's
// devlog_posts on the backend) so the two products' devlogs never mix,
// without needing a second CMS. Public/unauthenticated on purpose, same as
// SUBLI's devlog — no Clerk token attached, plain fetch instead of useApi().
interface DevlogPost {
  id: string;
  title: string;
  slug: string;
  date: string;
  preview: string;
  cover: string | null;
  html: string;
  url: string;
}

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL!;

export default function DevlogPage() {
  const [loading, setLoading] = useState(true);
  const [posts, setPosts] = useState<DevlogPost[]>([]);
  const [open, setOpen] = useState<DevlogPost | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`${BASE_URL}/devlog/posts`)
      .then((r) => r.json())
      .then((data) => setPosts(data.posts ?? []))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto w-full px-4 sm:px-6 py-8">
        {open ? (
          <div>
            <Button variant="ghost" size="sm" onClick={() => setOpen(null)} className="mb-4">
              ← Zurück
            </Button>
            <h1 className="text-xl font-bold mb-1">{open.title}</h1>
            <p className="text-xs text-white/40 mb-6">{open.date}</p>
            {open.cover && (
              <img src={open.cover} alt="" className="w-full rounded-2xl mb-6 aspect-video object-cover" />
            )}
            <div
              className="prose prose-invert prose-sm max-w-none prose-headings:text-white prose-a:text-blue-400"
              dangerouslySetInnerHTML={{ __html: open.html }}
            />
          </div>
        ) : (
          <>
            <h1 className="text-xl font-bold mb-1">Devlog</h1>
            <p className="text-sm text-white/50 mb-6">Was sich gerade bei Subshot tut.</p>

            {loading ? (
              <p className="text-sm text-white/40">Lädt…</p>
            ) : error ? (
              <p className="text-sm text-white/40">Devlog konnte nicht geladen werden.</p>
            ) : posts.length === 0 ? (
              <p className="text-sm text-white/40">Noch keine Einträge.</p>
            ) : (
              <div className="space-y-3">
                {posts.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setOpen(p)}
                    className="w-full text-left bg-white/[0.035] border border-white/8 hover:border-white/20 rounded-2xl p-4 flex gap-4 transition-colors"
                  >
                    {p.cover && (
                      <img src={p.cover} alt="" className="w-24 h-24 rounded-xl object-cover shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs text-white/40 mb-1">{p.date}</p>
                      <h2 className="font-semibold mb-1 truncate">{p.title}</h2>
                      <p className="text-sm text-white/50 line-clamp-2">{p.preview}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
