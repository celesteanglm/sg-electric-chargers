import { useCallback, useEffect, useState } from "react";

const FAVORITES_STORAGE_KEY = "bocharge_favorites";

/**
 * Custom hook to manage favorite charging stations with localStorage persistence.
 * Each favorite stores the station ID, country, and station metadata snapshot.
 * This allows recovery if station IDs change in feed refreshes.
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

  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setIsLoaded(true);
  }, []);

  const persistFavorites = useCallback((newFavorites) => {
    try {
      localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(newFavorites));
    } catch (error) {
      console.error("Failed to persist favorites to localStorage:", error);
    }
  }, []);

  /**
   * Add a station to favorites.
   * @param {string} stationId - Unique station identifier
   * @param {string} country - Country code (sg, my)
   * @param {object} stationData - Full station metadata to snapshot
   */
  const addFavorite = useCallback(
    (stationId, country, stationData) => {
      setFavorites((prev) => {
        const key = `${country}:${stationId}`;
        const updated = {
          ...prev,
          [key]: {
            stationId,
            country,
            addedAt: Date.now(),
            snapshot: stationData,
          },
        };
        persistFavorites(updated);
        return updated;
      });
    },
    [persistFavorites],
  );

  /**
   * Remove a station from favorites.
   */
  const removeFavorite = useCallback(
    (stationId, country) => {
      setFavorites((prev) => {
        const key = `${country}:${stationId}`;
        const updated = { ...prev };
        delete updated[key];
        persistFavorites(updated);
        return updated;
      });
    },
    [persistFavorites],
  );

  /**
   * Check if a station is favorited.
   */
  const isFavorite = useCallback(
    (stationId, country) => {
      const key = `${country}:${stationId}`;
      return key in favorites;
    },
    [favorites],
  );

  /**
   * Toggle favorite status (add if not present, remove if present).
   */
  const toggleFavorite = useCallback(
    (stationId, country, stationData) => {
      if (isFavorite(stationId, country)) {
        removeFavorite(stationId, country);
      } else {
        addFavorite(stationId, country, stationData);
      }
    },
    [isFavorite, addFavorite, removeFavorite],
  );

  /**
   * Get all favorites for a specific country.
   */
  const getFavoritesByCountry = useCallback(
    (country) => {
      return Object.values(favorites).filter((fav) => fav.country === country);
    },
    [favorites],
  );

  /**
   * Get all favorited station IDs for a country (for filtering).
   */
  const getFavoriteIds = useCallback(
    (country) => {
      return getFavoritesByCountry(country).map((fav) => fav.stationId);
    },
    [getFavoritesByCountry],
  );

  /**
   * Clear all favorites (destructive).
   */
  const clearAllFavorites = useCallback(() => {
    setFavorites({});
    persistFavorites({});
  }, [persistFavorites]);

  return {
    favorites,
    isLoaded,
    addFavorite,
    removeFavorite,
    isFavorite,
    toggleFavorite,
    getFavoritesByCountry,
    getFavoriteIds,
    clearAllFavorites,
    count: Object.keys(favorites).length,
  };
}
