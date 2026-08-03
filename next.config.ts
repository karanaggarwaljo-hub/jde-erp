import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces .next/standalone: a minimal self-contained server bundle (no need to
  // ship the full node_modules tree) used when packaging the Electron desktop app.
  output: 'standalone',
  // Pin the workspace root to this project folder. Without this, Next.js can pick a
  // different root if a sibling lockfile is found nearby (e.g. running from a git
  // worktree next to the main checkout), which changes where .next/standalone/server.js
  // ends up and breaks the fixed path the Electron main process expects.
  turbopack: {
    root: __dirname,
  },
  images: {
    // Public catalog product photos live in Supabase Storage (jde-catalog-images bucket),
    // served from the project's own *.supabase.co domain — needed for next/image on /catalog.
    remotePatterns: [
      { protocol: 'https', hostname: '**.supabase.co', pathname: '/storage/v1/object/public/**' },
    ],
  },
};

export default nextConfig;
