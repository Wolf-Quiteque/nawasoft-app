import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // This project sits inside a parent folder that also has a lockfile
  // (other, unrelated apps in the same workspace) — pin the trace root to
  // this project so Next doesn't guess wrong.
  outputFileTracingRoot: __dirname,

  // Strips the "powered by" header from every response. Small, but it is on
  // every single one.
  poweredByHeader: false,

  experimental: {
    // Rewrites barrel imports (`import { Bus } from 'lucide-react'`) into deep
    // imports, so a screen using five icons ships five icons instead of the
    // whole set.
    optimizePackageImports: ['lucide-react', 'date-fns'],

    // Client-side router cache. Next 15 defaults `dynamic` to 0, which means
    // bouncing between the bottom-nav tabs re-fetches every screen from the
    // server every time. 30s keeps tab switching instant during the rapid
    // back-and-forth staff actually do, while still being well inside the
    // window where a ticket count matters.
    staleTimes: { dynamic: 30, static: 180 },
  },

  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/manifest.webmanifest',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=3600' }],
      },
      {
        // Fixed filenames, so not marked immutable — but they change about
        // once a rebrand, and the install prompt and home-screen icon both
        // pull them. A month of browser cache on top of the service worker's
        // cache-first handling.
        source: '/icons/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=2592000' }],
      },
    ];
  },
};

export default nextConfig;
