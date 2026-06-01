import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import {
  ArrowLeft,
  BatteryCharging,
  Cable,
  ChevronLeft,
  ChevronRight,
  ChevronsUp,
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
  SlidersHorizontal,
  X,
} from "lucide-react";
import { getStationPriceKwh, normalizeChargerStations } from "./lib/chargers.js";
import { trackPageView } from "./lib/analytics.js";
import { PLACE_SEARCH_RADIUS_METERS, buildSearchQuery, rankStationSearchMatches } from "./lib/search.js";
import { canOpenProviderApp, getProviderAppTarget, getProviderProfile, openProviderApp } from "./data/providerApps.js";

const SINGAPORE_CENTER = [1.3521, 103.8198];
const MALAYSIA_CENTER = [4.2105, 101.9758];
const AREA_CENTER = { latitude: SINGAPORE_CENTER[0], longitude: SINGAPORE_CENTER[1] };
const DEFAULT_ZOOM = 11;
const MALAYSIA_ZOOM = 6;
const CLIENT_REFRESH_MS = 5 * 60 * 1000;
const MALAYSIA_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
const SG_TIME_ZONE = "Asia/Singapore";
const FEEDBACK_EMAIL = "celeste@agents.world";
const SHEET_DRAG_THRESHOLD_PX = 44;
const SHEET_CONTENT_DRAG_THRESHOLD_PX = 6;
const SHEET_VELOCITY_SAMPLE_MS = 140;
const SHEET_FLICK_VELOCITY_PX_PER_MS = 0.45;
const SHEET_MIN_VELOCITY_DISTANCE_PX = 8;
const COLLAPSED_SHEET_HEIGHT_PX = 164;
const MOBILE_SHEET_QUERY = "(max-width: 860px)";
const RESULT_PAGE_SIZE = 10;
const COUNTRY_OPTIONS = [
  {
    id: "sg",
    label: "Singapore",
    flag: "🇸🇬",
    center: SINGAPORE_CENTER,
    zoom: DEFAULT_ZOOM,
    minZoom: 10,
    refreshMs: CLIENT_REFRESH_MS,
    placeSearchEnabled: true,
    tagline: "Singapore EV chargers, refreshed every 5 min.",
    loadingLabel: "Loading Singapore chargers",
    areaLabel: "Area",
    availabilityFilterLabel: "Available now",
    availabilitySummaryLabel: "open plugs",
    resultHeader: "Available chargers",
    feedPrefix: "LTA DataMall updated at:",
  },
  {
    id: "my",
    label: "Malaysia",
    flag: "🇲🇾",
    center: MALAYSIA_CENTER,
    zoom: MALAYSIA_ZOOM,
    minZoom: 5,
    refreshMs: MALAYSIA_REFRESH_MS,
    placeSearchEnabled: false,
    tagline: "Malaysia EV charger locations from MEVnet.",
    loadingLabel: "Loading Malaysia chargers",
    areaLabel: "State",
    availabilityFilterLabel: "Existing",
    availabilitySummaryLabel: "existing bays",
    resultHeader: "Existing and proposed locations",
    feedPrefix: "MEVnet data as of:",
  },
];
const COUNTRY_CONFIGS = Object.fromEntries(COUNTRY_OPTIONS.map((country) => [country.id, country]));
const AREA_FILTERS = [
  { id: "central", label: "Central", color: "#08a7d8", textColor: "#06283a" },
  { id: "north", label: "North", color: "#17875a", textColor: "#ffffff" },
  { id: "south", label: "South", color: "#0f4c81", textColor: "#ffffff" },
  { id: "east", label: "East", color: "#f97316", textColor: "#17201c" },
  { id: "west", label: "West", color: "#7c3aed", textColor: "#ffffff" },
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

// Module-level icon cache keyed by the marker content that affects rendering.
const iconCache = new Map();

// Static icons that never change
const USER_ICON = L.divIcon({
  className: "user-marker",
  html: '<span class="user-pin"><span></span></span>',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

const SEARCH_PLACE_ICON = L.divIcon({
  className: "search-place-marker",
  html: '<span class="search-place-pin"><span></span></span>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

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

  useEffect(() => {
    trackPageView(path);
  }, [path]);

  if (path === "/data") {
    return <DataInfoPage onNavigate={navigate} />;
  }

  return <ChargerMapPage onNavigate={navigate} />;
}

function ChargerMapPage({ onNavigate }) {
  const [selectedCountry, setSelectedCountry] = useState("sg");
  const [stations, setStations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selectionMode, setSelectionMode] = useState("auto");
  const [query, setQuery] = useState("");
  const [resolvedPlace, setResolvedPlace] = useState(null);
  const [placeSearchStatus, setPlaceSearchStatus] = useState("idle");
  const [placeSearchWarning, setPlaceSearchWarning] = useState("");
  const [selectedFilters, setSelectedFilters] = useState(() => createDefaultFilterState("sg"));
  const [feed, setFeed] = useState({
    loading: true,
    sourceLabel: "Loading",
    warning: "",
    updatedAt: "",
    updatedAtLabel: "",
    refreshIntervalMs: CLIENT_REFRESH_MS,
    supportsLiveAvailability: true,
    cache: null,
  });
  const [userLocation, setUserLocation] = useState(null);
  const [userLocationAccuracy, setUserLocationAccuracy] = useState(null);
  const [isLocating, setIsLocating] = useState(false);
  const [mapCenter, setMapCenter] = useState(SINGAPORE_CENTER);
  const [mapBounds, setMapBounds] = useState(null);
  const [resultPage, setResultPage] = useState(1);
  const [locationNotice, setLocationNotice] = useState("");
  const [sheetMode, setSheetMode] = useState(getInitialSheetMode);
  const [sheetHasUserInteracted, setSheetHasUserInteracted] = useState(false);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const filterBarRef = useRef(null);
  const mapRef = useRef(null);
  const sheetRef = useRef(null);
  const sheetContentRef = useRef(null);
  const sheetDragState = useRef(null);
  const sheetDragSamples = useRef([]);
  const sheetDragWindowCleanup = useRef(null);
  const pendingContentDrag = useRef(null);
  const pendingContentDragCleanup = useRef(null);
  const sheetDidDrag = useRef(false);
  const locationWatchId = useRef(null);
  const searchCandidatesRef = useRef([]);
  const selectedFiltersRef = useRef(selectedFilters);
  const applyingLocationAreaFilter = useRef(false);
  const selectedCountryConfig = COUNTRY_CONFIGS[selectedCountry] || COUNTRY_CONFIGS.sg;
  const areaFilters = useMemo(() => buildAreaFilterOptions(stations, selectedCountry), [selectedCountry, stations]);
  const operatorFilters = useMemo(() => buildOperatorFilterOptions(stations), [stations]);
  const connectorTypeFilters = useMemo(() => buildConnectorTypeFilterOptions(stations), [stations]);
  const activeAreaIds = useMemo(() => new Set(selectedFilters.areas), [selectedFilters.areas]);
  const activeOperatorIds = useMemo(() => new Set(selectedFilters.operators), [selectedFilters.operators]);
  const activeConnectorTypeIds = useMemo(() => new Set(selectedFilters.connectorTypes), [selectedFilters.connectorTypes]);
  const priceStats = useMemo(() => buildPriceStats(stations), [stations]);
  const priceCurrencyPrefix = selectedCountry === "my" ? "RM" : "S$";
  const hasKnownPrices = priceStats.max != null;
  const priceFilterCount = (selectedFilters.maxPriceKwh ? 1 : 0) + (selectedFilters.includeUnknownPrices ? 0 : 1);
  const extendedFilterCount =
    selectedFilters.areas.length + selectedFilters.operators.length + selectedFilters.connectorTypes.length + priceFilterCount;
  const allFiltersActive = !hasActiveFilters(selectedFilters);
  const utilityFilterCounts = useMemo(
    () => ({
      all: stations.length,
      available: stations.filter((station) => stationMatchesPrimaryAvailability(station, selectedCountry)).length,
      fast: stations.filter((station) => station.maxPowerKw >= 43).length,
    }),
    [selectedCountry, stations],
  );
  const quickFilters = useMemo(
    () =>
      QUICK_FILTERS.filter((item) => selectedCountry === "sg" || item.id !== "fast").map((item) =>
        item.id === "available" ? { ...item, label: selectedCountryConfig.availabilityFilterLabel } : item,
      ),
    [selectedCountry, selectedCountryConfig.availabilityFilterLabel],
  );

  useEffect(() => {
    let mounted = true;
    let inFlight = false;
    let refreshTimer = null;
    const countryConfig = COUNTRY_CONFIGS[selectedCountry] || COUNTRY_CONFIGS.sg;

    setStations([]);
    setSelectedId(null);
    setFeed({
      loading: true,
      sourceLabel: "Loading",
      warning: "",
      updatedAt: "",
      updatedAtLabel: "",
      refreshIntervalMs: countryConfig.refreshMs,
      supportsLiveAvailability: selectedCountry === "sg",
      cache: null,
    });

    async function loadChargers() {
      if (inFlight) return;
      inFlight = true;

      try {
        const response = await fetch(`/api/chargers?country=${encodeURIComponent(selectedCountry)}`);
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
          updatedAtLabel: payload.updatedAtLabel || "",
          refreshIntervalMs: payload.refreshIntervalMs || countryConfig.refreshMs,
          supportsLiveAvailability: payload.supportsLiveAvailability !== false,
          cache: payload.cache || null,
        });
      } catch (error) {
        if (selectedCountry !== "sg") {
          if (!mounted) return;

          setStations([]);
          setSelectedId(null);
          setFeed({
            loading: false,
            sourceLabel: "PLANMalaysia MEVnet",
            warning: error instanceof Error ? error.message : "Unable to load Malaysia chargers.",
            updatedAt: "",
            updatedAtLabel: "",
            refreshIntervalMs: countryConfig.refreshMs,
            supportsLiveAvailability: false,
            cache: null,
          });
          return;
        }

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
          updatedAtLabel: "",
          refreshIntervalMs: countryConfig.refreshMs,
          supportsLiveAvailability: true,
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
      }, getRefreshDelayMs(selectedCountry, countryConfig.refreshMs));
    }

    loadChargers();
    scheduleNextRefresh();

    return () => {
      mounted = false;
      if (refreshTimer) window.clearTimeout(refreshTimer);
    };
  }, [selectedCountry]);

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_SHEET_QUERY);

    function syncMobileDefaultSheet() {
      if (mediaQuery.matches && !sheetHasUserInteracted) {
        setSheetMode("collapsed");
      } else if (!mediaQuery.matches) {
        setSheetMode("expanded");
      }
    }

    syncMobileDefaultSheet();
    mediaQuery.addEventListener("change", syncMobileDefaultSheet);

    return () => mediaQuery.removeEventListener("change", syncMobileDefaultSheet);
  }, [sheetHasUserInteracted]);

  useEffect(
    () => () => {
      stopLocationWatch();
      cleanupPendingContentDrag();
      cancelSheetDrag();
    },
    [],
  );

  // On iOS Safari, dynamically setting touch-action is ignored — the browser
  // reads it at gesture start, before our JS can update it. The only reliable
  // way to prevent the browser from scrolling the content when we want to
  // drag the sheet closed is a non-passive touchmove listener that calls
  // preventDefault() for downward gestures when already at scroll top.
  useEffect(() => {
    const content = sheetContentRef.current;
    if (!content) return;

    let touchStartY = null;
    let touchStartScrollTop = null;

    function onTouchStart(e) {
      if (sheetMode !== "expanded" || e.touches.length !== 1 || isInteractiveSheetTarget(e.target)) {
        touchStartY = null;
        touchStartScrollTop = null;
        return;
      }

      touchStartY = e.touches[0].clientY;
      touchStartScrollTop = content.scrollTop;
    }

    function onTouchMove(e) {
      if (e.touches.length !== 1 || touchStartY === null || touchStartScrollTop === null || touchStartScrollTop > 1) {
        return;
      }

      const delta = e.touches[0].clientY - touchStartY;
      if (delta > 0) {
        // Downward drag at scroll top: block browser scroll so pointer
        // events can drive the sheet-drag gesture instead.
        e.preventDefault();
      }
    }

    function onTouchEnd() {
      touchStartY = null;
      touchStartScrollTop = null;
    }

    content.addEventListener("touchstart", onTouchStart, { passive: true });
    content.addEventListener("touchmove", onTouchMove, { passive: false });
    content.addEventListener("touchend", onTouchEnd, { passive: true });
    content.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      content.removeEventListener("touchstart", onTouchStart);
      content.removeEventListener("touchmove", onTouchMove);
      content.removeEventListener("touchend", onTouchEnd);
      content.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [sheetMode]);

  const searchQuery = useMemo(() => buildSearchQuery(query), [query]);
  const textSearchMatches = useMemo(() => rankStationSearchMatches(stations, searchQuery), [stations, searchQuery]);
  const textSearchScoreById = useMemo(
    () => new Map(textSearchMatches.map((match) => [match.station.id, match.score])),
    [textSearchMatches],
  );
  const searchPlace = selectedCountryConfig.placeSearchEnabled ? searchQuery.knownPlace || resolvedPlace : null;
  const searchOrigin = useMemo(
    () => (searchPlace ? [searchPlace.latitude, searchPlace.longitude] : null),
    [searchPlace],
  );
  const searchCandidates = useMemo(() => {
    if (!searchQuery.active) return stations;
    if (searchOrigin) return getNearbyStationCandidates(stations, searchOrigin);
    return textSearchMatches.map((match) => match.station);
  }, [searchOrigin, searchQuery.active, stations, textSearchMatches]);
  const filteredStations = useMemo(
    () =>
      searchCandidates.filter((station) =>
        stationPassesFilters(station, selectedFilters, activeAreaIds, activeOperatorIds, activeConnectorTypeIds, selectedCountry),
      ),
    [activeAreaIds, activeConnectorTypeIds, activeOperatorIds, searchCandidates, selectedCountry, selectedFilters],
  );

  // Viewport culling — only render markers visible on the map (with padding buffer)
  const viewportStations = useMemo(() => {
    if (!mapBounds) return filteredStations;
    const paddedBounds = mapBounds.pad(0.2);
    return filteredStations.filter((station) =>
      paddedBounds.contains([station.latitude, station.longitude]),
    );
  }, [filteredStations, mapBounds]);

  useEffect(() => {
    searchCandidatesRef.current = searchCandidates;
  }, [searchCandidates]);

  useEffect(() => {
    selectedFiltersRef.current = selectedFilters;
  }, [selectedFilters]);

  const hiddenSearchMatchCount = searchQuery.active ? Math.max(0, searchCandidates.length - filteredStations.length) : 0;
  const rankingOrigin = searchOrigin || userLocation || mapCenter;
  const rankedStations = useMemo(
    () =>
      rankStationsByDistance(
        rankingOrigin,
        filteredStations,
        searchQuery.active && !searchOrigin ? textSearchScoreById : null,
      ),
    [filteredStations, rankingOrigin, searchOrigin, searchQuery.active, textSearchScoreById],
  );

  const pageCount = Math.max(1, Math.ceil(rankedStations.length / RESULT_PAGE_SIZE));
  const clampedResultPage = Math.min(Math.max(resultPage, 1), pageCount);
  const pageStart = rankedStations.length > 0 ? (clampedResultPage - 1) * RESULT_PAGE_SIZE : 0;
  const pageEnd = rankedStations.length > 0 ? Math.min(pageStart + RESULT_PAGE_SIZE, rankedStations.length) : 0;
  const visibleRankedStations = rankedStations.slice(pageStart, pageEnd);
  const firstVisibleStation = visibleRankedStations[0]?.station || null;
  const firstVisibleStationId = firstVisibleStation?.id || null;
  const hasMultipleResultPages = pageCount > 1;
  const distanceSourceLabel = searchPlace ? searchPlace.label : userLocation ? "you" : "";
  const resultRangeLabel =
    rankedStations.length > 0
      ? `${formatCompactCount(pageStart + 1)}-${formatCompactCount(pageEnd)}`
      : "0";
  const resultSummary = [
    `Showing ${resultRangeLabel} of ${formatCompactCount(rankedStations.length)}`,
    searchPlace ? `nearest to ${searchPlace.label}` : userLocation ? "nearest to you" : "tap location for distance",
    placeSearchStatus === "loading" ? "checking place" : "",
  ]
    .filter(Boolean)
    .join(" · ");

  useEffect(() => {
    const shouldSearchPlace =
      selectedCountryConfig.placeSearchEnabled &&
      searchQuery.active &&
      !searchQuery.knownPlace &&
      (searchQuery.hasPlaceIntent || textSearchMatches.length === 0) &&
      searchQuery.normalized.length >= 2;

    if (!shouldSearchPlace) {
      setResolvedPlace(null);
      setPlaceSearchStatus("idle");
      setPlaceSearchWarning("");
      return undefined;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setPlaceSearchStatus("loading");
      setPlaceSearchWarning("");

      try {
        const response = await fetch(`/api/search-place?q=${encodeURIComponent(searchQuery.normalized)}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Place search returned ${response.status}`);

        const payload = await response.json();
        const place = payload.results?.[0] || null;

        if (controller.signal.aborted) return;

        if (place) {
          setResolvedPlace(place);
          setPlaceSearchStatus("ready");
          setPlaceSearchWarning(payload.warning || "");
          return;
        }

        setResolvedPlace(null);
        setPlaceSearchStatus("empty");
        setPlaceSearchWarning(payload.warning || "No matching Singapore place found.");
      } catch (error) {
        if (controller.signal.aborted) return;

        setResolvedPlace(null);
        setPlaceSearchStatus("error");
        setPlaceSearchWarning(error instanceof Error ? error.message : "Place search unavailable.");
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    searchQuery.active,
    searchQuery.hasPlaceIntent,
    searchQuery.knownPlace,
    searchQuery.normalized,
    selectedCountryConfig.placeSearchEnabled,
    textSearchMatches.length,
  ]);

  useEffect(() => {
    if (stations.length === 0) return;

    updateSelectedFilters((current) => {
      const availableAreaIds = new Set(areaFilters.map((item) => item.areaId));
      const availableOperatorIds = new Set(operatorFilters.map((item) => item.id));
      const availableConnectorTypeIds = new Set(connectorTypeFilters.map((item) => item.id));
      const nextAreas = current.areas.filter((areaId) => availableAreaIds.has(areaId));
      const nextOperators = current.operators.filter((operatorId) => availableOperatorIds.has(operatorId));
      const nextConnectorTypes = current.connectorTypes.filter((id) => availableConnectorTypeIds.has(id));

      if (
        nextAreas.length === current.areas.length &&
        nextOperators.length === current.operators.length &&
        nextConnectorTypes.length === current.connectorTypes.length
      ) return current;

      return {
        ...current,
        areas: nextAreas,
        operators: nextOperators,
        connectorTypes: nextConnectorTypes,
      };
    });
  }, [areaFilters, connectorTypeFilters, operatorFilters, stations.length]);

  useEffect(() => {
    if (!filterPanelOpen) return;

    function handleClickOutside(event) {
      if (filterBarRef.current && !filterBarRef.current.contains(event.target)) {
        setFilterPanelOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") setFilterPanelOpen(false);
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [filterPanelOpen]);

  useEffect(() => {
    if (applyingLocationAreaFilter.current) {
      applyingLocationAreaFilter.current = false;
      setSelectionMode("auto");
      return;
    }

    setLocationNotice("");
    setSelectionMode("auto");
  }, [query, selectedFilters]);

  useEffect(() => {
    setResultPage(1);
  }, [rankingOrigin, query, selectedFilters]);

  useEffect(() => {
    setResultPage((currentPage) => Math.min(Math.max(currentPage, 1), pageCount));
  }, [pageCount]);

  useEffect(() => {
    if (!searchOrigin || filteredStations.length === 0) return;

    const nearestStation = rankStationsByDistance(searchOrigin, filteredStations)[0]?.station;
    if (!nearestStation) return;

    setSheetHasUserInteracted(true);
    setSelectionMode("auto");
    setSelectedId(nearestStation.id);
    setResultPage(1);
    setSheetMode("expanded");
    zoomToLocationAndStation(mapRef.current, searchOrigin, nearestStation);
  }, [filteredStations, searchOrigin]);

  const selectedStation =
    filteredStations.length > 0
      ? filteredStations.find((station) => station.id === selectedId) || firstVisibleStation
      : null;

  useEffect(() => {
    if (filteredStations.length === 0) {
      setSelectedId(null);
      return;
    }

    setSelectedId((current) => {
      if (selectionMode === "manual" && current && filteredStations.some((station) => station.id === current)) {
        return current;
      }

      return firstVisibleStationId;
    });
  }, [filteredStations, firstVisibleStationId, selectionMode]);

  const handleMapCenterChange = useCallback((nextCenter) => {
    setMapCenter((current) => (isSameMapCenter(current, nextCenter) ? current : nextCenter));
  }, []);

  const handleBoundsChange = useCallback((bounds) => {
    setMapBounds(bounds);
  }, []);

  function updateSelectedFilters(updater) {
    setSelectedFilters((current) => {
      const nextFilters = typeof updater === "function" ? updater(current) : updater;
      selectedFiltersRef.current = nextFilters;
      return nextFilters;
    });
  }

  function handleCountryChange(countryId) {
    if (countryId === selectedCountry || !COUNTRY_CONFIGS[countryId]) return;

    stopLocationWatch();
    setSelectedCountry(countryId);
    setQuery("");
    setResolvedPlace(null);
    setPlaceSearchStatus("idle");
    setPlaceSearchWarning("");
    setSelectedFilters(createDefaultFilterState(countryId));
    selectedFiltersRef.current = createDefaultFilterState(countryId);
    setSelectedId(null);
    setSelectionMode("auto");
    setUserLocation(null);
    setUserLocationAccuracy(null);
    setMapBounds(null);
    setMapCenter(COUNTRY_CONFIGS[countryId].center);
    setResultPage(1);
    setLocationNotice("");
  }

  const selectStation = useCallback((station) => {
    setSelectionMode("manual");
    setSelectedId(station.id);
    setSheetHasUserInteracted(true);
    setSheetMode("expanded");
    mapRef.current?.flyTo([station.latitude, station.longitude], Math.max(mapRef.current.getZoom(), 14), {
      duration: 0.35,
    });
  }, [mapRef]);

  const handleResultPageChange = useCallback((nextPage) => {
    const clampedPage = Math.min(Math.max(nextPage, 1), pageCount);
    const firstStationOnPage = rankedStations[(clampedPage - 1) * RESULT_PAGE_SIZE]?.station;

    setResultPage(clampedPage);

    if (firstStationOnPage) {
      setSelectionMode("auto");
      setSelectedId(firstStationOnPage.id);
    }
  }, [pageCount, rankedStations]);

  function handleLocateMe() {
    if (isLocating) return;

    if (!navigator.geolocation) {
      setLocationNotice("Location is not available in this browser.");
      return;
    }

    stopLocationWatch();
    setIsLocating(true);
    setLocationNotice("Finding your precise location...");
    let hasInitialLocation = false;

    locationWatchId.current = navigator.geolocation.watchPosition(
      (position) => {
        handleUserPosition(position, { focusNearest: !hasInitialLocation });
        hasInitialLocation = true;
        setIsLocating(false);
      },
      (error) => {
        if (!hasInitialLocation) stopLocationWatch();
        setLocationNotice(
          hasInitialLocation
            ? "Location tracking paused. Showing your last known position."
            : getLocationErrorMessage(error),
        );
        setIsLocating(false);
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 },
    );
  }

  function handleUserPosition(position, { focusNearest }) {
    const nextLocation = [position.coords.latitude, position.coords.longitude];
    const locationAccuracyLabel = formatAccuracyMeters(position.coords.accuracy);
    const locationArea =
      selectedCountry === "sg" ? getStationArea({ latitude: nextLocation[0], longitude: nextLocation[1] }, selectedCountry) : null;
    const nextFilters = locationArea ? applyAreaFilter(selectedFiltersRef.current, locationArea.id) : selectedFiltersRef.current;
    const areaFilterChanged = nextFilters !== selectedFiltersRef.current;
    const nextActiveAreaIds = new Set(nextFilters.areas);
    const nextActiveOperatorIds = new Set(nextFilters.operators);
    const nextActiveConnectorTypeIds = new Set(nextFilters.connectorTypes);
    const currentFilteredStations = searchCandidatesRef.current.filter((station) =>
      stationPassesFilters(station, nextFilters, nextActiveAreaIds, nextActiveOperatorIds, nextActiveConnectorTypeIds, selectedCountry),
    );

    setUserLocation((current) => (current && isSameMapCenter(current, nextLocation) ? current : nextLocation));
    setUserLocationAccuracy(position.coords.accuracy);

    if (areaFilterChanged) {
      applyingLocationAreaFilter.current = true;
      selectedFiltersRef.current = nextFilters;
      updateSelectedFilters(nextFilters);
    }

    if (currentFilteredStations.length === 0) {
      if (focusNearest) {
        setLocationNotice(
          [
            areaFilterChanged && locationArea ? `Switched area filter to ${locationArea.label}.` : "",
            "No visible chargers match the current filters.",
          ]
            .filter(Boolean)
            .join(" "),
        );
        mapRef.current?.flyTo(nextLocation, 16, { duration: 0.45 });
      }
      return;
    }

    const nearestStation = rankStationsByDistance(nextLocation, currentFilteredStations)[0]?.station;

    if (!nearestStation) {
      if (focusNearest) setLocationNotice("No visible chargers match the current filters.");
      return;
    }

    if (!focusNearest) return;

    setSelectionMode("auto");
    setSelectedId(nearestStation.id);
    setResultPage(1);
    setSheetHasUserInteracted(true);
    setSheetMode("expanded");
    setLocationNotice(
      [
        areaFilterChanged && locationArea ? `Switched area filter to ${locationArea.label}.` : "",
        "Tracking your location and selected the closest charger in the current filtered list.",
        locationAccuracyLabel ? `Accuracy: ${locationAccuracyLabel}.` : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
    zoomToLocationAndStation(mapRef.current, nextLocation, nearestStation);
  }

  function stopLocationWatch() {
    if (locationWatchId.current == null || !navigator.geolocation?.clearWatch) return;

    navigator.geolocation.clearWatch(locationWatchId.current);
    locationWatchId.current = null;
  }

  function getSheetSnapHeights() {
    return {
      expandedHeight: Math.min(window.innerHeight * 0.68, 620),
      collapsedHeight: COLLAPSED_SHEET_HEIGHT_PX,
    };
  }

  function startSheetDrag(
    event,
    { source, startY = event.clientY, captureTarget = event.currentTarget, skipButtonCheck = false } = {},
  ) {
    if (!skipButtonCheck && event.button != null && event.button !== 0) return false;
    if (event.pointerType === "touch" && !event.isPrimary) return false;
    if (sheetDragState.current || !sheetRef.current) return false;

    const startTime = performance.now();
    sheetDragState.current = {
      captureTarget,
      pointerId: event.pointerId,
      source,
      startHeight: sheetRef.current.offsetHeight,
      startTime,
      startY,
    };
    sheetDragSamples.current = [{ time: startTime, y: startY }];
    sheetDidDrag.current = false;

    sheetRef.current.style.transition = "none";
    sheetRef.current.classList.add("is-dragging");

    setPointerCapture(captureTarget, event.pointerId);
    attachSheetDragWindowListeners();
    return true;
  }

  function moveSheetDrag(clientY) {
    const drag = sheetDragState.current;
    if (!drag || !sheetRef.current) return;

    recordSheetDragSample(clientY);

    const delta = drag.startY - clientY;
    const { expandedHeight, collapsedHeight } = getSheetSnapHeights();
    let newHeight = drag.startHeight + delta;

    if (newHeight > expandedHeight) {
      newHeight = expandedHeight + Math.log1p(newHeight - expandedHeight) * 5;
    } else if (newHeight < collapsedHeight) {
      newHeight = collapsedHeight - Math.log1p(collapsedHeight - newHeight) * 5;
    }

    sheetRef.current.style.height = `${newHeight}px`;
  }

  function finishSheetDrag(endY) {
    const drag = sheetDragState.current;
    if (!drag) return;

    const deltaY = endY - drag.startY;
    const velocityY = getSheetDragVelocity(endY);
    const draggedFar = Math.abs(deltaY) > SHEET_DRAG_THRESHOLD_PX;
    const { expandedHeight, collapsedHeight } = getSheetSnapHeights();
    const drawnHeight = drag.startHeight - deltaY;

    let newMode = null;
    if (velocityY > SHEET_FLICK_VELOCITY_PX_PER_MS) {
      newMode = "collapsed";
    } else if (velocityY < -SHEET_FLICK_VELOCITY_PX_PER_MS) {
      newMode = "expanded";
    } else if (draggedFar) {
      const midpoint = (expandedHeight + collapsedHeight) / 2;
      newMode = drawnHeight > midpoint ? "expanded" : "collapsed";
    }

    cleanupSheetDrag();

    if (newMode) {
      sheetDidDrag.current = true;
      window.setTimeout(() => {
        sheetDidDrag.current = false;
      }, 400);

      setSheetHasUserInteracted(true);
      setSheetMode(newMode);
    }
  }

  function cancelSheetDrag() {
    cleanupSheetDrag();
  }

  function cleanupSheetDrag() {
    const drag = sheetDragState.current;
    removeSheetDragWindowListeners();
    cleanupPendingContentDrag();

    if (drag?.captureTarget) {
      releasePointerCapture(drag.captureTarget, drag.pointerId);
    }

    sheetDragState.current = null;
    sheetDragSamples.current = [];

    if (sheetRef.current) {
      sheetRef.current.style.transition = "";
      sheetRef.current.style.height = "";
      sheetRef.current.classList.remove("is-dragging");
    }
  }

  function toggleSheetMode() {
    if (sheetDidDrag.current) {
      sheetDidDrag.current = false;
      return;
    }

    setSheetHasUserInteracted(true);
    setSheetMode((current) => (current === "expanded" ? "collapsed" : "expanded"));
  }

  function handleSheetPointerDown(event) {
    startSheetDrag(event, { source: "handle" });
  }

  function handleCollapsedSheetPointerDown(event) {
    if (sheetMode !== "collapsed") return;
    startSheetDrag(event, { source: "collapsed" });
  }

  function handleContentPointerDown(event) {
    if (event.button != null && event.button !== 0) return;
    if (sheetMode !== "expanded") return;
    if (event.pointerType === "touch" && !event.isPrimary) {
      cleanupPendingContentDrag();
      cancelSheetDrag();
      return;
    }
    if (sheetDragState.current || pendingContentDrag.current) return;
    if (isInteractiveSheetTarget(event.target)) return;

    const content = event.currentTarget;
    if (content.scrollTop > 1) return;

    pendingContentDrag.current = {
      content,
      pointerId: event.pointerId,
      startY: event.clientY,
    };
    attachPendingContentDragListeners();
  }

  function handleSheetWindowPointerMove(event) {
    const drag = sheetDragState.current;
    if (!drag || event.pointerId !== drag.pointerId) return;

    event.preventDefault();
    moveSheetDrag(event.clientY);
  }

  function handleSheetWindowPointerUp(event) {
    const drag = sheetDragState.current;
    if (!drag || event.pointerId !== drag.pointerId) return;

    finishSheetDrag(event.clientY);
  }

  function handleSheetWindowPointerCancel(event) {
    const drag = sheetDragState.current;
    if (!drag || event.pointerId !== drag.pointerId) return;

    cancelSheetDrag();
  }

  function handlePendingContentPointerMove(event) {
    const pending = pendingContentDrag.current;
    if (!pending || event.pointerId !== pending.pointerId) return;

    const deltaY = event.clientY - pending.startY;
    if (deltaY < -SHEET_CONTENT_DRAG_THRESHOLD_PX || pending.content.scrollTop > 1) {
      cleanupPendingContentDrag();
      return;
    }

    if (deltaY <= SHEET_CONTENT_DRAG_THRESHOLD_PX) return;

    const started = startSheetDrag(event, {
      captureTarget: pending.content,
      skipButtonCheck: true,
      source: "content",
      startY: pending.startY,
    });
    cleanupPendingContentDrag();

    if (started) {
      event.preventDefault();
      moveSheetDrag(event.clientY);
    }
  }

  function handlePendingContentPointerEnd(event) {
    const pending = pendingContentDrag.current;
    if (!pending || event.pointerId !== pending.pointerId) return;

    cleanupPendingContentDrag();
  }

  function attachSheetDragWindowListeners() {
    removeSheetDragWindowListeners();
    const handleMove = handleSheetWindowPointerMove;
    const handleUp = handleSheetWindowPointerUp;
    const handleCancel = handleSheetWindowPointerCancel;
    window.addEventListener("pointermove", handleMove, { passive: false });
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleCancel);
    sheetDragWindowCleanup.current = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleCancel);
    };
  }

  function removeSheetDragWindowListeners() {
    sheetDragWindowCleanup.current?.();
    sheetDragWindowCleanup.current = null;
  }

  function attachPendingContentDragListeners() {
    removePendingContentDragListeners();
    const handleMove = handlePendingContentPointerMove;
    const handleEnd = handlePendingContentPointerEnd;
    window.addEventListener("pointermove", handleMove, { passive: false });
    window.addEventListener("pointerup", handleEnd);
    window.addEventListener("pointercancel", handleEnd);
    pendingContentDragCleanup.current = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleEnd);
      window.removeEventListener("pointercancel", handleEnd);
    };
  }

  function removePendingContentDragListeners() {
    pendingContentDragCleanup.current?.();
    pendingContentDragCleanup.current = null;
  }

  function cleanupPendingContentDrag() {
    removePendingContentDragListeners();
    pendingContentDrag.current = null;
  }

  function recordSheetDragSample(y) {
    const now = performance.now();
    const samples = [...sheetDragSamples.current, { time: now, y }].filter(
      (sample) => now - sample.time <= SHEET_VELOCITY_SAMPLE_MS,
    );
    sheetDragSamples.current = samples;
  }

  function getSheetDragVelocity(endY) {
    const now = performance.now();
    const samples = [...sheetDragSamples.current, { time: now, y: endY }];
    const anchor = samples.find((sample) => now - sample.time <= SHEET_VELOCITY_SAMPLE_MS && now > sample.time);
    if (!anchor) return 0;

    const elapsed = now - anchor.time;
    const distance = endY - anchor.y;
    if (elapsed <= 0 || Math.abs(distance) < SHEET_MIN_VELOCITY_DISTANCE_PX) return 0;

    return distance / elapsed;
  }

  function setPointerCapture(target, pointerId) {
    try {
      target?.setPointerCapture?.(pointerId);
    } catch {
      // Capture can fail if the browser has already canceled the pointer.
    }
  }

  function releasePointerCapture(target, pointerId) {
    try {
      if (target?.hasPointerCapture?.(pointerId)) {
        target.releasePointerCapture(pointerId);
      }
    } catch {
      // Ignore stale pointer ids during cancellation.
    }
  }

  function isInteractiveSheetTarget(target) {
    return Boolean(
      target instanceof Element &&
        target.closest("a, button, input, select, textarea, [role='button'], [contenteditable='true']"),
    );
  }

  const openConnectorCount = filteredStations.reduce((sum, station) => sum + station.availableCount, 0);
  const feedUpdatedLabel = formatFeedTime(feed, selectedCountryConfig);
  const feedbackHref = getFeedbackMailto({
    filterLabel: getActiveFilterLabel(selectedFilters, areaFilters, operatorFilters, connectorTypeFilters, selectedCountryConfig),
    query,
    visibleCount: filteredStations.length,
  });
  const searchNotice =
    hiddenSearchMatchCount > 0 && filteredStations.length === 0
      ? `${formatCompactCount(hiddenSearchMatchCount)} matching chargers are hidden by the current filters.`
      : placeSearchWarning && searchQuery.active && !searchPlace && textSearchMatches.length === 0
        ? placeSearchWarning
        : "";
  const topNotice = locationNotice || searchNotice;
  function clearFilters() {
    updateSelectedFilters(createAllFilterState());
  }

  function toggleQuickFilter(stateKey) {
    updateSelectedFilters((current) => ({
      ...current,
      [stateKey]: !current[stateKey],
    }));
  }

  function toggleAreaFilter(areaId) {
    updateSelectedFilters((current) => ({
      ...current,
      areas: toggleValue(current.areas, areaId),
    }));
  }

  function toggleOperatorFilter(operatorId) {
    updateSelectedFilters((current) => ({
      ...current,
      operators: toggleValue(current.operators, operatorId),
    }));
  }

  function toggleConnectorTypeFilter(connectorTypeId) {
    updateSelectedFilters((current) => ({
      ...current,
      connectorTypes: toggleValue(current.connectorTypes, connectorTypeId),
    }));
  }

  function handleMaxPriceChange(event) {
    const value = event.target.value;
    updateSelectedFilters((current) => ({
      ...current,
      maxPriceKwh: value,
    }));
  }

  function toggleUnknownPrices() {
    updateSelectedFilters((current) => ({
      ...current,
      includeUnknownPrices: !current.includeUnknownPrices,
    }));
  }

  return (
    <main className="app-shell">
      <section className="map-stage" aria-label={`${selectedCountryConfig.label} EV charger map`}>
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
                  {feed.loading ? "Syncing" : selectedCountry === "sg" ? "Live map" : "Weekly map"}
                </span>
              </div>
              <p className="brand-tagline">{selectedCountryConfig.tagline}</p>
              <p className="brand-status">
                {feed.loading
                  ? selectedCountryConfig.loadingLabel
                  : `${filteredStations.length} visible · ${openConnectorCount} ${selectedCountryConfig.availabilitySummaryLabel}`}
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
                className={isLocating ? "icon-button location-button locating" : "icon-button location-button"}
                type="button"
                onClick={handleLocateMe}
                aria-busy={isLocating}
                aria-label="Use my location"
                title="Find chargers near me"
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
              placeholder={selectedCountry === "sg" ? "Search place, area, or provider" : "Search location, state, or network"}
              aria-label="Search charging locations, areas, or providers"
            />
            {query ? (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
                <X size={16} />
              </button>
            ) : null}
          </label>

          <div className="country-toggle prominent-country-toggle" aria-label="Country filter">
            {COUNTRY_OPTIONS.map((country) => (
              <button
                className={selectedCountry === country.id ? "country-toggle-button active" : "country-toggle-button"}
                type="button"
                key={country.id}
                onClick={() => handleCountryChange(country.id)}
                aria-pressed={selectedCountry === country.id}
              >
                <span className="country-flag" aria-hidden="true">{country.flag}</span>
                {country.label}
              </button>
            ))}
          </div>

          <div ref={filterBarRef}>
          <div className="filter-bar" aria-label="Charger filters">
            <div className="filter-quick-chips">
              <UtilityFilterChip
                active={allFiltersActive}
                ariaLabel="Show all chargers and clear selected filters."
                count={utilityFilterCounts.all}
                item={ALL_FILTER}
                onSelect={clearFilters}
              />
              {quickFilters.map((item) => (
                <UtilityFilterChip
                  active={selectedFilters[item.stateKey]}
                  ariaLabel={`${selectedFilters[item.stateKey] ? "Remove" : "Add"} ${item.label} filter.`}
                  count={utilityFilterCounts[item.id]}
                  item={item}
                  key={item.id}
                  onSelect={() => toggleQuickFilter(item.stateKey)}
                />
              ))}
            </div>
            <button
              className={extendedFilterCount > 0 ? "filter-panel-toggle has-filters" : "filter-panel-toggle"}
              type="button"
              onClick={() => setFilterPanelOpen((v) => !v)}
              aria-expanded={filterPanelOpen}
              aria-label="Open area, operator, and connector filters"
            >
              <SlidersHorizontal size={13} aria-hidden="true" />
              More
              {extendedFilterCount > 0 ? <span className="filter-badge">{extendedFilterCount}</span> : null}
            </button>
          </div>

          {filterPanelOpen ? (
            <div className="filter-panel" aria-label="Extended filters">
              {areaFilters.length > 0 ? (
                <div className="filter-section">
                  <span className="filter-section-label">{selectedCountryConfig.areaLabel}</span>
                  <div className="filter-section-chips">
                    {areaFilters.map((item) => (
                      <UtilityFilterChip
                        active={activeAreaIds.has(item.areaId)}
                        ariaLabel={`${activeAreaIds.has(item.areaId) ? "Remove" : "Add"} ${item.label} area filter. ${item.availableCount} ${selectedCountryConfig.availabilitySummaryLabel} across ${item.stationCount} stations.`}
                        count={item.availableCount}
                        item={item}
                        key={item.id}
                        onSelect={() => toggleAreaFilter(item.areaId)}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
              {operatorFilters.length > 0 ? (
                <div className="filter-section">
                  <span className="filter-section-label">Operator</span>
                  <div className="filter-section-chips">
                    {operatorFilters.map((item) => (
                      <OperatorFilterChip
                        active={activeOperatorIds.has(item.id)}
                        item={item}
                        key={item.id}
                        countLabel={selectedCountryConfig.availabilitySummaryLabel}
                        onSelect={() => toggleOperatorFilter(item.id)}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
              {connectorTypeFilters.length > 0 ? (
                <div className="filter-section">
                  <span className="filter-section-label">Connector</span>
                  <div className="filter-section-chips">
                    {connectorTypeFilters.map((item) => (
                      <UtilityFilterChip
                        active={activeConnectorTypeIds.has(item.id)}
                        ariaLabel={`${activeConnectorTypeIds.has(item.id) ? "Remove" : "Add"} ${item.label} connector filter. ${item.stationCount} stations.`}
                        count={item.stationCount}
                        item={item}
                        key={item.id}
                        onSelect={() => toggleConnectorTypeFilter(item.id)}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="filter-section">
                <span className="filter-section-label">Price</span>
                <div className="price-filter-row">
                  <label className="price-input">
                    <span>{hasKnownPrices ? `Max ${priceCurrencyPrefix}/kWh` : `${priceCurrencyPrefix}/kWh unavailable`}</span>
                    <small>
                      {hasKnownPrices
                        ? `Current max ${priceCurrencyPrefix}${formatPriceAmount(priceStats.max)}/kWh`
                        : "No current price data"}
                    </small>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={selectedFilters.maxPriceKwh}
                      onChange={handleMaxPriceChange}
                      placeholder={hasKnownPrices ? formatPriceAmount(priceStats.max) : "No data"}
                      disabled={!hasKnownPrices}
                    />
                  </label>
                  <label className="unknown-price-toggle">
                    <input
                      type="checkbox"
                      checked={selectedFilters.includeUnknownPrices}
                      onChange={toggleUnknownPrices}
                    />
                    Include unknown prices
                  </label>
                </div>
                {selectedCountry === "my" ? (
                  <p className="filter-note">MEVnet does not publish tariff fields, so no current max RM/kWh can be shown.</p>
                ) : null}
              </div>
            </div>
          ) : null}
          </div>

          {topNotice ? <div className="location-notice">{topNotice}</div> : null}
        </div>

        <MapContainer
          key={selectedCountry}
          center={selectedCountryConfig.center}
          zoom={selectedCountryConfig.zoom}
          minZoom={selectedCountryConfig.minZoom}
          maxZoom={18}
          zoomControl={false}
          scrollWheelZoom
          className="charger-map"
        >
          <MapBridge mapRef={mapRef} onCenterChange={handleMapCenterChange} onBoundsChange={handleBoundsChange} />
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ClusterLayer
            stations={viewportStations}
            selectedStationId={selectedStation?.id}
            onSelectStation={selectStation}
          />
          {userLocation ? (
            <Marker position={userLocation} icon={USER_ICON} zIndexOffset={1000}>
              <Popup>
                <strong>Your location</strong>
                {formatAccuracyMeters(userLocationAccuracy) ? <span>Accuracy {formatAccuracyMeters(userLocationAccuracy)}</span> : null}
              </Popup>
            </Marker>
          ) : null}
          {searchPlace ? (
            <Marker position={[searchPlace.latitude, searchPlace.longitude]} icon={SEARCH_PLACE_ICON}>
              <Popup>{searchPlace.label}</Popup>
            </Marker>
          ) : null}
        </MapContainer>
      </section>

      <section
        ref={sheetRef}
        className={`bottom-sheet sheet-${sheetMode}`}
        aria-label="Charger details and results"
        onPointerDown={sheetMode === "collapsed" ? handleCollapsedSheetPointerDown : undefined}
      >
        <button
          className="sheet-handle"
          type="button"
          onClick={toggleSheetMode}
          onPointerDown={handleSheetPointerDown}
          aria-expanded={sheetMode === "expanded"}
          aria-label={sheetMode === "expanded" ? "Collapse charger details" : "Expand charger details"}
        >
          <span className="sheet-handle-bar" aria-hidden="true" />
          {sheetMode === "collapsed" ? <ChevronsUp className="sheet-swipe-cue" size={18} aria-hidden="true" /> : null}
        </button>

        <div ref={sheetContentRef} className="sheet-content" onPointerDown={handleContentPointerDown}>
          <div className="panel-kicker">
            <span>
              <PlugZap size={15} aria-hidden="true" />
              Charge board
            </span>
            <span>{feedUpdatedLabel}</span>
          </div>

          {selectedStation ? <CompactStationSummary station={selectedStation} /> : null}

          {feed.warning ? <div className="feed-warning">{feed.warning}</div> : null}

          {selectedStation ? (
            <StationDetail station={selectedStation} />
          ) : (
            <div className="empty-state">
              <CircleDot size={22} />
              <p>
                {hiddenSearchMatchCount > 0
                  ? `${formatCompactCount(hiddenSearchMatchCount)} matching chargers are hidden by the current filters.`
                  : placeSearchStatus === "loading"
                    ? "Looking up that place."
                    : "No matching chargers found."}
              </p>
              {hiddenSearchMatchCount > 0 ? (
                <button className="show-more-button empty-action" type="button" onClick={clearFilters}>
                  Clear filters
                </button>
              ) : null}
            </div>
          )}

          <div className="nearby-header">
            <span>{selectedCountryConfig.resultHeader}</span>
            <span>{resultSummary}</span>
          </div>

          <div className="station-list">
            {visibleRankedStations.map(({ station, distanceMeters }) => {
              const distanceLabel = distanceSourceLabel ? formatDistanceMeters(distanceMeters) : "";

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
                    {distanceLabel ? <span className="row-distance">{distanceLabel} from {distanceSourceLabel}</span> : null}
                    <b>{formatStationAvailability(station)}</b>
                  </div>
                </button>
              );
            })}

          </div>

          {hasMultipleResultPages ? (
            <div className="pagination-footer" aria-label="Available charger result pages">
              <button
                type="button"
                className="pagination-button"
                onClick={() => handleResultPageChange(clampedResultPage - 1)}
                disabled={clampedResultPage <= 1}
                aria-label="Previous charger results page"
              >
                <ChevronLeft size={17} />
              </button>
              <span className="pagination-status">
                Page {clampedResultPage} of {pageCount}
              </span>
              <button
                type="button"
                className="pagination-button"
                onClick={() => handleResultPageChange(clampedResultPage + 1)}
                disabled={clampedResultPage >= pageCount}
                aria-label="Next charger results page"
              >
                <ChevronRight size={17} />
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
    sg: null,
    my: null,
    warning: "",
  });

  useEffect(() => {
    let mounted = true;

    async function loadSourceInfo() {
      const results = await Promise.allSettled([
        fetchSourceInfo("sg"),
        fetchSourceInfo("my"),
      ]);

      if (!mounted) return;

      const sg = results[0].status === "fulfilled" ? results[0].value : null;
      const my = results[1].status === "fulfilled" ? results[1].value : null;
      const warnings = results
        .filter((result) => result.status === "rejected")
        .map((result) => result.reason?.message || "Unable to load source status.");
      if (sg?.warning) warnings.push(sg.warning);
      if (my?.warning) warnings.push(my.warning);

      setSourceInfo({
        loading: false,
        sg,
        my,
        warning: warnings.join(" "),
      });
    }

    loadSourceInfo();

    return () => {
      mounted = false;
    };
  }, []);

  const ltaUpdateTime = sourceInfo.sg?.updatedAtLabel || formatFeedTimeValue(sourceInfo.sg?.updatedAt);
  const mevnetUpdateTime = sourceInfo.my?.updatedAtLabel || formatFeedTimeValue(sourceInfo.my?.updatedAt);
  const sgServerRefreshLabel = sourceInfo.sg?.cache?.refreshedAt ? formatSourceTimestamp(sourceInfo.sg.cache.refreshedAt) : "Not available";
  const myServerRefreshLabel = sourceInfo.my?.cache?.refreshedAt ? formatSourceTimestamp(sourceInfo.my.cache.refreshedAt) : "Not available";
  const sgCacheExpiryLabel = sourceInfo.sg?.cache?.expiresAt ? formatSourceTimestamp(sourceInfo.sg.cache.expiresAt) : "At the next 5-minute slot";
  const myCacheExpiryLabel = sourceInfo.my?.cache?.expiresAt ? formatSourceTimestamp(sourceInfo.my.cache.expiresAt) : "At the next weekly refresh";

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
          <span>Singapore source</span>
          <strong>{sourceInfo.loading ? "Checking" : sourceInfo.sg?.sourceLabel || "Unknown"}</strong>
        </div>
        <div>
          <span>LTA DataMall update</span>
          <strong>{ltaUpdateTime}</strong>
        </div>
        <div>
          <span>Singapore refresh</span>
          <strong>{sgServerRefreshLabel}</strong>
        </div>
        <div>
          <span>Malaysia source</span>
          <strong>{sourceInfo.loading ? "Checking" : sourceInfo.my?.sourceLabel || "Unknown"}</strong>
        </div>
        <div>
          <span>MEVnet source date</span>
          <strong>{mevnetUpdateTime}</strong>
        </div>
        <div>
          <span>Malaysia refresh</span>
          <strong>{myServerRefreshLabel}</strong>
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
          Malaysia locations come from PLANMalaysia's MEVnet ArcGIS FeatureServer. MEVnet includes public existing and
          proposed charging bay locations, state, local authority, AC/DC counts, indoor/outdoor fields, and provider-network counts.
        </p>
      </section>

      <section className="info-section">
        <div className="info-section-heading">
          <Clock size={19} />
          <h2>Freshness model</h2>
        </div>
        <ul>
          <li>Singapore's visible timestamp is the LTA DataMall batch update time, not the time your browser loaded the page.</li>
          <li>Singapore data refreshes every 5 min, aligned to LTA's documented update cadence.</li>
          <li>Malaysia data is cached by BoCharge for 7 days. MEVnet describes its source updates as monthly/manual and subject to data availability.</li>
          <li>Singapore API cache expiry: {sgCacheExpiryLabel}.</li>
          <li>Malaysia API cache expiry: {myCacheExpiryLabel}.</li>
        </ul>
      </section>

      <section className="info-section">
        <div className="info-section-heading">
          <PlugZap size={19} />
          <h2>Reliability notes</h2>
        </div>
        <ul>
          <li>Availability can lag real-world charger usage because operators and LTA update the feed asynchronously.</li>
          <li>Malaysia MEVnet records are not real-time plug availability; the app labels them as existing or proposed.</li>
          <li>MEVnet does not publish tariff fields, so Malaysia price filtering treats those records as unknown price.</li>
          <li>Provider apps remain the best confirmation point before driving to a charger.</li>
          <li>If a live LTA refresh fails, the app can keep showing the last successful cached LTA payload.</li>
          <li>If no LTA key is configured, Singapore falls back to a bundled snapshot and labels it as sample data.</li>
        </ul>
      </section>

      <section className="info-section">
        <div className="info-section-heading">
          <MapPin size={19} />
          <h2>Derived fields</h2>
        </div>
        <p>
          Singapore area filters such as North, South, East, West, and Central are derived from charger coordinates.
          Malaysia state filters use the `state` field published by MEVnet.
        </p>
      </section>
    </main>
  );
}

async function fetchSourceInfo(country) {
  const response = await fetch(`/api/chargers?country=${encodeURIComponent(country)}`);
  if (!response.ok) throw new Error(`${country.toUpperCase()} API returned ${response.status}`);
  const payload = await response.json();

  return {
    sourceLabel: payload.sourceLabel || (country === "my" ? "PLANMalaysia MEVnet" : "LTA DataMall"),
    warning: payload.warning || "",
    updatedAt: payload.updatedAt || payload.lastUpdatedTime || "",
    updatedAtLabel: payload.updatedAtLabel || "",
    cache: payload.cache || null,
  };
}

function getInitialSheetMode() {
  if (typeof window === "undefined") return "expanded";

  return window.matchMedia(MOBILE_SHEET_QUERY).matches ? "collapsed" : "expanded";
}

function MapBridge({ mapRef, onCenterChange, onBoundsChange }) {
  const map = useMap();

  useEffect(() => {
    mapRef.current = map;
  }, [map, mapRef]);

  useEffect(() => {
    function syncState() {
      const center = map.getCenter();
      onCenterChange([center.lat, center.lng]);
      onBoundsChange(map.getBounds());
    }

    syncState();
    map.on("moveend zoomend", syncState);

    return () => {
      map.off("moveend zoomend", syncState);
    };
  }, [map, onCenterChange, onBoundsChange]);

  return null;
}

function ClusterLayer({ stations, selectedStationId, onSelectStation }) {
  const map = useMap();
  const clusterGroupRef = useRef(null);

  useEffect(() => {
    const clusterGroup = L.markerClusterGroup({
      disableClusteringAtZoom: 14,
      spiderfyOnMaxZoom: false,
      spiderifyOnMaxZoom: false,
      maxClusterRadius: 60,
      iconCreateFunction(cluster) {
        const count = cluster.getChildCount();
        return L.divIcon({
          className: "cluster-marker",
          html: `<span class="cluster-pin">${count}</span>`,
          iconSize: [40, 40],
          iconAnchor: [20, 20],
        });
      },
    });

    map.addLayer(clusterGroup);
    clusterGroupRef.current = clusterGroup;

    return () => {
      map.removeLayer(clusterGroup);
    };
  }, [map]);

  useEffect(() => {
    const clusterGroup = clusterGroupRef.current;
    if (!clusterGroup) return;

    clusterGroup.clearLayers();

    const markers = stations.map((station) => {
      const marker = L.marker([station.latitude, station.longitude], {
        icon: createStationIcon(station, station.id === selectedStationId),
      });
      marker.on("click", () => onSelectStation(station));
      return marker;
    });

    if (markers.length > 0) {
      clusterGroup.addLayers(markers);
    }
  }, [stations, selectedStationId, onSelectStation]);

  return null;
}

function StationDetail({ station }) {
  const providers = station.providers?.length ? station.providers : [station.provider];
  const appProviderName = providers.find((providerName) => canOpenProviderApp(providerName)) || station.provider;
  const providerProfile = getProviderProfile(appProviderName);
  const providerAppTarget = getProviderAppTarget(appProviderName);
  const bestPlug = station.plugTypes[0];
  const isMalaysia = station.country === "my";

  return (
    <article className="detail-card">
      <div className="detail-heading">
        <div>
          <div className="provider-line">
            <ProviderBadges providers={providers} />
            <StatusPill status={station.status} label={station.availabilityLabel} />
          </div>
          <h2>{station.name}</h2>
          <p>{station.address}</p>
        </div>
      </div>

      <div className="detail-grid">
        <Metric label={isMalaysia ? "Existing bays" : "Open plugs"} value={`${station.availableCount}/${station.totalCount}`} />
        <Metric
          label={isMalaysia ? "AC/DC" : "Max speed"}
          value={isMalaysia ? `${station.acCount || 0}/${station.dcCount || 0}` : station.maxPowerKw ? `${station.maxPowerKw} kW` : "TBC"}
        />
        <Metric label={isMalaysia ? "Status" : "Plug"} value={isMalaysia ? station.availabilityLabel || "TBC" : bestPlug?.plugType || "TBC"} />
      </div>

      <div className="detail-meta">
        <span>
          <MapPin size={15} />
          {station.position || station.operationHours || (isMalaysia ? "MEVnet public planning dataset" : "Open status follows provider feed")}
        </span>
        {bestPlug?.price ? (
          <span>
            <BatteryCharging size={15} />
            {bestPlug.priceType ? `$${bestPlug.price}/${bestPlug.priceType}` : `$${bestPlug.price}`}
          </span>
        ) : station.priceKnown === false ? (
          <span>
            <Info size={15} />
            Price unavailable
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

        {!isMalaysia && providerAppTarget.available ? (
          <button className="secondary-action" type="button" onClick={() => openProviderApp(appProviderName)}>
            <ExternalLink size={18} />
            Open {providerProfile.appName}
          </button>
        ) : !isMalaysia ? (
          <div className="provider-unavailable">
            <button className="secondary-action unavailable" type="button" disabled>
              <Info size={18} />
              App link unavailable
            </button>
            <p>{providerAppTarget.unavailableMessage}</p>
          </div>
        ) : null}
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

function OperatorFilterChip({ item, active, onSelect, countLabel = "open plugs" }) {
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
      aria-label={`${active ? "Remove" : "Add"} operator ${item.operatorName} filter. ${item.availableCount} ${countLabel} across ${item.stationCount} stations.`}
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
        <span className="operator-chip-count">{formatCompactCount(item.availableCount)} {countLabel}</span>
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

function CompactStationSummary({ station }) {
  const providers = station.providers?.length ? station.providers : [station.provider];
  const price = getStationPriceKwh(station);
  const isMalaysia = station.country === "my";
  const currencyLabel = station.priceCurrency === "MYR" ? "RM" : "S$";
  const priceLabel =
    price != null
      ? `${currencyLabel}${price.toFixed(2)}/kWh`
      : station.priceKnown === false
        ? "Price unknown"
        : "Price TBC";
  const speedLabel = isMalaysia
    ? `${station.acCount || 0} AC / ${station.dcCount || 0} DC`
    : station.maxPowerKw
      ? `${station.maxPowerKw} kW`
      : station.plugTypes[0]?.plugType || "Plug TBC";
  const countLabel = isMalaysia
    ? formatStationAvailability(station)
    : `${formatCompactCount(station.availableCount)}/${formatCompactCount(station.totalCount)} open`;

  return (
    <div className="compact-station-summary" aria-label={`Selected charger: ${station.name}`}>
      <div className="compact-station-topline">
        <ProviderBadges providers={providers} compact />
        <StatusPill status={station.status} label={station.availabilityLabel} />
      </div>
      <strong>{station.name}</strong>
      <span>{[countLabel, speedLabel, priceLabel].filter(Boolean).join(" · ")}</span>
    </div>
  );
}

function StatusPill({ status, label }) {
  const labels = {
    available: "Open",
    occupied: "In use",
    offline: "Offline",
    unknown: "Unknown",
  };

  return <span className={`status-pill ${status}`}>{label || labels[status] || "Unknown"}</span>;
}

function createStationIcon(station, selected) {
  const providerProfile = getProviderProfile(station.provider);
  const unknownProviderKey =
    providerProfile.key === "unknown" ? `${station.providerLabel || station.provider}-${station.providerInitials || ""}` : "";
  const key = `${providerProfile.key}-${unknownProviderKey}-${station.status}-${selected ? 1 : 0}`;
  if (iconCache.has(key)) return iconCache.get(key);

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

  const icon = L.divIcon({
    className: "station-marker",
    html: `<span class="${className}" style="${inlineStyle}" title="${escapeAttribute(station.providerLabel || providerProfile.shortName)}">${markerContent}<span class="pin-status pin-status-${station.status}"></span></span>`,
    iconSize: selected ? [36, 36] : [28, 28],
    iconAnchor: selected ? [18, 18] : [14, 14],
  });
  iconCache.set(key, icon);
  return icon;
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

function getActiveFilterLabel(filters, areaFilters, operatorFilters, connectorTypeFilters, countryConfig = COUNTRY_CONFIGS.sg) {
  const labels = [];

  if (filters.availableOnly) labels.push(countryConfig.availabilityFilterLabel);
  if (filters.fastOnly) labels.push("Fast");
  if (filters.maxPriceKwh) labels.push(`Max ${filters.maxPriceKwh}/kWh`);
  if (!filters.includeUnknownPrices) labels.push("Known prices only");

  filters.areas.forEach((areaId) => {
    const areaFilter = areaFilters.find((item) => item.areaId === areaId);
    if (areaFilter) labels.push(areaFilter.label);
  });

  filters.operators.forEach((operatorId) => {
    const operatorFilter = operatorFilters.find((item) => item.id === operatorId);
    if (operatorFilter) labels.push(operatorFilter.label);
  });

  filters.connectorTypes.forEach((connectorTypeId) => {
    const connectorTypeFilter = connectorTypeFilters.find((item) => item.id === connectorTypeId);
    if (connectorTypeFilter) labels.push(connectorTypeFilter.label);
  });

  return labels.length > 0 ? labels.join(" + ") : "All";
}

function createDefaultFilterState() {
  return {
    availableOnly: true,
    fastOnly: false,
    areas: [],
    operators: [],
    connectorTypes: [],
    maxPriceKwh: "",
    includeUnknownPrices: true,
  };
}

function createAllFilterState() {
  return {
    availableOnly: false,
    fastOnly: false,
    areas: [],
    operators: [],
    connectorTypes: [],
    maxPriceKwh: "",
    includeUnknownPrices: true,
  };
}

function applyAreaFilter(filters, areaId) {
  if (filters.areas.length === 1 && filters.areas[0] === areaId) return filters;

  return {
    ...filters,
    areas: [areaId],
  };
}

function hasActiveFilters(filters) {
  return Boolean(
    filters.availableOnly ||
      filters.fastOnly ||
      filters.areas.length > 0 ||
      filters.operators.length > 0 ||
      filters.connectorTypes.length > 0 ||
      filters.maxPriceKwh ||
      !filters.includeUnknownPrices,
  );
}

function stationPassesFilters(station, selectedFilters, activeAreaIds, activeOperatorIds, activeConnectorTypeIds, country = "sg") {
  const matchesAvailability = !selectedFilters.availableOnly || stationMatchesPrimaryAvailability(station, country);
  const matchesSpeed = !selectedFilters.fastOnly || station.maxPowerKw >= 43;
  const matchesArea = activeAreaIds.size === 0 || activeAreaIds.has(getStationArea(station, country).id);
  const matchesOperator = activeOperatorIds.size === 0 || hasProviderFilterId(station, activeOperatorIds);
  const matchesConnectorType =
    !activeConnectorTypeIds || activeConnectorTypeIds.size === 0 || hasConnectorTypeFilterId(station, activeConnectorTypeIds);
  const matchesPrice = stationPassesPriceFilter(station, selectedFilters);

  return matchesAvailability && matchesSpeed && matchesArea && matchesOperator && matchesConnectorType && matchesPrice;
}

function stationMatchesPrimaryAvailability(station, country = "sg") {
  if (country === "my") return station.lifecycleStatus === "existing" || station.availableCount > 0;
  return station.availableCount > 0;
}

function stationPassesPriceFilter(station, selectedFilters) {
  const price = getStationPriceKwh(station);
  const maxPrice = Number.parseFloat(selectedFilters.maxPriceKwh);
  const hasMaxPrice = selectedFilters.maxPriceKwh !== "" && Number.isFinite(maxPrice);

  if (price == null) return selectedFilters.includeUnknownPrices;
  if (!hasMaxPrice) return true;

  return price <= maxPrice;
}

function buildPriceStats(stations) {
  const prices = stations.map(getStationPriceKwh).filter((price) => price != null);

  return {
    knownCount: prices.length,
    min: prices.length > 0 ? Math.min(...prices) : null,
    max: prices.length > 0 ? Math.max(...prices) : null,
  };
}

function formatPriceAmount(value) {
  if (!Number.isFinite(value)) return "";
  return value.toFixed(2);
}

function formatStationAvailability(station) {
  if (station.country === "my") {
    if (station.lifecycleStatus === "existing") return `${formatCompactCount(station.availableCount)} existing`;
    return `${formatCompactCount(station.totalCount)} proposed`;
  }

  return `${formatCompactCount(station.availableCount)} open`;
}

function toggleValue(values, value) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function formatFeedTime(feed, countryConfig = COUNTRY_CONFIGS.sg) {
  const value = feed.updatedAtLabel || formatFeedTimeValue(feed.updatedAt);
  return `${countryConfig.feedPrefix} ${value}`;
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

function getRefreshDelayMs(country = "sg", intervalMs = CLIENT_REFRESH_MS) {
  if (country === "sg") return getMsUntilNextRefreshBoundary(Date.now(), intervalMs);

  return intervalMs;
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

function buildAreaFilterOptions(stations, country = "sg") {
  if (country === "my") return buildMalaysiaStateFilterOptions(stations);

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
    const area = getStationArea(station, country);
    const existing = areaStats.get(area.id);
    if (!existing) return;

    existing.stationCount += 1;
    existing.availableCount += station.availableCount;
    existing.totalCount += station.totalCount;
  });

  return AREA_FILTERS.map((area) => areaStats.get(area.id)).filter((area) => area.stationCount > 0);
}

function buildMalaysiaStateFilterOptions(stations) {
  const areaStats = new Map();

  stations.forEach((station) => {
    const area = getStationArea(station, "my");
    const existing = areaStats.get(area.id);

    if (existing) {
      existing.stationCount += 1;
      existing.availableCount += station.availableCount;
      existing.totalCount += station.totalCount;
      return;
    }

    areaStats.set(area.id, {
      id: `area:${area.id}`,
      areaId: area.id,
      label: area.label,
      color: "#0f4c81",
      textColor: "#ffffff",
      stationCount: 1,
      availableCount: station.availableCount,
      totalCount: station.totalCount,
    });
  });

  return [...areaStats.values()].sort((a, b) => b.availableCount - a.availableCount || a.label.localeCompare(b.label));
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

function getStationArea(station, country = "sg") {
  if (country === "my") {
    const label = station.state || station.region || "Unknown state";
    return { id: normalizeAreaFilterValue(label), label };
  }

  const latDelta = station.latitude - AREA_CENTER.latitude;
  const lngDelta = station.longitude - AREA_CENTER.longitude;
  const centralLatSpan = 0.035;
  const centralLngSpan = 0.045;
  const inDowntownCore =
    station.latitude >= 1.265 &&
    station.latitude <= 1.305 &&
    station.longitude >= 103.84 &&
    station.longitude <= 103.875;

  if (inDowntownCore || (Math.abs(latDelta) <= centralLatSpan && Math.abs(lngDelta) <= centralLngSpan)) {
    return { id: "central", label: "Central" };
  }

  const latitudeWeight = Math.abs(latDelta) / 0.09;
  const longitudeWeight = Math.abs(lngDelta) / 0.13;

  if (latitudeWeight >= longitudeWeight) {
    return latDelta >= 0 ? { id: "north", label: "North" } : { id: "south", label: "South" };
  }

  return lngDelta >= 0 ? { id: "east", label: "East" } : { id: "west", label: "West" };
}

function normalizeAreaFilterValue(value) {
  return String(value || "unknown")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "unknown";
}

function hasProviderFilterId(station, operatorIds) {
  const providerNames = uniqueProviderNames(station.providers?.length ? station.providers : [station.provider]);

  return providerNames.some((name) => operatorIds.has(`operator:${normalizeOperatorFilterValue(name)}`));
}

function hasConnectorTypeFilterId(station, connectorTypeIds) {
  return station.plugTypes.some((plug) => {
    const normalized = normalizeConnectorTypeValue(plug.plugType);
    return normalized && connectorTypeIds.has(`connector:${normalized}`);
  });
}

function buildConnectorTypeFilterOptions(stations) {
  const connectors = new Map();

  stations.forEach((station) => {
    const seenForStation = new Set();

    station.plugTypes.forEach((plug) => {
      const normalized = normalizeConnectorTypeValue(plug.plugType);
      if (!normalized || seenForStation.has(normalized)) return;
      seenForStation.add(normalized);

      const id = `connector:${normalized}`;
      const existing = connectors.get(id);

      if (existing) {
        existing.stationCount += 1;
        existing.availableCount += station.availableCount;
        return;
      }

      connectors.set(id, {
        id,
        label: formatConnectorTypeLabel(plug.plugType),
        Icon: Cable,
        color: connectorTypeColor(normalized),
        textColor: "#ffffff",
        stationCount: 1,
        availableCount: station.availableCount,
      });
    });
  });

  return [...connectors.values()].sort((a, b) => b.stationCount - a.stationCount || a.label.localeCompare(b.label));
}

function normalizeConnectorTypeValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function formatConnectorTypeLabel(value) {
  const raw = String(value || "").trim();
  if (!raw) return "Unknown";

  return raw
    .replace(/\btype\s*(\d)/i, "Type $1")
    .replace(/\bccs\s*(\d?)/i, (_, n) => (n ? `CCS${n}` : "CCS"))
    .replace(/\bchademo\b/i, "CHAdeMO")
    .replace(/\bgbt\b/i, "GB/T")
    .replace(/\btesla\b/i, "Tesla")
    .replace(/\bnacs\b/i, "NACS")
    .replace(/\bac\b/i, "AC")
    .replace(/\bdc\b/i, "DC")
    .trim();
}

function connectorTypeColor(normalized) {
  if (/ccs/.test(normalized)) return "#7c3aed";
  if (/chademo/.test(normalized)) return "#b45309";
  if (/type\s*2|type2/.test(normalized)) return "#0f4c81";
  if (/type\s*1|type1/.test(normalized)) return "#17875a";
  if (/gbt|gb/.test(normalized)) return "#c2410c";
  if (/tesla|nacs/.test(normalized)) return "#1d1d1d";
  return "#334155";
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

function getNearbyStationCandidates(stations, origin) {
  const ranked = rankStationsByDistance(origin, stations);
  const nearby = ranked.filter((item) => item.distanceMeters <= PLACE_SEARCH_RADIUS_METERS);

  return (nearby.length >= RESULT_PAGE_SIZE ? nearby : ranked.slice(0, RESULT_PAGE_SIZE * 3)).map((item) => item.station);
}

function rankStationsByDistance(origin, stations, searchScoreById = null) {
  return stations
    .map((station) => ({
      station,
      distanceMeters: getDistanceMeters(origin, [station.latitude, station.longitude]),
      searchScore: searchScoreById?.get(station.id) || 0,
    }))
    .sort((a, b) => {
      if (a.searchScore !== b.searchScore) return b.searchScore - a.searchScore;
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

function getLocationErrorMessage(error) {
  if (error?.code === 1) return "Location permission is blocked. Enable browser location to find the nearest charger.";
  if (error?.code === 3) return "Location timed out. Try again or check that precise location is enabled.";

  return "Location unavailable. Enable browser location to find the nearest charger.";
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
