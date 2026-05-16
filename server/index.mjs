import "dotenv/config";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractLtaBatchLink, normalizeChargerStations } from "../src/lib/chargers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const samplePath = path.join(rootDir, "public", "data", "sample-chargers.json");
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";
const ltaAccountKey = process.env.LTA_ACCOUNT_KEY;
const cacheTtlMs = Number(process.env.CACHE_TTL_MS || 60 * 60 * 1000);

let liveCache = null;
let liveRefreshPromise = null;
let sampleCache = null;

const app = express();

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    ltaConfigured: Boolean(ltaAccountKey),
    cache: liveCache ? buildCacheMeta(liveCache.fetchedAtMs) : null,
  });
});

app.get("/api/chargers", async (_req, res) => {
  const payload = await getChargersPayload();

  res.set("Cache-Control", "public, max-age=3600, stale-while-revalidate=900");
  res.json(payload);
});

app.use(express.static(path.join(rootDir, "dist")));

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(rootDir, "dist", "index.html"));
});

app.listen(port, host, () => {
  console.log(`BoCharge API listening on http://${host}:${port}`);
});

async function readSampleData() {
  if (sampleCache) return sampleCache;

  const raw = await fs.readFile(samplePath, "utf8");
  sampleCache = JSON.parse(raw);

  return sampleCache;
}

async function getChargersPayload() {
  if (!ltaAccountKey) {
    return buildSamplePayload("Add LTA_ACCOUNT_KEY to use the live DataMall EV Charging Points Batch feed.", false);
  }

  if (liveCache && Date.now() - liveCache.fetchedAtMs < cacheTtlMs) {
    return buildLivePayload(liveCache, "fresh");
  }

  if (!liveRefreshPromise) {
    liveRefreshPromise = refreshLiveCache().finally(() => {
      liveRefreshPromise = null;
    });
  }

  try {
    const refreshedCache = await liveRefreshPromise;
    return buildLivePayload(refreshedCache, "refreshed");
  } catch (error) {
    const warning = error instanceof Error ? error.message : "Unable to load LTA charger feed.";

    if (liveCache) {
      return buildLivePayload(liveCache, "stale", `Showing cached live data because refresh failed: ${warning}`);
    }

    return buildSamplePayload(warning, true);
  }
}

async function refreshLiveCache() {
  const metaResponse = await fetch("https://datamall2.mytransport.sg/ltaodataservice/EVCBatch", {
    headers: {
      AccountKey: ltaAccountKey,
      accept: "application/json",
    },
  });

  if (!metaResponse.ok) {
    throw new Error(`DataMall EVCBatch returned ${metaResponse.status}`);
  }

  const metaPayload = await metaResponse.json();
  const downloadLink = extractLtaBatchLink(metaPayload);

  if (!downloadLink) {
    throw new Error("DataMall EVCBatch response did not include a download link.");
  }

  const batchResponse = await fetch(downloadLink, {
    headers: { accept: "application/json" },
  });

  if (!batchResponse.ok) {
    throw new Error(`DataMall batch file returned ${batchResponse.status}`);
  }

  const batchPayload = await batchResponse.json();
  const stations = normalizeChargerStations(batchPayload);

  liveCache = {
    fetchedAtMs: Date.now(),
    stations,
  };

  return liveCache;
}

function buildLivePayload(cache, cacheStatus, warning = "") {
  const cacheMeta = buildCacheMeta(cache.fetchedAtMs, cacheStatus);

  return {
    stations: cache.stations,
    source: "lta-datamall",
    sourceLabel: cacheStatus === "stale" ? "Cached LTA DataMall" : "Live LTA DataMall",
    ltaConfigured: true,
    updatedAt: cacheMeta.refreshedAt,
    count: cache.stations.length,
    warning,
    cache: cacheMeta,
  };
}

async function buildSamplePayload(warning, ltaConfigured) {
  const sample = await readSampleData();

  return {
    ...sample,
    source: "sample",
    sourceLabel: "Sample fallback",
    ltaConfigured,
    warning,
    cache: {
      status: "sample",
      ttlSeconds: Math.round(cacheTtlMs / 1000),
      refreshedAt: sample.generatedAt,
      expiresAt: null,
      ageSeconds: null,
    },
  };
}

function buildCacheMeta(fetchedAtMs, status = "fresh") {
  const expiresAtMs = fetchedAtMs + cacheTtlMs;

  return {
    status,
    ttlSeconds: Math.round(cacheTtlMs / 1000),
    refreshedAt: new Date(fetchedAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    ageSeconds: Math.max(0, Math.round((Date.now() - fetchedAtMs) / 1000)),
  };
}
