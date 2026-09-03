import type { NextConfig } from "next";

// @ducanh2912/next-pwa is intentionally NOT used: its Workbox precache served
// stale pages after deploys, and its generated worker would overwrite our
// hand-written public/sw.js (push + notification routing). Install + share-target
// come from public/manifest.json; the SW is registered by components/PushSetup.tsx.
// The app is online-only, so there's no offline layer to lose.
const nextConfig: NextConfig = {
  turbopack: {},
  // got-scraping (lazy-loaded in lib/tools/mtg.ts for Moxfield deck import) ships
  // JSON fingerprint data and leans on Node's HTTP internals — let Node require it
  // straight from node_modules instead of bundling/transforming it.
  serverExternalPackages: ["got-scraping"],
  outputFileTracingIncludes: {
    "/api/**": ["./content/**"],
  },
};

export default nextConfig;
