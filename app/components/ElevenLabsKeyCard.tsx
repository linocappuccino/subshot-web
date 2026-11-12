"use client";

/**
 * 2026-11-12, Lino: «jedes Team trägt seinen eigenen ElevenLabs-API-Schlüssel ein, nur ein Admin». Shown to team
 * admins only (personal accounts without a team: the owner). The key is sent once, checked with ElevenLabs,
 * stored encrypted — afterwards only «hinterlegt …a1b2» is ever shown. Used by the Live-Dubbing node's KI-Dubbing.
 */
import { useEffect, useState } from "react";
import { useApi } from "@/lib/useApi";
import { ApiError } from "@/lib/api";

type Status = { stored: boolean; masked: string | null; can_edit: boolean };

export function ElevenLabsKeyCard({ teamId }: { teamId: string | null }) {
  const api = useApi();
  const [status, setStatus] = useState<Status | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    api.integrationKey("elevenlabs", teamId).then(setStatus).catch(() => setStatus(null));
  }, [api, teamId]);

  if (!status?.can_edit) return null;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      setStatus(await api.setIntegrationKey("elevenlabs", teamId, draft.trim()));
      setDraft("");
      setEditing(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Speichern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      setStatus(await api.deleteIntegrationKey("elevenlabs", teamId));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-elevenlabs-card className="mt-6 bg-white/[0.03] border border-white/8 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base">🎙️</span>
        <h2 className="font-semibold">ElevenLabs-API-Schlüssel</h2>
        {status.stored && <span className="ml-auto rounded-full bg-emerald-500/15 text-emerald-300 px-2.5 py-0.5 text-xs font-semibold">hinterlegt {status.masked}</span>}
      </div>
      <p className="text-sm text-white/45 mb-3">
        Für das KI-Dubbing in der Live-Dubbing-Node. Die Kosten laufen über euer eigenes ElevenLabs-Konto und erscheinen in der Credits-Node. Der Schlüssel wird verschlüsselt gespeichert und nie mehr angezeigt.
      </p>
      {!status.stored || editing ? (
        <div className="flex flex-col gap-2">
          <input
            type="password"
            autoComplete="off"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="sk_…"
            className="w-full rounded-xl bg-white/5 border border-white/10 px-3.5 py-2.5 text-sm outline-none focus:border-blue-500 select-text"
          />
          {error && <p className="text-xs text-red-300">{error}</p>}
          <div className="flex gap-2">
            <button type="button" disabled={busy || draft.trim().length < 20} onClick={() => void save()} className="rounded-lg bg-blue-600 hover:bg-blue-500 px-3 py-1.5 text-sm font-semibold disabled:opacity-40">
              {busy ? "Prüfe …" : "Prüfen und speichern"}
            </button>
            {editing && (
              <button type="button" onClick={() => setEditing(false)} className="rounded-lg bg-white/10 px-3 py-1.5 text-sm">
                Abbrechen
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button type="button" onClick={() => setEditing(true)} className="rounded-lg bg-white/10 hover:bg-white/15 px-3 py-1.5 text-sm">
            Ersetzen
          </button>
          <button type="button" disabled={busy} onClick={() => void remove()} className="rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-300 px-3 py-1.5 text-sm">
            Entfernen
          </button>
        </div>
      )}
    </div>
  );
}
