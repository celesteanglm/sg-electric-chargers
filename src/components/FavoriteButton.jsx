import { Heart } from "lucide-react";

/**
 * Reusable heart button for favoriting stations.
 * Shows filled heart when favorited, outline when not.
 */
export function FavoriteButton({ isFavorited, onClick, className = "" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center justify-center p-2 rounded-full transition-all hover:scale-110 ${
        isFavorited
          ? "text-red-500 bg-red-50 hover:bg-red-100"
          : "text-gray-400 bg-gray-50 hover:bg-gray-100"
      } ${className}`}
      title={isFavorited ? "Remove from favorites" : "Add to favorites"}
      aria-label={isFavorited ? "Remove from favorites" : "Add to favorites"}
    >
      <Heart
        size={20}
        strokeWidth={isFavorited ? 0 : 2}
        fill={isFavorited ? "currentColor" : "none"}
      />
    </button>
  );
}
