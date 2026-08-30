import withPWA from "@ducanh2912/next-pwa";

const nextConfig = withPWA({
  dest: "public",
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === "development",
})({
  turbopack: {},
  // Bundle the persona/profile markdown into the serverless functions that read them.
  outputFileTracingIncludes: {
    "/api/**": ["./content/**"],
  },
});

export default nextConfig;
