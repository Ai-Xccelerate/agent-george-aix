import React from "react";
import Link from "next/link";

export interface BreadcrumbItem {
  label: string;
  href?: string;
  icon?: React.ReactNode;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  variant?: "chevron" | "slash";
  className?: string;
}

const ChevronSeparator = () => (
  <svg
    className="stroke-current text-gray-500 dark:text-gray-400"
    width="17"
    height="16"
    viewBox="0 0 17 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M6.0765 12.667L10.2432 8.50033L6.0765 4.33366"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const SlashSeparator = () => (
  <span className="text-gray-500 dark:text-gray-400">/</span>
);

const Breadcrumb: React.FC<BreadcrumbProps> = ({
  items,
  variant = "chevron",
  className = "",
}) => {
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const content = (
            <span className="inline-flex items-center gap-1.5">
              {item.icon && (
                <span className="flex items-center">{item.icon}</span>
              )}
              {item.label}
            </span>
          );

          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1.5">
              {isLast || !item.href ? (
                <span
                  aria-current={isLast ? "page" : undefined}
                  className={
                    isLast
                      ? "text-sm text-gray-800 dark:text-white/90"
                      : "text-sm text-gray-500 dark:text-gray-400"
                  }
                >
                  {content}
                </span>
              ) : (
                <Link
                  href={item.href}
                  className="rounded-lg text-sm text-gray-500 transition-colors duration-150 ease-out hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:text-gray-400 dark:hover:text-brand-400 dark:focus-visible:ring-offset-gray-900"
                >
                  {content}
                </Link>
              )}
              {!isLast &&
                (variant === "slash" ? <SlashSeparator /> : <ChevronSeparator />)}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};

export default Breadcrumb;
