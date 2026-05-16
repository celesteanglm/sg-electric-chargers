import { getProviderKey } from "../data/providerApps.js";

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

export function stationSearchText(station) {
  return [
    station.name,
    station.address,
    station.provider,
    toArray(station.providers).join(" "),
    station.providerLabel,
    station.postalCode,
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

  return {
    id: cleanString(record.locationId || record.LocationId || record.id || record.Id || `${latitude}-${longitude}-${index}`),
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
    plugTypes,
    chargers: chargingPoints.map(normalizeChargingPoint),
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
  return typeof value === "string" && /^https?:\/\//i.test(value) && /\/EVBatch-/i.test(value);
}

function collectPlugTypes(record, chargingPoints) {
  const recordProvider = cleanString(record.operator || record.Operator || record.provider || record.Provider || "");
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
    cleanString(record.operator || record.Operator || ""),
    cleanString(record.provider || record.Provider || ""),
    ...chargingPoints.map(getChargingPointProvider),
  ]).filter(Boolean);
}

function getChargingPointProvider(point) {
  return cleanString(point?.operator || point?.Operator || point?.provider || point?.Provider || "");
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

function maxPower(plugTypes) {
  return Math.max(0, ...plugTypes.map((plug) => Number.parseFloat(plug.chargingSpeed)).filter(Number.isFinite));
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
