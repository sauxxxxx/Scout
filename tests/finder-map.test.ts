import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { areaFromBounds, finderAreaSchema, finderBoundsSchema, hasCoordinates, isWithinArea, parseFinderBounds, placesSearchArea } from '@/lib/finder-map';
import { finderIndustries, validGooglePlaceType } from '@/lib/finder-industries';
import { finderPlacesErrorMessage, mapFinderResult, mapFinderSearch, processFinderJob } from '@/lib/finder-store';
import { publicFinderResult } from '@/lib/finder-public';
import { finderSearchSchema } from '@/lib/validation';

const bounds = { south: 10.2, north: 10.5, west: 123.7, east: 124 };
afterEach(() => vi.unstubAllGlobals());

describe('Finder geography', () => {
  it('validates geographic boundaries, including a dateline crossing', () => {
    expect(finderBoundsSchema.safeParse(bounds).success).toBe(true);
    expect(finderBoundsSchema.safeParse({ ...bounds, west: 179, east: -179 }).success).toBe(true);
    for (const invalid of [{ ...bounds, north: 91 }, { ...bounds, south: 11 }, { ...bounds, east: bounds.west }, { ...bounds, west: NaN }]) {
      expect(finderBoundsSchema.safeParse(invalid).success).toBe(false);
    }
    expect(parseFinderBounds('bad JSON')).toBeUndefined();
    expect(parseFinderBounds(null)).toBeUndefined();
    expect(parseFinderBounds(JSON.stringify(bounds))).toEqual(bounds);
    expect(finderSearchSchema.safeParse({ action: 'save', industry: 'Dentists', location: 'Cebu City', targetCount: 20, requirements: ['Phone'], bounds }).success).toBe(true);
    const area = areaFromBounds(bounds)!;
    expect(finderAreaSchema.safeParse(area).success).toBe(true);
    expect(isWithinArea({ latitude: area.latitude, longitude: area.longitude }, area)).toBe(true);
    expect(isWithinArea({ latitude: 11, longitude: 125 }, area)).toBe(false);
  });

  it('keeps unknown coordinates out of the map and accepts zero coordinates', () => {
    expect(hasCoordinates({ latitude: 0, longitude: 0 })).toBe(true);
    expect(hasCoordinates({ latitude: undefined, longitude: 12 })).toBe(false);
    expect(hasCoordinates({ latitude: 100, longitude: 12 })).toBe(false);
    expect(hasCoordinates({ latitude: NaN, longitude: 12 })).toBe(false);
    expect(mapFinderResult({ latitude: null, longitude: null }).latitude).toBeUndefined();
    expect(placesSearchArea()).toEqual({});
  });

  it('only sends current Text Search Table A industry filters', () => {
    expect(validGooglePlaceType('general_contractor')).toBeUndefined();
    expect(validGooglePlaceType('advertising_agency')).toBeUndefined();
    expect(validGooglePlaceType('auto_repair_shop')).toBeUndefined();
    expect(validGooglePlaceType('car_repair')).toBe('car_repair');
    for (const industry of finderIndustries) {
      if (industry.googleType) expect(validGooglePlaceType(industry.googleType)).toBe(industry.googleType);
    }
    expect(finderPlacesErrorMessage(400)).not.toMatch(/included.?type|google places/i);
  });

  it('keeps usage and budget diagnostics out of public results', () => {
    const result = publicFinderResult(mapFinderResult({ ai_status: 'budget_limited', ai_error: 'Monthly AI budget reached', ai_prompt_tokens: 99, ai_output_tokens: 9, ai_estimated_cost_microusd: 100 }));
    expect(result.aiStatus).toBe('skipped');
    expect(JSON.stringify(result)).not.toMatch(/budget|tokens|cost/i);
    expect(result).not.toHaveProperty('aiEstimatedCostUsd');
  });

  it('runs the actual search job against SQLite and persists provider coordinates and bounds', async () => {
    const sql = new DatabaseSync(':memory:');
    for (const file of ['0006_real_finder.sql', '0007_gemini_finder.sql', '0010_finder_map.sql']) sql.exec(readFileSync(`db/migrations/${file}`, 'utf8'));
    sql.exec('CREATE TABLE companies (id TEXT PRIMARY KEY,workspace_id TEXT)');
    sql.exec(readFileSync('db/migrations/0011_finder_radius_facebook.sql', 'utf8'));
    sql.exec('CREATE TABLE leads (id TEXT, workspace_id TEXT)');
    sql.exec(readFileSync('db/migrations/0013_finder_sales_review.sql', 'utf8'));
    const statement = (query: string, values: SQLInputValue[] = []) => ({
      bind: (...args: SQLInputValue[]) => statement(query, args),
      first: async () => sql.prepare(query).get(...values) || null,
      all: async () => ({ results: sql.prepare(query).all(...values) }),
      run: async () => ({ meta: { changes: Number(sql.prepare(query).run(...values).changes) } }),
    });
    const db = { prepare: statement, batch: async (queries: ReturnType<typeof statement>[]) => Promise.all(queries.map(query => query.run())) } as unknown as D1Database;
    sql.prepare("INSERT INTO finder_searches (id,workspace_id,created_by,name,industry,industry_type,location,target_count,requirements_json,status,map_bounds_json) VALUES ('search','workspace','user','Dentists','Dentists','general_contractor','Cebu City',10,'[\"Phone\"]','Queued',?)").run(JSON.stringify(bounds));
    const fetcher = vi.fn(async () => Response.json({ places: [{ id: 'place', displayName: { text: 'Sample Dental' }, googleMapsUri: 'https://maps.google.com/?cid=123', internationalPhoneNumber: '+63 123', location: { latitude: 10.32, longitude: 123.9 } }] }));
    vi.stubGlobal('fetch', fetcher);
    try {
      await processFinderJob(db, 'workspace', 'search', { googlePlacesApiKey: 'test-server-key', aiMaxCandidates: 0 });
      const search = mapFinderSearch(sql.prepare("SELECT * FROM finder_searches WHERE id='search'").get()!);
      expect(search.status).toBe('Complete');
      expect(search.bounds).toEqual(bounds);
      expect(search.foundCount).toBe(1);
      const result = mapFinderResult(sql.prepare('SELECT * FROM finder_results').get()!);
      expect(result.latitude).toBe(10.32);
      expect(result.longitude).toBe(123.9);
      const call = fetcher.mock.calls[0] as unknown as [string, RequestInit];
      const request = JSON.parse(String(call[1].body));
      expect(request.textQuery).toBe('Dentists');
      expect(request).not.toHaveProperty('includedType');
      expect(request.locationBias.circle.center).toEqual({ latitude: 10.35, longitude: 123.85 });
      expect(request.locationBias.circle.radius).toBeGreaterThan(16000);
      expect(call[1].headers).toHaveProperty('X-Goog-FieldMask', expect.stringContaining('places.location'));
      expect(call[1].headers).toHaveProperty('X-Goog-FieldMask', expect.stringContaining('places.websiteUri'));
    } finally { sql.close(); }
  });
});
