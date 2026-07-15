import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { ToastProvider } from "@/app/components/ui/Toast";
import { TrialExpiredDialog } from "@/app/components/ui/TrialExpiredDialog";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Subshot",
  description: "Storyboard & shot list, in the browser.",
};

// Dark-mode-only, same as the iOS app (see SubshotApp.swift's
// .preferredColorScheme(.dark) comment) — this is a companion client to the
// same product, not a general-purpose web app that should follow OS theme.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html
        lang="de"
        className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
      >
        <body className="min-h-full flex flex-col bg-[#161616] text-[#f0f0f0]">
          <ToastProvider>{children}</ToastProvider>
          <TrialExpiredDialog />
        </body>
      </html>
    </ClerkProvider>
  );
}
