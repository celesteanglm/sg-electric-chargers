#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractLtaBatchLink, normalizeChargerStations } from "../src/lib/chargers.js";

const LTA_EVC_BATCH_URL = "https://datamall2.mytransport.sg/ltaodataservice/EVCBatch";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const outputPath = path.join(rootDir, "public", "data", "sample-chargers.json");

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

async function main() {
  if (!process.env.LTA_ACCOUNT_KEY) {
    throw new Error("Set LTA_ACCOUNT_KEY in .env or the environment before refreshing sample charger data.");
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
  const payload = {
    source: "lta-datamall-snapshot",
    sourceLabel: "LTA DataMall snapshot",
    generatedAt: new Date().toISOString(),
    lastUpdatedTime: batchPayload.LastUpdatedTime || batchPayload.lastUpdatedTime || "",
    count: stations.length,
    evLocationsData: batchPayload.evLocationsData || batchPayload.EvLocationsData || [],
  };

  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Wrote ${stations.length} stations to ${outputPath}`);
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }

  return response.json();
}
