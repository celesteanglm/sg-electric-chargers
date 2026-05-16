# ChargeSG

Mobile-first Singapore EV charger map.

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
- If a live refresh fails after a previous successful live fetch, the server returns the last cached live payload with a warning
- If no `LTA_ACCOUNT_KEY` is configured, the app uses `public/data/sample-chargers.json`

This means normal production traffic should make roughly one LTA batch refresh per running server process at each 5-minute boundary, not one LTA call per user. A cold server with no live cache may still warm itself on the first request so the website can show data immediately.

## Region Filters

The LTA EV Charging Points Batch feed includes latitude and longitude for each station, but it does not include a named planning region such as North, South, East, West, or Central. The app derives those area filters client-side from coordinates:

- Central stations are those close to the Singapore map center, currently within `0.035` latitude and `0.045` longitude of `1.3521, 103.8198`.
- Remaining stations are assigned to North/South/East/West by comparing their normalized latitude and longitude distance from that center.
- If the north/south distance is stronger, the latitude decides North or South.
- If the east/west distance is stronger, the longitude decides East or West.

These are lightweight geographic buckets for filtering and should not be treated as official URA, postal-sector, or LTA region boundaries. If exact administrative regions become important, add a polygon dataset and test each charger coordinate against those polygons.

## Key Handling

Never put the LTA key in client-side code or a `VITE_` variable. Keep it server-only:

```bash
LTA_ACCOUNT_KEY=your_lta_datamall_account_key
```

The key is read by [server/index.mjs](server/index.mjs) and sent to LTA using the `AccountKey` request header.

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
curl http://127.0.0.1:8787/api/health
curl http://127.0.0.1:8787/api/chargers
```

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
- If it returns `sourceLabel: "Cached LTA DataMall"`, users are seeing the last successful live payload while a refresh problem is present.
- LTA's published API threshold is high, but the correct pattern is still to cache because this specific feed only updates every 5 minutes.

## Provider App Links

Provider app store IDs live in `src/data/providerAppStoreMappings.js`. The mobile CTA derives App Store and Google Play URLs from that mapping, then uses OS-aware store handoff for iOS and Android. If a provider publishes a stable app-specific deep link later, add it in `src/data/providerApps.js` without touching the map UI.

## References

- LTA DataMall dynamic data: https://datamall.lta.gov.sg/content/datamall/en.html
- LTA API documentation: https://datamall.lta.gov.sg/content/dam/datamall/datasets/LTA_DataMall_API_User_Guide.pdf
- LTA API terms: https://datamall.lta.gov.sg/content/datamall/en/api-terms-of-service.html
- Railway config as code: https://docs.railway.com/config-as-code/reference
- Railway healthchecks: https://docs.railway.com/deployments/healthchecks
