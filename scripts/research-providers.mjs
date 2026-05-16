#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { extractLtaBatchLink, normalizeChargerStations } from "../src/lib/chargers.js";
import { getProviderProfile } from "../src/data/providerApps.js";

const LTA_EVC_BATCH_URL = "https://datamall2.mytransport.sg/ltaodataservice/EVCBatch";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const OSM_CHARGING_TAGS_URL = "https://wiki.openstreetmap.org/wiki/Key%3Acharging_station%3Aoutput";
const OVERPASS_RADIUS_METERS = 120;
const SAMPLE_LOCATIONS_PER_OPERATOR = 3;
const OVERPASS_DELAY_MS = 250;

const args = process.argv.slice(2);
const writeIndex = args.indexOf("--write");
const outputPath = writeIndex >= 0 ? args[writeIndex + 1] : "";

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

async function main() {
  if (!process.env.LTA_ACCOUNT_KEY) {
    throw new Error("Set LTA_ACCOUNT_KEY in .env or the environment before running provider research.");
  }

  const metaPayload = await fetchJson(LTA_EVC_BATCH_URL, {
    AccountKey: process.env.LTA_ACCOUNT_KEY,
    accept: "application/json",
  });
  const downloadLink = extractLtaBatchLink(metaPayload);

  if (!downloadLink) {
    throw new Error("DataMall EVCBatch response did not include a batch download link.");
  }

  const batchPayload = await fetchJson(downloadLink, { accept: "application/json" });
  const stations = normalizeChargerStations(batchPayload);
  const unresolvedStations = stations.filter((station) => getProviderProfile(station.provider).key === "unknown");
  const unresolvedGroups = groupByOperator(unresolvedStations);
  const unresolvedOperators = [];

  for (const group of unresolvedGroups) {
    const sampleLocations = [];

    for (const station of group.stations.slice(0, SAMPLE_LOCATIONS_PER_OPERATOR)) {
      const osmLookup = await lookupOsmChargingStation(station);
      sampleLocations.push({
        stationId: station.id,
        name: station.name,
        address: station.address,
        coordinates: {
          latitude: station.latitude,
          longitude: station.longitude,
        },
        googleMapsReviewUrl: buildGoogleMapsSearchUrl(station),
        osmLookup,
      });
      await sleep(OVERPASS_DELAY_MS);
    }

    unresolvedOperators.push({
      operator: group.operator,
      stationCount: group.stations.length,
      confidence: estimateConfidence(group.operator, sampleLocations),
      sourceUrls: collectSourceUrls(sampleLocations),
      webSearchUrl: buildWebSearchUrl(group.operator),
      sampleLocations,
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    sources: {
      ltaEvcBatchUrl: LTA_EVC_BATCH_URL,
      ltaBatchDownloadUrl: redactQuery(downloadLink),
      overpassUrl: OVERPASS_URL,
      osmChargingTagsUrl: OSM_CHARGING_TAGS_URL,
      note: "Google Maps URLs are generated for manual review only; this script does not scrape Google Maps.",
    },
    summary: {
      totalStations: stations.length,
      unresolvedStationCount: unresolvedStations.length,
      unresolvedOperatorCount: unresolvedGroups.length,
      providerBreakdown: countByProviderKey(stations),
    },
    unresolvedOperators,
  };

  const output = `${JSON.stringify(report, null, 2)}\n`;

  if (outputPath) {
    const absoluteOutputPath = path.resolve(outputPath);
    await fs.mkdir(path.dirname(absoluteOutputPath), { recursive: true });
    await fs.writeFile(absoluteOutputPath, output);
    console.log(`Provider research report written to ${absoluteOutputPath}`);
    return;
  }

  console.log(output);
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }

  return response.json();
}

function groupByOperator(stations) {
  const groups = new Map();

  for (const station of stations) {
    const operator = station.provider || "Unknown";

    if (!groups.has(operator)) {
      groups.set(operator, []);
    }

    groups.get(operator).push(station);
  }

  return [...groups.entries()]
    .map(([operator, groupStations]) => ({
      operator,
      stations: groupStations.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => b.stations.length - a.stations.length || a.operator.localeCompare(b.operator));
}

async function lookupOsmChargingStation(station) {
  try {
    const query = buildOverpassQuery(station);
    const response = await fetch(`${OVERPASS_URL}?data=${encodeURIComponent(query)}`, {
      headers: {
        "user-agent": "sg-electric-chargers-provider-research/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(`Overpass returned ${response.status}`);
    }

    const payload = await response.json();
    const matches = toArray(payload.elements)
      .map(formatOsmElement)
      .filter((element) => Object.keys(element.tags).length > 0);

    return {
      status: "ok",
      radiusMeters: OVERPASS_RADIUS_METERS,
      sourceUrl: OVERPASS_URL,
      matches,
    };
  } catch (error) {
    return {
      status: "error",
      radiusMeters: OVERPASS_RADIUS_METERS,
      sourceUrl: OVERPASS_URL,
      error: error instanceof Error ? error.message : "Unable to query Overpass.",
      matches: [],
    };
  }
}

function buildOverpassQuery(station) {
  const { latitude, longitude } = station;

  return `
[out:json][timeout:20];
(
  node(around:${OVERPASS_RADIUS_METERS},${latitude},${longitude})["amenity"="charging_station"];
  way(around:${OVERPASS_RADIUS_METERS},${latitude},${longitude})["amenity"="charging_station"];
  relation(around:${OVERPASS_RADIUS_METERS},${latitude},${longitude})["amenity"="charging_station"];
);
out center 10;
`;
}

function formatOsmElement(element) {
  const tags = element.tags || {};

  return {
    type: element.type,
    id: element.id,
    osmUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
    coordinates: {
      latitude: element.lat ?? element.center?.lat ?? null,
      longitude: element.lon ?? element.center?.lon ?? null,
    },
    tags: pickTags(tags, ["operator", "brand", "network", "name"]),
  };
}

function pickTags(tags, keys) {
  return keys.reduce((picked, key) => {
    if (tags[key]) picked[key] = tags[key];
    return picked;
  }, {});
}

function estimateConfidence(operator, sampleLocations) {
  const operatorText = normalize(operator);
  const osmTagValues = sampleLocations.flatMap((location) =>
    location.osmLookup.matches.flatMap((match) => Object.values(match.tags).map(normalize)),
  );

  if (osmTagValues.some((value) => value && (operatorText.includes(value) || value.includes(operatorText)))) {
    return "high";
  }

  if (osmTagValues.some(Boolean)) {
    return "medium";
  }

  return "manual_review";
}

function collectSourceUrls(sampleLocations) {
  const urls = new Set([OVERPASS_URL]);

  for (const location of sampleLocations) {
    urls.add(location.googleMapsReviewUrl);
    for (const match of location.osmLookup.matches) {
      urls.add(match.osmUrl);
    }
  }

  return [...urls];
}

function countByProviderKey(stations) {
  return stations.reduce((counts, station) => {
    counts[station.providerKey] = (counts[station.providerKey] || 0) + 1;
    return counts;
  }, {});
}

function buildGoogleMapsSearchUrl(station) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${station.name} ${station.address} EV charging`,
  )}`;
}

function buildWebSearchUrl(operator) {
  return `https://www.google.com/search?q=${encodeURIComponent(`${operator} EV charging Singapore`)}`;
}

function redactQuery(url) {
  return url.split("?")[0];
}

function normalize(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
