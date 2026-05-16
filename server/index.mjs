import "dotenv/config";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractLtaBatchLink, normalizeChargerStations } from "../src/lib/chargers.js";
import { normalizeSearchText } from "../src/lib/search.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const samplePath = path.join(rootDir, "public", "data", "sample-chargers.json");
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";
const ltaAccountKey = process.env.LTA_ACCOUNT_KEY;
const configuredCacheTtlMs = Number(process.env.CACHE_TTL_MS || 5 * 60 * 1000);
const cacheTtlMs = Number.isFinite(configuredCacheTtlMs) && configuredCacheTtlMs > 0 ? configuredCacheTtlMs : 5 * 60 * 1000;
const configuredLtaFetchTimeoutMs = Number(process.env.LTA_FETCH_TIMEOUT_MS || 15000);
const ltaFetchTimeoutMs =
  Number.isFinite(configuredLtaFetchTimeoutMs) && configuredLtaFetchTimeoutMs > 0 ? configuredLtaFetchTimeoutMs : 15000;
const oneMapBaseUrl = process.env.ONEMAP_BASE_URL || "https://www.onemap.gov.sg";
const oneMapApiToken = process.env.ONEMAP_API_TOKEN || "";
const oneMapEmail = process.env.ONEMAP_EMAIL || "";
const oneMapPassword = process.env.ONEMAP_PASSWORD || "";
const configuredOneMapCacheTtlMs = Number(process.env.ONEMAP_CACHE_TTL_MS || 30 * 24 * 60 * 60 * 1000);
const oneMapSearchCacheTtlMs =
  Number.isFinite(configuredOneMapCacheTtlMs) && configuredOneMapCacheTtlMs > 0
    ? configuredOneMapCacheTtlMs
    : 30 * 24 * 60 * 60 * 1000;

let liveCache = null;
let liveRefreshPromise = null;
let sampleCache = null;
let alignedRefreshTimer = null;
let oneMapTokenCache = null;
const oneMapSearchCache = new Map();

const app = express();

app.disable("x-powered-by");

app.use((_req, res, next) => {
  res.set({
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://*.tile.openstreetmap.org",
      "connect-src 'self'",
      "font-src 'self' data:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(), geolocation=(self), microphone=(), payment=()",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    ltaConfigured: Boolean(ltaAccountKey),
    cache: liveCache ? buildCacheMeta(liveCache.fetchedAtMs) : null,
  });
});

app.get("/api/chargers", async (_req, res) => {
  const payload = await getChargersPayload();
  const maxAgeSeconds = getSecondsUntilNextRefreshBoundary();

  res.set("Cache-Control", `public, max-age=${maxAgeSeconds}, stale-while-revalidate=60`);
  res.json(payload);
});

app.get("/api/search-place", async (req, res) => {
  const query = normalizeSearchText(req.query.q);

  if (query.length < 2) {
    res.json({ results: [] });
    return;
  }

  try {
    const payload = await searchOneMapPlace(query);
    const maxAgeSeconds = Math.max(60, Math.round(oneMapSearchCacheTtlMs / 1000));

    res.set("Cache-Control", `public, max-age=${maxAgeSeconds}, stale-while-revalidate=86400`);
    res.json(payload);
  } catch (error) {
    const warning = error instanceof Error ? error.message : "Place search unavailable.";

    res.status(200).json({ results: [], warning });
  }
});

app.use(express.static(path.join(rootDir, "dist")));

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(rootDir, "dist", "index.html"));
});

app.listen(port, host, () => {
  console.log(`BoCharge API listening on http://${host}:${port}`);
  if (ltaAccountKey) scheduleAlignedLiveRefresh();
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

  if (liveCache && liveCache.refreshSlotMs === getCurrentRefreshSlotMs()) {
    return buildLivePayload(liveCache, "fresh");
  }

  try {
    const refreshedCache = await ensureLiveCacheForCurrentSlot();
    return buildLivePayload(refreshedCache, "refreshed");
  } catch (error) {
    const warning = error instanceof Error ? error.message : "Unable to load LTA charger feed.";
    console.warn(`LTA live refresh failed: ${warning}`);

    if (liveCache) {
      return buildLivePayload(liveCache, "stale");
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
    signal: AbortSignal.timeout(ltaFetchTimeoutMs),
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
    signal: AbortSignal.timeout(ltaFetchTimeoutMs),
  });

  if (!batchResponse.ok) {
    throw new Error(`DataMall batch file returned ${batchResponse.status}`);
  }

  const batchPayload = await batchResponse.json();
  const stations = normalizeChargerStations(batchPayload);
  const ltaLastUpdatedTime = batchPayload.LastUpdatedTime || batchPayload.lastUpdatedTime || "";
  const fetchedAtMs = Date.now();

  liveCache = {
    fetchedAtMs,
    ltaLastUpdatedTime,
    ltaUpdatedAt: normalizeLtaTimestamp(ltaLastUpdatedTime),
    refreshSlotMs: getCurrentRefreshSlotMs(fetchedAtMs),
    stations,
  };

  return liveCache;
}

async function ensureLiveCacheForCurrentSlot() {
  if (liveCache && liveCache.refreshSlotMs === getCurrentRefreshSlotMs()) {
    return liveCache;
  }

  if (!liveRefreshPromise) {
    liveRefreshPromise = refreshLiveCache().finally(() => {
      liveRefreshPromise = null;
    });
  }

  return liveRefreshPromise;
}

async function searchOneMapPlace(query) {
  const cacheKey = normalizeSearchText(query);
  const cached = oneMapSearchCache.get(cacheKey);

  if (cached && cached.expiresAtMs > Date.now()) {
    return cached.payload;
  }

  const payload = await fetchOneMapPlaces(cacheKey);

  oneMapSearchCache.set(cacheKey, {
    expiresAtMs: Date.now() + oneMapSearchCacheTtlMs,
    payload,
  });

  return payload;
}

async function fetchOneMapPlaces(query) {
  const url = new URL("/api/common/elastic/search", oneMapBaseUrl);
  url.searchParams.set("searchVal", query);
  url.searchParams.set("returnGeom", "Y");
  url.searchParams.set("getAddrDetails", "Y");
  url.searchParams.set("pageNum", "1");

  const authorization = await getOneMapAuthorizationHeader();
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      ...(authorization ? { Authorization: authorization } : {}),
    },
    signal: AbortSignal.timeout(ltaFetchTimeoutMs),
  });

  if (!response.ok) {
    throw new Error(`OneMap search returned ${response.status}`);
  }

  const payload = await response.json();
  const results = toArray(payload.results).map(normalizeOneMapPlace).filter(Boolean).slice(0, 5);
  const warning =
    payload.error && results.length === 0
      ? payload.error
      : !authorization
        ? "OneMap token is not configured; place search may be limited."
        : "";

  return {
    results,
    warning,
  };
}

async function getOneMapAuthorizationHeader() {
  if (oneMapApiToken) return oneMapApiToken;
  if (!oneMapEmail || !oneMapPassword) return "";

  if (oneMapTokenCache && oneMapTokenCache.expiresAtMs > Date.now() + 5 * 60 * 1000) {
    return oneMapTokenCache.token;
  }

  const tokenResponse = await fetch(new URL("/api/auth/post/getToken", oneMapBaseUrl), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: oneMapEmail,
      password: oneMapPassword,
    }),
    signal: AbortSignal.timeout(ltaFetchTimeoutMs),
  });

  if (!tokenResponse.ok) {
    throw new Error(`OneMap token request returned ${tokenResponse.status}`);
  }

  const payload = await tokenResponse.json();
  const token = payload.access_token || payload.token || "";

  if (!token) {
    throw new Error("OneMap token response did not include an access token.");
  }

  const expiresAtMs = getOneMapTokenExpiryMs(payload);

  oneMapTokenCache = {
    expiresAtMs,
    token,
  };

  return token;
}

function normalizeOneMapPlace(place) {
  const latitude = toNumber(place.LATITUDE ?? place.latitude);
  const longitude = toNumber(place.LONGITUDE ?? place.LONGTITUDE ?? place.longitude ?? place.longtitude);

  if (!isSingaporeCoordinate(latitude, longitude)) return null;

  const label = cleanOneMapValue(place.SEARCHVAL || place.BUILDING || place.searchVal || place.building || "");
  const address = cleanOneMapValue(place.ADDRESS || place.address || label);
  const postalCode = cleanOneMapValue(place.POSTAL || place.postal || "");

  return {
    id: `onemap:${normalizeSearchText(label || address)}:${latitude.toFixed(6)},${longitude.toFixed(6)}`,
    address,
    label: label || address,
    latitude,
    longitude,
    postalCode: postalCode === "NIL" ? "" : postalCode,
  };
}

function getOneMapTokenExpiryMs(payload) {
  const expiryTimestamp = Number(payload.expiry_timestamp || payload.expiryTimestamp || payload.expires_at || 0);

  if (Number.isFinite(expiryTimestamp) && expiryTimestamp > 0) {
    return expiryTimestamp > 1_000_000_000_000 ? expiryTimestamp : expiryTimestamp * 1000;
  }

  return Date.now() + 72 * 60 * 60 * 1000;
}

function cleanOneMapValue(value) {
  return String(value || "").trim();
}

function isSingaporeCoordinate(latitude, longitude) {
  return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= 1.15 && latitude <= 1.5 && longitude >= 103.55 && longitude <= 104.15;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function scheduleAlignedLiveRefresh() {
  if (alignedRefreshTimer) clearTimeout(alignedRefreshTimer);

  alignedRefreshTimer = setTimeout(async () => {
    try {
      await ensureLiveCacheForCurrentSlot();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to refresh LTA charger feed.";
      console.warn(`Scheduled LTA refresh failed: ${message}`);
    } finally {
      scheduleAlignedLiveRefresh();
    }
  }, getMsUntilNextRefreshBoundary());
}

function buildLivePayload(cache, cacheStatus, warning = "") {
  const cacheMeta = buildCacheMeta(cache.fetchedAtMs, cacheStatus);

  return {
    stations: cache.stations,
    source: "lta-datamall",
    sourceLabel: "Live LTA DataMall",
    ltaConfigured: true,
    updatedAt: cache.ltaUpdatedAt || "",
    lastUpdatedTime: cache.ltaLastUpdatedTime || "",
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
    updatedAt: normalizeLtaTimestamp(sample.lastUpdatedTime) || sample.lastUpdatedTime || "",
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
  const expiresAtMs = getNextRefreshBoundaryMs(fetchedAtMs);

  return {
    status,
    ttlSeconds: Math.max(0, Math.round((expiresAtMs - fetchedAtMs) / 1000)),
    refreshedAt: new Date(fetchedAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    ageSeconds: Math.max(0, Math.round((Date.now() - fetchedAtMs) / 1000)),
  };
}

function normalizeLtaTimestamp(value) {
  if (typeof value !== "string") return "";

  const match = value
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);

  if (!match) return "";

  const [, year, month, day, hour, minute, second = "00"] = match;
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`);

  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function getCurrentRefreshSlotMs(nowMs = Date.now()) {
  return Math.floor(nowMs / cacheTtlMs) * cacheTtlMs;
}

function getNextRefreshBoundaryMs(nowMs = Date.now()) {
  return getCurrentRefreshSlotMs(nowMs) + cacheTtlMs;
}

function getMsUntilNextRefreshBoundary(nowMs = Date.now()) {
  const remainder = nowMs % cacheTtlMs;

  return remainder === 0 ? cacheTtlMs : cacheTtlMs - remainder;
}

function getSecondsUntilNextRefreshBoundary(nowMs = Date.now()) {
  return Math.max(1, Math.ceil(getMsUntilNextRefreshBoundary(nowMs) / 1000));
}
