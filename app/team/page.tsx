"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/app/components/AppShell";
import { Button } from "@/app/components/ui/Button";
import { Input, Label, FieldGroup } from "@/app/components/ui/Field";
import { Slider } from "@/app/components/ui/Slider";
import { Switch } from "@/app/components/ui/Switch";
import { Avatar } from "@/app/components/ui/Avatar";
import { Pill } from "@/app/components/ui/Badge";
import { ConfirmDialog } from "@/app/components/ui/ConfirmDialog";
import { useApi } from "@/lib/useApi";
import { ApiError } from "@/lib/api";
import { useToast } from "@/app/components/ui/Toast";
import { useLanguage } from "@/lib/i18n";
import type { SeatPrice, Team, TeamMember, TeamRole } from "@/lib/types";
import { SEAT_MIN, SEAT_MAX, STORAGE_TIERS_GB, STORAGE_TIER_MIN_GB, STORAGE_TIER_MAX_GB, chf, formatStorageTierGb } from "@/lib/seats";

export default function TeamPage() {
  return (
    <Suspense fallback={null}>
      <TeamPageInner />
    </Suspense>
  );
}

function TeamPageInner() {
  const api = useApi();
  const toast = useToast();
  const { t } = useLanguage();
  const searchParams = useSearchParams();

  const STATUS_LABELS: Record<string, string> = {
    inactive: t("teamPage.statusInactive"),
    active: t("teamPage.statusActive"),
    past_due: t("teamPage.statusPastDue"),
    canceled: t("teamPage.statusCanceled"),
  };
  const ROLE_LABELS: Record<TeamRole, string> = {
    admin: t("roles.admin"),
    projektleiter: t("roles.projectLead"),
    editor: t("roles.editor"),
  };

  const [loading, setLoading] = useState(true);
  const [team, setTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Create-team form state
  const [name, setName] = useState(t("teamPage.defaultTeamName"));
  const [newSeats, setNewSeats] = useState(5);
  // 2026-07-27 — storage tariff, chosen once here at creation (no change-
  // tier flow exists afterward, unlike seat_count). Defaults to the
  // smallest tier, same "start minimal, upsell later" reasoning the seat
  // slider's own default of 5 (not SEAT_MAX) already follows.
  const [newStorageTierGb, setNewStorageTierGb] = useState(STORAGE_TIERS_GB[0]);
  const [creating, setCreating] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Existing-team seat slider
  const [seatDraft, setSeatDraft] = useState(1);
  const [savingSeats, setSavingSeats] = useState(false);

  // Existing-team storage-tier picker (2026-07-27, Lino correction —
  // storage IS changeable after all: "erhöhen geht sofort, verkleinern
  // erst auf den nächsten Abrechnungszyklus").
  const [storageTierDraft, setStorageTierDraft] = useState(STORAGE_TIERS_GB[0]);
  const [savingStorageTier, setSavingStorageTier] = useState(false);

  // 2026-07-18 (Todoist #203, Lino: "Man kann seinen Teamnamen nicht
  // speichern") — root cause: once a team exists, its name only ever
  // rendered as plain static text (<h2>{team.name}</h2>), there was no
  // input/save path for it at all — `name`/`setName` above is the
  // CREATE-team form's own draft, unrelated to an already-existing team.
  const [teamNameDraft, setTeamNameDraft] = useState("");
  const [savingTeamName, setSavingTeamName] = useState(false);

  const [inviteEmail, setInviteEmail] = useState("");
  // 2026-07-17, Lino: "Wenn der admin also einen User hinzufügt/einlädt
  // muss er auch direkt die rolle für diesen user definieren" — Default
  // "editor" (die schwächste Rolle), bewusst kein Default auf "admin".
  const [inviteRole, setInviteRole] = useState<TeamRole>("editor");
  const [inviting, setInviting] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<TeamMember | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  useEffect(() => {
    const checkout = searchParams.get("checkout");
    if (checkout === "success") toast.showSuccess(t("teamPage.checkoutSuccess"));
    // 2026-07-19: admin-exklusiver gratis-Team-Pfad (create_team_checkout in
    // main.py) redirected hierher OHNE Stripe — eigener Toast-Text, "Zahlung
    // erfolgreich" wäre schlicht falsch, es wurde ja nichts bezahlt.
    if (checkout === "free") toast.showSuccess(t("teamPage.checkoutFree"));
    if (checkout === "cancel") toast.showError(t("teamPage.checkoutCanceled"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
    api.me().then((me) => setCurrentUserId(me.id)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    try {
      const teams = await api.myTeams();
      const mine = teams[0] ?? null;
      setTeam(mine);
      if (mine) {
        setSeatDraft(mine.seat_count);
        setStorageTierDraft(mine.storage_tier_gb);
        setTeamNameDraft(mine.name);
        const m = await api.teamMembers(mine.id);
        setMembers(m);
      }
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("teamPage.loadFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function startCheckout() {
    setCreating(true);
    try {
      const { url } = await api.teamCheckout(name.trim() || t("teamPage.defaultTeamName"), newSeats, newStorageTierGb);
      window.location.href = url;
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("teamPage.checkoutFailed"));
      setCreating(false);
    }
  }

  async function saveSeats() {
    if (!team || seatDraft === team.seat_count) return;
    setSavingSeats(true);
    try {
      const updated = await api.changeTeamSeats(team.id, seatDraft);
      setTeam(updated);
      toast.showSuccess(t("teamPage.seatsChanged", { count: seatDraft }));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("teamPage.changeFailed"));
      setSeatDraft(team.seat_count);
    } finally {
      setSavingSeats(false);
    }
  }

  async function saveStorageTier() {
    if (!team || storageTierDraft === team.storage_tier_gb) return;
    setSavingStorageTier(true);
    try {
      const updated = await api.changeTeamStorageTier(team.id, storageTierDraft);
      setTeam(updated);
      // 2026-07-27 — backend applies an INCREASE immediately (updated.storage_tier_gb
      // already reflects it) but only SCHEDULES a decrease (updated.pending_storage_tier_gb),
      // see change_team_storage_tier's own doc comment — the toast matches which one happened.
      if (updated.storage_tier_gb === storageTierDraft) {
        toast.showSuccess(t("teamPage.storageTierChangedNow", { gb: storageTierDraft }));
      } else {
        toast.showSuccess(t("teamPage.storageTierChangedPending", { gb: storageTierDraft }));
      }
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("teamPage.changeFailed"));
      setStorageTierDraft(team.storage_tier_gb);
    } finally {
      setSavingStorageTier(false);
    }
  }

  async function saveTeamName() {
    if (!team) return;
    const trimmed = teamNameDraft.trim();
    if (!trimmed || trimmed === team.name) return;
    setSavingTeamName(true);
    try {
      const updated = await api.patchTeam(team.id, { name: trimmed });
      setTeam(updated);
      setTeamNameDraft(updated.name);
      toast.showSuccess(t("teamPage.teamNameSaved"));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("teamPage.saveFailed"));
      setTeamNameDraft(team.name);
    } finally {
      setSavingTeamName(false);
    }
  }

  async function uploadLogo(file: File) {
    if (!team) return;
    if (file.type !== "image/png") {
      toast.showError(t("teamPage.logoMustBePng"));
      return;
    }
    setLogoUploading(true);
    try {
      const updated = await api.uploadTeamLogo(team.id, file);
      setTeam(updated);
      toast.showSuccess(t("teamPage.logoSaved"));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("teamPage.saveFailed"));
    } finally {
      setLogoUploading(false);
    }
  }

  async function removeLogo() {
    if (!team) return;
    setLogoUploading(true);
    try {
      const updated = await api.deleteTeamLogo(team.id);
      setTeam(updated);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("teamPage.removeFailed"));
    } finally {
      setLogoUploading(false);
    }
  }

  async function sendInvite() {
    if (!team) return;
    const trimmed = inviteEmail.trim();
    if (!trimmed) return;
    setInviting(true);
    try {
      await api.inviteTeamMember(team.id, trimmed, inviteRole);
      toast.showSuccess(t("teamPage.inviteSent", { email: trimmed }));
      setInviteEmail("");
      setInviteRole("editor");
      const m = await api.teamMembers(team.id);
      setMembers(m);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("teamPage.inviteFailed"));
    } finally {
      setInviting(false);
    }
  }

  async function removeMember() {
    if (!team || !removeTarget) return;
    try {
      await api.removeTeamMember(team.id, removeTarget.id);
      setMembers((prev) => prev.filter((m) => m.id !== removeTarget.id));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("teamPage.removeFailed"));
    } finally {
      setRemoveTarget(null);
    }
  }

  // 2026-07-17, Lino: "[Admin] kann Rollen vergeben. und auch andere zu
  // einem Admin machen." — nur Admins sehen die Dropdown-Steuerung
  // (siehe isCurrentUserAdmin unten), das Backend lehnt es fuer alle
  // anderen ohnehin ab (403), das hier ist nur die UI-Sichtbarkeit.
  async function changeMemberRole(member: TeamMember, role: TeamRole) {
    if (!team) return;
    try {
      const updated = await api.changeTeamMemberRole(team.id, member.id, role);
      setMembers((prev) => prev.map((m) => (m.id === member.id ? updated : m)));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("teamPage.roleChangeFailed"));
    }
  }

  const isCurrentUserAdmin = members.some((m) => m.user_id === currentUserId && m.role === "admin");

  async function cancelSubscription() {
    if (!team) return;
    try {
      const updated = await api.cancelTeam(team.id);
      setTeam(updated);
      toast.showSuccess(t("teamPage.subCanceled"));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("teamPage.cancelFailed"));
    } finally {
      setShowCancelConfirm(false);
    }
  }

  // 2026-07-17, Lino: "nur personen die einem Projekt hinzugefügt wurden
  // können das projekt in der projektübersicht sehen... dies soll man aber
  // in den team einstellungen wählen können (switch)".
  async function toggleVisibility(value: boolean) {
    if (!team) return;
    try {
      const updated = await api.patchTeam(team.id, { all_members_see_all_projects: value });
      setTeam(updated);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("teamPage.toggleFailed"));
    }
  }

  if (loading) {
    return (
      <AppShell>
        <div className="flex-1 flex items-center justify-center text-white/50">{t("common.loading")}</div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex-1 max-w-2xl mx-auto w-full px-4 sm:px-6 py-8">
        <h1 className="text-2xl font-bold tracking-tight mb-1">{t("teamPage.title")}</h1>
        <p className="text-sm text-white/40 mb-6">
          {t("teamPage.intro")}
        </p>

        {!team ? (
          <div className="bg-white/[0.03] border border-white/8 rounded-2xl p-5">
            <FieldGroup>
              <Label>{t("teamPage.teamName")}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("teamPage.teamNamePlaceholder")} />
            </FieldGroup>

            <FieldGroup>
              <div className="flex items-baseline justify-between mb-2">
                <Label>{t("teamPage.seatCount")}</Label>
                <span className="text-sm font-semibold">{newSeats}</span>
              </div>
              <Slider value={newSeats} min={SEAT_MIN} max={SEAT_MAX} onChange={setNewSeats} />
              <div className="flex justify-between text-[11px] text-white/30 mt-1">
                <span>{SEAT_MIN}</span>
                <span>{SEAT_MAX}</span>
              </div>
            </FieldGroup>

            <FieldGroup>
              <Label>{t("teamPage.storageTier")}</Label>
              <div className="grid grid-cols-5 gap-1.5 mt-1.5">
                {STORAGE_TIERS_GB.map((gb) => (
                  <button
                    key={gb}
                    type="button"
                    onClick={() => setNewStorageTierGb(gb)}
                    className={`rounded-lg py-2 text-xs font-semibold transition-colors ${
                      gb === newStorageTierGb ? "bg-[#3875bd] text-white" : "bg-white/5 text-white/60 hover:bg-white/10"
                    }`}
                  >
                    {formatStorageTierGb(gb)}
                  </button>
                ))}
              </div>
            </FieldGroup>

            <SeatPriceSummary seatCount={newSeats} storageTierGb={newStorageTierGb} />

            <Button variant="primary" className="w-full mt-4" onClick={startCheckout} disabled={creating || !name.trim()}>
              {creating ? t("teamPage.redirecting") : t("teamPage.subscribeTeam")}
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="bg-white/[0.03] border border-white/8 rounded-2xl p-5">
              <div className="flex items-center justify-between gap-3 mb-4">
                {/* 2026-07-18 (Todoist #203) — editable now (was static
                    text); Enter saves, same pattern as the invite email
                    field below. Blurring without pressing Enter just
                    leaves the draft in place, unsaved — no auto-save on
                    blur, so an accidental click-away can't silently rename
                    the team. */}
                <input
                  value={teamNameDraft}
                  onChange={(e) => setTeamNameDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveTeamName()}
                  disabled={savingTeamName}
                  className="font-semibold text-lg bg-transparent outline-none focus:ring-2 focus:ring-blue-500/50 rounded-lg px-1 -mx-1 min-w-0 flex-1"
                />
                <Pill tone={team.status === "active" ? "good" : team.status === "past_due" ? "danger" : "default"}>
                  {STATUS_LABELS[team.status] ?? team.status}
                </Pill>
              </div>
              {teamNameDraft.trim() !== team.name && teamNameDraft.trim() && (
                <Button variant="primary" size="sm" className="mb-4 -mt-2" onClick={saveTeamName} disabled={savingTeamName}>
                  {savingTeamName ? t("common.saving") : t("teamPage.saveName")}
                </Button>
              )}

              <div className="flex items-baseline justify-between mb-2">
                <Label>{t("teamPage.seats")}</Label>
                <span className="text-sm font-semibold">
                  {seatDraft} ({t("teamPage.seatsOccupied", { used: members.length, total: team.seat_count })})
                </span>
              </div>
              <Slider value={seatDraft} min={Math.max(SEAT_MIN, members.length)} max={SEAT_MAX} onChange={setSeatDraft} />
              <div className="flex justify-between text-[11px] text-white/30 mt-1 mb-3">
                <span>{Math.max(SEAT_MIN, members.length)}</span>
                <span>{SEAT_MAX}</span>
              </div>

              <SeatPriceSummary seatCount={seatDraft} storageTierGb={storageTierDraft} />

              {team.pending_seat_count !== null && (
                <p className="text-xs text-white/40 mt-2">
                  {t("teamPage.pendingSeatChange", { count: team.pending_seat_count, date: formatDate(team.current_period_end) })}
                </p>
              )}

              {seatDraft !== team.seat_count && (
                <Button variant="primary" size="sm" className="mt-3" onClick={saveSeats} disabled={savingSeats}>
                  {savingSeats ? t("common.saving") : t("teamPage.changeSeats")}
                </Button>
              )}

              {/* 2026-07-27 — storage-tier change (Lino: "erhöhen geht
                  sofort, verkleinern erst auf den nächsten
                  Abrechnungszyklus"), same button-grid picker as the
                  create-team form. */}
              <div className="mt-5 pt-4 border-t border-white/8">
                <div className="flex items-baseline justify-between mb-2">
                  <Label>{t("teamPage.storageTier")}</Label>
                  <span className="text-sm font-semibold">{formatStorageTierGb(storageTierDraft)}</span>
                </div>
                {/* 2026-08-06, Lino: "soll auch mit einem schieberegler
                    funktionieren wie bei Seats" — the tiers themselves are
                    non-linear (10GB steps up to 100, then 100GB steps to
                    1000, see STORAGE_TIERS_GB), so the slider drags over the
                    ARRAY INDEX, not the GB value directly; onChange maps
                    that index back to the actual tier for storageTierDraft,
                    same value every other bit of this page already expects. */}
                <Slider
                  value={STORAGE_TIERS_GB.indexOf(storageTierDraft)}
                  min={0}
                  max={STORAGE_TIERS_GB.length - 1}
                  onChange={(index) => setStorageTierDraft(STORAGE_TIERS_GB[index])}
                />
                <div className="flex justify-between text-[11px] text-white/30 mt-1 mb-3">
                  <span>{formatStorageTierGb(STORAGE_TIER_MIN_GB)}</span>
                  <span>{formatStorageTierGb(STORAGE_TIER_MAX_GB)}</span>
                </div>

                {storageTierDraft !== team.storage_tier_gb && (
                  <p className="text-xs text-white/40 mt-2">
                    {storageTierDraft > team.storage_tier_gb
                      ? t("teamPage.storageTierIncreaseHint")
                      : t("teamPage.storageTierDecreaseHint")}
                  </p>
                )}
                {team.pending_storage_tier_gb !== null && (
                  <p className="text-xs text-white/40 mt-2">
                    {t("teamPage.pendingStorageChange", { gb: team.pending_storage_tier_gb, date: formatDate(team.current_period_end) })}
                  </p>
                )}

                {storageTierDraft !== team.storage_tier_gb && (
                  <Button variant="primary" size="sm" className="mt-3" onClick={saveStorageTier} disabled={savingStorageTier}>
                    {savingStorageTier ? t("common.saving") : t("teamPage.changeStorageTier")}
                  </Button>
                )}
              </div>

              {!team.cancel_at_period_end ? (
                <button
                  onClick={() => setShowCancelConfirm(true)}
                  className="block mt-4 text-xs text-white/30 hover:text-red-400 transition-colors"
                >
                  {t("teamPage.cancelSubscription")}
                </button>
              ) : (
                <p className="text-xs text-white/40 mt-4">
                  {t("teamPage.subscriptionEndsOn", { date: formatDate(team.current_period_end) })}
                </p>
              )}
            </div>

            {/* 2026-09-06, Lino: "jedes Team auf Subshot muss ausserdem das
                Firmenlogo (quadratisch) als PNG hochladen können damit es
                jeweils auf den Previewlinks dargestellt wird, wird kein
                Firmenlogo hochgeladen, wird es als Text dargestellt." */}
            <div className="bg-white/[0.03] border border-white/8 rounded-2xl p-5">
              <Label>{t("teamPage.logo")}</Label>
              <p className="text-xs text-white/40 mt-1 mb-3">{t("teamPage.logoHint")}</p>
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-xl bg-white/5 border border-white/10 overflow-hidden flex items-center justify-center shrink-0">
                  {team.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- presigned R2 URL, not a static/local asset next/image can optimize
                    <img src={team.logo_url} alt={team.name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-[10px] text-white/30 text-center px-1">{t("teamPage.logoNone")}</span>
                  )}
                </div>
                {isCurrentUserAdmin ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex gap-2">
                      <Button variant="secondary" size="sm" onClick={() => logoInputRef.current?.click()} disabled={logoUploading}>
                        {logoUploading ? t("common.saving") : team.logo_url ? t("teamPage.logoChange") : t("teamPage.logoUpload")}
                      </Button>
                      {team.logo_url && (
                        <Button variant="secondary" size="sm" onClick={removeLogo} disabled={logoUploading}>
                          {t("teamPage.logoRemove")}
                        </Button>
                      )}
                    </div>
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/png"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file) void uploadLogo(file);
                      }}
                    />
                  </div>
                ) : null}
              </div>
            </div>

            {/* 2026-07-17, Lino: "nur personen die einem Projekt
                hinzugefügt wurden können das projekt in der
                projektübersicht sehen... dies soll man aber in den team
                einstellungen wählen können (switch)... Mit einer
                erklärung dazu damit man versteht was dieser switch
                macht." Nur für Admins änderbar (Backend lehnt es sonst
                ab), andere sehen nur den aktuellen Stand. */}
            <div className="bg-white/[0.03] border border-white/8 rounded-2xl p-5">
              <div className={isCurrentUserAdmin ? undefined : "pointer-events-none opacity-60"}>
                <Switch
                  checked={team.all_members_see_all_projects}
                  onChange={toggleVisibility}
                  label={t("teamPage.visibilityLabel")}
                />
              </div>
              <p className="text-xs text-white/40 mt-2">
                {team.all_members_see_all_projects
                  ? t("teamPage.visibilityOnHint")
                  : t("teamPage.visibilityOffHint")}
              </p>
            </div>

            {/* 2026-07-19, Lino's finale Rollen-Spezifikation: Team-Funktion
                (inkl. Einladen) ist jetzt admin-exklusiv — Projektleiter
                durfte hier vorher noch einladen (nur auf "Editor"
                festgelegt), das faellt jetzt komplett weg. Der
                Team-Nav-Button ist fuer Nicht-Admins ohnehin schon
                ausgeblendet (AppShell.tsx), das hier greift nur bei
                direkter URL-Navigation. */}
            {isCurrentUserAdmin && (
            <div className="bg-white/[0.03] border border-white/8 rounded-2xl p-5">
              <FieldGroup>
                <Label>{t("teamPage.invitePerson")}</Label>
                <div className="flex gap-2">
                  <Input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && sendInvite()}
                    placeholder={t("teamPage.emailPlaceholder")}
                    className="flex-1"
                  />
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as TeamRole)}
                    className="bg-white/5 border border-white/10 rounded-xl px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  >
                    <option value="editor">{t("roles.editor")}</option>
                    <option value="projektleiter">{t("roles.projectLead")}</option>
                    <option value="admin">{t("roles.admin")}</option>
                  </select>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={sendInvite}
                    disabled={!inviteEmail.trim() || inviting || members.length >= team.seat_count}
                  >
                    {inviting ? t("teamPage.sending") : t("teamPage.invite")}
                  </Button>
                </div>
                {members.length >= team.seat_count && (
                  <p className="text-xs text-white/40 mt-1.5">{t("teamPage.allSeatsTaken")}</p>
                )}
                <p className="text-xs text-white/30 mt-1.5">
                  {t("teamPage.roleExplainer")}
                </p>
              </FieldGroup>

              <FieldGroup className="mb-0">
                <Label>{t("teamPage.members")}</Label>
                <div className="space-y-1">
                  {members.length === 0 && <p className="text-sm text-white/30">{t("teamPage.noMembersYet")}</p>}
                  {members.map((m) => (
                    <div key={m.id} className="flex items-center gap-2.5 py-1.5">
                      <Avatar name={m.name} email={m.email} avatarUrl={m.avatar_url} size={30} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{m.name || m.email}</div>
                        <div className="text-xs text-white/40">{m.status === "active" ? t("teamPage.memberActive") : t("teamPage.memberPending")}</div>
                      </div>
                      {/* 2026-07-17, Lino: "[Admin] kann Rollen vergeben.
                          und auch andere zu einem Admin machen." — diese
                          ganze Karte ist jetzt admin-exklusiv gerendert
                          (siehe isCurrentUserAdmin weiter oben), hier bleibt
                          nur noch die is_owner-Ausnahme: der Team-Käufer
                          kann weder degradiert noch entfernt werden. */}
                      {!m.is_owner ? (
                        <select
                          value={m.role}
                          onChange={(e) => changeMemberRole(m, e.target.value as TeamRole)}
                          className="shrink-0 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                        >
                          <option value="editor">{t("roles.editor")}</option>
                          <option value="projektleiter">{t("roles.projectLead")}</option>
                          <option value="admin">{t("roles.admin")}</option>
                        </select>
                      ) : (
                        <span className="shrink-0 text-xs text-white/40">{ROLE_LABELS[m.role]}</span>
                      )}
                      {!m.is_owner && (
                        <button
                          onClick={() => setRemoveTarget(m)}
                          className="text-xs text-white/30 hover:text-red-400 transition-colors shrink-0"
                        >
                          {t("teamPage.remove")}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </FieldGroup>
            </div>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={removeTarget !== null}
        title={t("teamPage.removeMemberTitle")}
        message={t("teamPage.removeMemberMessage", { name: removeTarget?.name || removeTarget?.email || "" })}
        onConfirm={removeMember}
        onCancel={() => setRemoveTarget(null)}
      />
      <ConfirmDialog
        open={showCancelConfirm}
        title={t("teamPage.cancelSubTitle")}
        message={t("teamPage.cancelSubMessage")}
        onConfirm={cancelSubscription}
        onCancel={() => setShowCancelConfirm(false)}
      />
    </AppShell>
  );
}

// 2026-07-27 — now shows the full seats+storage breakdown (was seats-only,
// back when a Team's price had no other component). `storageTierGb` for
// the EXISTING-team seat-change section is the team's own already-fixed
// tier (no picker there, see this file's storage-tier state doc comment) —
// still queried/shown so the change-seats preview reflects the REAL
// combined invoice total, not just the seat delta in isolation.
function SeatPriceSummary({ seatCount, storageTierGb }: { seatCount: number; storageTierGb: number }) {
  const api = useApi();
  const { t } = useLanguage();
  const [price, setPrice] = useState<SeatPrice | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.seatPrice(seatCount, storageTierGb).then((p) => {
      if (!cancelled) setPrice(p);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seatCount, storageTierGb]);

  if (!price) return null;
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex items-baseline justify-between">
        <span className="text-white/50">{t("teamPage.perSeat", { price: chf(price.unit_price_rappen) })}</span>
        <span className="text-white/70">{chf(price.seats_price_rappen)}</span>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-white/50">{t("teamPage.storageLine", { gb: price.storage_tier_gb })}</span>
        <span className="text-white/70">{chf(price.storage_tier_price_rappen)}</span>
      </div>
      <div className="flex items-baseline justify-between border-t border-white/10 pt-1 mt-0.5">
        <span className="text-white/50">{t("common.total")}</span>
        <span className="font-semibold">{t("teamPage.perMonth", { price: chf(price.monthly_total_rappen) })}</span>
      </div>
    </div>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
}
