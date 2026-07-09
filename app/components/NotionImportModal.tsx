"use client";

import { useState } from "react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Input, Label, FieldGroup } from "./ui/Field";
import { useApi } from "@/lib/useApi";
import { ApiError } from "@/lib/api";
import { useToast } from "./ui/Toast";
import type { NotionDatabase } from "@/lib/types";

export function NotionImportModal({
  open,
  onClose,
  projectId,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onImported: () => void;
}) {
  const api = useApi();
  const toast = useToast();
  const [step, setStep] = useState<"token" | "database">("token");
  const [token, setToken] = useState("");
  const [databases, setDatabases] = useState<NotionDatabase[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);

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
      toast.showError(e instanceof ApiError ? e.message : "Verbindung fehlgeschlagen.");
    } finally {
      setLoading(false);
    }
  }

  async function importFrom(databaseId: string) {
    setImporting(databaseId);
    try {
      const result = await api.importNotion(projectId, databaseId);
      toast.showSuccess(`${result.imported} Szenen importiert.`);
      onImported();
      onClose();
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Import fehlgeschlagen.");
    } finally {
      setImporting(null);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Notion-Import">
      {step === "token" ? (
        <>
          <p className="text-sm text-white/60 mb-3">
            Erstelle eine &quot;Internal Integration&quot; in deinem Notion-Workspace, teile deine Shot-Listen-Datenbank
            damit, und füge das Secret hier ein.
          </p>
          <FieldGroup className="mb-0">
            <Label>Integration Secret</Label>
            <Input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="secret_… oder ntn_…"
              onKeyDown={(e) => e.key === "Enter" && connectToken()}
            />
          </FieldGroup>
          <Button variant="primary" className="mt-4 w-full" onClick={connectToken} disabled={!token.trim() || loading}>
            {loading ? "Verbinde…" : "Verbinden"}
          </Button>
        </>
      ) : (
        <div className="space-y-1.5">
          {databases.length === 0 && <p className="text-sm text-white/50">Keine Datenbanken gefunden.</p>}
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
