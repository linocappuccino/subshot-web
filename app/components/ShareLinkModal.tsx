"use client";

import { useEffect, useState } from "react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Input, Label, FieldGroup } from "./ui/Field";
import { Switch } from "./ui/Switch";
import { useApi } from "@/lib/useApi";
import { ApiError } from "@/lib/api";
import { useToast } from "./ui/Toast";
import { useLanguage } from "@/lib/i18n";

/** Manage the project's public share link: fetch/create it, optionally
 * password-protect it (2026-07-10, for client-facing previews where nothing
 * should be public even with the link), copy/native-share it. Mirrors the
 * iOS app's ShareLinkSheet field-for-field for client parity — replaces the
 * old separate "Link"/"Teilen" quick-action buttons, since password
 * protection needs a place to live and folding it into a one-click button
 * would either bury it or turn every share into a two-click flow anyway. */
export function ShareLinkModal({ open, onClose, projectId, projectName, kind = "storyboard", sectionId }: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  /** 2026-07-16 — "ideas" shares the Planungssektor page (idea tiles +
   * client feedback) instead of the storyboard, a separate live link per
   * project (see backend ShareLink.kind). "video" (2026-07-17, #11 Schritt
   * 7) shares the Video-Feedback-Tool page instead. */
  kind?: "storyboard" | "ideas" | "video";
  /** 2026-09-10, Lino: "wenn man in einer shotlist drin ist und dann teilt,
   * muss der geteilte link auch direkt die preview öffnen IN der shotlist
   * und nicht in der shotlist übersicht" — the currently-open Section's id
   * (projects/[id]/page.tsx's own `currentSectionId`), when sharing from
   * inside one. Appended as `?section=` on top of the SAME underlying
   * storyboard link (no separate ShareLink row per section — see
   * preview-scenes/[token]/page.tsx's own `?section=` handling), so this
   * is purely a client-side URL addition, not a new backend concept. */
  sectionId?: string | null;
}) {
  const api = useApi();
  const toast = useToast();
  const { t } = useLanguage();
  const [url, setUrl] = useState<string | null>(null);
  const [hasPassword, setHasPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isProtecting, setIsProtecting] = useState(false);
  const [password, setPassword] = useState("");
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  // 2026-07-30, Todoist #389 — get_or_create_share_link returns a
  // structured {"error":"no_ideas_internally_reviewed"} 409 (same
  // {"error","detail"} shape as insufficient_credits/trial_expired
  // elsewhere) when kind==="ideas" and NOT A SINGLE idea in the project has
  // been internally approved yet — narrower than the original #356 gate
  // (which blocked on ANY unreviewed idea): #386 made get_ideas_preview
  // itself filter to approved-only, so a link is safe to hand out the
  // moment at least one idea is ready, this only catches the "would show
  // the client a literally empty page" case.
  const [noneReviewed, setNoneReviewed] = useState(false);
  // 2026-08-09, Lino: "sind hier noch kommentare offen und will man preview
  // link teilen, ist dies nicht möglich" — same shape as noneReviewed
  // above, a SEPARATE 409 code (open_idea_comments_exist, see
  // get_or_create_share_link's own doc comment) checked in addition, not
  // instead of, the internal-review gate.
  const [openCommentsExist, setOpenCommentsExist] = useState(false);

  useEffect(() => {
    if (!open) return;
    setIsLoading(true);
    setNoneReviewed(false);
    setOpenCommentsExist(false);
    api.shareLink(projectId, undefined, undefined, kind)
      .then((result) => {
        setUrl(result.url);
        setHasPassword(result.has_password);
        setIsProtecting(result.has_password);
      })
      .catch((e) => {
        if (e instanceof ApiError && e.code === "no_ideas_internally_reviewed") {
          setNoneReviewed(true);
          return;
        }
        if (e instanceof ApiError && e.code === "open_idea_comments_exist") {
          setOpenCommentsExist(true);
          return;
        }
        toast.showError(e instanceof ApiError ? e.message : t("shareLinkModal.loadFailed"));
      })
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId, kind]);

  // Client-side only — same underlying link/token for every visitor of this
  // project+kind, just with `?section=` appended when shared from inside a
  // specific shotlist (see sectionId's own doc comment above).
  const displayUrl = url && kind === "storyboard" && sectionId ? `${url}?section=${sectionId}` : url;

  async function copyLink() {
    if (!displayUrl) return;
    await navigator.clipboard.writeText(displayUrl);
    toast.showSuccess(t("shareLinkModal.linkCopied"));
  }

  async function shareLink() {
    if (!displayUrl) return;
    if (navigator.share) {
      await navigator.share({ title: projectName || "Subshot-Projekt", url: displayUrl }).catch(() => {});
    } else {
      await copyLink();
    }
  }

  async function savePassword() {
    const trimmed = password.trim();
    if (!trimmed) return;
    setIsSavingPassword(true);
    try {
      const result = await api.shareLink(projectId, trimmed, undefined, kind);
      setUrl(result.url);
      setHasPassword(result.has_password);
      setPassword("");
      toast.showSuccess(t("shareLinkModal.passwordSet"));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("shareLinkModal.loadFailed"));
    } finally {
      setIsSavingPassword(false);
    }
  }

  async function clearPassword() {
    try {
      const result = await api.shareLink(projectId, undefined, true, kind);
      setUrl(result.url);
      setHasPassword(result.has_password);
      setIsProtecting(false);
      setPassword("");
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("shareLinkModal.loadFailed"));
    }
  }

  /** The switch only ever toggled local `isProtecting` (whether the password
   * section is expanded) — turning it OFF while a password was already set
   * never called the backend, so the real page stayed protected even though
   * the switch looked off. Root cause of "Passwortschutz entfernt aber Seite
   * immer noch geschützt". Now mirrors clicking "Entfernen" whenever the
   * switch is turned off with an existing password. */
  function handleProtectToggle(next: boolean) {
    setIsProtecting(next);
    if (!next && hasPassword) clearPassword();
  }

  if (noneReviewed) {
    return (
      <Modal open={open} onClose={onClose} title={t("shareLinkModal.titleIdeas")}>
        <p className="text-sm text-white/70 leading-relaxed">{t("shareLinkModal.noneInternallyReviewed")}</p>
      </Modal>
    );
  }

  if (openCommentsExist) {
    return (
      <Modal open={open} onClose={onClose} title={t("shareLinkModal.titleIdeas")}>
        <p className="text-sm text-white/70 leading-relaxed">{t("shareLinkModal.openCommentsExist")}</p>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title={kind === "ideas" ? t("shareLinkModal.titleIdeas") : kind === "video" ? t("shareLinkModal.titleVideo") : t("shareLinkModal.titleDefault")}>
      <FieldGroup>
        <Label>{t("shareLinkModal.publicLink")}</Label>
        {isLoading ? (
          <div className="text-sm text-white/40 py-2">{t("common.loading")}</div>
        ) : url ? (
          <>
            <div className="text-xs text-white/50 break-all mb-2">{displayUrl}</div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={copyLink}>{t("shareLinkModal.copy")}</Button>
              <Button variant="secondary" size="sm" onClick={shareLink}>{t("shareLinkModal.share")}</Button>
            </div>
          </>
        ) : null}
        <p className="text-xs text-white/40 mt-2">
          {t("shareLinkModal.linkHint")}
        </p>
        {/* 2026-07-30, Todoist #386 (Lino): "es soll die Meldung kommen die
            ca. so heisst: es werde nur intern abgenommene Ideen den Kunden
            gezeigt" — a standing reminder shown every time this modal is
            open for an "ideas" link (not just the hard-block dialog above,
            which only fires when something is CURRENTLY unreviewed) since
            new, not-yet-reviewed ideas can still be added after the link
            already exists. */}
        {kind === "ideas" && (
          <p className="text-xs text-white/40 mt-1">
            {t("shareLinkModal.ideasOnlyApprovedHint")}
          </p>
        )}
      </FieldGroup>

      <FieldGroup className="mb-2">
        <Switch checked={isProtecting} onChange={handleProtectToggle} label={t("shareLinkModal.protectWithPassword")} />
      </FieldGroup>
      {isProtecting && (
        <FieldGroup>
          <Input
            type="password"
            placeholder={hasPassword ? t("shareLinkModal.newPasswordOptional") : t("shareLinkModal.passwordPlaceholder")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div className="flex gap-2 mt-2">
            <Button variant="primary" size="sm" onClick={savePassword} disabled={!password.trim() || isSavingPassword}>
              {isSavingPassword ? t("common.saving") : hasPassword ? t("shareLinkModal.confirmPassword") : t("shareLinkModal.setPassword")}
            </Button>
            {hasPassword && (
              <Button variant="danger" size="sm" onClick={clearPassword}>{t("shareLinkModal.remove")}</Button>
            )}
          </div>
          <p className="text-xs text-white/40 mt-2">
            {hasPassword
              ? t("shareLinkModal.protectedHint")
              : t("shareLinkModal.unprotectedHint")}
          </p>
        </FieldGroup>
      )}
    </Modal>
  );
}
