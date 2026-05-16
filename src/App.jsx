import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import {
  BatteryCharging,
  CircleDot,
  ExternalLink,
  Filter,
  Info,
  LocateFixed,
  Mail,
  MapPin,
  Navigation,
  PlugZap,
  Search,
  X,
} from "lucide-react";
import { normalizeChargerStations, stationSearchText } from "./lib/chargers.js";
import { canOpenProviderApp, getProviderAppTarget, getProviderProfile, openProviderApp } from "./data/providerApps.js";

const SINGAPORE_CENTER = [1.3521, 103.8198];
const AREA_CENTER = { latitude: SINGAPORE_CENTER[0], longitude: SINGAPORE_CENTER[1] };
const DEFAULT_ZOOM = 11;
const CLIENT_REFRESH_MS = 5 * 60 * 1000;
const SG_TIME_ZONE = "Asia/Singapore";
const FEEDBACK_EMAIL = "celesteanglm@gmail.com";
const SHEET_DRAG_THRESHOLD_PX = 44;
const AREA_FILTERS = [
  { id: "north", label: "North", color: "#17875a", textColor: "#ffffff" },
  { id: "south", label: "South", color: "#0f4c81", textColor: "#ffffff" },
  { id: "east", label: "East", color: "#f97316", textColor: "#17201c" },
  { id: "west", label: "West", color: "#7c3aed", textColor: "#ffffff" },
  { id: "central", label: "Central", color: "#08a7d8", textColor: "#06283a" },
];
const UTILITY_FILTERS = [
  { id: "all", label: "All", Icon: CircleDot, color: "#08283f", textColor: "#ffffff" },
  { id: "available", label: "Open now", Icon: BatteryCharging, color: "#18bf73", textColor: "#073825" },
  { id: "fast", label: "Fast", Icon: PlugZap, color: "#08a7d8", textColor: "#06283a" },
];

export default function App() {
  const [stations, setStations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [feed, setFeed] = useState({
    loading: true,
    sourceLabel: "Loading",
    warning: "",
    updatedAt: "",
    cache: null,
  });
  const [userLocation, setUserLocation] = useState(null);
  const [locationNotice, setLocationNotice] = useState("");
  const [sheetMode, setSheetMode] = useState("expanded");
  const mapRef = useRef(null);
  const sheetTouchStartY = useRef(null);
  const sheetDidDrag = useRef(false);
  const areaFilters = useMemo(() => buildAreaFilterOptions(stations), [stations]);
  const activeAreaFilter = areaFilters.find((item) => item.id === filter);
  const operatorFilters = useMemo(() => buildOperatorFilterOptions(stations), [stations]);
  const activeOperatorFilter = operatorFilters.find((item) => item.id === filter);
  const utilityFilterCounts = useMemo(
    () => ({
      all: stations.length,
      available: stations.filter((station) => station.status === "available").length,
      fast: stations.filter((station) => station.maxPowerKw >= 43).length,
    }),
    [stations],
  );

  useEffect(() => {
    let mounted = true;
    let inFlight = false;
    let refreshTimer = null;

    async function loadChargers() {
      if (inFlight) return;
      inFlight = true;

      try {
        const response = await fetch("/api/chargers");
        if (!response.ok) throw new Error(`API returned ${response.status}`);
        const payload = await response.json();
        const nextStations = getStationPayload(payload);

        if (!mounted) return;

        setStations(nextStations);
        setSelectedId((current) =>
          current && nextStations.some((station) => station.id === current) ? current : nextStations[0]?.id || null,
        );
        setFeed({
          loading: false,
          sourceLabel: payload.sourceLabel || "LTA DataMall",
          warning: payload.warning || "",
          updatedAt: payload.updatedAt || payload.generatedAt || "",
          cache: payload.cache || null,
        });
      } catch (error) {
        const response = await fetch("/data/sample-chargers.json");
        const payload = await response.json();
        const nextStations = getStationPayload(payload);

        if (!mounted) return;

        setStations(nextStations);
        setSelectedId((current) =>
          current && nextStations.some((station) => station.id === current) ? current : nextStations[0]?.id || null,
        );
        setFeed({
          loading: false,
          sourceLabel: "Sample fallback",
          warning: error instanceof Error ? error.message : "Unable to load chargers.",
          updatedAt: payload.generatedAt || "",
          cache: null,
        });
      } finally {
        inFlight = false;
      }
    }

    function scheduleNextRefresh() {
      refreshTimer = window.setTimeout(async () => {
        await loadChargers();
        if (mounted) scheduleNextRefresh();
      }, getMsUntilNextRefreshBoundary());
    }

    loadChargers();
    scheduleNextRefresh();

    return () => {
      mounted = false;
      if (refreshTimer) window.clearTimeout(refreshTimer);
    };
  }, []);

  const filteredStations = useMemo(() => {
    const search = query.trim().toLowerCase();

    return stations.filter((station) => {
      const matchesSearch = !search || stationSearchText(station).includes(search);
      const matchesFilter =
        filter === "all" ||
        (filter === "available" && station.status === "available") ||
        (filter === "fast" && station.maxPowerKw >= 43) ||
        (activeAreaFilter && getStationArea(station).id === activeAreaFilter.areaId) ||
        (activeOperatorFilter && hasProviderName(station, activeOperatorFilter.operatorName));

      return matchesSearch && matchesFilter;
    });
  }, [activeAreaFilter, activeOperatorFilter, filter, query, stations]);

  useEffect(() => {
    if (
      (filter.startsWith("operator:") && !operatorFilters.some((item) => item.id === filter)) ||
      (filter.startsWith("area:") && !areaFilters.some((item) => item.id === filter))
    ) {
      setFilter("all");
    }
  }, [areaFilters, filter, operatorFilters]);

  useEffect(() => {
    setLocationNotice("");
  }, [filter, query]);

  const selectedStation =
    filteredStations.length > 0 ? filteredStations.find((station) => station.id === selectedId) || filteredStations[0] : null;

  useEffect(() => {
    if (filteredStations.length === 0) {
      setSelectedId(null);
      return;
    }

    if (!selectedStation || !filteredStations.some((station) => station.id === selectedStation.id)) {
      setSelectedId(filteredStations[0].id);
    }
  }, [filteredStations, selectedStation]);

  function selectStation(station) {
    setSelectedId(station.id);
    setSheetMode("expanded");
    mapRef.current?.flyTo([station.latitude, station.longitude], Math.max(mapRef.current.getZoom(), 14), {
      duration: 0.35,
    });
  }

  function handleLocateMe() {
    if (!navigator.geolocation) {
      setLocationNotice("Location is not available in this browser.");
      return;
    }

    setLocationNotice("");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextLocation = [position.coords.latitude, position.coords.longitude];
        setUserLocation(nextLocation);

        if (filteredStations.length === 0) {
          setLocationNotice("No visible chargers match the current filters.");
          mapRef.current?.flyTo(nextLocation, 14, { duration: 0.45 });
          return;
        }

        const nearestStation = findNearestStation(nextLocation, filteredStations);

        if (!nearestStation) {
          setLocationNotice("No visible chargers match the current filters.");
          return;
        }

        setSelectedId(nearestStation.id);
        setLocationNotice("Selected the nearest visible charger.");
        mapRef.current?.flyTo([nearestStation.latitude, nearestStation.longitude], 15, { duration: 0.45 });
      },
      () => {
        setLocationNotice("Location unavailable. Enable browser location to find the nearest charger.");
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  function handleSheetTouchStart(event) {
    sheetTouchStartY.current = event.touches[0]?.clientY ?? null;
  }

  function handleSheetTouchEnd(event) {
    if (sheetTouchStartY.current == null) return;

    const endY = event.changedTouches[0]?.clientY ?? sheetTouchStartY.current;
    const deltaY = endY - sheetTouchStartY.current;
    sheetTouchStartY.current = null;
    sheetDidDrag.current = Math.abs(deltaY) > SHEET_DRAG_THRESHOLD_PX;

    if (sheetDidDrag.current) {
      window.setTimeout(() => {
        sheetDidDrag.current = false;
      }, 400);
    }

    if (deltaY > SHEET_DRAG_THRESHOLD_PX) {
      setSheetMode("collapsed");
    } else if (deltaY < -SHEET_DRAG_THRESHOLD_PX) {
      setSheetMode("expanded");
    }
  }

  function toggleSheetMode() {
    if (sheetDidDrag.current) {
      sheetDidDrag.current = false;
      return;
    }

    setSheetMode((current) => (current === "expanded" ? "collapsed" : "expanded"));
  }

  const openConnectorCount = filteredStations.reduce((sum, station) => sum + station.availableCount, 0);
  const totalConnectors = filteredStations.reduce((sum, station) => sum + station.totalCount, 0);
  const feedUpdatedLabel = formatFeedTime(feed.updatedAt);
  const feedbackHref = getFeedbackMailto({
    filterLabel: getActiveFilterLabel(filter, areaFilters, operatorFilters),
    query,
    visibleCount: filteredStations.length,
  });

  return (
    <main className="app-shell">
      <section className="map-stage" aria-label="Singapore EV charger map">
        <div className="top-panel">
          <div className="brand-row">
            <div className="brand-mark" aria-hidden="true">
              <img src="/brand/bocharge-logo.png" alt="" />
            </div>
            <div className="brand-copy">
              <div className="brand-titleline">
                <h1>BoCharge</h1>
                <span className={feed.loading ? "live-pill loading" : "live-pill"}>
                  <span aria-hidden="true" />
                  {feed.loading ? "Syncing" : "Live map"}
                </span>
              </div>
              <p>
                {feed.loading
                  ? "Loading Singapore chargers"
                  : `${filteredStations.length} visible · ${openConnectorCount} open plugs`}
              </p>
            </div>
            <div className="brand-actions">
              <a className="icon-button feedback-button" href={feedbackHref} aria-label="Send feedback">
                <Mail size={17} />
                <span className="feedback-label">Feedback</span>
              </a>
              <button className="icon-button" type="button" onClick={handleLocateMe} aria-label="Use my location">
                <LocateFixed size={19} />
              </button>
            </div>
          </div>

          <label className="search-box">
            <Search size={18} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search area or provider"
              aria-label="Search charging areas or providers"
            />
            {query ? (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
                <X size={16} />
              </button>
            ) : null}
          </label>

          <div className="filter-scroller" aria-label="Charger filters by status, speed, and operator">
            <span className="filter-rail-label">
              <Filter size={14} aria-hidden="true" />
              Filters
            </span>
            {UTILITY_FILTERS.map((item) => (
              <UtilityFilterChip
                active={item.id === filter}
                count={utilityFilterCounts[item.id]}
                item={item}
                key={item.id}
                onSelect={() => setFilter(item.id)}
              />
            ))}
            <span className="filter-divider" aria-hidden="true" />
            {areaFilters.map((item) => (
              <UtilityFilterChip
                active={item.id === filter}
                ariaLabel={`Filter ${item.label} area. ${item.availableCount} open plugs across ${item.stationCount} stations.`}
                count={item.availableCount}
                item={item}
                key={item.id}
                onSelect={() => setFilter(item.id)}
              />
            ))}
            <span className="filter-divider" aria-hidden="true" />
            {operatorFilters.map((item) => (
              <OperatorFilterChip
                active={item.id === filter}
                item={item}
                key={item.id}
                onSelect={() => setFilter(item.id)}
              />
            ))}
          </div>

          {locationNotice ? <div className="location-notice">{locationNotice}</div> : null}
        </div>

        <MapContainer
          center={SINGAPORE_CENTER}
          zoom={DEFAULT_ZOOM}
          minZoom={10}
          maxZoom={18}
          zoomControl={false}
          scrollWheelZoom
          className="charger-map"
        >
          <MapBridge mapRef={mapRef} />
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {filteredStations.map((station) => (
            <Marker
              key={station.id}
              position={[station.latitude, station.longitude]}
              icon={createStationIcon(station, station.id === selectedStation?.id)}
              eventHandlers={{
                click: () => selectStation(station),
              }}
            >
              <Popup>
                <strong>{station.name}</strong>
                <span>{station.providerLabel || station.provider}</span>
              </Popup>
            </Marker>
          ))}
          {userLocation ? (
            <Marker position={userLocation} icon={createUserIcon()}>
              <Popup>Your location</Popup>
            </Marker>
          ) : null}
        </MapContainer>
      </section>

      <section className={`bottom-sheet sheet-${sheetMode}`} aria-label="Charger details and results">
        <button
          className="sheet-handle"
          type="button"
          onClick={toggleSheetMode}
          onTouchStart={handleSheetTouchStart}
          onTouchEnd={handleSheetTouchEnd}
          aria-expanded={sheetMode === "expanded"}
          aria-label={sheetMode === "expanded" ? "Collapse charger details" : "Expand charger details"}
        >
          <span aria-hidden="true" />
        </button>

        <div className="sheet-content">
          <div className="panel-kicker">
            <span>
              <PlugZap size={15} aria-hidden="true" />
              Charge board
            </span>
            <span>{feedUpdatedLabel}</span>
          </div>

          <div className="summary-strip">
            <StatTile label="Open plugs" value={`${openConnectorCount}/${totalConnectors}`} tone="green" />
            <StatTile label="Stations" value={filteredStations.length} tone="blue" />
            <StatTile label="Source" value={feed.sourceLabel.replace(" fallback", "")} tone="dark" />
          </div>

          {feed.warning ? <div className="feed-warning">{feed.warning}</div> : null}

          {selectedStation ? (
            <StationDetail station={selectedStation} />
          ) : (
            <div className="empty-state">
              <CircleDot size={22} />
              <p>No matching chargers found.</p>
            </div>
          )}

          <div className="nearby-header">
            <span>Nearby chargers</span>
            <span>{filteredStations.length} results</span>
          </div>

          <div className="station-list">
            {filteredStations.map((station) => (
              <button
                className={station.id === selectedStation?.id ? "station-row active" : "station-row"}
                key={station.id}
                type="button"
                onClick={() => selectStation(station)}
              >
                <StatusDot status={station.status} />
                <div>
                  <strong>{station.name}</strong>
                  <span>{station.address}</span>
                </div>
                <div className="row-meta">
                  <ProviderBadges providers={station.providers?.length ? station.providers : [station.provider]} compact />
                  <b>{station.availableCount} open</b>
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function MapBridge({ mapRef }) {
  const map = useMap();

  useEffect(() => {
    mapRef.current = map;
  }, [map, mapRef]);

  return null;
}

function StationDetail({ station }) {
  const providers = station.providers?.length ? station.providers : [station.provider];
  const appProviderName = providers.find((providerName) => canOpenProviderApp(providerName)) || station.provider;
  const providerProfile = getProviderProfile(appProviderName);
  const providerAppTarget = getProviderAppTarget(appProviderName);
  const bestPlug = station.plugTypes[0];

  return (
    <article className="detail-card">
      <div className="detail-heading">
        <div>
          <div className="provider-line">
            <ProviderBadges providers={providers} />
            <StatusPill status={station.status} />
          </div>
          <h2>{station.name}</h2>
          <p>{station.address}</p>
        </div>
      </div>

      <div className="detail-grid">
        <Metric label="Open plugs" value={`${station.availableCount}/${station.totalCount}`} />
        <Metric label="Max speed" value={station.maxPowerKw ? `${station.maxPowerKw} kW` : "TBC"} />
        <Metric label="Plug" value={bestPlug?.plugType || "TBC"} />
      </div>

      <div className="detail-meta">
        <span>
          <MapPin size={15} />
          {station.position || station.operationHours || "Open status follows provider feed"}
        </span>
        {bestPlug?.price ? (
          <span>
            <BatteryCharging size={15} />
            {bestPlug.priceType ? `$${bestPlug.price}/${bestPlug.priceType}` : `$${bestPlug.price}`}
          </span>
        ) : null}
      </div>

      <div className="detail-actions">
        <a
          className="primary-action"
          href={getGoogleMapsUrl(station)}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${station.name} in Google Maps`}
        >
          <Navigation size={18} />
          Open in Google Maps
        </a>

        {providerAppTarget.available ? (
          <button className="secondary-action" type="button" onClick={() => openProviderApp(appProviderName)}>
            <ExternalLink size={18} />
            Open {providerProfile.appName}
          </button>
        ) : (
          <div className="provider-unavailable">
            <button className="secondary-action unavailable" type="button" disabled>
              <Info size={18} />
              App link unavailable
            </button>
            <p>{providerAppTarget.unavailableMessage}</p>
          </div>
        )}
      </div>

      <div className="connector-strip">
        {station.plugTypes.slice(0, 4).map((plug, index) => (
          <span key={`${plug.plugType}-${plug.powerRating}-${index}`}>
            {plug.plugType || "Plug"} {plug.chargingSpeed ? `${plug.chargingSpeed} kW` : plug.powerRating || ""}
          </span>
        ))}
      </div>
    </article>
  );
}

function ProviderBadge({ providerName, compact = false }) {
  const providerProfile = getProviderProfile(providerName);
  const label = providerProfile.key === "unknown" ? getOperatorInitials(providerName) : providerProfile.shortName;

  return (
    <span
      className={compact ? "provider-badge compact" : "provider-badge"}
      style={{
        "--provider-color": providerProfile.brandColor,
        "--provider-text": providerProfile.brandTextColor,
      }}
      title={providerName}
    >
      {providerProfile.logoSrc ? (
        <img
          className={`provider-badge-logo provider-badge-logo-${providerProfile.key}`}
          src={providerProfile.logoSrc}
          alt=""
          aria-hidden="true"
        />
      ) : null}
      <span>{label}</span>
    </span>
  );
}

function UtilityFilterChip({ item, active, count, onSelect, ariaLabel }) {
  const Icon = item.Icon || MapPin;

  return (
    <button
      className={active ? "chip active" : "chip"}
      style={{
        "--chip-color": item.color,
        "--chip-text": item.textColor,
      }}
      type="button"
      onClick={onSelect}
      aria-label={ariaLabel}
      aria-pressed={active}
    >
      <span className="chip-icon" aria-hidden="true">
        <Icon size={14} />
      </span>
      <span>{item.label}</span>
      <span className="chip-count">{formatCompactCount(count)}</span>
    </button>
  );
}

function OperatorFilterChip({ item, active, onSelect }) {
  const { profile } = item;
  const iconLabel = profile.key === "unknown" ? getOperatorInitials(item.operatorName) : profile.markerLabel;

  return (
    <button
      className={active ? "operator-chip active" : "operator-chip"}
      style={{
        "--provider-color": profile.brandColor,
        "--provider-text": profile.brandTextColor,
      }}
      type="button"
      onClick={onSelect}
      aria-label={`Filter by operator ${item.operatorName}. ${item.availableCount} open plugs across ${item.stationCount} stations.`}
      aria-pressed={active}
      title={item.operatorName}
    >
      <span className="operator-chip-icon" aria-hidden="true">
        {profile.logoSrc ? (
          <img className={`operator-chip-logo operator-chip-logo-${profile.key}`} src={profile.logoSrc} alt="" />
        ) : (
          <span>{iconLabel}</span>
        )}
      </span>
      <span className="operator-chip-copy">
        <span className="operator-chip-name">{item.label}</span>
        <span className="operator-chip-count">{formatCompactCount(item.availableCount)} open plugs</span>
      </span>
    </button>
  );
}

function ProviderBadges({ providers, compact = false }) {
  const providerNames = uniqueProviderNames(providers).slice(0, 4);

  return (
    <span className={compact ? "provider-stack compact" : "provider-stack"} title={uniqueProviderNames(providers).join(" + ")}>
      {providerNames.map((providerName) => (
        <ProviderBadge compact={compact} key={providerName} providerName={providerName} />
      ))}
      {uniqueProviderNames(providers).length > providerNames.length ? (
        <span className={compact ? "provider-more compact" : "provider-more"}>
          +{uniqueProviderNames(providers).length - providerNames.length}
        </span>
      ) : null}
    </span>
  );
}

function StatTile({ label, value, tone }) {
  return (
    <div className={`stat-tile ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusDot({ status }) {
  return <span className={`status-dot ${status}`} aria-hidden="true" />;
}

function StatusPill({ status }) {
  const labels = {
    available: "Open",
    occupied: "In use",
    offline: "Offline",
    unknown: "Unknown",
  };

  return <span className={`status-pill ${status}`}>{labels[status] || "Unknown"}</span>;
}

function createStationIcon(station, selected) {
  const providerProfile = getProviderProfile(station.provider);
  const className = [
    "pin",
    `pin-provider-${providerProfile.key}`,
    `pin-${station.status}`,
    selected ? "selected" : "",
  ].join(" ");
  const label =
    providerProfile.key === "unknown"
      ? station.providerInitials || getOperatorInitials(station.provider)
      : providerProfile.markerLabel || station.providerInitials || station.provider.slice(0, 2).toUpperCase();
  const markerContent = providerProfile.logoSrc
    ? `<img class="pin-logo pin-logo-${providerProfile.key}" src="${escapeAttribute(providerProfile.logoSrc)}" alt="" aria-hidden="true" />`
    : `<span class="pin-label">${escapeHtml(label)}</span>`;
  const inlineStyle = [
    `--provider-color: ${providerProfile.brandColor}`,
    `--provider-text: ${providerProfile.brandTextColor}`,
  ].join("; ");

  return L.divIcon({
    className: "station-marker",
    html: `<span class="${className}" style="${inlineStyle}" title="${escapeAttribute(station.providerLabel || providerProfile.shortName)}">${markerContent}<span class="pin-status pin-status-${station.status}"></span></span>`,
    iconSize: selected ? [36, 36] : [28, 28],
    iconAnchor: selected ? [18, 18] : [14, 14],
  });
}

function createUserIcon() {
  return L.divIcon({
    className: "user-marker",
    html: '<span class="user-pin"><span></span></span>',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function getGoogleMapsUrl(station) {
  const destination = encodeURIComponent(`${station.latitude},${station.longitude}`);
  const destinationName = encodeURIComponent(station.name || station.address || "EV charger");
  return `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving&dir_action=navigate&destination_name=${destinationName}`;
}

function getFeedbackMailto({ filterLabel, query, visibleCount }) {
  const subject = encodeURIComponent("BoCharge feedback");
  const body = encodeURIComponent(
    [
      "Hi, I have feedback about BoCharge:",
      "",
      `Current filter: ${filterLabel || "All"}`,
      `Current search: ${query || "None"}`,
      `Visible results: ${visibleCount}`,
      "",
    ].join("\n"),
  );

  return `mailto:${FEEDBACK_EMAIL}?subject=${subject}&body=${body}`;
}

function getActiveFilterLabel(filter, areaFilters, operatorFilters) {
  const utilityFilter = UTILITY_FILTERS.find((item) => item.id === filter);
  if (utilityFilter) return utilityFilter.label;

  const areaFilter = areaFilters.find((item) => item.id === filter);
  if (areaFilter) return areaFilter.label;

  const operatorFilter = operatorFilters.find((item) => item.id === filter);
  if (operatorFilter) return operatorFilter.label;

  return "All";
}

function formatFeedTime(value) {
  if (!value) return "Freshness TBC";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Updated recently";

  const parts = new Intl.DateTimeFormat("en-SG", {
    timeZone: SG_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === "hour")?.value || "0";
  const minute = parts.find((part) => part.type === "minute")?.value || "00";
  const dayPeriod = (parts.find((part) => part.type === "dayPeriod")?.value || "").toLowerCase().replaceAll(".", "");

  return `Updated ${hour}.${minute}${dayPeriod} SGT`;
}

function getMsUntilNextRefreshBoundary(nowMs = Date.now(), intervalMs = CLIENT_REFRESH_MS) {
  const remainder = nowMs % intervalMs;

  return remainder === 0 ? intervalMs : intervalMs - remainder;
}

function getStationPayload(payload) {
  const records = payload.stations || payload;

  if (Array.isArray(records) && records.every(isNormalizedStation)) {
    return records;
  }

  return normalizeChargerStations(records);
}

function uniqueProviderNames(providers) {
  const seen = new Set();

  return toArray(providers).filter((providerName) => {
    const normalized = String(providerName || "").trim().toLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function buildAreaFilterOptions(stations) {
  const areaStats = new Map(
    AREA_FILTERS.map((area) => [
      area.id,
      {
        id: `area:${area.id}`,
        areaId: area.id,
        label: area.label,
        color: area.color,
        textColor: area.textColor,
        stationCount: 0,
        availableCount: 0,
        totalCount: 0,
      },
    ]),
  );

  stations.forEach((station) => {
    const area = getStationArea(station);
    const existing = areaStats.get(area.id);
    if (!existing) return;

    existing.stationCount += 1;
    existing.availableCount += station.availableCount;
    existing.totalCount += station.totalCount;
  });

  return AREA_FILTERS.map((area) => areaStats.get(area.id)).filter((area) => area.stationCount > 0);
}

function buildOperatorFilterOptions(stations) {
  const operators = new Map();

  stations.forEach((station) => {
    const providerNames = uniqueProviderNames(station.providers?.length ? station.providers : [station.provider]);

    providerNames.forEach((operatorName) => {
      const normalizedOperatorName = normalizeOperatorFilterValue(operatorName);
      if (!normalizedOperatorName) return;

      const id = `operator:${normalizedOperatorName}`;
      const existing = operators.get(id);

      if (existing) {
        existing.stationCount += 1;
        existing.availableCount += station.availableCount;
        existing.totalCount += station.totalCount;
        return;
      }

      operators.set(id, {
        id,
        operatorName,
        label: formatOperatorFilterLabel(operatorName),
        profile: getProviderProfile(operatorName),
        stationCount: 1,
        availableCount: station.availableCount,
        totalCount: station.totalCount,
      });
    });
  });

  return [...operators.values()].sort((a, b) => {
    if (b.availableCount !== a.availableCount) return b.availableCount - a.availableCount;
    if (b.totalCount !== a.totalCount) return b.totalCount - a.totalCount;
    if (b.stationCount !== a.stationCount) return b.stationCount - a.stationCount;
    return a.label.localeCompare(b.label);
  });
}

function getStationArea(station) {
  const latDelta = station.latitude - AREA_CENTER.latitude;
  const lngDelta = station.longitude - AREA_CENTER.longitude;
  const centralLatSpan = 0.035;
  const centralLngSpan = 0.045;

  if (Math.abs(latDelta) <= centralLatSpan && Math.abs(lngDelta) <= centralLngSpan) {
    return { id: "central", label: "Central" };
  }

  const latitudeWeight = Math.abs(latDelta) / 0.09;
  const longitudeWeight = Math.abs(lngDelta) / 0.13;

  if (latitudeWeight >= longitudeWeight) {
    return latDelta >= 0 ? { id: "north", label: "North" } : { id: "south", label: "South" };
  }

  return lngDelta >= 0 ? { id: "east", label: "East" } : { id: "west", label: "West" };
}

function hasProviderName(station, providerName) {
  const target = normalizeOperatorFilterValue(providerName);
  const providerNames = uniqueProviderNames(station.providers?.length ? station.providers : [station.provider]);

  return providerNames.some((name) => normalizeOperatorFilterValue(name) === target);
}

function normalizeOperatorFilterValue(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function formatOperatorFilterLabel(operatorName) {
  const strippedName = String(operatorName || "")
    .replace(/\b(private\s+limited|pte\.?\s*ltd\.?|ltd\.?|limited)\b\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const label = strippedName || String(operatorName || "").trim() || "Unknown";

  return label
    .split(/\s+/)
    .map(formatOperatorWord)
    .join(" ")
    .replace(/\bComfortdelgro\b/g, "ComfortDelGro")
    .replace(/\bEneready\b/g, "ENEReady")
    .replace(/\bEvone\b/g, "EVOne")
    .replace(/\bFastparkncharge\b/g, "FastParkNCharge")
    .replace(/\bIwow\b/g, "IWOW");
}

function formatOperatorWord(word) {
  if (!word) return "";

  const trimmed = word.trim();
  const upper = trimmed.toUpperCase();
  const compact = upper.replace(/[^A-Z0-9+]/g, "");
  const exact = {
    SP: "SP",
    YTL: "YTL",
    MNL: "MNL",
    EV: "EV",
    KED: "KED",
    ST: "ST",
    UP: "UP",
    CTN: "CTN",
    GO: "GO",
    NSP: "NSP",
  };

  if (exact[compact]) return exact[compact];
  if (compact === "CHARGE+") return "Charge+";
  if (trimmed.includes("-")) return trimmed.split("-").map(formatOperatorWord).join("-");

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

function getOperatorInitials(operatorName) {
  const label = formatOperatorFilterLabel(operatorName);
  const compact = label.replace(/[^a-z0-9+ ]/gi, "").trim();
  if (!compact) return "EV";
  if (/charge\+/i.test(compact)) return "C+";

  const words = compact.split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 4).toUpperCase();

  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function formatCompactCount(value) {
  return Number(value || 0).toLocaleString();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function isNormalizedStation(station) {
  return (
    station &&
    typeof station === "object" &&
    "providerKey" in station &&
    "availableCount" in station &&
    "totalCount" in station &&
    Array.isArray(station.plugTypes)
  );
}

function findNearestStation(location, stations) {
  return stations.reduce((nearest, station) => {
    const distanceMeters = getDistanceMeters(location, [station.latitude, station.longitude]);

    if (!nearest || distanceMeters < nearest.distanceMeters) {
      return { station, distanceMeters };
    }

    return nearest;
  }, null)?.station;
}

function getDistanceMeters(start, end) {
  const earthRadiusMeters = 6371000;
  const startLatitude = toRadians(start[0]);
  const endLatitude = toRadians(end[0]);
  const deltaLatitude = toRadians(end[0] - start[0]);
  const deltaLongitude = toRadians(end[1] - start[1]);
  const a =
    Math.sin(deltaLatitude / 2) * Math.sin(deltaLatitude / 2) +
    Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(deltaLongitude / 2) * Math.sin(deltaLongitude / 2);

  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
