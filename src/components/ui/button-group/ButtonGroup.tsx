"use client";
import React, { useState } from "react";

export interface ButtonGroupItem {
  label: string;
  icon?: React.ReactNode;
}

interface ButtonGroupProps {
  items: ButtonGroupItem[];
  size?: "sm" | "md";
  defaultActiveIndex?: number;
  activeIndex?: number;
  onChange?: (index: number) => void;
  className?: string;
}

const ButtonGroup: React.FC<ButtonGroupProps> = ({
  items,
  size = "md",
  defaultActiveIndex = 0,
  activeIndex,
  onChange,
  className = "",
}) => {
  const [internalActive, setInternalActive] = useState(defaultActiveIndex);
  const active = activeIndex ?? internalActive;

  const sizeClasses = {
    sm: "px-3 py-2 text-xs",
    md: "px-4 py-2.5 text-sm",
  };

  const handleClick = (index: number) => {
    if (activeIndex === undefined) setInternalActive(index);
    onChange?.(index);
  };

  return (
    <div
      className={`inline-flex rounded-lg shadow-theme-xs ring-1 ring-inset ring-gray-300 dark:ring-gray-700 ${className}`}
      role="group"
    >
      {items.map((item, index) => {
        const isActive = index === active;
        const isFirst = index === 0;
        const isLast = index === items.length - 1;
        return (
          <button
            key={`${item.label}-${index}`}
            type="button"
            aria-pressed={isActive}
            onClick={() => handleClick(index)}
            className={`inline-flex items-center gap-2 font-medium transition-colors duration-150 ease-out focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/50 ${
              sizeClasses[size]
            } ${isFirst ? "rounded-l-lg" : ""} ${isLast ? "rounded-r-lg" : ""} ${
              !isFirst ? "-ml-px" : ""
            } ${
              isActive
                ? "z-10 bg-brand-500 text-white ring-1 ring-inset ring-brand-500"
                : "bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.03]"
            }`}
          >
            {item.icon && <span className="flex items-center">{item.icon}</span>}
            {item.label}
          </button>
        );
      })}
    </div>
  );
};

export default ButtonGroup;
