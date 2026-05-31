# BoCharge

Mobile-first Singapore EV charger map.

Product planning notes live in [docs/todo.md](docs/todo.md). Data and third-party asset notices live in [NOTICE.md](NOTICE.md).

## Project Status

BoCharge is an open-source web app for finding EV charging stations in Singapore. The app uses a Node/Express API, a Vite/React frontend, LTA DataMall for charger data, optional OneMap place search, optional Google Analytics, and OpenStreetMap tiles.

Production deployments should keep API credentials server-side, run one replica unless shared caching is added, and validate LTA/OneMap terms before redistributing derived data outside this app.

## Data Source And Refresh Cadence

The production data source is LTA DataMall's EV Charging Points Batch API:

```text
https://datamall2.mytransport.sg/ltaodataservice/EVCBatch
```

LTA documents this dataset as a single-file feed for all EV charging points in Singapore. Its update frequency is **5 minutes**. The API returns a temporary download link, and that link expires after **5 minutes**.

This app follows that cadence:

- Browser -> `GET /api/chargers`
- Server -> calls LTA for the current 5-minute refresh slot, and also runs a background refresh on those same clock boundaries when `LTA_ACCOUNT_KEY` is configured
- Default `CACHE_TTL_MS` -> `300000` ms, or 5 minutes
- Browser auto-refresh -> the next `:00`, `:05`, `:10`, `:15`, etc. 5-minute clock boundary, shown in the app as SGT
- HTTP cache expiry -> `max-age` is calculated to expire at the next 5-minute boundary, rather than 5 minutes after a random page load
- If a live refresh fails after a previous successful live fetch, the server logs the failure and returns the last cached live payload without showing a frontend warning
- If no `LTA_ACCOUNT_KEY` is configured, the app uses `public/data/sample-chargers.json`

This means normal production traffic should make roughly one LTA batch refresh per running server process at each 5-minute boundary, not one LTA call per user. A cold server with no live cache may still warm itself on the first request so the website can show data immediately.

## Region Filters

The LTA EV Charging Points Batch feed includes latitude and longitude for each station, but it does not include a named planning region such as North, South, East, West, or Central. The app derives those area filters client-side from coordinates:

- Central stations are those close to the Singapore map center, currently within `0.035` latitude and `0.045` longitude of `1.3521, 103.8198`.
- Remaining stations are assigned to North/South/East/West by comparing their normalized latitude and longitude distance from that center.
- If the north/south distance is stronger, the latitude decides North or South.
- If the east/west distance is stronger, the longitude decides East or West.

These are lightweight geographic buckets for filtering and should not be treated as official URA, postal-sector, or LTA region boundaries. If exact administrative regions become important, add a polygon dataset and test each charger coordinate against those polygons.

## Typed Location Search

Typed search is free-first. The browser normalizes the query, removes words such as `near` and `around`, scores local charger text matches, and supports common place aliases such as `mbs`. Known places such as Marina Bay and Marina Bay Sands rank chargers by nearby distance rather than requiring the place name to appear in the charger record.

For place queries that are not covered locally, the server exposes:

```text
GET /api/search-place?q=marina%20bay%20sands
```

This endpoint proxies OneMap Search from the server, caches normalized query results, and returns only label/address/coordinate fields to the browser. Configure either `ONEMAP_API_TOKEN` or `ONEMAP_EMAIL` plus `ONEMAP_PASSWORD` to avoid exposing OneMap credentials client-side:

```bash
ONEMAP_API_TOKEN=your_short_lived_token
# Or use credentials so the server can refresh tokens:
ONEMAP_EMAIL=you@example.com
ONEMAP_PASSWORD=your_password
ONEMAP_CACHE_TTL_MS=2592000000
```

## Key Handling

Never put the LTA key in client-side code or a `VITE_` variable. Keep it server-only:

```bash
LTA_ACCOUNT_KEY=your_lta_datamall_account_key
CACHE_TTL_MS=300000
LTA_FETCH_TIMEOUT_MS=15000
ONEMAP_API_TOKEN=optional_onemap_token
# Or use ONEMAP_EMAIL and ONEMAP_PASSWORD so the server can refresh tokens.
ONEMAP_CACHE_TTL_MS=2592000000
```

The key is read by [server/index.mjs](server/index.mjs) and sent to LTA using the `AccountKey` request header.
The server also restricts LTA batch downloads to the current DataMall S3 host and applies a fetch timeout so public
requests cannot leave backend fetches hanging indefinitely.

## Analytics

Basic Google Analytics tracking is optional. Create a GA4 web data stream, copy its measurement ID, and expose it to the server runtime:

```bash
GA_MEASUREMENT_ID=G-XXXXXXXXXX
```

The server returns only this public measurement ID from `GET /api/config`, so production hosts such as Railway can update it without relying on Vite build-time env injection. `VITE_GA_MEASUREMENT_ID` is still supported for local static builds.

When a measurement ID is set, the client loads Google's `gtag.js` script and records page views for the map and `/data` route. When it is blank, analytics is disabled and no Google Analytics script is loaded.

## Run Locally

```bash
npm install
cp .env.example .env
# Add LTA_ACCOUNT_KEY in .env for the live all-Singapore feed.
npm run dev
```

Open `http://127.0.0.1:5173`.

For a production-style local run:

```bash
npm run build
LTA_ACCOUNT_KEY=your_key npm start
```

Open `http://127.0.0.1:8787`.

Useful checks:

```bash
npm run check
curl http://127.0.0.1:8787/api/health
curl http://127.0.0.1:8787/api/chargers
```

`npm run check` runs the production dependency audit and frontend build. Pull requests should pass this before merge.

## Railway Runbook

Railway can host this as one Node service: the Express server serves both the API and the built Vite frontend.

### 1. Prepare The Repo

If this folder is deployed from a larger repo, set the Railway service **Root Directory** to:

```text
/sg-electric-chargers
```

If this folder is its own GitHub repo, no special root directory is needed.

### 2. Create The Railway Service

1. Create a new Railway project.
2. Deploy from GitHub.
3. Select the repo.
4. Confirm the root directory if needed.
5. Railway should read [railway.toml](railway.toml):
   - Build command: `npm run build`
   - Start command: `npm start`
   - Healthcheck path: `/api/health`

### 3. Set Variables

In the Railway service Variables tab, set:

```bash
LTA_ACCOUNT_KEY=your_lta_datamall_account_key
CACHE_TTL_MS=300000
LTA_FETCH_TIMEOUT_MS=15000
NODE_ENV=production
```

Do **not** set `PORT` on Railway unless you intentionally want to override Railway's provided port. The server listens on `0.0.0.0:$PORT`, which is what Railway expects for public networking.

### 4. Deploy And Validate

After deployment, open the Railway public domain and verify:

```text
https://your-service.up.railway.app/api/health
https://your-service.up.railway.app/api/chargers
```

Expected live health response:

```json
{
  "ok": true,
  "ltaConfigured": true,
  "cache": null
}
```

`cache` will be `null` before the first `/api/chargers` request. After the first successful live request, it should include `refreshedAt`, `expiresAt`, and `ageSeconds`.

### 5. Operational Notes

- Keep replicas at `1` unless you add a shared cache such as Redis. The current cache is in-memory, so each replica would refresh LTA separately.
- If traffic grows, add Redis and move the `/api/chargers` cache there before scaling horizontally.
- Do not log `LTA_ACCOUNT_KEY`.
- If `/api/chargers` returns `source: "sample"`, either the key is missing or the live LTA call failed before any live cache existed.
- If `cache.status` is `stale`, users are seeing the last successful live payload while a refresh problem is present; the public UI still fills silently and the failure is logged server-side.
- LTA's published API threshold is high, but the correct pattern is still to cache because this specific feed only updates every 5 minutes.

## Provider App Links

Provider app store IDs live in `src/data/providerAppStoreMappings.js`. The mobile CTA derives App Store and Google Play URLs from that mapping, then uses OS-aware store handoff for iOS and Android. If a provider publishes a stable app-specific deep link later, add it in `src/data/providerApps.js` without touching the map UI.

## Open Source

- Code is licensed under [MIT](LICENSE).
- Contributions should follow [CONTRIBUTING.md](CONTRIBUTING.md).
- Security reports should follow [SECURITY.md](SECURITY.md).
- Privacy behavior is documented in [PRIVACY.md](PRIVACY.md).
- Third-party data, map tiles, provider logos, app-store data, and trademarks are not relicensed by this repository.

## References

- LTA DataMall dynamic data: https://datamall.lta.gov.sg/content/datamall/en.html
- LTA API documentation: https://datamall.lta.gov.sg/content/dam/datamall/datasets/LTA_DataMall_API_User_Guide.pdf
- LTA API terms: https://datamall.lta.gov.sg/content/datamall/en/api-terms-of-service.html
- Railway config as code: https://docs.railway.com/config-as-code/reference
- Railway healthchecks: https://docs.railway.com/deployments/healthchecks
