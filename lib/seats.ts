// Mirrors app/seats.py on the backend — display-only constants, the backend
// is the source of truth for the actual price (this file never computes a
// price itself, only formats what the API returned).
export const SEAT_MIN = 1;
export const SEAT_MAX = 40;

// 2026-07-27 — storage tariff picked once at Team creation, see
// STORAGE_TIER_PRICE_RAPPEN in app/seats.py (must match exactly — this list
// only drives which options the picker shows, the backend independently
// validates/prices whatever gets submitted).
// 2026-07-29 — extended 100 -> 1000 (1TB), same "must match the backend
// dict" rule.
export const STORAGE_TIERS_GB = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
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
