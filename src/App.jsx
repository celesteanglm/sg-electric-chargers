import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import {
  BatteryCharging,
  CircleDot,
  ExternalLink,
  Filter,
  LocateFixed,
  MapPin,
  Navigation,
  PlugZap,
  Search,
  X,
} from "lucide-react";
import { normalizeChargerStations, stationSearchText } from "./lib/chargers.js";
import { getProviderProfile, openProviderApp } from "./data/providerApps.js";

const SINGAPORE_CENTER = [1.3521, 103.8198];
const DEFAULT_ZOOM = 11;
const CLIENT_REFRESH_MS = 60 * 1000;
const STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: "available", label: "Available" },
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
  const mapRef = useRef(null);

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
        const nextStations = normalizeChargerStations(payload.stations || payload);

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
        const nextStations = normalizeChargerStations(payload.stations || payload);

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
        (filter === "sp" && station.providerKey === "sp") ||
        (filter === "shell" && station.providerKey === "shell") ||
        (filter === "chargeplus" && station.providerKey === "chargeplus");

      return matchesSearch && matchesFilter;
    });
  }, [filter, query, stations]);

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
    mapRef.current?.flyTo([station.latitude, station.longitude], Math.max(mapRef.current.getZoom(), 14), {
      duration: 0.35,
    });
  }

  function handleLocateMe() {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextLocation = [position.coords.latitude, position.coords.longitude];
        setUserLocation(nextLocation);
        mapRef.current?.flyTo(nextLocation, 14, { duration: 0.45 });
      },
      () => {},
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  const availableCount = stations.reduce((sum, station) => sum + station.availableCount, 0);
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
              <h1>ChargeSG</h1>
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
                <span>{station.provider}</span>
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

      <section className="bottom-sheet" aria-label="Charger details and results">
        <div className="sheet-handle" aria-hidden="true" />
        <div className="summary-strip">
          <StatTile label="Available" value={availableCount} tone="green" />
          <StatTile label="Connectors" value={totalConnectors} tone="blue" />
          <StatTile label="Source" value={feed.sourceLabel.replace(" fallback", "")} tone="dark" />
        </div>

        {feed.warning ? <div className="feed-warning">{feed.warning}</div> : null}

        {selectedStation ? (
          <StationDetail station={selectedStation} onOpenApp={() => openProviderApp(selectedStation.provider)} />
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
                <span>{station.provider}</span>
                <b>
                  {station.availableCount}/{station.totalCount}
                </b>
              </div>
            </button>
          ))}
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

function StationDetail({ station, onOpenApp }) {
  const providerProfile = getProviderProfile(station.provider);
  const bestPlug = station.plugTypes[0];

  return (
    <article className="detail-card">
      <div className="detail-heading">
        <div>
          <div className="provider-line">
            <span className={`provider-badge provider-${station.providerKey}`}>{providerProfile.shortName}</span>
            <StatusPill status={station.status} />
          </div>
          <h2>{station.name}</h2>
          <p>{station.address}</p>
        </div>
      </div>

      <div className="detail-grid">
        <Metric label="Available" value={`${station.availableCount}/${station.totalCount}`} />
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
        <button className="primary-action" type="button" onClick={() => openDirections(station)}>
          <Navigation size={18} />
          Open in Google Maps
        </button>

        <button className="secondary-action" type="button" onClick={onOpenApp}>
          <ExternalLink size={18} />
          Open {providerProfile.appName}
        </button>
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
    available: "Available",
    occupied: "Occupied",
    offline: "Offline",
    unknown: "Unknown",
  };

  return <span className={`status-pill ${status}`}>{labels[status] || "Unknown"}</span>;
}

function createStationIcon(station, selected) {
  const className = ["pin", `pin-${station.status}`, selected ? "selected" : ""].join(" ");
  const initials = station.providerInitials || station.provider.slice(0, 2).toUpperCase();

  return L.divIcon({
    className: "station-marker",
    html: `<span class="${className}"><span>${initials}</span></span>`,
    iconSize: selected ? [44, 44] : [36, 36],
    iconAnchor: selected ? [22, 22] : [18, 18],
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

function openDirections(station) {
  const destination = encodeURIComponent(`${station.latitude},${station.longitude}`);
  const destinationName = encodeURIComponent(station.name || station.address || "EV charger");
  const url = `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving&dir_action=navigate&destination_name=${destinationName}`;

  window.open(url, "_blank", "noopener,noreferrer");
}
