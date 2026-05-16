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
- Server -> calls LTA only when the in-memory cache is older than `CACHE_TTL_MS`
- Default `CACHE_TTL_MS` -> `300000` ms, or 5 minutes
- Browser auto-refresh -> every 60 seconds, but those refreshes hit the server cache instead of hammering LTA
- If a live refresh fails after a previous successful live fetch, the server returns the last cached live payload with a warning
- If no `LTA_ACCOUNT_KEY` is configured, the app uses `public/data/sample-chargers.json`

This means normal production traffic should make roughly one LTA batch refresh per running server process every 5 minutes, not one LTA call per user.

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
/electric-chargers
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

Provider app mappings live in `src/data/providerApps.js`. The mobile CTA uses OS-aware store handoff for iOS and Android. If a provider publishes a stable app-specific deep link later, add it in that file without touching the map UI.

## References

- LTA DataMall dynamic data: https://datamall.lta.gov.sg/content/datamall/en.html
- LTA API documentation: https://datamall.lta.gov.sg/content/dam/datamall/datasets/LTA_DataMall_API_User_Guide.pdf
- LTA API terms: https://datamall.lta.gov.sg/content/datamall/en/api-terms-of-service.html
- Railway config as code: https://docs.railway.com/config-as-code/reference
- Railway healthchecks: https://docs.railway.com/deployments/healthchecks
