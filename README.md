# Scout

A sales CRM for finding local businesses, tracking follow-ups and managing a pipeline. It runs on Cloudflare Workers with D1 for data and R2 for files. Finder's assessments use Google Gemini.

## Run it locally

You need Node 22.13 or newer.

```bash
npm install
cp .env.example .env.local
npm run dev -- --port 3000
```

Use port 3000, because the Maps key allows that origin. On `localhost` you're signed in automatically as a local owner, and data stays in `.wrangler/`, which isn't committed. To see the real sign-in page, open `http://scout.localhost:3000`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm test` | Unit and data-layer tests (the data-layer tests run real SQL in memory) |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | Typecheck |
| `npm run build` | Production build |
| `npx vite preview --port 3000` | Runs the production build locally. Needed to test the script policy, which is off in dev. Copy `.env.local` to `dist/server/.dev.vars` first, and delete it afterwards. |
| `npm run smoke:production` | Checks the live site's public endpoints |

CI runs lint, typecheck, tests and build on every pull request.

## Settings

Copy these from `.env.example`. Secrets belong in Cloudflare, never in the repo.

| Name | Needed for |
| --- | --- |
| `GOOGLE_OAUTH_CLIENT_ID` | Google sign-in |
| `SCOUT_OWNER_EMAIL` | Fresh databases only. The first person allowed to become owner. |
| `SCOUT_ALERT_EMAIL` | Where failure alerts are emailed. Needs `RESEND_API_KEY` and `SCOUT_EMAIL_FROM`. |
| `RESEND_API_KEY`, `SCOUT_EMAIL_FROM` | Invitation emails. Without both, invites give you a link to share yourself. |
| `GOOGLE_PLACES_API_KEY`, `GEMINI_API_KEY` | Finder |
| `GOOGLE_MAPS_BROWSER_KEY`, `GOOGLE_MAPS_MAP_ID` | The Finder map |

## How it's organised

| Path | Contents |
| --- | --- |
| `app/page.tsx` | App state, loading and saving |
| `components/crm/` | The main screens: Leads, Pipeline, Tasks and so on |
| `components/` | Finder, Team, Settings, sign-in |
| `app/api/` | API routes. Every one goes through `authenticateRequest`. |
| `lib/permissions.ts` | Roles and permissions |
| `lib/record-scope.ts` | "Own records only" rules |
| `lib/foundation-store.ts` | Database setup and migrations |
| `lib/use-record-sync.ts` | Background saving, rollback and conflicts |

## Database changes

`lib/foundation-store.ts` applies schema changes automatically. When you change it, raise `SCHEMA_VERSION`, otherwise the change won't run. `db/migrations/` is a readable history of those changes.

## Monitoring and recovery

- Failed requests, Finder job failures and browser crashes are logged as JSON. See them in the Cloudflare dashboard under Workers Logs.
- With `SCOUT_ALERT_EMAIL` set, the first failure of each kind is emailed, then that kind stays quiet for 15 minutes.
- Point an uptime monitor at `/api/health`. It returns 200 when the app and database are working.
- Workspace owners and admins can see access and deletion history in Settings, Activity log.
- D1 keeps point-in-time history. To restore, use `wrangler d1 time-travel`.

## Known limits

- Records store the owner's display name. Renames update every record, and two teammates can't share a name.
- The browser keeps a working set: open work plus the 200 most recently changed leads. Everything else loads as you search or page, using `/api/leads`, `/api/companies` and `/api/contacts`.
- Background refresh only asks for changes, so a record a colleague deletes stays on your screen until you reload.
