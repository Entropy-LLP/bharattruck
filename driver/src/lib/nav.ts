// Navigation deep-link handoff to the phone's Google Maps app.
// FROZEN contract (Maps/Tracking): navigation is a deep-link handoff —
// NO in-app turn-by-turn, NO backend. On iOS we prefer the
// `comgooglemaps://` scheme (only opens if Google Maps is installed);
// everywhere else (and as the safe fallback) the universal
// `https://www.google.com/maps/dir/?api=1` link, which itself deep-links
// into the app when present.

export interface LatLng {
  lat: number
  lng: number
}

export function buildNavDeepLink({
  destination,
  origin,
}: {
  destination: LatLng
  origin?: LatLng
}): string {
  const dest = `${destination.lat},${destination.lng}`

  const isIOS =
    typeof navigator !== 'undefined' && /iP(hone|od|ad)/.test(navigator.userAgent)

  if (isIOS) {
    let url = `comgooglemaps://?daddr=${dest}&directionsmode=driving`
    if (origin) url += `&saddr=${origin.lat},${origin.lng}`
    return url
  }

  let url = `https://www.google.com/maps/dir/?api=1&destination=${dest}`
  if (origin) url += `&origin=${origin.lat},${origin.lng}`
  return url
}
