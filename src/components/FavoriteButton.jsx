import { Heart } from "lucide-react";
import { useState } from "react";

/**
 * Heart icon button for favoriting stations with magical touch animation.
 * Shows filled pink heart when favorited, outline when not.
 */
export function FavoriteButton({ isFavorited, onClick, className = "" }) {
  const [isAnimating, setIsAnimating] = useState(false);

  const handleClick = (e) => {
    // Trigger animation
    setIsAnimating(true);
    setTimeout(() => setIsAnimating(false), 600);
    onClick(e);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`favorite-button transition-all hover:scale-125 ${isAnimating ? "animate-magical-touch" : ""} ${className}`}
      title={isFavorited ? "Remove from favorites" : "Add to favorites"}
      aria-label={isFavorited ? "Remove from favorites" : "Add to favorites"}
    >
      <Heart
        size={24}
        strokeWidth={isFavorited ? 0 : 2}
        fill={isFavorited ? "currentColor" : "none"}
        className={isFavorited ? "text-pink-500" : "text-gray-400"}
      />
    </button>
  );
}
