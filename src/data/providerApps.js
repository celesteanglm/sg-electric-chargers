const PROVIDERS = [
  {
    key: "sp",
    shortName: "SP",
    appName: "SP App",
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
    matches: ["cdg", "comfortdelgro", "engie"],
    appleId: "954951647",
    androidPackage: "com.codigo.comfort",
    appStore: "https://apps.apple.com/sg/app/cdg-zig-taxis-cars/id954951647",
    playStore: "https://play.google.com/store/apps/details?id=com.codigo.comfort",
    website: "https://www.cdgtaxi.com.sg/cdg-zig/",
  },
  {
    key: "kigo",
    shortName: "Kigo",
    appName: "Kigo App",
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
    matches: ["volt"],
    appleId: "1606309147",
    appStore: "https://apps.apple.com/sg/app/volt-ev-charging/id1606309147",
    website: "https://www.volt.sg",
  },
  {
    key: "tesla",
    shortName: "Tesla",
    appName: "Tesla",
    matches: ["tesla"],
    appleId: "582007913",
    androidPackage: "com.teslamotors.tesla",
    appStore: "https://apps.apple.com/sg/app/tesla/id582007913",
    playStore: "https://play.google.com/store/apps/details?id=com.teslamotors.tesla",
    website: "https://www.tesla.com/en_sg/supercharger",
  },
];

const UNKNOWN_PROVIDER = {
  key: "unknown",
  shortName: "EV",
  appName: "provider app",
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

export function openProviderApp(providerName) {
  const provider = getProviderProfile(providerName);
  const { launchUrl, fallbackUrl } = getLaunchUrls(provider);

  if (!launchUrl) {
    window.open(fallbackUrl, "_blank", "noopener,noreferrer");
    return;
  }

  const openedAt = Date.now();
  window.location.href = launchUrl;

  window.setTimeout(() => {
    if (Date.now() - openedAt < 1800) {
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
    fallbackUrl: provider.appStore || provider.playStore || provider.website,
  };
}

