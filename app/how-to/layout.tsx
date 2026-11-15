import type { Metadata } from "next";

// 2026-11-15 — the help articles («How to», formerly «Devlog»)
export const metadata: Metadata = {
  title: "How to use Subshot",
  description: "Every Subshot feature explained step by step: canvas, shot list, shooting, post-production, delivery, Live-Dubbing and more.",
  openGraph: {
    title: "How to use Subshot",
    description: "Every Subshot feature explained step by step.",
    url: "https://app.subshot.ch/how-to",
    siteName: "Subshot",
    type: "website",
  },
};

export default function HowToLayout({ children }: { children: React.ReactNode }) {
  return children;
}
