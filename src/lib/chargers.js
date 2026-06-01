import { getProviderKey } from "../data/providerApps.js";

const LTA_BATCH_DOWNLOAD_HOSTS = new Set(["dmprod-datasets.s3.ap-southeast-1.amazonaws.com"]);
const MEVNET_PROVIDER_FIELDS = [
  ["number_of_ev_charger_by_network", "1Utama"],
  ["number_of_ev_charger_by_netwo_1", "ABB"],
  ["number_of_ev_charger_by_netwo_2", "BMW"],
  ["number_of_ev_charger_by_netwo_3", "ChargeNGo"],
  ["number_of_ev_charger_by_netwo_4", "chargEV"],
  ["number_of_ev_charger_by_netwo_5", "ChargeSini"],
  ["number_of_ev_charger_by_netwo_6", "ETCM"],
  ["number_of_ev_charger_by_netwo_7", "Evwave"],
  ["number_of_ev_charger_by_netwo_8", "Exicom"],
  ["number_of_ev_charger_by_netwo_9", "Flexi Parking"],
  ["number_of_ev_charger_by_netw_10", "Gentari"],
  ["number_of_ev_charger_by_netw_11", "GoCar"],
  ["number_of_ev_charger_by_netw_12", "GoToU"],
  ["number_of_ev_charger_by_netw_13", "Jomcharge"],
  ["number_of_ev_charger_by_netw_14", "Kineta"],
  ["number_of_ev_charger_by_netw_15", "Mini"],
  ["number_of_ev_charger_by_netw_16", "Nichicon"],
  ["number_of_ev_charger_by_netw_17", "ParkEasy"],
  ["number_of_ev_charger_by_netw_18", "PEKEMA"],
  ["number_of_ev_charger_by_netw_19", "Pestech"],
  ["number_of_ev_charger_by_netw_20", "Plugit"],
  ["number_of_ev_charger_by_netw_21", "Schneider"],
  ["number_of_ev_charger_by_netw_22", "ShellRecharge"],
  ["number_of_ev_charger_by_netw_23", "Sunway"],
  ["number_of_ev_charger_by_netw_24", "TNBX (GoToU)"],
  ["number_of_ev_charger_by_netw_25", "Zap"],
  ["number_of_ev_charger_by_netw_26", "Others"],
];

export function extractLtaBatchLink(payload) {
  if (!payload || typeof payload !== "object") return "";
  const direct = payload.Link || payload.link || payload.DownloadLink || payload.downloadLink;
  if (isLtaBatchDownloadLink(direct)) return direct;

  for (const value of Object.values(payload)) {
    if (value && typeof value === "object") {
      const nested = extractLtaBatchLink(value);
      if (nested) return nested;
    }
  }

  for (const value of Object.values(payload)) {
    if (isLtaBatchDownloadLink(value)) return value;
  }

  return "";
}

export function normalizeChargerStations(payload) {
  const records = extractStationRecords(payload);

  return records
    .map((record, index) => normalizeStationRecord(record, index))
    .filter((station) => Number.isFinite(station.latitude) && Number.isFinite(station.longitude))
    .sort((a, b) => {
      if (a.status !== b.status) return statusRank(a.status) - statusRank(b.status);
      return a.name.localeCompare(b.name);
    });
}

export function normalizeMevnetStations(payload) {
  const records = extractMevnetRecords(payload);

  return records
    .map((record, index) => normalizeMevnetRecord(record, index))
    .filter((station) => Number.isFinite(station.latitude) && Number.isFinite(station.longitude))
    .sort((a, b) => {
      if (a.lifecycleStatus !== b.lifecycleStatus) return lifecycleRank(a.lifecycleStatus) - lifecycleRank(b.lifecycleStatus);
      return a.name.localeCompare(b.name);
    });
}

export function getStationPriceKwh(station) {
  const prices = toArray(station?.plugTypes)
    .filter((plug) => /kwh/i.test(cleanString(plug.priceType)))
    .map((plug) => Number.parseFloat(plug.price))
    .filter((price) => Number.isFinite(price) && price >= 0);

  return prices.length > 0 ? Math.min(...prices) : null;
}

export function parseMevnetDataDate(value) {
  if (typeof value !== "string") return null;

  const match = cleanString(value).match(/^(\d{1,2})-([a-z]{3})-(\d{2}|\d{4})$/i);
  if (!match) return null;

  const [, dayText, monthText, yearText] = match;
  const monthIndex = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  }[monthText.toLowerCase()];

  if (monthIndex == null) return null;

  const day = Number(dayText);
  const rawYear = Number(yearText);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  const date = new Date(Date.UTC(year, monthIndex, day));

  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatMevnetDataDate(value) {
  const date = value instanceof Date ? value : parseMevnetDataDate(value);
  if (!date || Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function stationSearchText(station) {
  return [
    station.name,
    station.address,
    station.provider,
    toArray(station.providers).join(" "),
    station.providerLabel,
    station.postalCode,
    station.state,
    station.pbt,
    station.category,
    station.availabilityLabel,
    station.plugTypes.map((plug) => plug.plugType).join(" "),
  ]
    .join(" ")
    .toLowerCase();
}

function normalizeStationRecord(record, index) {
  const chargingPoints = toArray(record.chargingPoints || record.ChargingPoints || record.chargers);
  const providers = collectProviders(record, chargingPoints);
  const provider = providers[0] || "Unknown";
  const providerKeys = uniqueValues(providers.map((providerName) => getProviderKey(providerName)));
  const plugTypes = collectPlugTypes(record, chargingPoints);
  const connectors = collectConnectorStatuses(chargingPoints);
  const stationStatus = normalizeStatus(record.status ?? record.Status, connectors);
  const totalCount = connectors.length || plugTypes.length || Number(record.totalCount || record.TotalCount || 1);
  const availableCount =
    connectors.length > 0
      ? connectors.filter((status) => status === "available").length
      : stationStatus === "available"
        ? Math.max(1, Number(record.availableCount || record.AvailableCount || 1))
        : 0;
  const providerKey = getProviderKey(provider);
  const latitude = toNumber(record.latitude ?? record.Latitude ?? record.lat ?? record.Lat);
  const longitude = toNumber(
    record.longtitude ?? record.Longtitude ?? record.longitude ?? record.Longitude ?? record.lng ?? record.Lng,
  );
  const name = cleanString(record.name || record.Name || record.address || record.Address || `Charging area ${index + 1}`);
  const address = cleanString(record.address || record.Address || name);
  const priceKwh = getPriceKwh(plugTypes);

  return {
    id: cleanString(record.locationId || record.LocationId || record.id || record.Id || `${latitude}-${longitude}-${index}`),
    country: "sg",
    name,
    address,
    postalCode: cleanString(record.postalCode || record.PostalCode || extractPostalCode(address)),
    latitude,
    longitude,
    provider,
    providerKey,
    providers,
    providerKeys,
    providerLabel: formatProviderLabel(providers),
    providerInitials: providerInitials(provider),
    status: stationStatus,
    availableCount,
    totalCount,
    operationHours: cleanString(
      record.operationHours ||
        record.OperationHours ||
        record.operatingHours ||
        record.OperatingHours ||
        firstChargingPointValue(chargingPoints, ["operationHours", "OperationHours", "operatingHours", "OperatingHours"]) ||
        "",
    ),
    position: cleanString(record.position || record.Position || chargingPoints[0]?.position || chargingPoints[0]?.Position || ""),
    maxPowerKw: maxPower(plugTypes),
    priceKnown: priceKwh != null,
    minPriceKwh: priceKwh,
    priceCurrency: "SGD",
    plugTypes,
    chargers: chargingPoints.map(normalizeChargingPoint),
  };
}

function normalizeMevnetRecord(record, index) {
  const attrs = record?.attributes && typeof record.attributes === "object" ? record.attributes : record;
  const latitude = toNumber(attrs.latitude ?? attrs.Latitude);
  const longitude = toNumber(attrs.longitude ?? attrs.Longitude);
  const name = cleanString(attrs.location || attrs.Location || `MEVnet location ${index + 1}`);
  const state = cleanString(attrs.state || attrs.State || "");
  const pbt = cleanString(attrs.pbt || attrs.PBT || "");
  const category = cleanString(attrs.category || attrs.Category || "");
  const sourceDataDate = cleanString(attrs.data_as || attrs.DataAs || "");
  const existingCount = Math.max(0, toWholeNumber(attrs.number_of_existing_ev_charger_s));
  const proposedCount = Math.max(0, toWholeNumber(attrs.number_of_proposed_ev_charger__));
  const acCount = Math.max(0, toWholeNumber(attrs.type_ac));
  const dcCount = Math.max(0, toWholeNumber(attrs.type_dc));
  const indoorCount = Math.max(0, toWholeNumber(attrs.indoor));
  const outdoorCount = Math.max(0, toWholeNumber(attrs.outdoor));
  const rawStatus = cleanString(attrs.status || attrs.Status || "");
  const lifecycleStatus = /existing/i.test(rawStatus) || existingCount > 0 ? "existing" : "proposed";
  const totalCount = Math.max(existingCount || proposedCount || acCount + dcCount || indoorCount + outdoorCount || 1, 1);
  const availableCount = lifecycleStatus === "existing" ? Math.max(existingCount || totalCount, 1) : 0;
  const providers = collectMevnetProviders(attrs);
  const provider = providers[0] || "Unknown";
  const plugTypes = collectMevnetPlugTypes({ acCount, dcCount, provider });
  const address = [name, pbt, state, "Malaysia"].filter(Boolean).join(", ");

  return {
    id: cleanString(attrs.objectid || attrs.ObjectId || attrs.bil || attrs.Bil || `${latitude}-${longitude}-${index}`),
    country: "my",
    name,
    address,
    postalCode: "",
    latitude,
    longitude,
    provider,
    providerKey: getProviderKey(provider),
    providers,
    providerKeys: uniqueValues(providers.map((providerName) => getProviderKey(providerName))),
    providerLabel: formatProviderLabel(providers),
    providerInitials: providerInitials(provider),
    status: lifecycleStatus === "existing" ? "available" : "offline",
    availabilityLabel: lifecycleStatus === "existing" ? "Existing" : "Proposed",
    lifecycleStatus,
    availableCount,
    totalCount,
    operationHours: "",
    position: [category, cleanString(attrs.indoor___outdoor || attrs.IndoorOutdoor || "")].filter(Boolean).join(" · "),
    maxPowerKw: 0,
    priceKnown: false,
    minPriceKwh: null,
    priceCurrency: "MYR",
    region: state,
    state,
    pbt,
    category,
    sourceDataDate,
    existingCount,
    proposedCount,
    acCount,
    dcCount,
    indoorCount,
    outdoorCount,
    plugTypes,
    chargers: [],
  };
}

function extractStationRecords(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];

  const directCandidates = [
    payload.stations,
    payload.Stations,
    payload.value,
    payload.Value,
    payload.data,
    payload.Data,
    payload.evLocationsData,
    payload.EvLocationsData,
    payload.chargingStations,
    payload.ChargingStations,
    payload.chargingPoints,
    payload.ChargingPoints,
  ];

  for (const candidate of directCandidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  const arrays = [];
  walkPayload(payload, arrays);
  arrays.sort((a, b) => scoreRecordArray(b) - scoreRecordArray(a));

  return arrays[0] || [];
}

function extractMevnetRecords(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.features)) return payload.features.map((feature) => feature.attributes || feature);
  if (Array.isArray(payload.records)) return payload.records;
  if (Array.isArray(payload.stations)) return payload.stations;

  return [];
}

function walkPayload(value, arrays) {
  if (Array.isArray(value)) {
    if (value.some(looksLikeStation)) arrays.push(value);
    value.slice(0, 5).forEach((item) => walkPayload(item, arrays));
    return;
  }

  if (!value || typeof value !== "object") return;
  Object.values(value).forEach((child) => walkPayload(child, arrays));
}

function looksLikeStation(record) {
  if (!record || typeof record !== "object") return false;
  const keys = Object.keys(record).map((key) => key.toLowerCase());
  return keys.includes("latitude") || keys.includes("longtitude") || keys.includes("longitude") || keys.includes("locationid");
}

function scoreRecordArray(records) {
  return records.reduce((score, record) => score + (looksLikeStation(record) ? 1 : 0), 0);
}

function isLtaBatchDownloadLink(value) {
  if (typeof value !== "string") return false;

  try {
    const url = new URL(value);

    return (
      url.protocol === "https:" &&
      LTA_BATCH_DOWNLOAD_HOSTS.has(url.hostname.toLowerCase()) &&
      /^\/ev-batch\/\d{4}-\d{2}-\d{2}\//i.test(url.pathname) &&
      /\/EVBatch-/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function collectPlugTypes(record, chargingPoints) {
  const recordProvider = getRecordProvider(record);
  const plugs = toArray(record.plugTypes || record.PlugTypes).map((plug) => normalizePlugType(plug, recordProvider));

  chargingPoints.forEach((point) => {
    const pointProvider = getChargingPointProvider(point);
    plugs.push(...toArray(point.plugTypes || point.PlugTypes).map((plug) => normalizePlugType(plug, pointProvider)));
  });

  const normalized = plugs.filter(Boolean);
  const seen = new Set();

  return normalized.filter((plug) => {
    const key = `${plug.provider}-${plug.plugType}-${plug.powerRating}-${plug.chargingSpeed}-${plug.price}-${plug.priceType}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectConnectorStatuses(chargingPoints) {
  return chargingPoints.flatMap((point) => collectEvIds(point).map((evId) => normalizeConnectorStatus(evId.status ?? evId.Status)));
}

function normalizeChargingPoint(point) {
  const provider = getChargingPointProvider(point);

  return {
    id: cleanString(point.id || point.Id || ""),
    name: cleanString(point.name || point.Name || ""),
    provider,
    providerKey: provider ? getProviderKey(provider) : "unknown",
    providerInitials: providerInitials(provider),
    position: cleanString(point.position || point.Position || ""),
    status: normalizeConnectorStatus(point.status ?? point.Status),
    plugTypes: toArray(point.plugTypes || point.PlugTypes).map((plug) => normalizePlugType(plug, provider)).filter(Boolean),
    connectors: collectEvIds(point).map((connector) => ({
      id: cleanString(connector.evCpId || connector.EvCpId || connector.id || connector.Id || ""),
      status: normalizeConnectorStatus(connector.status ?? connector.Status),
    })),
  };
}

function collectEvIds(point) {
  const directEvIds = toArray(point.evIds || point.EvIds || point.evIDs || point.EvIDs);
  const plugEvIds = toArray(point.plugTypes || point.PlugTypes).flatMap((plug) =>
    toArray(plug.evIds || plug.EvIds || plug.evIDs || plug.EvIDs),
  );

  return [...directEvIds, ...plugEvIds];
}

function firstChargingPointValue(chargingPoints, keys) {
  for (const point of chargingPoints) {
    for (const key of keys) {
      if (point?.[key]) return point[key];
    }
  }

  return "";
}

function collectProviders(record, chargingPoints) {
  return uniqueValues([
    ...getProviderCandidates(record),
    ...chargingPoints.flatMap(getProviderCandidates),
  ]).filter(Boolean);
}

function getRecordProvider(record) {
  return getProviderCandidates(record)[0] || "";
}

function getChargingPointProvider(point) {
  return getProviderCandidates(point)[0] || "";
}

function getProviderCandidates(source) {
  if (!source || typeof source !== "object") return [];

  return uniqueValues([
    cleanString(source.operatorName || source.OperatorName || ""),
    cleanString(source.operator || source.Operator || ""),
    cleanString(source.providerName || source.ProviderName || ""),
    cleanString(source.provider || source.Provider || ""),
  ]).filter(Boolean);
}

function normalizePlugType(plug, provider = "") {
  if (!plug || typeof plug !== "object") return null;

  const rawPowerRating = cleanString(plug.powerRating || plug.PowerRating || "");
  const current = cleanString(plug.current || plug.Current || plug.powerType || plug.PowerType || "");
  const chargingSpeed = cleanString(
    plug.chargingSpeed ||
      plug.ChargingSpeed ||
      plug.powerKw ||
      plug.PowerKw ||
      plug.powerKW ||
      plug.PowerKW ||
      (isNumericText(rawPowerRating) ? rawPowerRating : ""),
  );
  const powerRating = cleanString(current || (!isNumericText(rawPowerRating) ? rawPowerRating : ""));

  return {
    plugType: cleanString(plug.plugType || plug.PlugType || plug.type || plug.Type || ""),
    powerRating,
    chargingSpeed,
    price: cleanString(plug.price || plug.Price || ""),
    priceType: cleanString(plug.priceType || plug.PriceType || ""),
    provider: cleanString(provider),
    providerKey: provider ? getProviderKey(provider) : "unknown",
  };
}

function collectMevnetProviders(record) {
  return MEVNET_PROVIDER_FIELDS.flatMap(([fieldName, providerName]) => {
    const count = toWholeNumber(record[fieldName]);
    return count > 0 ? [providerName] : [];
  });
}

function collectMevnetPlugTypes({ acCount, dcCount, provider }) {
  const plugTypes = [];
  if (acCount > 0) {
    plugTypes.push({
      plugType: "AC",
      powerRating: "AC",
      chargingSpeed: "",
      price: "",
      priceType: "",
      provider: cleanString(provider),
      providerKey: provider ? getProviderKey(provider) : "unknown",
    });
  }

  if (dcCount > 0) {
    plugTypes.push({
      plugType: "DC",
      powerRating: "DC",
      chargingSpeed: "",
      price: "",
      priceType: "",
      provider: cleanString(provider),
      providerKey: provider ? getProviderKey(provider) : "unknown",
    });
  }

  return plugTypes;
}

function normalizeStatus(value, connectorStatuses) {
  if (connectorStatuses.length > 0) {
    if (connectorStatuses.some((status) => status === "available")) return "available";
    if (connectorStatuses.every((status) => status === "offline")) return "offline";
    if (connectorStatuses.every((status) => status === "occupied")) return "occupied";
  }

  const status = normalizeConnectorStatus(value);
  return status === "unknown" ? "offline" : status;
}

function normalizeConnectorStatus(value) {
  if (value === 1 || value === "1") return "available";
  if (value === 0 || value === "0") return "occupied";
  if (value === 100 || value === "100" || value === "" || value == null) return "offline";

  const text = String(value).toLowerCase();
  if (["available", "free"].includes(text)) return "available";
  if (["charging", "reserved", "blocked", "occupied"].includes(text)) return "occupied";
  if (["outoforder", "inoperative", "unknown", "planned", "removed", "offline", "not available"].includes(text)) {
    return "offline";
  }

  return "unknown";
}

function statusRank(status) {
  return { available: 0, occupied: 1, offline: 2, unknown: 3 }[status] ?? 3;
}

function lifecycleRank(status) {
  return { existing: 0, proposed: 1 }[status] ?? 2;
}

function maxPower(plugTypes) {
  return Math.max(0, ...plugTypes.map((plug) => Number.parseFloat(plug.chargingSpeed)).filter(Number.isFinite));
}

function getPriceKwh(plugTypes) {
  const prices = plugTypes
    .filter((plug) => /kwh/i.test(cleanString(plug.priceType)))
    .map((plug) => Number.parseFloat(plug.price))
    .filter((price) => Number.isFinite(price) && price >= 0);

  return prices.length > 0 ? Math.min(...prices) : null;
}

function providerInitials(provider) {
  const compact = provider.replace(/[^a-z0-9+ ]/gi, "").trim();
  if (!compact) return "EV";
  if (/charge\+/i.test(compact)) return "C+";

  return compact
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function formatProviderLabel(providers) {
  if (providers.length === 0) return "Unknown";
  if (providers.length === 1) return providers[0];
  if (providers.length === 2) return providers.join(" + ");

  return `${providers[0]} + ${providers.length - 1} more`;
}

function extractPostalCode(address) {
  return address.match(/\b\d{6}\b/)?.[0] || "";
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : Number.NaN;
}

function toWholeNumber(value) {
  if (value == null || value === "") return 0;
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function cleanString(value) {
  return String(value ?? "").trim();
}

function uniqueValues(values) {
  const seen = new Set();

  return values.filter((value) => {
    const normalized = cleanString(value).toLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function isNumericText(value) {
  return /^-?\d+(\.\d+)?$/.test(cleanString(value));
}
