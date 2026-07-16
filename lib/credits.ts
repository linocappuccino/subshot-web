// Mirrors app/main.py's MIN_CREDIT_PURCHASE/MAX_CREDIT_PURCHASE/
// IMAGE_GENERATION_COST_CREDITS — display-only constants, the backend is
// the source of truth for the actual charge (this file never computes a
// Rappen/CHF price itself — Lino: Credits only in this app's own UI, CHF
// only ever shows up on Stripe's own hosted checkout page).
export const MIN_CREDIT_PURCHASE = 600;   // 40 images
export const MAX_CREDIT_PURCHASE = 30000; // 2000 images
export const IMAGE_GENERATION_COST_CREDITS = 15;

export function creditsToImages(credits: number): number {
  return Math.floor(credits / IMAGE_GENERATION_COST_CREDITS);
}
