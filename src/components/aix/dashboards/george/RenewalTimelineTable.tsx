import React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import Badge from "@/components/ui/badge/Badge";
import AgentAvatar, { AgentName } from "@/components/aix/AgentAvatar";

type Risk = "High" | "Medium" | "Low";

export interface Renewal {
  account: string;
  arr: string;
  renewal: string;
  owner: AgentName;
  risk: Risk;
}



const riskColor: Record<Risk, "error" | "warning" | "success"> = {
  High: "error",
  Medium: "warning",
  Low: "success",
};

export default function RenewalTimelineTable({
  renewals,
}: {
  renewals: Renewal[];
}) {
  return (
    <div className="flex h-full flex-col rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="px-5 pt-5 md:px-6 md:pt-6">
        <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">
          Renewal timeline
        </h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Next 120 days of renewals, ordered by date
        </p>
      </div>
      {/* Mobile: stacked cards — no horizontal scroll. */}
      <div className="mt-4 space-y-2.5 px-5 pb-5 md:hidden">
        {renewals.map((row) => (
          <div
            key={row.account}
            className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 p-3 dark:border-gray-800"
          >
            <div className="flex min-w-0 items-center gap-3">
              <AgentAvatar name={row.owner} size="sm" />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-gray-800 dark:text-white/90">
                  {row.account}
                </div>
                <div className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">
                  {row.renewal} &middot; {row.owner}
                </div>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-sm font-medium tabular-nums text-gray-800 dark:text-white/90">
                {row.arr}
              </div>
              <div className="mt-1.5">
                <Badge size="sm" color={riskColor[row.risk]}>
                  {row.risk}
                </Badge>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="custom-scrollbar mt-4 hidden max-w-full overflow-x-auto md:block">
        <Table>
          <TableHeader className="border-y border-gray-100 dark:border-gray-800">
            <TableRow>
              <TableCell
                isHeader
                className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 md:px-6"
              >
                Account
              </TableCell>
              <TableCell
                isHeader
                className="px-5 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 md:px-6"
              >
                ARR
              </TableCell>
              <TableCell
                isHeader
                className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 md:px-6"
              >
                Renewal date
              </TableCell>
              <TableCell
                isHeader
                className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 md:px-6"
              >
                Owner
              </TableCell>
              <TableCell
                isHeader
                className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 md:px-6"
              >
                Risk
              </TableCell>
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-gray-100 dark:divide-gray-800">
            {renewals.map((row) => (
              <TableRow key={row.account}>
                <TableCell className="px-5 py-4 text-sm font-medium text-gray-800 dark:text-white/90 md:px-6">
                  {row.account}
                </TableCell>
                <TableCell className="whitespace-nowrap px-5 py-4 text-right text-sm text-gray-500 dark:text-gray-400 md:px-6">
                  {row.arr}
                </TableCell>
                <TableCell className="whitespace-nowrap px-5 py-4 text-sm text-gray-500 dark:text-gray-400 md:px-6">
                  {row.renewal}
                </TableCell>
                <TableCell className="px-5 py-4 md:px-6">
                  <span className="flex items-center gap-2">
                    <AgentAvatar name={row.owner} size="sm" />
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      {row.owner}
                    </span>
                  </span>
                </TableCell>
                <TableCell className="px-5 py-4 md:px-6">
                  <Badge size="sm" color={riskColor[row.risk]}>
                    {row.risk}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
