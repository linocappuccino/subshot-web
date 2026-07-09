"use client";

import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { motion } from "framer-motion";

/** Persistent top bar for every signed-in screen — replaces the bare
 * "Subshot" <h1> each page used to render on its own. One shared shell so
 * navigation/branding is consistent everywhere instead of every page
 * reinventing its own header. */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-[#161616]/80 border-b border-white/8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link href="/projects" className="flex items-center gap-2 font-semibold tracking-tight">
            <motion.span
              whileHover={{ rotate: -8, scale: 1.08 }}
              transition={{ type: "spring", stiffness: 400, damping: 15 }}
              className="text-lg"
            >
              🎬
            </motion.span>
            Subshot
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/team" className="flex items-center gap-1.5 text-sm text-white/60 hover:text-white transition-colors">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              Team
            </Link>
            <UserButton
              appearance={{
                elements: { userButtonAvatarBox: "w-8 h-8" },
              }}
            />
          </div>
        </div>
      </header>
      <main className="flex-1 flex flex-col">{children}</main>
    </div>
  );
}
