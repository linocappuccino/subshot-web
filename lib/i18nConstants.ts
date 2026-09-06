// 2026-07-21 — split out of lib/i18n.tsx on purpose. That file has
// "use client" at the top (it defines a React Context/Provider); layout.tsx
// is a Server Component that needs ONLY this one cookie-name string (to read
// it via next/headers and pick Clerk's localization at SSR time). Importing
// ANYTHING from a "use client" module into server code risks Next.js
// evaluating that module separately in the server vs. client bundle graphs —
// for a module with top-level state (lib/i18n.tsx's `createContext(...)`)
// that would silently create TWO separate Context instances, so a Provider
// mounted in one copy is invisible to a consumer resolved from the other
// (exactly the "useLanguage must be used within LanguageProvider" crash this
// was hit by, despite the component tree nesting being correct). Keeping
// this one constant in a plain, directive-free module sidesteps the
// ambiguity entirely — both layout.tsx and lib/i18n.tsx import the SAME
// unambiguous module.
export const LANGUAGE_COOKIE = "subshot_lang";
