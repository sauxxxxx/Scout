import { describe, expect, it } from 'vitest';
import { countryName, countryOptions, DEFAULT_COUNTRY, isCountry, placeLabel, placesRegion } from '@/lib/countries';
import { ensureFoundationSchema } from '@/lib/foundation-store';
import { buildLeadFilter } from '@/lib/lead-query';
import { leadsToCsv } from '@/lib/lead-export';
import { detailsChanged, leadDetails } from '@/lib/lead-touch-store';
import { savedFilterSchema } from '@/lib/view-settings';
import { finderSearchSchema, leadInputSchema } from '@/lib/validation';
import { testD1 } from './helpers/d1';

const search = { action: 'run', industry: 'Dental clinics', location: 'Marina Bay', targetCount: 5 };
const lead = { name: 'Clinic', industry: 'Dental', city: 'Cebu', status: 'New', score: 0, owner: 'Ana', last: '', next: '', phone: '', email: '', contact: '', priority: 'Low', opportunity: '' };

describe('countries', () => {
  it('starts with the Philippines, then runs by name', () => {
    expect(countryOptions[0]).toBe('PH');
    expect(countryOptions.slice(1, 3).map(countryName)).toEqual(['Afghanistan', 'Albania']);
    expect(new Set(countryOptions).size).toBe(countryOptions.length);
  });

  it('gives every country a real name', () => {
    for (const code of countryOptions) expect(countryName(code)).not.toBe(code);
  });

  it('treats old records as the Philippines', () => {
    expect(countryName(null)).toBe('Philippines');
    expect(countryName('nonsense')).toBe('Philippines');
  });

  it('only names the country outside the Philippines', () => {
    expect(placeLabel('Cebu City', 'PH')).toBe('Cebu City');
    expect(placeLabel('Cebu City', undefined)).toBe('Cebu City');
    expect(placeLabel('Marina Bay', 'SG')).toBe('Marina Bay, Singapore');
    expect(placeLabel('Singapore', 'SG')).toBe('Singapore');
  });

  it('leaves Philippine searches to Google unchanged', () => {
    expect(placesRegion('PH')).toEqual({});
    expect(placesRegion(undefined)).toEqual({});
    expect(placesRegion('SG')).toEqual({ regionCode: 'SG', languageCode: 'en' });
  });
});

describe('country on searches and leads', () => {
  it('accepts real countries and refuses others', () => {
    expect(finderSearchSchema.safeParse({ ...search, country: 'SG' }).success).toBe(true);
    expect(finderSearchSchema.safeParse(search).success).toBe(true);
    expect(finderSearchSchema.safeParse({ ...search, country: 'ZZ' }).success).toBe(false);
    expect(leadInputSchema.safeParse({ ...lead, country: 'SG' }).success).toBe(true);
    expect(leadInputSchema.safeParse({ ...lead, country: 'Singapore' }).success).toBe(false);
  });

  it('marks existing leads and searches as the Philippines when the database updates', async () => {
    const store = testD1();
    await ensureFoundationSchema(store.db);
    const columns = (table: string) => store.sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string; dflt_value: string }[];
    for (const table of ['leads', 'finder_searches']) expect(columns(table).find(column => column.name === 'country')?.dflt_value).toBe(`'${DEFAULT_COUNTRY}'`);
  });

  it('filters leads by country', () => {
    const filter = (params: string) => buildLeadFilter(new URLSearchParams(params), 'w', 'Ana', false);
    expect(filter('country=SG').where).toContain('leads.country=?');
    expect(filter('country=SG').values).toContain('SG');
    expect(filter('country=All+countries').where).not.toContain('leads.country');
  });

  it('counts a country change as an update', () => {
    expect(detailsChanged({ country: 'PH' }, { country: 'SG' }, leadDetails)).toBe(true);
  });

  it('shows the country name in exports', () => {
    const csv = leadsToCsv([{ ...lead, country: 'SG' }, lead]);
    expect(csv.split('\n')[0]).toContain('Country');
    expect(csv).toContain('Singapore');
    expect(csv).toContain('Philippines');
  });

  it('keeps saved views from before countries existed', () => {
    const saved = savedFilterSchema.parse({ id: 'a', name: 'Mine', status: 'All statuses', owner: 'All owners', priority: 'All priorities', industry: 'All industries', minimumScore: 'Any score', touchFilter: 'Any last touch' });
    expect(saved.country).toBe('All countries');
  });
});
