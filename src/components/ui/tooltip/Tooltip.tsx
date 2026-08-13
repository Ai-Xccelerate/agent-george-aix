"use client";

import React from "react";

type Placement = "top" | "bottom" | "left" | "right";

interface TooltipProps {
  content: React.ReactNode;
  placement?: Placement;
  children: React.ReactNode;
}

const placementClasses: Record<Placement, string> = {
  top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
  bottom: "top-full left-1/2 mt-2 -translate-x-1/2",
  left: "right-full top-1/2 mr-2 -translate-y-1/2",
  right: "left-full top-1/2 ml-2 -translate-y-1/2",
};

const Tooltip: React.FC<TooltipProps> = ({
  content,
  placement = "top",
  children,
}) => {
  return (
    <div className="group relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-50 max-w-xs rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 opacity-0 glass-popover transition-opacity duration-150 ease-out group-hover:opacity-100 group-focus-within:opacity-100 dark:border-gray-800 dark:text-gray-200 ${placementClasses[placement]}`}
      >
        {content}
      </span>
    </div>
  );
};

export default Tooltip;
