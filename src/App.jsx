import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import {
  ArrowLeft,
  BatteryCharging,
  CircleDot,
  Clock,
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
const FEEDBACK_EMAIL = "celeste@agents.world";
const SHEET_DRAG_THRESHOLD_PX = 44;
const RESULT_PAGE_SIZE = 10;
const AREA_FILTERS = [
  { id: "north", label: "North", color: "#17875a", textColor: "#ffffff" },
  { id: "south", label: "South", color: "#0f4c81", textColor: "#ffffff" },
  { id: "east", label: "East", color: "#f97316", textColor: "#17201c" },
  { id: "west", label: "West", color: "#7c3aed", textColor: "#ffffff" },
  { id: "central", label: "Central", color: "#08a7d8", textColor: "#06283a" },
];
const ALL_FILTER = { id: "all", label: "All", Icon: CircleDot, color: "#08283f", textColor: "#ffffff" };
const QUICK_FILTERS = [
  {
    id: "available",
    stateKey: "availableOnly",
    label: "Available now",
    Icon: BatteryCharging,
    color: "#18bf73",
    textColor: "#073825",
  },
  { id: "fast", stateKey: "fastOnly", label: "Fast", Icon: PlugZap, color: "#08a7d8", textColor: "#06283a" },
];

export default function App() {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    function handlePopState() {
      setPath(window.location.pathname);
    }

    window.addEventListener("popstate", handlePopState);

    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function navigate(nextPath) {
    if (window.location.pathname === nextPath) return;

    window.history.pushState(null, "", nextPath);
    setPath(nextPath);
  }

  if (path === "/data") {
    return <DataInfoPage onNavigate={navigate} />;
  }

  return <ChargerMapPage onNavigate={navigate} />;
}

function ChargerMapPage({ onNavigate }) {
  const [stations, setStations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selectionMode, setSelectionMode] = useState("auto");
  const [query, setQuery] = useState("");
  const [selectedFilters, setSelectedFilters] = useState(createDefaultFilterState);
  const [feed, setFeed] = useState({
    loading: true,
    sourceLabel: "Loading",
    warning: "",
    updatedAt: "",
    cache: null,
  });
  const [userLocation, setUserLocation] = useState(null);
  const [isLocating, setIsLocating] = useState(false);
  const [mapCenter, setMapCenter] = useState(SINGAPORE_CENTER);
  const [visibleResultCount, setVisibleResultCount] = useState(RESULT_PAGE_SIZE);
  const [locationNotice, setLocationNotice] = useState("");
  const [sheetMode, setSheetMode] = useState("expanded");
  const mapRef = useRef(null);
  const sheetTouchStartY = useRef(null);
  const sheetDidDrag = useRef(false);
  const areaFilters = useMemo(() => buildAreaFilterOptions(stations), [stations]);
  const operatorFilters = useMemo(() => buildOperatorFilterOptions(stations), [stations]);
  const activeAreaIds = useMemo(() => new Set(selectedFilters.areas), [selectedFilters.areas]);
  const activeOperatorIds = useMemo(() => new Set(selectedFilters.operators), [selectedFilters.operators]);
  const allFiltersActive = !hasActiveFilters(selectedFilters);
  const utilityFilterCounts = useMemo(
    () => ({
      all: stations.length,
      available: stations.filter((station) => station.availableCount > 0).length,
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
          current && nextStations.some((station) => station.id === current) ? current : null,
        );
        setFeed({
          loading: false,
          sourceLabel: payload.sourceLabel || "LTA DataMall",
          warning: payload.warning || "",
          updatedAt: payload.updatedAt || payload.lastUpdatedTime || "",
          cache: payload.cache || null,
        });
      } catch (error) {
        const response = await fetch("/data/sample-chargers.json");
        const payload = await response.json();
        const nextStations = getStationPayload(payload);

        if (!mounted) return;

        setStations(nextStations);
        setSelectedId((current) =>
          current && nextStations.some((station) => station.id === current) ? current : null,
        );
        setFeed({
          loading: false,
          sourceLabel: "Sample fallback",
          warning: error instanceof Error ? error.message : "Unable to load chargers.",
          updatedAt: payload.updatedAt || payload.lastUpdatedTime || "",
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
      const matchesAvailability = !selectedFilters.availableOnly || station.availableCount > 0;
      const matchesSpeed = !selectedFilters.fastOnly || station.maxPowerKw >= 43;
      const matchesArea = activeAreaIds.size === 0 || activeAreaIds.has(getStationArea(station).id);
      const matchesOperator = activeOperatorIds.size === 0 || hasProviderFilterId(station, activeOperatorIds);

      return matchesSearch && matchesAvailability && matchesSpeed && matchesArea && matchesOperator;
    });
  }, [activeAreaIds, activeOperatorIds, query, selectedFilters.availableOnly, selectedFilters.fastOnly, stations]);

  const rankingOrigin = userLocation || mapCenter;
  const rankedStations = useMemo(() => rankStationsByDistance(rankingOrigin, filteredStations), [filteredStations, rankingOrigin]);

  const visibleRankedStations = rankedStations.slice(0, visibleResultCount);
  const hasMoreResults = visibleRankedStations.length < rankedStations.length;
  const resultSummary = [
    `Showing ${formatCompactCount(visibleRankedStations.length)} of ${formatCompactCount(rankedStations.length)}`,
    userLocation ? "nearest to you" : "tap location for distance",
  ]
    .filter(Boolean)
    .join(" · ");

  useEffect(() => {
    setSelectedFilters((current) => {
      const availableAreaIds = new Set(areaFilters.map((item) => item.areaId));
      const availableOperatorIds = new Set(operatorFilters.map((item) => item.id));
      const nextAreas = current.areas.filter((areaId) => availableAreaIds.has(areaId));
      const nextOperators = current.operators.filter((operatorId) => availableOperatorIds.has(operatorId));

      if (nextAreas.length === current.areas.length && nextOperators.length === current.operators.length) return current;

      return {
        ...current,
        areas: nextAreas,
        operators: nextOperators,
      };
    });
  }, [areaFilters, operatorFilters]);

  useEffect(() => {
    setLocationNotice("");
    setSelectionMode("auto");
  }, [query, selectedFilters]);

  useEffect(() => {
    setVisibleResultCount(RESULT_PAGE_SIZE);
  }, [rankingOrigin, query, selectedFilters]);

  const selectedStation =
    filteredStations.length > 0
      ? filteredStations.find((station) => station.id === selectedId) || rankedStations[0]?.station || null
      : null;

  useEffect(() => {
    if (filteredStations.length === 0) {
      setSelectedId(null);
      return;
    }

    const nearestVisibleStationId = rankedStations[0]?.station.id || null;
    setSelectedId((current) => {
      if (selectionMode === "manual" && current && filteredStations.some((station) => station.id === current)) {
        return current;
      }

      return nearestVisibleStationId;
    });
  }, [filteredStations, rankedStations, selectionMode]);

  const handleMapCenterChange = useCallback((nextCenter) => {
    setMapCenter((current) => (isSameMapCenter(current, nextCenter) ? current : nextCenter));
  }, []);

  function selectStation(station) {
    setSelectionMode("manual");
    setSelectedId(station.id);
    setSheetMode("expanded");
    mapRef.current?.flyTo([station.latitude, station.longitude], Math.max(mapRef.current.getZoom(), 14), {
      duration: 0.35,
    });
  }

  function handleLocateMe() {
    if (isLocating) return;

    if (!navigator.geolocation) {
      setLocationNotice("Location is not available in this browser.");
      return;
    }

    setIsLocating(true);
    setLocationNotice("Finding your precise location...");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextLocation = [position.coords.latitude, position.coords.longitude];
        const locationAccuracyLabel = formatAccuracyMeters(position.coords.accuracy);
        setUserLocation(nextLocation);

        if (filteredStations.length === 0) {
          setLocationNotice("No visible chargers match the current filters.");
          mapRef.current?.flyTo(nextLocation, 16, { duration: 0.45 });
          setIsLocating(false);
          return;
        }

        const nearestStation = rankStationsByDistance(nextLocation, filteredStations)[0]?.station;

        if (!nearestStation) {
          setLocationNotice("No visible chargers match the current filters.");
          setIsLocating(false);
          return;
        }

        setSelectionMode("auto");
        setSelectedId(nearestStation.id);
        setVisibleResultCount(RESULT_PAGE_SIZE);
        setSheetMode("expanded");
        setLocationNotice(
          [
            "Selected the closest charger in the current filtered list.",
            locationAccuracyLabel ? `Location accuracy: ${locationAccuracyLabel}.` : "",
          ]
            .filter(Boolean)
            .join(" "),
        );
        zoomToLocationAndStation(mapRef.current, nextLocation, nearestStation);
        setIsLocating(false);
      },
      () => {
        setLocationNotice("Location unavailable. Enable browser location to find the nearest charger.");
        setIsLocating(false);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 },
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
    filterLabel: getActiveFilterLabel(selectedFilters, areaFilters, operatorFilters),
    query,
    visibleCount: filteredStations.length,
  });

  function clearFilters() {
    setSelectedFilters(createAllFilterState());
  }

  function toggleQuickFilter(stateKey) {
    setSelectedFilters((current) => ({
      ...current,
      [stateKey]: !current[stateKey],
    }));
  }

  function toggleAreaFilter(areaId) {
    setSelectedFilters((current) => ({
      ...current,
      areas: toggleValue(current.areas, areaId),
    }));
  }

  function toggleOperatorFilter(operatorId) {
    setSelectedFilters((current) => ({
      ...current,
      operators: toggleValue(current.operators, operatorId),
    }));
  }

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
              <button className="icon-button" type="button" onClick={() => onNavigate("/data")} aria-label="Data sources">
                <Info size={19} />
              </button>
              <a className="icon-button feedback-button" href={feedbackHref} aria-label="Send feedback">
                <Mail size={17} />
                <span className="feedback-label">Feedback</span>
              </a>
              <button
                className={isLocating ? "icon-button locating" : "icon-button"}
                type="button"
                onClick={handleLocateMe}
                aria-busy={isLocating}
                aria-label="Use my location"
                disabled={isLocating}
              >
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

          <div className="filter-scroller" aria-label="Charger filters by availability, speed, area, and operator">
            <span className="filter-rail-label">
              <Filter size={14} aria-hidden="true" />
              Filters
            </span>
            <UtilityFilterChip
              active={allFiltersActive}
              ariaLabel="Show all chargers and clear selected filters."
              count={utilityFilterCounts.all}
              item={ALL_FILTER}
              onSelect={clearFilters}
            />
            {QUICK_FILTERS.map((item) => (
              <UtilityFilterChip
                active={selectedFilters[item.stateKey]}
                ariaLabel={`${selectedFilters[item.stateKey] ? "Remove" : "Add"} ${item.label} filter.`}
                count={utilityFilterCounts[item.id]}
                item={item}
                key={item.id}
                onSelect={() => toggleQuickFilter(item.stateKey)}
              />
            ))}
            <span className="filter-divider" aria-hidden="true" />
            {areaFilters.map((item) => (
              <UtilityFilterChip
                active={activeAreaIds.has(item.areaId)}
                ariaLabel={`${activeAreaIds.has(item.areaId) ? "Remove" : "Add"} ${item.label} area filter. ${item.availableCount} open plugs across ${item.stationCount} stations.`}
                count={item.availableCount}
                item={item}
                key={item.id}
                onSelect={() => toggleAreaFilter(item.areaId)}
              />
            ))}
            <span className="filter-divider" aria-hidden="true" />
            {operatorFilters.map((item) => (
              <OperatorFilterChip
                active={activeOperatorIds.has(item.id)}
                item={item}
                key={item.id}
                onSelect={() => toggleOperatorFilter(item.id)}
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
          <MapBridge mapRef={mapRef} onCenterChange={handleMapCenterChange} />
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
            <span>Available chargers</span>
            <span>{resultSummary}</span>
          </div>

          <div className="station-list">
            {visibleRankedStations.map(({ station, distanceMeters }) => {
              const distanceLabel = userLocation ? formatDistanceMeters(distanceMeters) : "";

              return (
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
                    {distanceLabel ? <span className="row-distance">{distanceLabel} from you</span> : null}
                    <b>{station.availableCount} open</b>
                  </div>
                </button>
              );
            })}
          </div>

          {hasMoreResults ? (
            <div className="station-list-footer">
              <button
                type="button"
                className="show-more-button"
                onClick={() => setVisibleResultCount((count) => count + RESULT_PAGE_SIZE)}
              >
                Show more
              </button>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function DataInfoPage({ onNavigate }) {
  const [sourceInfo, setSourceInfo] = useState({
    loading: true,
    sourceLabel: "",
    warning: "",
    updatedAt: "",
    cache: null,
  });

  useEffect(() => {
    let mounted = true;

    async function loadSourceInfo() {
      try {
        const response = await fetch("/api/chargers");
        if (!response.ok) throw new Error(`API returned ${response.status}`);
        const payload = await response.json();

        if (!mounted) return;

        setSourceInfo({
          loading: false,
          sourceLabel: payload.sourceLabel || "LTA DataMall",
          warning: payload.warning || "",
          updatedAt: payload.updatedAt || payload.lastUpdatedTime || "",
          cache: payload.cache || null,
        });
      } catch (error) {
        if (!mounted) return;

        setSourceInfo({
          loading: false,
          sourceLabel: "Unavailable",
          warning: error instanceof Error ? error.message : "Unable to load data source status.",
          updatedAt: "",
          cache: null,
        });
      }
    }

    loadSourceInfo();

    return () => {
      mounted = false;
    };
  }, []);

  const ltaUpdateTime = formatFeedTimeValue(sourceInfo.updatedAt);
  const serverRefreshLabel = sourceInfo.cache?.refreshedAt ? formatSourceTimestamp(sourceInfo.cache.refreshedAt) : "Not available";
  const cacheExpiryLabel = sourceInfo.cache?.expiresAt ? formatSourceTimestamp(sourceInfo.cache.expiresAt) : "At the next 5-minute slot";

  return (
    <main className="info-page">
      <header className="info-header">
        <button className="back-button" type="button" onClick={() => onNavigate("/")} aria-label="Back to map">
          <ArrowLeft size={18} />
          Map
        </button>
        <div>
          <p>Data sources</p>
          <h1>Reliability and freshness</h1>
        </div>
      </header>

      <section className="info-status" aria-label="Current feed status">
        <div>
          <span>Current source</span>
          <strong>{sourceInfo.loading ? "Checking" : sourceInfo.sourceLabel || "Unknown"}</strong>
        </div>
        <div>
          <span>LTA DataMall update</span>
          <strong>{ltaUpdateTime}</strong>
        </div>
        <div>
          <span>Server refresh</span>
          <strong>{serverRefreshLabel}</strong>
        </div>
      </section>

      {sourceInfo.warning ? <div className="info-warning">{sourceInfo.warning}</div> : null}

      <section className="info-section">
        <div className="info-section-heading">
          <Info size={19} />
          <h2>Primary data source</h2>
        </div>
        <p>
          BoCharge uses LTA DataMall's EV Charging Points Batch feed as the production source for Singapore charger
          locations, operators, plug types, prices, and connector availability.
        </p>
        <p>
          LTA publishes this as a batch file behind a temporary download link. The app requests that batch server-side so
          the LTA account key is never exposed in browser code.
        </p>
      </section>

      <section className="info-section">
        <div className="info-section-heading">
          <Clock size={19} />
          <h2>Freshness model</h2>
        </div>
        <ul>
          <li>The visible timestamp is the LTA DataMall batch update time, not the time your browser loaded the page.</li>
          <li>The server refreshes around 5-minute clock boundaries to match LTA's documented update cadence.</li>
          <li>Browser refreshes are also aligned to the next 5-minute boundary.</li>
          <li>Current API cache expiry: {cacheExpiryLabel}.</li>
        </ul>
      </section>

      <section className="info-section">
        <div className="info-section-heading">
          <PlugZap size={19} />
          <h2>Reliability notes</h2>
        </div>
        <ul>
          <li>Availability can lag real-world charger usage because operators and LTA update the feed asynchronously.</li>
          <li>Provider apps remain the best confirmation point before driving to a charger.</li>
          <li>If a live LTA refresh fails, the app can show the last successful cached LTA payload with a warning.</li>
          <li>If no LTA key is configured, the app falls back to a bundled snapshot and labels it as sample data.</li>
        </ul>
      </section>

      <section className="info-section">
        <div className="info-section-heading">
          <MapPin size={19} />
          <h2>Derived fields</h2>
        </div>
        <p>
          Area filters such as North, South, East, West, and Central are derived from charger coordinates. They are
          lightweight map buckets, not official planning-region boundaries.
        </p>
      </section>
    </main>
  );
}

function MapBridge({ mapRef, onCenterChange }) {
  const map = useMap();

  useEffect(() => {
    mapRef.current = map;
  }, [map, mapRef]);

  useEffect(() => {
    function syncCenter() {
      const center = map.getCenter();
      onCenterChange([center.lat, center.lng]);
    }

    syncCenter();
    map.on("moveend zoomend", syncCenter);

    return () => {
      map.off("moveend zoomend", syncCenter);
    };
  }, [map, onCenterChange]);

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
      aria-label={`${active ? "Remove" : "Add"} operator ${item.operatorName} filter. ${item.availableCount} open plugs across ${item.stationCount} stations.`}
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
      `Current filters: ${filterLabel || "All"}`,
      `Current search: ${query || "None"}`,
      `Visible results: ${visibleCount}`,
      "",
    ].join("\n"),
  );

  return `mailto:${FEEDBACK_EMAIL}?subject=${subject}&body=${body}`;
}

function getActiveFilterLabel(filters, areaFilters, operatorFilters) {
  const labels = [];

  if (filters.availableOnly) labels.push("Available now");
  if (filters.fastOnly) labels.push("Fast");

  filters.areas.forEach((areaId) => {
    const areaFilter = areaFilters.find((item) => item.areaId === areaId);
    if (areaFilter) labels.push(areaFilter.label);
  });

  filters.operators.forEach((operatorId) => {
    const operatorFilter = operatorFilters.find((item) => item.id === operatorId);
    if (operatorFilter) labels.push(operatorFilter.label);
  });

  return labels.length > 0 ? labels.join(" + ") : "All";
}

function createDefaultFilterState() {
  return {
    availableOnly: true,
    fastOnly: false,
    areas: [],
    operators: [],
  };
}

function createAllFilterState() {
  return {
    availableOnly: false,
    fastOnly: false,
    areas: [],
    operators: [],
  };
}

function hasActiveFilters(filters) {
  return Boolean(filters.availableOnly || filters.fastOnly || filters.areas.length > 0 || filters.operators.length > 0);
}

function toggleValue(values, value) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function formatFeedTime(value) {
  return `LTA DataMall updated at: ${formatFeedTimeValue(value)}`;
}

function formatFeedTimeValue(value) {
  if (!value) return "TBC";

  const date = parseFeedTime(value);
  if (Number.isNaN(date.getTime())) return "recently";

  const parts = new Intl.DateTimeFormat("en-SG", {
    timeZone: SG_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === "hour")?.value || "0";
  const minute = parts.find((part) => part.type === "minute")?.value || "00";
  const dayPeriod = (parts.find((part) => part.type === "dayPeriod")?.value || "").toLowerCase().replaceAll(".", "");

  return `${hour}.${minute}${dayPeriod} SGT`;
}

function parseFeedTime(value) {
  if (typeof value === "string") {
    const match = value
      .trim()
      .match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);

    if (match) {
      const [, year, month, day, hour, minute, second = "00"] = match;
      return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`);
    }
  }

  return new Date(value);
}

function formatSourceTimestamp(value) {
  const date = parseFeedTime(value);
  if (Number.isNaN(date.getTime())) return "Not available";

  const parts = new Intl.DateTimeFormat("en-SG", {
    timeZone: SG_TIME_ZONE,
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const day = parts.find((part) => part.type === "day")?.value || "";
  const month = parts.find((part) => part.type === "month")?.value || "";
  const hour = parts.find((part) => part.type === "hour")?.value || "0";
  const minute = parts.find((part) => part.type === "minute")?.value || "00";
  const dayPeriod = (parts.find((part) => part.type === "dayPeriod")?.value || "").toLowerCase().replaceAll(".", "");

  return `${day} ${month}, ${hour}.${minute}${dayPeriod} SGT`;
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

function hasProviderFilterId(station, operatorIds) {
  const providerNames = uniqueProviderNames(station.providers?.length ? station.providers : [station.provider]);

  return providerNames.some((name) => operatorIds.has(`operator:${normalizeOperatorFilterValue(name)}`));
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

function rankStationsByDistance(origin, stations) {
  return stations
    .map((station) => ({
      station,
      distanceMeters: getDistanceMeters(origin, [station.latitude, station.longitude]),
    }))
    .sort((a, b) => {
      if (a.distanceMeters !== b.distanceMeters) return a.distanceMeters - b.distanceMeters;
      if (a.station.availableCount !== b.station.availableCount) {
        return b.station.availableCount - a.station.availableCount;
      }
      return a.station.name.localeCompare(b.station.name);
    });
}

function zoomToLocationAndStation(map, location, station) {
  if (!map) return;

  const stationLocation = [station.latitude, station.longitude];
  const bounds = L.latLngBounds([location, stationLocation]);

  if (bounds.getNorthEast().equals(bounds.getSouthWest())) {
    map.flyTo(stationLocation, 17, { duration: 0.45 });
    return;
  }

  map.flyToBounds(bounds, {
    duration: 0.45,
    maxZoom: 17,
    padding: [48, 48],
  });
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

function formatDistanceMeters(distanceMeters) {
  if (!Number.isFinite(distanceMeters)) return "";
  if (distanceMeters < 50) return "< 50 m";
  if (distanceMeters < 1000) return `${Math.round(distanceMeters / 10) * 10} m`;
  if (distanceMeters < 10000) return `${(distanceMeters / 1000).toFixed(1)} km`;

  return `${Math.round(distanceMeters / 1000)} km`;
}

function formatAccuracyMeters(accuracyMeters) {
  if (!Number.isFinite(accuracyMeters) || accuracyMeters <= 0) return "";
  if (accuracyMeters < 1000) return `+/- ${Math.round(accuracyMeters)} m`;

  return `+/- ${(accuracyMeters / 1000).toFixed(1)} km`;
}

function isSameMapCenter(current, next) {
  return Math.abs(current[0] - next[0]) < 0.000001 && Math.abs(current[1] - next[1]) < 0.000001;
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
