# Subshot Web

Browser client for Subshot — same backend (FastAPI, `/opt/subshot`) and same
Clerk user base as the iOS app, so logging in here uses the exact same
account.

## Local development

```bash
npm install
npm run dev
```

Needs `.env.local` (already present, not committed — see `.gitignore`):
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` — same Clerk app as
  the backend's `.env` and the iOS app's `SubshotApp.swift`.
- `NEXT_PUBLIC_API_BASE_URL` — the backend's public URL (`https://subshot.ch`).

## Deploying (Vercel)

1. Import this directory as a new Vercel project.
2. Set the three env vars above in Vercel's project settings (Production +
   Preview).
3. Add the deployed origin (and any Vercel preview-deployment origin, e.g.
   `https://*.vercel.app` if previews should also work) to the backend's
   `WEB_APP_ORIGINS` env var (comma-separated) in `/opt/subshot/.env`, then
   restart the backend (`sudo systemctl restart subshot`) — without this,
   every request fails with a CORS error, not a 401.

## What's implemented

Sign-in/sign-up (Clerk), project list (folders + projects, create new
project), project detail (scenes grouped by section — same "completed
scenes always sort last" rule as the iOS app — with images, description,
dialogue incl. the checkable multi-dialogue list, shot sub-list with
done-toggle), share-link generation.

## Not ported yet (works fine in the iOS app, not here)

Team/member management, Notion import, PDF export, scene image upload,
drag-and-drop reordering, todo lists, push notifications, folder/project
color+emoji editing, section create/rename UI (sections only render if they
already exist from the app). Follow-up work, not started.
