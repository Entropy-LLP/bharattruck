// Navigation deep-link handoff to the phone's Google Maps app.
// FROZEN contract (Maps/Tracking): navigation is a deep-link handoff —
// NO in-app turn-by-turn, NO backend.
//
// We return the universal `https://www.google.com/maps/dir/?api=1` link as the
// single reliable target: it opens the Google Maps app when installed and
// otherwise falls back to web Google Maps / Apple Maps. We deliberately do NOT
// emit a bare `comgooglemaps://` link on iOS — that scheme silently dead-ends
// when Google Maps isn't installed, and we don't implement a real https
// fallback for it. The universal link already deep-links into the app when
// present, so a driver without the Google Maps app still lands somewhere usable.

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
  let url = `https://www.google.com/maps/dir/?api=1&destination=${dest}`
  if (origin) url += `&origin=${origin.lat},${origin.lng}`
  return url
}
