"use client";

import { useState } from "react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Input, Label, FieldGroup } from "./ui/Field";
import { useApi } from "@/lib/useApi";
import { ApiError } from "@/lib/api";
import { useToast } from "./ui/Toast";
import { useLanguage, type TranslationKey } from "@/lib/i18n";
import type { NotionDatabase, Project } from "@/lib/types";

function relativeTime(iso: string, t: (key: TranslationKey, vars?: Record<string, string | number>) => string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return t("notionImportModal.justNow");
  if (minutes < 60) return t("notionImportModal.minutesAgo", { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("notionImportModal.hoursAgo", { count: hours });
  const days = Math.round(hours / 24);
  return t("notionImportModal.daysAgo", { count: days });
}

export function NotionImportModal({
  open,
  onClose,
  project,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  project: Project;
  onImported: () => void;
}) {
  const api = useApi();
  const toast = useToast();
  const { t } = useLanguage();
  const [step, setStep] = useState<"synced" | "token" | "database">(project.notion_database_id ? "synced" : "token");
  const [token, setToken] = useState("");
  const [databases, setDatabases] = useState<NotionDatabase[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);

  // This modal stays mounted while closed (its parent renders it
  // unconditionally), so `step`'s initial value only ever applied once -
  // without this, a project's very first successful import would never
  // flip the modal to the "synced" state on the next open.
  const [wasOpen, setWasOpen] = useState(open);
  if (open && !wasOpen) {
    setWasOpen(true);
    if (project.notion_database_id) {
      setStep("synced");
    } else {
      // The Notion token is saved once per Subshot account (POST
      // /me/notion-token), not per project - re-asking for it on every
      // new project that hasn't been linked yet was a real bug (Lino: "muss
      // ich jetzt jedesmal den Key suchen?"). Check first whether one's
      // already stored and skip straight to picking a database if so.
      setStep("token");
      api.me().then((me) => {
        if (me.has_notion_token) loadDatabases();
      });
    }
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  async function connectToken() {
    const trimmed = token.trim();
    if (!trimmed) return;
    setLoading(true);
    try {
      await api.setNotionToken(trimmed);
      const dbs = await api.notionDatabases();
      setDatabases(dbs);
      setStep("database");
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("notionImportModal.connectFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function loadDatabases() {
    setLoading(true);
    try {
      const dbs = await api.notionDatabases();
      setDatabases(dbs);
      setStep("database");
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("notionImportModal.connectFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function importFrom(databaseId: string) {
    setImporting(databaseId);
    try {
      const result = await api.importNotion(project.id, databaseId);
      toast.showSuccess(t("notionImportModal.importResult", { imported: result.imported, updated: result.updated }));
      onImported();
      onClose();
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("notionImportModal.importFailed"));
    } finally {
      setImporting(null);
    }
  }

  async function resync() {
    setImporting(project.notion_database_id);
    try {
      const result = await api.importNotion(project.id);
      toast.showSuccess(t("notionImportModal.importResult", { imported: result.imported, updated: result.updated }));
      onImported();
      onClose();
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("notionImportModal.syncFailed"));
    } finally {
      setImporting(null);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t("notionImportModal.title")}>
      {step === "synced" && (
        <>
          <p className="text-sm text-white/60 mb-4">
            {project.notion_last_synced_at
              ? t("notionImportModal.lastSynced", { time: relativeTime(project.notion_last_synced_at, t) })
              : t("notionImportModal.connected")}
          </p>
          <Button variant="primary" className="w-full mb-2" onClick={resync} disabled={importing !== null}>
            {importing !== null ? t("notionImportModal.syncing") : t("notionImportModal.syncNow")}
          </Button>
          <button onClick={loadDatabases} className="text-xs text-white/40 hover:text-white/70 transition-colors">
            {t("notionImportModal.chooseOtherDatabase")}
          </button>
          <p className="text-xs text-white/30 mt-4">
            {t("notionImportModal.autoSyncHint")}
          </p>
        </>
      )}

      {step === "token" && (
        <>
          <p className="text-sm text-white/60 mb-3">
            {t("notionImportModal.tokenInstructions")}
          </p>
          <FieldGroup className="mb-0">
            <Label>{t("notionImportModal.integrationSecret")}</Label>
            <Input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={t("notionImportModal.secretPlaceholder")}
              onKeyDown={(e) => e.key === "Enter" && connectToken()}
            />
          </FieldGroup>
          <Button variant="primary" className="mt-4 w-full" onClick={connectToken} disabled={!token.trim() || loading}>
            {loading ? t("notionImportModal.connecting") : t("notionImportModal.connect")}
          </Button>
        </>
      )}

      {step === "database" && (
        <div className="space-y-1.5">
          {databases.length === 0 && <p className="text-sm text-white/50">{t("notionImportModal.noDatabasesFound")}</p>}
          {databases.map((db) => (
            <button
              key={db.id}
              onClick={() => importFrom(db.id)}
              disabled={importing !== null}
              className="w-full text-left px-3.5 py-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors flex items-center justify-between disabled:opacity-50"
            >
              <span className="text-sm font-medium">{db.title}</span>
              {importing === db.id && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
