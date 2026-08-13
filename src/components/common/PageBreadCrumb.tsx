import Link from "next/link";
import React from "react";

export type Crumb = { label: string; href?: string };

interface BreadcrumbProps {
  pageTitle: string;
  /** Optional supporting line under the title. */
  description?: React.ReactNode;
  /** Trail before the current page. Defaults to Dashboard. */
  trail?: Crumb[];
  /** Right-hand actions (buttons, sync controls). Replaces the crumb list. */
  actions?: React.ReactNode;
}

/**
 * AIX page header (AIX-F3), adapted for George.
 *
 * Two changes from the theme's version: the trail root points at /dashboard
 * rather than / (George's landing route), and the component carries an
 * optional `description` and `actions` slot, because George's page headers
 * pair the title with a supporting line and page-level controls. Without
 * those the reskin would have had to throw that content away.
 */
const PageBreadcrumb: React.FC<BreadcrumbProps> = ({
  pageTitle,
  description,
  trail,
  actions,
}) => {
  const crumbs: Crumb[] = trail ?? [{ label: "Dashboard", href: "/dashboard" }];

  return (
    <div
      data-aix-id="AIX-F3"
      className="mb-6 flex flex-wrap items-start justify-between gap-3"
    >
      <div className="min-w-0">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-gray-800 dark:text-white/90">
          {pageTitle}
        </h2>
        {description && (
          <p className="mt-1 max-w-[640px] text-sm text-gray-500 dark:text-gray-400">
            {description}
          </p>
        )}
      </div>

      {actions ?? (
        <nav aria-label="Breadcrumb">
          <ol className="flex items-center gap-1.5">
            {crumbs.map((crumb) => (
              <li key={crumb.label}>
                {crumb.href ? (
                  <Link
                    className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                    href={crumb.href}
                  >
                    {crumb.label}
                    <svg
                      className="stroke-current"
                      width="17"
                      height="16"
                      viewBox="0 0 17 16"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      aria-hidden="true"
                    >
                      <path
                        d="M6.0765 12.667L10.2432 8.50033L6.0765 4.33366"
                        stroke=""
                        strokeWidth="1.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </Link>
                ) : (
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {crumb.label}
                  </span>
                )}
              </li>
            ))}
            <li className="text-sm text-gray-800 dark:text-white/90">{pageTitle}</li>
          </ol>
        </nav>
      )}
    </div>
  );
};

export default PageBreadcrumb;
