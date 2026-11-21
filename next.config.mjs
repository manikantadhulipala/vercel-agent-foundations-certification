import { withWorkflow } from "workflow/next";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Type errors fail the build (the codebase type-checks cleanly).
  typescript: {
    ignoreBuildErrors: false,
  },
  serverExternalPackages: ["@vercel/oidc"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.public.blob.vercel-storage.com",
      },
      {
        protocol: "https",
        hostname: "**.vercel-storage.com",
      },
    ],
  },
};

// Enables the "use workflow" / "use step" directives used by both agents.
export default withWorkflow(nextConfig);
