import React from "react";

type RibbonVariant = "corner" | "rounded";
type RibbonColor = "brand" | "success" | "error" | "info";

interface RibbonProps {
  text: string;
  variant?: RibbonVariant;
  color?: RibbonColor;
}

const colorClasses: Record<RibbonColor, string> = {
  brand: "bg-brand-500",
  success: "bg-success-500",
  error: "bg-error-500",
  info: "bg-blue-light-500",
};

// Darker shade for the folded-corner tail, so the banner reads as wrapping the card.
const foldClasses: Record<RibbonColor, string> = {
  brand: "bg-brand-700",
  success: "bg-success-700",
  error: "bg-error-700",
  info: "bg-blue-light-700",
};

const Ribbon: React.FC<RibbonProps> = ({
  text,
  variant = "rounded",
  color = "brand",
}) => {
  if (variant === "corner") {
    return (
      <span
        className={`absolute -right-11 top-5 w-40 rotate-45 py-1.5 text-center text-xs font-semibold text-white shadow-theme-xs ${colorClasses[color]}`}
      >
        {text}
      </span>
    );
  }

  // Pinned to the TOP-RIGHT edge so it never overlaps a card's (left-aligned)
  // title. A small darker fold beneath the tail sells the "wrapped" look.
  return (
    <span
      className={`absolute -right-2 top-4 inline-flex items-center rounded-l-lg py-1.5 pl-4 pr-3 text-xs font-semibold text-white shadow-theme-xs ${colorClasses[color]}`}
    >
      {text}
      <span
        aria-hidden
        className={`absolute right-0 top-full h-2 w-2 [clip-path:polygon(100%_0,100%_100%,0_0)] ${foldClasses[color]}`}
      />
    </span>
  );
};

export default Ribbon;
