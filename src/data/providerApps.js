const PROVIDERS = [
  {
    key: "sp",
    shortName: "SP",
    appName: "SP App",
    markerLabel: "SP",
    brandColor: "#17875a",
    brandTextColor: "#ffffff",
    assetSourceUrl: "https://www.spdigital.sg/spapp/ev-charging",
    matches: ["sp", "singapore power", "sp group"],
    appleId: "596749130",
    androidPackage: "sg.com.singaporepower.spservices",
    appStore: "https://apps.apple.com/sg/app/sp-rethink-green/id596749130",
    playStore: "https://play.google.com/store/apps/details?id=sg.com.singaporepower.spservices",
    website: "https://www.spgroup.com.sg/for-individuals/electric-vehicle-charging",
  },
  {
    key: "shell",
    shortName: "Shell",
    appName: "Shell Recharge Asia",
    markerLabel: "Shell",
    brandColor: "#ffd33d",
    brandTextColor: "#17201c",
    logoSrc: "/provider-logos/shell.svg",
    logoAlt: "Shell",
    assetSourceUrl: "https://eve.com.sg/hubfs/shell-logo-light.svg",
    matches: ["shell", "shell recharge"],
    appleId: "6458189524",
    androidPackage: "com.zecosystems.shellrechargeasia",
    appStore: "https://apps.apple.com/sg/app/shell-recharge-asia/id6458189524",
    playStore: "https://play.google.com/store/apps/details?id=com.zecosystems.shellrechargeasia",
    website: "https://www.shell.com.sg/motorists/shell-recharge.html",
  },
  {
    key: "chargeplus",
    shortName: "C+",
    appName: "CHARGE+ App",
    markerLabel: "C+",
    brandColor: "#0d8d7a",
    brandTextColor: "#ffffff",
    assetSourceUrl: "https://eve.com.sg/",
    matches: ["charge+", "charge plus", "chargeplus"],
    appleId: "1481750244",
    androidPackage: "com.chargeplus.chargeapp",
    appStore: "https://apps.apple.com/sg/app/charge/id1481750244",
    playStore: "https://play.google.com/store/apps/details?id=com.chargeplus.chargeapp",
    website: "https://chargeplus.com",
  },
  {
    key: "cdg",
    shortName: "CDG",
    appName: "CDG Zig",
    markerLabel: "CDG",
    brandColor: "#1b65c9",
    brandTextColor: "#ffffff",
    assetSourceUrl: "https://eve.com.sg/",
    matches: ["cdg", "comfortdelgro", "engie"],
    appleId: "954951647",
    androidPackage: "com.codigo.comfort",
    appStore: "https://apps.apple.com/sg/app/cdg-zig-taxis-cars/id954951647",
    playStore: "https://play.google.com/store/apps/details?id=com.codigo.comfort",
    website: "https://www.cdgtaxi.com.sg/cdg-zig/",
  },
  {
    key: "strides",
    shortName: "SY",
    appName: "Strides YTL",
    markerLabel: "SY",
    brandColor: "#134e8a",
    brandTextColor: "#ffffff",
    matches: ["strides ytl", "strides"],
    website: "https://www.google.com/search?q=Strides+YTL+EV+charging+Singapore",
  },
  {
    key: "kigo",
    shortName: "Kigo",
    appName: "Kigo App",
    markerLabel: "Kigo",
    brandColor: "#5b48d6",
    brandTextColor: "#ffffff",
    logoSrc: "/provider-logos/kigo.png",
    logoAlt: "Kigo",
    assetSourceUrl: "https://www.kigo.app/",
    matches: ["kigo", "eigen"],
    appleId: "1616117249",
    androidPackage: "app.kigo.customer",
    appStore: "https://apps.apple.com/sg/app/kigo-app/id1616117249",
    playStore: "https://play.google.com/store/apps/details?id=app.kigo.customer",
    website: "https://kigo.app",
  },
  {
    key: "volt",
    shortName: "Volt",
    appName: "Volt EV Charging",
    markerLabel: "Volt",
    brandColor: "#e84486",
    brandTextColor: "#ffffff",
    logoSrc: "/provider-logos/volt.png",
    logoAlt: "Volt",
    assetSourceUrl: "https://www.keppelvolt.com/about/",
    matches: ["volt"],
    appleId: "1606309147",
    appStore: "https://apps.apple.com/sg/app/volt-ev-charging/id1606309147",
    website: "https://www.volt.sg",
  },
  {
    key: "tesla",
    shortName: "Tesla",
    appName: "Tesla",
    markerLabel: "T",
    brandColor: "#d32232",
    brandTextColor: "#ffffff",
    assetSourceUrl: "https://www.tesla.com/en_sg/supercharger",
    matches: ["tesla"],
    appleId: "582007913",
    androidPackage: "com.teslamotors.tesla",
    appStore: "https://apps.apple.com/sg/app/tesla/id582007913",
    playStore: "https://play.google.com/store/apps/details?id=com.teslamotors.tesla",
    website: "https://www.tesla.com/en_sg/supercharger",
  },
  {
    key: "mnl",
    shortName: "MNL",
    appName: "MNL Solutions",
    markerLabel: "MNL",
    brandColor: "#5f6f69",
    brandTextColor: "#ffffff",
    matches: ["mnl solutions", "mnl"],
    website: "https://www.google.com/search?q=MNL+Solutions+EV+charging+Singapore",
  },
  {
    key: "evmobility",
    shortName: "EVM",
    appName: "EV Mobility",
    markerLabel: "EVM",
    brandColor: "#2563eb",
    brandTextColor: "#ffffff",
    matches: ["ev mobility"],
    website: "https://www.google.com/search?q=EV+Mobility+EV+charging+Singapore",
  },
  {
    key: "fastparkncharge",
    shortName: "FPC",
    appName: "FastParkNCharge",
    markerLabel: "FPC",
    brandColor: "#f97316",
    brandTextColor: "#17201c",
    matches: ["fastparkncharge", "fast park n charge", "fast park ncharge"],
    website: "https://www.google.com/search?q=FastParkNCharge+EV+charging+Singapore",
  },
  {
    key: "ked",
    shortName: "KED",
    appName: "KED Energy",
    markerLabel: "KED",
    brandColor: "#0f766e",
    brandTextColor: "#ffffff",
    matches: ["ked energy"],
    website: "https://www.google.com/search?q=KED+Energy+EV+charging+Singapore",
  },
  {
    key: "novowatt",
    shortName: "Novo",
    appName: "Novowatt",
    markerLabel: "Novo",
    brandColor: "#7c3aed",
    brandTextColor: "#ffffff",
    matches: ["novowatt", "novo watt"],
    website: "https://www.google.com/search?q=Novowatt+EV+charging+Singapore",
  },
  {
    key: "stengineering",
    shortName: "ST",
    appName: "ST Engineering Urban Solutions",
    markerLabel: "ST",
    brandColor: "#0f4c81",
    brandTextColor: "#ffffff",
    matches: ["st engineering urban solutions", "st engineering", "ste urban solutions"],
    website: "https://www.stengg.com/en/urban-solutions/",
  },
  {
    key: "evone",
    shortName: "EV1",
    appName: "EVOne Charging",
    markerLabel: "EV1",
    brandColor: "#16a34a",
    brandTextColor: "#ffffff",
    matches: ["evone charging", "evone"],
    website: "https://www.google.com/search?q=EVOne+Charging+Singapore",
  },
  {
    key: "cityenergy",
    shortName: "CE",
    appName: "City Energy Go",
    markerLabel: "CE",
    brandColor: "#dc2626",
    brandTextColor: "#ffffff",
    matches: ["city energy go", "city energy"],
    website: "https://www.cityenergy.com.sg/",
  },
  {
    key: "upsolutions",
    shortName: "UP",
    appName: "UP Solutions",
    markerLabel: "UP",
    brandColor: "#0891b2",
    brandTextColor: "#ffffff",
    matches: ["up solutions"],
    website: "https://www.google.com/search?q=UP+Solutions+EV+charging+Singapore",
  },
  {
    key: "solateks",
    shortName: "Sol",
    appName: "Solateks",
    markerLabel: "Sol",
    brandColor: "#ca8a04",
    brandTextColor: "#17201c",
    matches: ["solateks", "solatek"],
    website: "https://www.google.com/search?q=Solateks+EV+charging+Singapore",
  },
  {
    key: "airetec",
    shortName: "Air",
    appName: "Airetec",
    markerLabel: "Air",
    brandColor: "#0284c7",
    brandTextColor: "#ffffff",
    matches: ["airetec"],
    website: "https://www.google.com/search?q=Airetec+EV+charging+Singapore",
  },
  {
    key: "greatcharge",
    shortName: "GC",
    appName: "Great Charge",
    markerLabel: "GC",
    brandColor: "#059669",
    brandTextColor: "#ffffff",
    matches: ["great charge", "greatcharge"],
    website: "https://www.google.com/search?q=Great+Charge+EV+charging+Singapore",
  },
  {
    key: "eneready",
    shortName: "ER",
    appName: "ENEReady",
    markerLabel: "ER",
    brandColor: "#65a30d",
    brandTextColor: "#ffffff",
    matches: ["eneready", "ene ready"],
    website: "https://www.google.com/search?q=ENEReady+EV+charging+Singapore",
  },
  {
    key: "busways",
    shortName: "BW",
    appName: "Busways",
    markerLabel: "BW",
    brandColor: "#475569",
    brandTextColor: "#ffffff",
    matches: ["busways"],
    website: "https://www.google.com/search?q=Busways+EV+charging+Singapore",
  },
  {
    key: "gtech",
    shortName: "GT",
    appName: "G. Tech",
    markerLabel: "GT",
    brandColor: "#9333ea",
    brandTextColor: "#ffffff",
    matches: ["g. tech", "g tech", "gtech"],
    website: "https://www.google.com/search?q=G+Tech+EV+charging+Singapore",
  },
  {
    key: "wescares",
    shortName: "WES",
    appName: "WES Cares",
    markerLabel: "WES",
    brandColor: "#0d9488",
    brandTextColor: "#ffffff",
    matches: ["wes cares", "wescares"],
    website: "https://www.google.com/search?q=WES+Cares+EV+charging+Singapore",
  },
  {
    key: "electric",
    shortName: "ELE",
    appName: "Electric",
    markerLabel: "ELE",
    brandColor: "#4b5563",
    brandTextColor: "#ffffff",
    matches: ["electric pte", "electric pte ltd"],
    website: "https://www.google.com/search?q=Electric+Pte+Ltd+EV+charging+Singapore",
  },
  {
    key: "alpina",
    shortName: "ALP",
    appName: "Alpina Energy",
    markerLabel: "ALP",
    brandColor: "#1d4ed8",
    brandTextColor: "#ffffff",
    matches: ["alpina energy", "alpina"],
    website: "https://www.google.com/search?q=Alpina+Energy+EV+charging+Singapore",
  },
  {
    key: "pparking",
    shortName: "PP",
    appName: "P-Parking",
    markerLabel: "PP",
    brandColor: "#6d28d9",
    brandTextColor: "#ffffff",
    matches: ["p-parking", "p parking", "pparking"],
    website: "https://www.google.com/search?q=P-Parking+EV+charging+Singapore",
  },
  {
    key: "uniongas",
    shortName: "UG",
    appName: "Union Gas",
    markerLabel: "UG",
    brandColor: "#b91c1c",
    brandTextColor: "#ffffff",
    matches: ["union gas"],
    website: "https://www.uniongas.com.sg/",
  },
  {
    key: "iwow",
    shortName: "IWOW",
    appName: "IWOW Technology",
    markerLabel: "IWOW",
    brandColor: "#334155",
    brandTextColor: "#ffffff",
    matches: ["iwow technology", "iwow"],
    website: "https://www.google.com/search?q=IWOW+Technology+EV+charging+Singapore",
  },
];

const UNKNOWN_PROVIDER = {
  key: "unknown",
  shortName: "EV",
  appName: "provider app",
  markerLabel: "EV",
  brandColor: "#52605b",
  brandTextColor: "#ffffff",
  matches: [],
  website: "https://www.google.com/search?q=Singapore+EV+charging+app",
};

export function getProviderKey(providerName) {
  return getProviderProfile(providerName).key;
}

export function getProviderProfile(providerName = "") {
  const normalized = providerName.toLowerCase();
  return PROVIDERS.find((provider) => provider.matches.some((match) => normalized.includes(match))) || UNKNOWN_PROVIDER;
}

export function canOpenProviderApp(providerName = "") {
  const provider = getProviderProfile(providerName);
  return Boolean(provider.appleId || provider.androidPackage || provider.appStore || provider.playStore);
}

export function openProviderApp(providerName) {
  if (!canOpenProviderApp(providerName)) return;

  const provider = getProviderProfile(providerName);
  const { launchUrl, fallbackUrl } = getLaunchUrls(provider);

  if (!launchUrl) {
    if (fallbackUrl) window.open(fallbackUrl, "_blank", "noopener,noreferrer");
    return;
  }

  const openedAt = Date.now();
  window.location.href = launchUrl;

  window.setTimeout(() => {
    if (fallbackUrl && Date.now() - openedAt < 1800) {
      window.location.href = fallbackUrl;
    }
  }, 900);
}

function getLaunchUrls(provider) {
  const userAgent = window.navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(userAgent);
  const isAndroid = /Android/i.test(userAgent);

  if (isIOS && provider.appleId) {
    return {
      launchUrl: `itms-apps://itunes.apple.com/app/id${provider.appleId}`,
      fallbackUrl: provider.appStore,
    };
  }

  if (isAndroid && provider.androidPackage) {
    return {
      launchUrl: `market://details?id=${provider.androidPackage}`,
      fallbackUrl: provider.playStore,
    };
  }

  return {
    launchUrl: "",
    fallbackUrl: provider.appStore || provider.playStore || provider.website || "",
  };
}
