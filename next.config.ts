import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Chat attachments go through a server action that accepts up to 10
    // files × 25 MB each (see MAX_FILE_SIZE / MAX_FILES_PER_TURN in
    // src/app/(app)/chat/upload-actions.ts). The default 1 MB limit
    // rejects anything bigger with a 413 before the action even runs.
    serverActions: {
      bodySizeLimit: "300mb",
    },
  },
};

export default nextConfig;
