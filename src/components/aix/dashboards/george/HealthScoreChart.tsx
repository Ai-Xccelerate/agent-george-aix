"use client";
import { ApexOptions } from "apexcharts";
import dynamic from "next/dynamic";
import React from "react";
import { AGENT_META } from "@/components/aix/AgentAvatar";

const ReactApexChart = dynamic(() => import("react-apexcharts"), {
  ssr: false,
});

/** Score buckets, low → high. Must stay in step with bucketHealthScores(). */
export const HEALTH_BUCKETS = [
  "0–20",
  "21–40",
  "41–60",
  "61–70",
  "71–80",
  "81–90",
  "91–100",
];

export default function HealthScoreChart({ accounts }: { accounts: number[] }) {
  const buckets = HEALTH_BUCKETS;
  const georgeHex = AGENT_META.George.hex;

  const options: ApexOptions = {
    colors: [georgeHex],
    chart: {
      fontFamily: "Inter, sans-serif",
      type: "bar",
      height: 320,
      toolbar: { show: false },
    },
    plotOptions: {
      bar: {
        horizontal: false,
        columnWidth: "45%",
        borderRadius: 6,
        borderRadiusApplication: "end",
        distributed: false,
      },
    },
    dataLabels: { enabled: false },
    stroke: {
      show: true,
      width: 4,
      colors: ["transparent"],
    },
    grid: {
      strokeDashArray: 4,
      borderColor: "#E4E7EC",
      yaxis: { lines: { show: true } },
      xaxis: { lines: { show: false } },
    },
    xaxis: {
      categories: buckets,
      title: {
        text: "Health score",
        style: {
          color: "#98A2B3",
          fontSize: "12px",
          fontWeight: 400,
        },
      },
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: {
        style: { colors: "#98A2B3", fontSize: "12px" },
      },
    },
    yaxis: {
      labels: {
        style: { colors: "#98A2B3", fontSize: "12px" },
      },
    },
    legend: { show: false },
    fill: { opacity: 1 },
    tooltip: {
      x: { show: true },
      y: { formatter: (val: number) => `${val} accounts` },
    },
  };

  const series = [{ name: "Accounts", data: accounts }];

  return (
    <div className="flex h-full flex-col rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
      <div>
        <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">
          Health score distribution
        </h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          156 accounts scored nightly on usage, sentiment, and support signals
        </p>
      </div>
      <div className="mt-2">
        <ReactApexChart
          options={options}
          series={series}
          type="bar"
          height={320}
        />
      </div>
    </div>
  );
}
