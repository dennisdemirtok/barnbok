/** @type {import('next').NextConfig} */
const nextConfig = {
  // src/instrumentation.ts tar upp bakgrundsjobb när servern startar
  experimental: { instrumentationHook: true },
}

module.exports = nextConfig
