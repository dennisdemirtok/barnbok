/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // src/instrumentation.ts tar upp bakgrundsjobb när servern startar
    instrumentationHook: true,
    // Ljudkontrollens mp3-avkodare (WebAssembly) laddas som den är på servern
    serverComponentsExternalPackages: ['mpg123-decoder'],
  },
}

module.exports = nextConfig
