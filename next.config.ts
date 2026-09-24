import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces .next/standalone: a minimal self-contained server bundle (no need to
  // ship the full node_modules tree) used when packaging the Electron desktop app.
  // Skipped on Vercel (VERCEL is set automatically in their build environment) —
  // Vercel has its own build adapter that packages each route as its own function,
  // and forcing standalone output alongside it breaks the adapter's own file-tracing
  // step (it looks for .next/next-server.js.nft.json in a place standalone mode
  // doesn't leave it, and the build fails with an ENOENT on that file).
  output: process.env.VERCEL ? undefined : 'standalone',
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
  // The live site sent nothing but the HSTS header Vercel adds itself, which left the whole ERP
  // — signed-in pages included — embeddable in a frame on any other site, the usual setup for
  // tricking someone into clicking a button they cannot see. These four are the headers that need
  // no per-page thought; a full script-level Content-Security-Policy is deliberately not here,
  // because Next inlines its own scripts and a wrong one takes the app down silently.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // frame-ancestors is the modern form and covers browsers that ignore X-Frame-Options;
          // both are sent because some older browsers only honour the latter.
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Frame-Options', value: 'DENY' },
          // Stops a browser second-guessing a declared type — an uploaded part photo served as an
          // image must never be run as script.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Another site gets the bare origin, never the path: an invoice URL names a customer.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
