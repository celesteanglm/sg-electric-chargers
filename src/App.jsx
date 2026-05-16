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
  MapPin,
  Navigation,
  PlugZap,
  Search,
  X,
} from "lucide-react";
import { normalizeChargerStations, stationSearchText } from "./lib/chargers.js";
import { canOpenProviderApp, getProviderProfile, openProviderApp } from "./data/providerApps.js";

const SINGAPORE_CENTER = [1.3521, 103.8198];
const DEFAULT_ZOOM = 11;
const CLIENT_REFRESH_MS = 60 * 60 * 1000;
const SHEET_DRAG_THRESHOLD_PX = 44;
const STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: "available", label: "Open now" },
  { id: "fast", label: "Fast" },
  { id: "sp", label: "SP" },
  { id: "shell", label: "Shell" },
  { id: "chargeplus", label: "Charge+" },
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

  useEffect(() => {
    let mounted = true;
    let inFlight = false;

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

    loadChargers();
    const refreshTimer = window.setInterval(loadChargers, CLIENT_REFRESH_MS);

    return () => {
      mounted = false;
      window.clearInterval(refreshTimer);
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
        (filter === "sp" && hasProviderKey(station, "sp")) ||
        (filter === "shell" && hasProviderKey(station, "shell")) ||
        (filter === "chargeplus" && hasProviderKey(station, "chargeplus"));

      return matchesSearch && matchesFilter;
    });
  }, [filter, query, stations]);

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

  const openConnectorCount = stations.reduce((sum, station) => sum + station.availableCount, 0);
  const totalConnectors = stations.reduce((sum, station) => sum + station.totalCount, 0);

  return (
    <main className="app-shell">
      <section className="map-stage" aria-label="Singapore EV charger map">
        <div className="top-panel">
          <div className="brand-row">
            <div className="brand-mark" aria-hidden="true">
              <PlugZap size={20} />
            </div>
            <div>
              <h1>BoCharge</h1>
              <p>{feed.loading ? "Loading chargers" : `${filteredStations.length} of ${stations.length} stations`}</p>
            </div>
            <button className="icon-button" type="button" onClick={handleLocateMe} aria-label="Use my location">
              <LocateFixed size={19} />
            </button>
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

          <div className="filter-scroller" aria-label="Charger filters">
            <Filter size={15} className="filter-icon" aria-hidden="true" />
            {STATUS_FILTERS.map((item) => (
              <button
                className={item.id === filter ? "chip active" : "chip"}
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id)}
              >
                {item.label}
              </button>
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
          <div className="summary-strip">
            <StatTile label="Open plugs" value={`${openConnectorCount}/${totalConnectors}`} tone="green" />
            <StatTile label="Stations" value={stations.length} tone="blue" />
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
  const providerAppAvailable = canOpenProviderApp(appProviderName);
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

        {providerAppAvailable ? (
          <button className="secondary-action" type="button" onClick={() => openProviderApp(appProviderName)}>
            <ExternalLink size={18} />
            Open {providerProfile.appName}
          </button>
        ) : (
          <div className="provider-unavailable">
            <button className="secondary-action unavailable" type="button" disabled>
              <Info size={18} />
              Provider app unavailable
            </button>
            <p>Provider has not been identified or no app link is available.</p>
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
      <span>{providerProfile.shortName}</span>
    </span>
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
  const label = providerProfile.markerLabel || station.providerInitials || station.provider.slice(0, 2).toUpperCase();
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

function getStationPayload(payload) {
  const records = payload.stations || payload;

  if (Array.isArray(records) && records.every(isNormalizedStation)) {
    return records;
  }

  return normalizeChargerStations(records);
}

function hasProviderKey(station, providerKey) {
  return station.providerKey === providerKey || toArray(station.providerKeys).includes(providerKey);
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
