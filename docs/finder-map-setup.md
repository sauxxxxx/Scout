# Finder map configuration

The Finder uses Google Maps for displaying Google Places results. Searching and reviewing the list remain available when the map is unavailable.

## Runtime configuration

- `GOOGLE_PLACES_API_KEY`: existing server-only key for Places API (New). Never use it as the browser key.
- `GOOGLE_MAPS_BROWSER_KEY`: a separate Google Maps browser key. Enable Maps JavaScript API and Geocoding API, restrict its APIs to those two, and restrict HTTP referrers to the actual app origins. Include `http://localhost:3000/*` only for local development; preferably use a separate development key.
- `GOOGLE_MAPS_MAP_ID`: optional JavaScript map ID for map styling. The Google demo map ID is used when omitted; set your own production map ID before release.

Add local values to the ignored `.env.local` and restart the development server. Set production values on the existing hosting environment. The authenticated `/api/finder/map-config` endpoint intentionally returns only the restricted browser key and map ID, never the Places or Gemini server keys.

## Database migration

Apply `0010_finder_map.sql` and then `0011_finder_radius_facebook.sql` from the project's migration directory before deploying the new Finder. The second migration adds circular search areas, PSGC and industry metadata, result distances, and Facebook research fields. Matching migration files are provided in `db/migrations` and `drizzle`; apply through one migration system, not both. Local development also adds missing nullable columns defensively when Scout initializes its database.

Older searches remain reviewable in the list. Their results display “Map location unavailable” until a rerun obtains provider coordinates. Do not invent or derive business pins from city names.

## Behavior

- The searchable location picker uses PSGC Cloud city and municipality records and stores the PSGC code, locality type, province when available, and region. Its server adapter caches the source catalog for 24 hours.
- Selecting a location geocodes its center and shows a 1–50 km circular search radius. Google Places is biased to that circle, and Scout applies an exact distance check before saving each result.
- Moving the map does not run a business search. “Use this area” sets the draft area; “Search this area” creates a new search with the current industry, requirements and count.
- Saved searches and history retain their center and radius. Review filters are remembered during the current application session.
- New provider results persist their latitude and longitude. Map clusters, result highlighting, selection and existing-lead labels share the filtered result set.
- Internal assessment usage accounting remains server-side. Customer Finder responses and screens omit spend, credits, budgets, and token totals.
- Facebook URLs are discovered only from Google Places or a business's public website. Sales users can confirm or replace a page manually; Scout does not scrape Facebook. Confirmed links and structured research notes are carried into the company record on import.

## Release verification

With the browser key configured, check map loading and attribution, PSGC search, city resolution, radius changes, exact distance filtering, cluster expansion, result-to-pin focus, mobile List/Map switching, Facebook confirmation, company import, and restoration of a saved area. Test the unavailable state by blocking the Maps script. A live map cannot be validated without a configured browser key.
