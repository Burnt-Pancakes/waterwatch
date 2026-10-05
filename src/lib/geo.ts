/**
 * Equirectangular ("flat earth") great-circle approximation in kilometers.
 *
 * Mirrors the same formula used by the `get_sites_with_latest_reading`
 * SQL function so the client and server agree on distance values:
 *
 *   d = 111.045 * sqrt(
 *         (lat2 - lat1)^2 +
 *         ((lng2 - lng1) * cos(radians(lat1)))^2
 *       )
 *
 * WHY equirectangular and not Haversine: at DMV-area latitudes the error
 * is well under 0.5% over the distances we care about (a few tens of km),
 * and the formula is cheap enough to evaluate inside SQL without PostGIS,
 * which the project rules forbid.
 *
 * @param lat1 origin latitude in decimal degrees
 * @param lng1 origin longitude in decimal degrees
 * @param lat2 destination latitude in decimal degrees
 * @param lng2 destination longitude in decimal degrees
 * @returns distance in kilometers
 */
export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLng = (lng2 - lng1) * Math.cos(toRad(lat1));
  return 111.045 * Math.sqrt(dLat * dLat + dLng * dLng);
}
