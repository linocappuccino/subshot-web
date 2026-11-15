// Mirrors app/seats.py on the backend — display-only constants, the backend
// is the source of truth for the actual price (this file never computes a
// price itself, only formats what the API returned).
export const SEAT_MIN = 1;
export const SEAT_MAX = 100;

// 2026-07-27 — storage tariff picked once at Team creation, see
// STORAGE_TIER_PRICE_RAPPEN in app/seats.py (must match exactly — this list
// only drives which options the picker shows, the backend independently
// validates/prices whatever gets submitted).
// 2026-07-29 — extended 100 -> 1000 (1TB), same "must match the backend
// dict" rule.
// 2026-11-15, Lino: plans = storage + included seats (more seats CHF 4.90 each), must match PLANS in app/seats.py
export const PLAN_INCLUDED_SEATS: Record<number, number> = { 10: 3, 100: 10, 500: 50 };
export const STORAGE_TIERS_GB = [10, 100, 500];
export function includedSeats(gb: number): number {
  const lower = STORAGE_TIERS_GB.filter((t) => t <= gb);
  return PLAN_INCLUDED_SEATS[lower.length ? lower[lower.length - 1] : STORAGE_TIERS_GB[0]];
}
export const STORAGE_TIER_MIN_GB = STORAGE_TIERS_GB[0];
export const STORAGE_TIER_MAX_GB = STORAGE_TIERS_GB[STORAGE_TIERS_GB.length - 1];

export function chf(rappen: number): string {
  return `CHF ${(rappen / 100).toFixed(2)}`;
}

// 2026-07-29 — the 1000GB tier reads as "1 TB" in the picker instead of a
// 4-digit gram of "1000 GB", everything below stays in GB.
export function formatStorageTierGb(gb: number): string {
  return gb >= 1000 ? `${gb / 1000} TB` : `${gb} GB`;
}
