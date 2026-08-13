import React from "react";
import { CheckLineIcon } from "@/icons";

export interface ListItem {
  text: React.ReactNode;
  icon?: React.ReactNode;
}

interface ListProps {
  items: ListItem[];
  variant?: "unordered" | "ordered" | "icon" | "check";
  className?: string;
}

const List: React.FC<ListProps> = ({
  items,
  variant = "unordered",
  className = "",
}) => {
  const baseItem = "text-sm text-gray-700 dark:text-gray-300";

  if (variant === "ordered") {
    return (
      <ol className={`list-decimal space-y-3 pl-5 marker:text-brand-500 ${className}`}>
        {items.map((item, i) => (
          <li key={i} className={baseItem}>
            {item.text}
          </li>
        ))}
      </ol>
    );
  }

  if (variant === "unordered") {
    return (
      <ul className={`list-disc space-y-3 pl-5 marker:text-brand-500 ${className}`}>
        {items.map((item, i) => (
          <li key={i} className={baseItem}>
            {item.text}
          </li>
        ))}
      </ul>
    );
  }

  // icon / check variants
  return (
    <ul className={`space-y-3 ${className}`}>
      {items.map((item, i) => (
        <li key={i} className="flex items-center gap-3">
          <span
            className={`flex h-5 w-5 shrink-0 items-center justify-center ${
              variant === "check"
                ? "rounded-full bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-400"
                : "text-brand-500"
            }`}
          >
            {variant === "check" ? (
              <CheckLineIcon className="h-3.5 w-3.5" />
            ) : (
              item.icon
            )}
          </span>
          <span className={baseItem}>{item.text}</span>
        </li>
      ))}
    </ul>
  );
};

export default List;
