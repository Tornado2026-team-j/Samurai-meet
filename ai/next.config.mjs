/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // API routes only handle JSON; keep the body parser small by default.
  experimental: {},
};

export default nextConfig;
