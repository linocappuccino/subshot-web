"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/app/components/AppShell";
import { Button } from "@/app/components/ui/Button";
import { Input, Label, FieldGroup } from "@/app/components/ui/Field";
import { Slider } from "@/app/components/ui/Slider";
import { Avatar } from "@/app/components/ui/Avatar";
import { Pill } from "@/app/components/ui/Badge";
import { ConfirmDialog } from "@/app/components/ui/ConfirmDialog";
import { useApi } from "@/lib/useApi";
import { ApiError } from "@/lib/api";
import { useToast } from "@/app/components/ui/Toast";
import type { Team, TeamMember } from "@/lib/types";
import { SEAT_MIN, SEAT_MAX, chf } from "@/lib/seats";

const STATUS_LABELS: Record<string, string> = {
  inactive: "Inaktiv",
  active: "Aktiv",
  past_due: "Zahlung überfällig",
  canceled: "Gekündigt",
};

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
  const searchParams = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [team, setTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);

  // Create-team form state
  const [name, setName] = useState("Mein Team");
  const [newSeats, setNewSeats] = useState(5);
  const [creating, setCreating] = useState(false);

  // Existing-team seat slider
  const [seatDraft, setSeatDraft] = useState(1);
  const [savingSeats, setSavingSeats] = useState(false);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<TeamMember | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  useEffect(() => {
    const checkout = searchParams.get("checkout");
    if (checkout === "success") toast.showSuccess("Zahlung erfolgreich — dein Team wird gleich angezeigt.");
    if (checkout === "cancel") toast.showError("Kauf abgebrochen.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
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
        const m = await api.teamMembers(mine.id);
        setMembers(m);
      }
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Laden fehlgeschlagen.");
    } finally {
      setLoading(false);
    }
  }

  async function startCheckout() {
    setCreating(true);
    try {
      const { url } = await api.teamCheckout(name.trim() || "Mein Team", newSeats);
      window.location.href = url;
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Checkout fehlgeschlagen.");
      setCreating(false);
    }
  }

  async function saveSeats() {
    if (!team || seatDraft === team.seat_count) return;
    setSavingSeats(true);
    try {
      const updated = await api.changeTeamSeats(team.id, seatDraft);
      setTeam(updated);
      toast.showSuccess(`${seatDraft} Seats ab der nächsten Abrechnung.`);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Ändern fehlgeschlagen.");
      setSeatDraft(team.seat_count);
    } finally {
      setSavingSeats(false);
    }
  }

  async function sendInvite() {
    if (!team) return;
    const trimmed = inviteEmail.trim();
    if (!trimmed) return;
    setInviting(true);
    try {
      await api.inviteTeamMember(team.id, trimmed);
      toast.showSuccess(`Einladung an ${trimmed} verschickt.`);
      setInviteEmail("");
      const m = await api.teamMembers(team.id);
      setMembers(m);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Einladung fehlgeschlagen.");
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
      toast.showError(e instanceof ApiError ? e.message : "Entfernen fehlgeschlagen.");
    } finally {
      setRemoveTarget(null);
    }
  }

  async function cancelSubscription() {
    if (!team) return;
    try {
      const updated = await api.cancelTeam(team.id);
      setTeam(updated);
      toast.showSuccess("Abo wird zum Ende der Abrechnungsperiode gekündigt.");
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Kündigen fehlgeschlagen.");
    } finally {
      setShowCancelConfirm(false);
    }
  }

  if (loading) {
    return (
      <AppShell>
        <div className="flex-1 flex items-center justify-center text-white/50">Lädt…</div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex-1 max-w-2xl mx-auto w-full px-4 sm:px-6 py-8">
        <h1 className="text-2xl font-bold tracking-tight mb-1">Team</h1>
        <p className="text-sm text-white/40 mb-6">
          Seats kaufen und Leute einladen. Ein Seat kostet CHF 4.90/Monat, ab 40 Seats nur noch CHF 4.00/Monat pro Seat —
          monatlich im Voraus, dazwischen linear gestaffelt.
        </p>

        {!team ? (
          <div className="bg-white/[0.03] border border-white/8 rounded-2xl p-5">
            <FieldGroup>
              <Label>Teamname</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Meine Produktionsfirma" />
            </FieldGroup>

            <FieldGroup>
              <div className="flex items-baseline justify-between mb-2">
                <Label>Anzahl Seats</Label>
                <span className="text-sm font-semibold">{newSeats}</span>
              </div>
              <Slider value={newSeats} min={SEAT_MIN} max={SEAT_MAX} onChange={setNewSeats} />
              <div className="flex justify-between text-[11px] text-white/30 mt-1">
                <span>{SEAT_MIN}</span>
                <span>{SEAT_MAX}</span>
              </div>
            </FieldGroup>

            <SeatPriceSummary seatCount={newSeats} />

            <Button variant="primary" className="w-full mt-4" onClick={startCheckout} disabled={creating || !name.trim()}>
              {creating ? "Weiterleiten…" : "Team abonnieren"}
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="bg-white/[0.03] border border-white/8 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-lg">{team.name}</h2>
                <Pill tone={team.status === "active" ? "good" : team.status === "past_due" ? "danger" : "default"}>
                  {STATUS_LABELS[team.status] ?? team.status}
                </Pill>
              </div>

              <div className="flex items-baseline justify-between mb-2">
                <Label>Seats</Label>
                <span className="text-sm font-semibold">
                  {seatDraft} ({members.length}/{team.seat_count} belegt)
                </span>
              </div>
              <Slider value={seatDraft} min={Math.max(SEAT_MIN, members.length)} max={SEAT_MAX} onChange={setSeatDraft} />
              <div className="flex justify-between text-[11px] text-white/30 mt-1 mb-3">
                <span>{Math.max(SEAT_MIN, members.length)}</span>
                <span>{SEAT_MAX}</span>
              </div>

              <SeatPriceSummary seatCount={seatDraft} />

              {team.pending_seat_count !== null && (
                <p className="text-xs text-white/40 mt-2">
                  Wechsel auf {team.pending_seat_count} Seats ist geplant ab {formatDate(team.current_period_end)}.
                </p>
              )}

              {seatDraft !== team.seat_count && (
                <Button variant="primary" size="sm" className="mt-3" onClick={saveSeats} disabled={savingSeats}>
                  {savingSeats ? "Speichert…" : "Seats ändern"}
                </Button>
              )}

              {!team.cancel_at_period_end ? (
                <button
                  onClick={() => setShowCancelConfirm(true)}
                  className="block mt-4 text-xs text-white/30 hover:text-red-400 transition-colors"
                >
                  Abo kündigen
                </button>
              ) : (
                <p className="text-xs text-white/40 mt-4">
                  Abo endet am {formatDate(team.current_period_end)}.
                </p>
              )}
            </div>

            <div className="bg-white/[0.03] border border-white/8 rounded-2xl p-5">
              <FieldGroup>
                <Label>Person einladen</Label>
                <div className="flex gap-2">
                  <Input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && sendInvite()}
                    placeholder="email@beispiel.ch"
                    className="flex-1"
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={sendInvite}
                    disabled={!inviteEmail.trim() || inviting || members.length >= team.seat_count}
                  >
                    {inviting ? "Sendet…" : "Einladen"}
                  </Button>
                </div>
                {members.length >= team.seat_count && (
                  <p className="text-xs text-white/40 mt-1.5">Alle Seats sind belegt — erst mehr Seats kaufen oder jemanden entfernen.</p>
                )}
              </FieldGroup>

              <FieldGroup className="mb-0">
                <Label>Mitglieder</Label>
                <div className="space-y-1">
                  {members.length === 0 && <p className="text-sm text-white/30">Noch niemand eingeladen.</p>}
                  {members.map((m) => (
                    <div key={m.id} className="flex items-center gap-2.5 py-1.5">
                      <Avatar name={m.name} email={m.email} avatarUrl={m.avatar_url} size={30} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{m.name || m.email}</div>
                        <div className="text-xs text-white/40">{m.status === "active" ? "Aktiv" : "Einladung ausstehend"}</div>
                      </div>
                      <button
                        onClick={() => setRemoveTarget(m)}
                        className="text-xs text-white/30 hover:text-red-400 transition-colors shrink-0"
                      >
                        Entfernen
                      </button>
                    </div>
                  ))}
                </div>
              </FieldGroup>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={removeTarget !== null}
        title="Mitglied entfernen?"
        message={`${removeTarget?.name || removeTarget?.email} verliert den Seat und den Zugriff auf freigegebene Projekte.`}
        onConfirm={removeMember}
        onCancel={() => setRemoveTarget(null)}
      />
      <ConfirmDialog
        open={showCancelConfirm}
        title="Abo kündigen?"
        message="Das Team bleibt bis zum Ende der aktuellen Abrechnungsperiode aktiv, verlängert sich danach nicht mehr."
        onConfirm={cancelSubscription}
        onCancel={() => setShowCancelConfirm(false)}
      />
    </AppShell>
  );
}

function SeatPriceSummary({ seatCount }: { seatCount: number }) {
  const api = useApi();
  const [price, setPrice] = useState<{ unit_price_rappen: number; monthly_total_rappen: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.seatPrice(seatCount).then((p) => {
      if (!cancelled) setPrice(p);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seatCount]);

  if (!price) return null;
  return (
    <div className="flex items-baseline justify-between text-sm">
      <span className="text-white/50">{chf(price.unit_price_rappen)} / Seat</span>
      <span className="font-semibold">{chf(price.monthly_total_rappen)} / Monat</span>
    </div>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
}
