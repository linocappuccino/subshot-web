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
          <UserButton
            appearance={{
              elements: { userButtonAvatarBox: "w-8 h-8" },
            }}
          />
        </div>
      </header>
      <main className="flex-1 flex flex-col">{children}</main>
    </div>
  );
}
