import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  transpilePackages: ['@roughmagic/oak', '@roughmagic/oak-react'],
}

export default nextConfig
