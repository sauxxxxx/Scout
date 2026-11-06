import type { FinderArea } from '@/lib/finder-map';

export const FINDER_MAX_LEADS = 300;
export const FINDER_DEFAULT_LEADS = 100;
const PAGE_SIZE = 20;
/** A cell with only a few businesses is close to empty, so searching inside it again isn't worth paying for. */
const FEWEST_PLACES_TO_SPLIT = 4;
/** Below about a kilometre across, splitting again only returns the same businesses. */
const SMALLEST_CELL_DEGREES = 0.01;

export type FinderBox = { south: number; west: number; north: number; east: number };
/**
 * `root` is the first, area-wide search. Google returns only its most relevant matches, often 10 to 20, with no sign that
 * more exist. Searching smaller parts of the same area surfaces different businesses, so any cell with results gets split.
 */
export type FinderCell = FinderBox | { root: true };
export type FinderSearchState = { cells: FinderCell[]; pageToken?: string; requests: number; cellPlaces?: number; hidden: string[]; box?: FinderBox };

export const isRootCell = (cell: FinderCell): cell is { root: true } => 'root' in cell;

/** Scout gathers more than it keeps, so the best can be chosen once contact details are checked. */
export function finderCandidateTarget(targetCount: number) {
  return targetCount <= 60 ? Math.min(60, Math.max(20, targetCount * 2)) : Math.ceil(Math.min(targetCount, FINDER_MAX_LEADS) * 1.2);
}

/** A hard ceiling on Google requests, which are billed each, so a search in an exhausted area can't run up the bill. */
export function finderRequestLimit(targetCount: number) {
  return Math.max(3, Math.ceil(finderCandidateTarget(targetCount) / PAGE_SIZE) * 4);
}

export function newSearchState(): FinderSearchState {
  return { cells: [{ root: true }], requests: 0, hidden: [] };
}

export function readSearchState(json: unknown): FinderSearchState {
  if (typeof json !== 'string' || !json) return newSearchState();
  try {
    const state = JSON.parse(json) as FinderSearchState;
    return Array.isArray(state.cells) && Array.isArray(state.hidden) ? state : newSearchState();
  } catch { return newSearchState(); }
}

export function boxOfArea(area: FinderArea): FinderBox {
  const latitude = area.radiusKm / 110.574;
  const longitude = area.radiusKm / (111.32 * Math.cos(area.latitude * Math.PI / 180));
  return { south: area.latitude - latitude, north: area.latitude + latitude, west: area.longitude - longitude, east: area.longitude + longitude };
}

export function splitBox(box: FinderBox): FinderBox[] {
  if (box.north - box.south < SMALLEST_CELL_DEGREES * 2 || box.east - box.west < SMALLEST_CELL_DEGREES * 2) return [];
  const middleLatitude = (box.south + box.north) / 2;
  const middleLongitude = (box.west + box.east) / 2;
  return [
    { south: box.south, west: box.west, north: middleLatitude, east: middleLongitude },
    { south: box.south, west: middleLongitude, north: middleLatitude, east: box.east },
    { south: middleLatitude, west: box.west, north: box.north, east: middleLongitude },
    { south: middleLatitude, west: middleLongitude, north: box.north, east: box.east },
  ];
}

export function restrictToBox(box: FinderBox) {
  return { locationRestriction: { rectangle: { low: { latitude: box.south, longitude: box.west }, high: { latitude: box.north, longitude: box.east } } } };
}

/** Without a map area, the businesses found so far show where the place is. */
export function growBox(state: FinderSearchState, points: { latitude?: number; longitude?: number }[]) {
  for (const { latitude, longitude } of points) {
    if (latitude === undefined || longitude === undefined) continue;
    const box = state.box;
    state.box = box
      ? { south: Math.min(box.south, latitude), north: Math.max(box.north, latitude), west: Math.min(box.west, longitude), east: Math.max(box.east, longitude) }
      : { south: latitude, north: latitude, west: longitude, east: longitude };
  }
}

export function finishCell(state: FinderSearchState, area?: FinderArea) {
  const cell = state.cells.shift();
  const found = state.cellPlaces || 0;
  state.pageToken = undefined;
  state.cellPlaces = 0;
  if (!cell || found < FEWEST_PLACES_TO_SPLIT) return;
  const box = isRootCell(cell) ? (area ? boxOfArea(area) : state.box) : cell;
  if (box) state.cells.push(...splitBox(box));
}
