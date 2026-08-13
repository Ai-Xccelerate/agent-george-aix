import React from "react";

type ProgressSize = "sm" | "md" | "lg";
type ProgressColor = "brand" | "success" | "warning" | "error" | "info";

interface ProgressBarProps {
  value: number;
  size?: ProgressSize;
  color?: ProgressColor;
  showLabel?: boolean;
  className?: string;
  /** Accessible name for the progress bar (announced to assistive tech). */
  label?: string;
}

const sizeClasses: Record<ProgressSize, string> = {
  sm: "h-2",
  md: "h-3",
  lg: "h-4",
};

const colorClasses: Record<ProgressColor, string> = {
  brand: "bg-brand-500",
  success: "bg-success-500",
  warning: "bg-warning-500",
  error: "bg-error-500",
  info: "bg-blue-light-500",
};

const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  size = "md",
  color = "brand",
  showLabel = false,
  className = "",
  label,
}) => {
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? "Progress"}
        className={`relative w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800 ${sizeClasses[size]}`}
      >
        <div
          className={`absolute left-0 top-0 h-full rounded-full transition-[width] duration-500 ease-out ${colorClasses[color]}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {showLabel && (
        <span className="w-10 shrink-0 text-right text-sm font-medium text-gray-700 dark:text-gray-300">
          {clamped}%
        </span>
      )}
    </div>
  );
};

export default ProgressBar;
