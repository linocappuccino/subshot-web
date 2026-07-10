"use client";

import { useEffect, useState } from "react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Input, Label, FieldGroup } from "./ui/Field";
import { Switch } from "./ui/Switch";
import { useApi } from "@/lib/useApi";
import { ApiError } from "@/lib/api";
import { useToast } from "./ui/Toast";

/** Manage the project's public share link: fetch/create it, optionally
 * password-protect it (2026-07-10, for client-facing previews where nothing
 * should be public even with the link), copy/native-share it. Mirrors the
 * iOS app's ShareLinkSheet field-for-field for client parity — replaces the
 * old separate "Link"/"Teilen" quick-action buttons, since password
 * protection needs a place to live and folding it into a one-click button
 * would either bury it or turn every share into a two-click flow anyway. */
export function ShareLinkModal({ open, onClose, projectId, projectName }: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
}) {
  const api = useApi();
  const toast = useToast();
  const [url, setUrl] = useState<string | null>(null);
  const [hasPassword, setHasPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isProtecting, setIsProtecting] = useState(false);
  const [password, setPassword] = useState("");
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  useEffect(() => {
    if (!open) return;
    setIsLoading(true);
    api.shareLink(projectId)
      .then((result) => {
        setUrl(result.url);
        setHasPassword(result.has_password);
        setIsProtecting(result.has_password);
      })
      .catch((e) => toast.showError(e instanceof ApiError ? e.message : "Fehlgeschlagen."))
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId]);

  async function copyLink() {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    toast.showSuccess("Link kopiert");
  }

  async function shareLink() {
    if (!url) return;
    if (navigator.share) {
      await navigator.share({ title: projectName || "Subshot-Projekt", url }).catch(() => {});
    } else {
      await copyLink();
    }
  }

  async function savePassword() {
    const trimmed = password.trim();
    if (!trimmed) return;
    setIsSavingPassword(true);
    try {
      const result = await api.shareLink(projectId, trimmed);
      setUrl(result.url);
      setHasPassword(result.has_password);
      setPassword("");
      toast.showSuccess("Passwort gesetzt");
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Fehlgeschlagen.");
    } finally {
      setIsSavingPassword(false);
    }
  }

  async function clearPassword() {
    try {
      const result = await api.shareLink(projectId, undefined, true);
      setUrl(result.url);
      setHasPassword(result.has_password);
      setIsProtecting(false);
      setPassword("");
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Fehlgeschlagen.");
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Link teilen">
      <FieldGroup>
        <Label>Öffentlicher Link</Label>
        {isLoading ? (
          <div className="text-sm text-white/40 py-2">Lädt…</div>
        ) : url ? (
          <>
            <div className="text-xs text-white/50 break-all mb-2">{url}</div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={copyLink}>Kopieren</Button>
              <Button variant="secondary" size="sm" onClick={shareLink}>Teilen</Button>
            </div>
          </>
        ) : null}
        <p className="text-xs text-white/40 mt-2">
          Jeder mit diesem Link kann die Vorschau ansehen, auch ohne Subshot-Account. Läuft nach 7 Tagen ab.
        </p>
      </FieldGroup>

      <FieldGroup className="mb-2">
        <Switch checked={isProtecting} onChange={setIsProtecting} label="Mit Passwort schützen" />
      </FieldGroup>
      {isProtecting && (
        <FieldGroup>
          <Input
            type="password"
            placeholder={hasPassword ? "Neues Passwort (optional)" : "Passwort"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div className="flex gap-2 mt-2">
            <Button variant="primary" size="sm" onClick={savePassword} disabled={!password.trim() || isSavingPassword}>
              {isSavingPassword ? "Speichert…" : hasPassword ? "Passwort ändern" : "Passwort setzen"}
            </Button>
            {hasPassword && (
              <Button variant="danger" size="sm" onClick={clearPassword}>Entfernen</Button>
            )}
          </div>
          <p className="text-xs text-white/40 mt-2">
            {hasPassword
              ? "Aktiv — Besucher müssen das Passwort eingeben, bevor sie die Vorschau sehen."
              : "Sinnvoll für Projekte/Kunden, wo nichts öffentlich einsehbar sein soll, auch nicht mit dem Link."}
          </p>
        </FieldGroup>
      )}
    </Modal>
  );
}
