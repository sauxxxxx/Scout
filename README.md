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
| `lib/foundation-store.ts` | Database setup and migrations |
| `lib/lead-query.ts`, `lib/record-scope.ts` | Lead filters and who can see them |
| `lib/last-touch.ts` | What counts as contact with a customer |
| `lib/overview-period.ts` | Overview periods and comparisons |
| `lib/reports.ts`, `lib/report-store.ts` | What Overview and Reports count, in one place |
| `lib/customization.ts` | Workspace colours, logo, status names and task types |
| `lib/view-settings.ts` | Each person's columns, saved views and layout |
| `lib/use-record-sync.ts` | Background saving, rollback and conflicts |
| `components/DialogManager.tsx` | Focus, Escape and unsaved-changes handling for every dialog and drawer |
| `app/globals.css` | Design tokens at the top, with dark values under `[data-theme=dark]`. The floating bento layer is at the end, using the `--bento-*` tokens. |

## Who sees what

Owners and admins see every lead. Members and viewers see leads assigned to them, plus any lead where they hold an open task. An owner can turn on "See all records" for a role in Settings. Handing a lead to someone else moves its open deal, the old owner's open tasks and its company with it, so the old owner loses sight of all of them.

## Customization

Owners change these in Settings, for the whole workspace:

- **Branding:** accent colour, logo and sign-in message. The logo also appears in invitation emails.
- **Sales setup:** names for lead statuses and pipeline stages, and the list of task types.

Records always store the original status, such as `Interested`, and the name is swapped when it's shown. That's why a rename can't break reports, and why Won and Lost keep their meaning whatever they're called. To add an accent colour, add it to `lib/customization.ts` and give it a light and dark rule in `app/globals.css`. `tests/customization.test.ts` fails if the text on it would be hard to read.

Logos are served without sign-in, because sign-in pages and emails show them. SVG isn't accepted, since it can carry scripts.

Each person sets their own font size and row spacing in Preferences. Table columns, saved views and the Overview layout save as they're changed, through `/api/profile/view`.

## Reports

Overview and Reports read the same counts from `loadReport` in `lib/report-store.ts`, so they can't disagree. Reps see only their own numbers. Owners, admins and anyone with "See all records" can see the team.

- **Prospects:** leads added in the period, by hand or from Finder.
- **Calls, emails, meetings:** completed activities, dated when they happened. Callbacks count as calls.
- **Follow-ups:** tasks marked complete, other than internal reminders. Stored in `tasks.completed_at`.
- **Proposals:** a logged proposal, a finished Send proposal task, or a deal or lead moved to Proposal. Each lead counts once per period, on its earliest day.

Tasks and deals finished before these dates existed use their last update as the date, so older periods are approximate.

## Google Sheets export

"Open in Google Sheets" creates the sheet in the rep's own Drive, using their Google sign-in. Configure the Google Cloud project that holds `GOOGLE_OAUTH_CLIENT_ID`:

1. Enable the **Google Sheets API**.
2. In **Google Auth Platform → Audience**, use **External** for personal Gmail accounts or users outside the project's Google Workspace organisation. **Internal** only allows accounts within that organisation; other accounts receive `403: org_internal`.
3. If the external app's publishing status is **Testing**, add each account that will export (including the owner's account) under **Test users**. For wider availability, publish the OAuth app when ready.
4. Under **Data Access**, add `https://www.googleapis.com/auth/drive.file`.
5. Under **Clients**, make sure the web client's **Authorized JavaScript origins** includes `https://scoutcrm.pages.dev` (and `http://localhost:3000` for local testing).

After saving changes, close any failed Google popup and retry **Open in Google Sheets**. Audience changes happen in Google Cloud and do not require redeploying Scout. See [Google's audience setup guide](https://support.google.com/cloud/answer/15549945).

The access token stays in the browser and is never sent to Scout's server.

## Finder search size

Google returns only its most relevant matches per search, so Scout splits the area into smaller parts until it reaches the lead count. `finderRequestLimit` in `lib/finder-cells.ts` caps the billed requests per search: 24 for 100 leads. Businesses a workspace has been shown are remembered for 90 days in `finder_seen_places` and left out of later searches.

`FINDER_AI_MAX_CANDIDATES` caps how many results per search get an AI assessment (20 by default). The rest keep their rule-based score.

## Sample data

For demos, `npm run demo` fills the local database with a sample team, leads, deals, tasks, activity and Finder searches. Dates are relative to today, so run it again on the day. `npm run demo:remove` takes it out and leaves real records alone. Both only touch the local development database.

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
- On phones the lead table shows only the business and status. Open a lead to see the rest.
- Sales targets aren't in the Overview yet.
