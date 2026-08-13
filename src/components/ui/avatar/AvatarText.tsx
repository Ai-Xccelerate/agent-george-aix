import React from "react";

type AvatarTextSize =
  | "xsmall"
  | "small"
  | "medium"
  | "large"
  | "xlarge"
  | "xxlarge";

interface AvatarTextProps {
  name: string;
  size?: AvatarTextSize;
  className?: string;
}

// Mirrors Avatar's size scale so initials fallbacks line up with image avatars.
const sizeClasses: Record<AvatarTextSize, string> = {
  xsmall: "h-6 w-6 text-theme-xs",
  small: "h-8 w-8 text-theme-xs",
  medium: "h-10 w-10 text-sm",
  large: "h-12 w-12 text-base",
  xlarge: "h-14 w-14 text-lg",
  xxlarge: "h-16 w-16 text-xl",
};

const AvatarText: React.FC<AvatarTextProps> = ({
  name,
  size = "medium",
  className = "",
}) => {
  const initials = name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  // One neutral chip — no rainbow. Identity color belongs to AgentAvatar's
  // locked agent tokens, never Tailwind's default palette (brand rule).
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full bg-gray-100 font-medium text-gray-600 dark:bg-white/[0.08] dark:text-gray-300 ${sizeClasses[size]} ${className}`}
    >
      <span>{initials}</span>
    </div>
  );
};

export default AvatarText;
