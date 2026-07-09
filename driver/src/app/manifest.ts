import type { MetadataRoute } from 'next'

// Minimal installable PWA manifest for the driver app (pilot-critical: the
// driver installs it to the home screen and runs it standalone during drives).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'BharatTruck Driver',
    short_name: 'BT Driver',
    description: 'Accept loads, run trips and share live location on BharatTruck.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#2563eb',
    icons: [
      { src: '/icon.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon-maskable.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  }
}
