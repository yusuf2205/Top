/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone", // needed for the slim Docker runtime image (infrastructure/docker/web.Dockerfile)
  transpilePackages: ["@top/ui", "@top/types"],
};

export default nextConfig;
