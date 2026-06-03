import { useState } from "react";

const FAVORITES_STORAGE_KEY = "bocharge_favorites";

/**
 * Custom hook to manage favorite charging stations with localStorage persistence.
 */
export function useFavorites() {
  const [favorites, setFavorites] = useState(() => {
    if (typeof window === "undefined") return {};
    try {
      const stored = localStorage.getItem(FAVORITES_STORAGE_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch {
      console.warn("Failed to load favorites from localStorage");
      return {};
    }
  });

  const persistFavorites = (newFavorites) => {
    try {
      localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(newFavorites));
    } catch (error) {
      console.error("Failed to persist favorites to localStorage:", error);
    }
  };

  const addFavorite = (stationId, country, stationData) => {
    const key = `${country}:${stationId}`;
    const updated = {
      ...favorites,
      [key]: {
        stationId,
        country,
        addedAt: Date.now(),
        snapshot: stationData,
      },
    };
    persistFavorites(updated);
    setFavorites(updated);
  };

  const removeFavorite = (stationId, country) => {
    const key = `${country}:${stationId}`;
    const updated = { ...favorites };
    delete updated[key];
    persistFavorites(updated);
    setFavorites(updated);
  };

  const toggleFavorite = (stationId, country, stationData) => {
    const key = `${country}:${stationId}`;
    if (key in favorites) {
      removeFavorite(stationId, country);
    } else {
      addFavorite(stationId, country, stationData);
    }
  };

  return {
    favorites,
    addFavorite,
    removeFavorite,
    toggleFavorite,
    count: Object.keys(favorites).length,
  };
}
