// Mirrors app/seats.py on the backend — display-only constants, the backend
// is the source of truth for the actual price (this file never computes a
// price itself, only formats what the API returned).
export const SEAT_MIN = 1;
export const SEAT_MAX = 40;

export function chf(rappen: number): string {
  return `CHF ${(rappen / 100).toFixed(2)}`;
}
