import type { NextConfig } from "next";

// SVGR must KEEP the viewBox (SVGO's preset-default strips it by default when
// width/height are present). Without a viewBox an SVG can't scale — any CSS
// size smaller than its intrinsic px just clips the artwork. Preserving it lets
// every icon scale cleanly at any size / density.
const svgrOptions = {
  svgoConfig: {
    plugins: [
      {
        name: "preset-default",
        params: { overrides: { removeViewBox: false } },
      },
    ],
  },
};

const nextConfig: NextConfig = {
  experimental: {
    // Chat attachments go through a server action that accepts up to 10
    // files × 25 MB each (see MAX_FILE_SIZE / MAX_FILES_PER_TURN in
    // src/app/(app)/chat/upload-actions.ts). The default 1 MB limit
    // rejects anything bigger with a 413 before the action even runs.
    // 260 MB covers the maximum realistic payload (10 × 25 MB + overhead).
    serverActions: {
      bodySizeLimit: "260mb",
    },
  },

  // AIX theme icons ship as raw .svg compiled to React components by SVGR.
  // Both bundlers need the rule: turbopack for `next dev`, webpack for the
  // production build.
  webpack(config) {
    config.module.rules.push({
      test: /\.svg$/,
      use: [{ loader: "@svgr/webpack", options: svgrOptions }],
    });
    return config;
  },

  turbopack: {
    rules: {
      "*.svg": {
        loaders: [{ loader: "@svgr/webpack", options: svgrOptions }],
        as: "*.js",
      },
    },
  },
};

export default nextConfig;
