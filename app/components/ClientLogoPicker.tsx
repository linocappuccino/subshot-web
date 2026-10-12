"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { useToast } from "./ui/Toast";
import { useApi } from "@/lib/useApi";
import { useLanguage } from "@/lib/i18n";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { ClientLogo } from "@/lib/types";

// 2026-10-12, Lino: "wenn man logos hochlädt, kann man das logo benennen und es wird gespeichert so
// dass man es für weitere projekte einfach in einer auswahlliste wieder auswählen kann ... man kann es
// auch bearbeiten und ein neues logo hochladen falls sich das logo von einem kunden ändert" — the logo
// library (per team, or per owner without a team): pick one for this project's Deliver page, rename,
// replace the file (every project using it updates), delete, add new ones with a name.

const ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml";

export function ClientLogoPicker({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const api = useApi();
  const toast = useToast();
  const { t } = useLanguage();
  const [logos, setLogos] = useState<ClientLogo[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [newName, setNewName] = useState("");
  const [newFile, setNewFile] = useState<File | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ClientLogo | null>(null);
  const newInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<string | null>(null);

  const fail = (e: unknown) => toast.showError(e instanceof ApiError ? e.message : t("deliverAdmin.saveFailed"));

  const load = useCallback(async () => {
    try {
      const r = await api.clientLogos(projectId);
      setLogos(r.logos);
      setSelected(r.selected_id);
    } catch {
      setLogos([]);
    }
  }, [api, projectId]);

  useEffect(() => {
    let alive = true;
    api
      .clientLogos(projectId)
      .then((r) => {
        if (!alive) return;
        setLogos(r.logos);
        setSelected(r.selected_id);
      })
      .catch(() => alive && setLogos([]));
    return () => {
      alive = false;
    };
  }, [api, projectId]);

  async function uploadFile(file: File): Promise<string> {
    const type = file.type || "image/png";
    const { key, upload_url } = await api.startClientLogoUpload(projectId, type);
    await api.putFile(upload_url, file, type);
    return key;
  }

  async function choose(id: string | null) {
    const before = selected;
    setSelected(id);
    try {
      await api.chooseDeliverLogo(projectId, id);
    } catch (e) {
      setSelected(before);
      fail(e);
    }
  }

  async function addNew() {
    const name = newName.trim();
    if (!name || !newFile) return;
    setBusy("new");
    try {
      const key = await uploadFile(newFile);
      const logo = await api.createClientLogo(projectId, name, key);
      setNewName("");
      setNewFile(null);
      await load();
      setSelected(logo.id);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  async function rename(id: string) {
    const name = editName.trim();
    setEditing(null);
    if (!name) return;
    setBusy(id);
    try {
      await api.updateClientLogo(projectId, id, { name });
      await load();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  async function replace(id: string, file: File) {
    setBusy(id);
    try {
      const key = await uploadFile(file);
      await api.updateClientLogo(projectId, id, { key });
      await load();
      toast.showSuccess(t("clientLogo.replaced"));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  async function remove(logo: ClientLogo) {
    setConfirmDelete(null);
    setBusy(logo.id);
    try {
      await api.deleteClientLogo(projectId, logo.id);
      await load();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  if (logos === null) return null;
  const current = logos.find((l) => l.id === selected) ?? null;
  const thumbBox = "flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/90 p-1";

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-xs text-white/50">{t("deliverRecipient.logo")}</span>
      {current ? (
        <span className="flex items-center gap-2">
          <span className={cn(thumbBox, "h-10 w-16")}>
            {/* eslint-disable-next-line @next/next/no-img-element -- presigned R2 URL */}
            <img src={current.url} alt="" className="max-h-full max-w-full object-contain" />
          </span>
          <span className="text-sm text-white/85">{current.name}</span>
        </span>
      ) : (
        <span className="text-xs text-white/30">{t("deliverRecipient.noLogo")}</span>
      )}
      {canEdit && (
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          {current ? t("clientLogo.change") : t("clientLogo.choose")}
        </Button>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={t("clientLogo.title")}>
        <div className="space-y-5 [font-family:-apple-system,BlinkMacSystemFont,'SF_Pro_Text',system-ui,sans-serif]">
          <section>
            <h3 className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-[0.06em] text-white/40">{t("clientLogo.library")}</h3>
            <ul className="divide-y divide-white/[0.06] overflow-hidden rounded-2xl bg-white/[0.05] ring-1 ring-inset ring-white/[0.06]">
              <li>
                <button type="button" onClick={() => choose(null)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-white/[0.04]">
                  <span className={cn(thumbBox, "h-9 w-14 bg-white/10 text-xs text-white/40")}>–</span>
                  <span className="flex-1 text-[15px] text-white/70">{t("clientLogo.none")}</span>
                  {!selected && <span className="text-[#0a84ff]">✓</span>}
                </button>
              </li>
              {logos.map((l) => (
                <li key={l.id} className={cn("flex items-center gap-3 px-3 py-2.5", busy === l.id && "opacity-60")}>
                  <button type="button" onClick={() => choose(l.id)} className={cn(thumbBox, "h-9 w-14")} title={t("clientLogo.use")}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- presigned R2 URL */}
                    <img src={l.url} alt="" className="max-h-full max-w-full object-contain" />
                  </button>
                  {editing === l.id ? (
                    <input
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={() => rename(l.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") setEditing(null);
                      }}
                      maxLength={120}
                      className="min-w-0 flex-1 rounded-lg bg-white/10 px-2 py-1 text-[15px] text-white outline-none ring-1 ring-[#0a84ff]/60"
                    />
                  ) : (
                    <button type="button" onClick={() => choose(l.id)} className="min-w-0 flex-1 truncate text-left text-[15px] text-white">
                      {l.name}
                    </button>
                  )}
                  {selected === l.id && <span className="text-[#0a84ff]">✓</span>}
                  <span className="flex shrink-0 items-center gap-0.5">
                    <IconBtn
                      title={t("clientLogo.rename")}
                      onClick={() => {
                        setEditing(l.id);
                        setEditName(l.name);
                      }}
                    >
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                    </IconBtn>
                    <IconBtn
                      title={t("clientLogo.replace")}
                      onClick={() => {
                        replaceTarget.current = l.id;
                        replaceInput.current?.click();
                      }}
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <path d="m17 8-5-5-5 5M12 3v12" />
                    </IconBtn>
                    <IconBtn title={t("clientLogo.delete")} danger onClick={() => setConfirmDelete(l)}>
                      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                    </IconBtn>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-[0.06em] text-white/40">{t("clientLogo.new")}</h3>
            <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white/[0.05] p-3 ring-1 ring-inset ring-white/[0.06]">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("clientLogo.namePlaceholder")}
                maxLength={120}
                className="min-w-0 flex-1 rounded-lg bg-white/[0.06] px-3 py-2 text-sm text-white outline-none placeholder:text-white/35 focus:ring-1 focus:ring-[#0a84ff]/60"
              />
              <Button variant="secondary" size="sm" onClick={() => newInput.current?.click()}>
                {newFile ? `✓ ${newFile.name.length > 18 ? newFile.name.slice(0, 16) + "…" : newFile.name}` : t("clientLogo.pickFile")}
              </Button>
              <Button variant="primary" size="sm" disabled={!newName.trim() || !newFile || busy === "new"} onClick={addNew}>
                {busy === "new" ? t("common.saving") : t("clientLogo.save")}
              </Button>
            </div>
          </section>

          <div className="flex justify-end">
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
              {t("common.done")}
            </Button>
          </div>
        </div>
        <input
          ref={newInput}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) {
              setNewFile(f);
              if (!newName.trim()) setNewName(f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "));
            }
          }}
        />
        <input
          ref={replaceInput}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f && replaceTarget.current) void replace(replaceTarget.current, f);
          }}
        />
      </Modal>
      <ConfirmDialog
        open={confirmDelete !== null}
        title={t("clientLogo.deleteTitle")}
        message={t("clientLogo.deleteMessage", { name: confirmDelete?.name ?? "" })}
        confirmLabel={t("clientLogo.delete")}
        onConfirm={() => confirmDelete && remove(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

function IconBtn({ title, onClick, danger, children }: { title: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn("flex h-8 w-8 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/10", danger ? "hover:text-red-400" : "hover:text-white")}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  );
}
