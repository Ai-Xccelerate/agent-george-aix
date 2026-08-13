import React from "react";
import Link from "next/link";

export interface AtRiskAccount {
  /** Customer id — the row links through to the account when present. */
  id?: string;
  account: string;
  healthScore: number;
  renewal: string;
}

function scoreDot(score: number): string {
  if (score < 40) return "bg-error-500";
  if (score < 55) return "bg-warning-500";
  return "bg-gray-400";
}

function scoreTone(score: number): string {
  if (score < 40) return "text-error-600 dark:text-error-500";
  if (score < 55) return "text-warning-600 dark:text-warning-400";
  return "text-gray-500 dark:text-gray-400";
}

export default function AtRiskAccountsPanel({
  accounts,
}: {
  accounts: AtRiskAccount[];
}) {
  return (
    <div className="flex h-full flex-col rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
      <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">
        At-risk accounts
      </h3>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        Health below 60, soonest renewal first
      </p>

      {accounts.length === 0 ? (
        <p className="mt-5 rounded-2xl border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          No accounts below 60. Nothing needs a save play.
        </p>
      ) : (
        <ul className="mt-5 flex flex-col divide-y divide-gray-100 dark:divide-gray-800">
          {accounts.map((acct) => {
            const row = (
              <>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-800 dark:text-white/90">
                    {acct.account}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {acct.renewal ? `Renews ${acct.renewal}` : "No renewal date"}
                  </p>
                </div>
                <span
                  className={`inline-flex shrink-0 items-center gap-1.5 text-sm font-medium ${scoreTone(acct.healthScore)}`}
                >
                  <span className={`size-2 rounded-full ${scoreDot(acct.healthScore)}`} />
                  {acct.healthScore}
                </span>
              </>
            );
            return (
              <li key={acct.id ?? acct.account}>
                {acct.id ? (
                  <Link
                    href={`/customers/${acct.id}`}
                    className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.03]"
                  >
                    {row}
                  </Link>
                ) : (
                  <div className="flex items-center justify-between gap-3 py-3">{row}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
