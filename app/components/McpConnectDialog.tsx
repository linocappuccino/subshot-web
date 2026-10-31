"use client";

import { useState } from "react";
import Link from "next/link";
import { Modal } from "./ui/Modal";
import { useLanguage } from "@/lib/i18n";

// 2026-10-31, Lino: «ein MCP-Button, der direkt ein Fenster aufklappt und zeigt, wie man seinen KI-Chat (Claude oder
// ChatGPT) mit Subshot verbindet». Information only: the public MCP endpoint (OAuth — the AI app asks the user to log in
// and confirm), no tokens, nothing written.
export const MCP_URL = "https://subshot.ch/mcp";

function CopyField({ value, label }: { value: string; label: string }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = value;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        // nothing more to try
      }
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-white/10 bg-black/30 p-1.5 pl-3">
      <code aria-label={label} className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[13px] text-white/90 [scrollbar-width:none]">
        {value}
      </code>
      <button
        type="button"
        onClick={copy}
        className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${copied ? "bg-emerald-500/20 text-emerald-300" : "bg-white/10 text-white hover:bg-white/15"}`}
      >
        {copied ? t("mcp.copied") : t("mcp.copy")}
      </button>
    </div>
  );
}

export function McpConnectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLanguage();
  const [tab, setTab] = useState<"claude" | "chatgpt">("claude");
  const step = "flex gap-2.5 text-sm leading-relaxed text-white/75";
  const num = "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px] font-bold text-white/80";
  const steps = (keys: string[]) => (
    <ol className="space-y-2">
      {keys.map((k, i) => (
        <li key={k} className={step}>
          <span className={num}>{i + 1}</span>
          <span>{t(k as Parameters<typeof t>[0], { url: MCP_URL })}</span>
        </li>
      ))}
    </ol>
  );
  return (
    <Modal open={open} onClose={onClose} title={t("mcp.title")} wide>
      <div className="space-y-5">
        <p className="text-sm leading-relaxed text-white/60">{t("mcp.intro")}</p>

        <section>
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/45">{t("mcp.urlLabel")}</h3>
          <CopyField value={MCP_URL} label={t("mcp.urlLabel")} />
        </section>

        <section>
          <div role="tablist" className="mb-3 flex w-fit rounded-lg bg-white/[0.06] p-0.5 text-[13px] font-semibold">
            {(["claude", "chatgpt"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={`rounded-md px-4 py-1.5 transition-colors ${tab === k ? "bg-white/15 text-white" : "text-white/50 hover:text-white/85"}`}
              >
                {k === "claude" ? "Claude" : "ChatGPT"}
              </button>
            ))}
          </div>
          {tab === "claude" ? (
            <div className="space-y-4">
              <div>
                <h4 className="mb-2 text-sm font-semibold text-white/90">{t("mcp.claudeWeb")}</h4>
                {steps(["mcp.claudeStep1", "mcp.claudeStep2", "mcp.claudeStep3", "mcp.claudeStep4"])}
              </div>
              <div>
                <h4 className="mb-2 text-sm font-semibold text-white/90">{t("mcp.claudeCode")}</h4>
                <CopyField value={`claude mcp add --transport http subshot ${MCP_URL}`} label={t("mcp.claudeCode")} />
                <p className="mt-1.5 text-xs text-white/45">{t("mcp.claudeCodeHint")}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {steps(["mcp.gptStep1", "mcp.gptStep2", "mcp.gptStep3", "mcp.gptStep4"])}
              <p className="text-xs text-white/45">{t("mcp.gptHint")}</p>
            </div>
          )}
        </section>

        <section>
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/45">{t("mcp.canTitle")}</h3>
          <ul className="space-y-1 text-sm text-white/75">
            {(["mcp.can1", "mcp.can2", "mcp.can3", "mcp.can4", "mcp.can5"] as const).map((k) => (
              <li key={k} className="flex gap-2">
                <span className="text-blue-300">•</span>
                {t(k)}
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-1.5 rounded-xl border border-amber-400/25 bg-amber-400/[0.07] px-4 py-3 text-sm text-amber-100/90">
          <p>⚠ {t("mcp.noApprove")}</p>
          <p>🔒 {t("mcp.noSecrets")}</p>
        </section>

        <p className="text-xs text-white/45">
          {t("mcp.manage")}{" "}
          <Link href="/oauth/connections" onClick={onClose} className="text-blue-400 hover:underline">
            {t("mcp.manageLink")}
          </Link>
        </p>
      </div>
    </Modal>
  );
}
