/** @type {import('next').NextConfig} */
const api = process.env.API_URL || "http://127.0.0.1:3001";

const nextConfig = {
  reactStrictMode: true,
  experimental: { externalDir: true },
  async rewrites() {
    return [{ source: "/backend/:path*", destination: `${api}/:path*` }];
  },
};

module.exports = nextConfig;
