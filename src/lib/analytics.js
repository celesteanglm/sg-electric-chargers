const BUILD_GA_MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID?.trim();
const ANALYTICS_CONFIG_ENDPOINT = "/api/config";
const GA_SCRIPT_ID = "google-analytics-gtag";

let initialized = false;
let measurementId = BUILD_GA_MEASUREMENT_ID || "";
let measurementIdPromise = null;

export async function initAnalytics() {
  const nextMeasurementId = await resolveMeasurementId();
  if (!nextMeasurementId || typeof window === "undefined" || typeof document === "undefined") return false;

  window.dataLayer = window.dataLayer || [];
  window.gtag =
    window.gtag ||
    function gtag() {
      window.dataLayer.push(arguments);
    };

  if (!document.getElementById(GA_SCRIPT_ID)) {
    const script = document.createElement("script");
    script.async = true;
    script.id = GA_SCRIPT_ID;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(nextMeasurementId)}`;
    document.head.appendChild(script);
  }

  if (!initialized) {
    window.gtag("js", new Date());
    window.gtag("config", nextMeasurementId, { send_page_view: false });
    initialized = true;
  }

  return true;
}

export function trackPageView(path) {
  void sendPageView(path);
}

async function sendPageView(path) {
  if (!(await initAnalytics())) return;

  window.gtag("event", "page_view", {
    page_path: path || `${window.location.pathname}${window.location.search}`,
    page_location: window.location.href,
    page_title: document.title,
  });
}

async function resolveMeasurementId() {
  if (measurementId) return measurementId;
  if (typeof window === "undefined") return "";
  if (!measurementIdPromise) measurementIdPromise = fetchRuntimeMeasurementId();

  measurementId = await measurementIdPromise;
  return measurementId;
}

async function fetchRuntimeMeasurementId() {
  try {
    const response = await fetch(ANALYTICS_CONFIG_ENDPOINT, {
      cache: "no-store",
      credentials: "same-origin",
    });

    if (!response.ok) return "";

    const config = await response.json();
    return String(config?.analytics?.gaMeasurementId || "").trim();
  } catch {
    return "";
  }
}
