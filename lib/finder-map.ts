import { z } from 'zod';

export const finderBoundsSchema = z.object({
  south: z.number().finite().min(-90).max(90),
  north: z.number().finite().min(-90).max(90),
  west: z.number().finite().min(-180).max(180),
  east: z.number().finite().min(-180).max(180),
}).strict().refine(value => value.south < value.north && value.west !== value.east, 'Choose a valid map area.');

export const finderAreaSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  radiusKm: z.number().finite().min(1).max(50),
}).strict();

export type FinderBounds = z.infer<typeof finderBoundsSchema>;
export type FinderArea = z.infer<typeof finderAreaSchema>;

export function parseFinderBounds(value: unknown): FinderBounds | undefined {
  try {
    const parsed = finderBoundsSchema.safeParse(typeof value === 'string' ? JSON.parse(value) : value);
    return parsed.success ? parsed.data : undefined;
  } catch { return undefined; }
}

export function parseFinderArea(value: unknown): FinderArea | undefined {
  try {
    const parsed = finderAreaSchema.safeParse(typeof value === 'string' ? JSON.parse(value) : value);
    return parsed.success ? parsed.data : undefined;
  } catch { return undefined; }
}

export function hasCoordinates<T extends { latitude?: number; longitude?: number }>(value: T): value is T & { latitude: number; longitude: number } {
  return Number.isFinite(value.latitude) && Number.isFinite(value.longitude)
    && Math.abs(value.latitude!) <= 90 && Math.abs(value.longitude!) <= 180;
}

export function distanceKm(latitudeA: number, longitudeA: number, latitudeB: number, longitudeB: number) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const deltaLatitude = radians(latitudeB - latitudeA);
  const deltaLongitude = radians(longitudeB - longitudeA);
  const a = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(radians(latitudeA)) * Math.cos(radians(latitudeB)) * Math.sin(deltaLongitude / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function areaFromBounds(bounds?: FinderBounds): FinderArea | undefined {
  if (!bounds) return undefined;
  const latitude = (bounds.south + bounds.north) / 2;
  const longitude = (bounds.west + bounds.east) / 2;
  const radiusKm = Math.min(50, Math.max(1, distanceKm(latitude, longitude, bounds.north, longitude)));
  return { latitude, longitude, radiusKm };
}

export function isWithinArea(value: { latitude?: number; longitude?: number }, area?: FinderArea) {
  return !area || (hasCoordinates(value) && distanceKm(area.latitude, area.longitude, value.latitude, value.longitude) <= area.radiusKm);
}

export function placesSearchArea(area?: FinderArea) {
  return area ? { locationBias: { circle: {
    center: { latitude: area.latitude, longitude: area.longitude },
    radius: area.radiusKm * 1000,
  } } } : {};
}
