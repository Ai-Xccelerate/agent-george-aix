import React from "react";

type SpinnerSize = "sm" | "md" | "lg";
type SpinnerColor = "brand" | "gray" | "white";
type SpinnerVariant = "ring" | "dots";

interface SpinnerProps {
  size?: SpinnerSize;
  color?: SpinnerColor;
  variant?: SpinnerVariant;
}

const ringSize: Record<SpinnerSize, string> = {
  sm: "h-5 w-5 border-2",
  md: "h-8 w-8 border-[3px]",
  lg: "h-12 w-12 border-4",
};

const dotSize: Record<SpinnerSize, string> = {
  sm: "h-1.5 w-1.5",
  md: "h-2.5 w-2.5",
  lg: "h-3.5 w-3.5",
};

const ringColor: Record<SpinnerColor, string> = {
  brand: "border-brand-500 border-t-transparent",
  gray: "border-gray-300 border-t-transparent dark:border-gray-600 dark:border-t-transparent",
  white: "border-white border-t-transparent",
};

const dotColor: Record<SpinnerColor, string> = {
  brand: "bg-brand-500",
  gray: "bg-gray-400 dark:bg-gray-500",
  white: "bg-white",
};

const Spinner: React.FC<SpinnerProps> = ({
  size = "md",
  color = "brand",
  variant = "ring",
}) => {
  if (variant === "dots") {
    return (
      <span className="inline-flex items-center gap-1.5" role="status" aria-label="Loading">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`inline-block animate-pulse rounded-full ${dotSize[size]} ${dotColor[color]}`}
            style={{ animationDelay: `${i * 0.2}s` }}
          />
        ))}
      </span>
    );
  }

  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block animate-spin rounded-full ${ringSize[size]} ${ringColor[color]}`}
    />
  );
};

export default Spinner;
