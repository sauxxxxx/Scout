import { z } from 'zod';
import { countryName, countryOptions, DEFAULT_COUNTRY, isCountry } from '@/lib/countries';

/** The most rows one file may bring in. Each batch of 25 is one request, so this is at most 80 requests. */
export const LEAD_IMPORT_MAX_ROWS = 2000;
export const LEAD_IMPORT_STATUSES = ['New', 'Prospect', 'Contacted', 'Interested'] as const;

export const leadImportFields = [
  { key: 'name', label: 'Business name', required: true, aliases: ['business name', 'business', 'company name', 'company', 'name', 'lead name', 'lead', 'account', 'store', 'shop', 'clinic', 'establishment'] },
  { key: 'industry', label: 'Industry', aliases: ['industry', 'category', 'business type', 'type', 'sector', 'niche'] },
  { key: 'city', label: 'City', aliases: ['city', 'town', 'municipality', 'city municipality', 'location', 'area'] },
  { key: 'country', label: 'Country', aliases: ['country'] },
  { key: 'contact', label: 'Contact person', aliases: ['contact person', 'contact name', 'contact', 'person', 'owner name', 'full name'] },
  { key: 'phone', label: 'Phone', aliases: ['phone', 'phone number', 'mobile', 'mobile number', 'contact number', 'cellphone', 'cell', 'telephone', 'tel', 'number'] },
  { key: 'email', label: 'Email', aliases: ['email', 'e mail', 'email address', 'mail'] },
  { key: 'facebookUrl', label: 'Facebook page', aliases: ['facebook', 'facebook page', 'facebook url', 'facebook link', 'fb', 'fb page', 'fb link'] },
] as const;

export type LeadImportField = (typeof leadImportFields)[number]['key'];
export type LeadImportMapping = Record<LeadImportField, number>;
export type LeadImportRow = { line: number; name: string; industry: string; city: string; country: string; contact: string; phone: string; email: string; facebookUrl: string };

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const facebookPattern = /^(?:https?:\/\/)?(?:[\w-]+\.)?(?:facebook|fb)\.com\/./i;
const headerKey = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const nameKey = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

/** Reads CSV the way Excel and Google Sheets save it, and the tab-separated text Google Sheets copies: quoted cells, line breaks inside quotes, and comma, semicolon or tab separators. */
export function parseCsv(text: string, knownDelimiter?: string): string[][] {
  const source = text.replace(/^﻿/, '');
  const firstLine = source.slice(0, source.search(/\r?\n|$/));
  const delimiter = knownDelimiter || [',', ';', '\t'].map(mark => ({ mark, count: firstLine.split(mark).length })).sort((a, b) => b.count - a.count)[0].mark;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { cell += '"'; index++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === '') quoted = true;
    else if (char === delimiter) { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += char;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map(cells => cells.map(value => value.trim())).filter(cells => cells.some(Boolean));
}

/** Matches spreadsheet headers to Scout fields by common names, so most files need no changes. */
export function guessMapping(headers: string[]): LeadImportMapping {
  const keys = headers.map(headerKey);
  const used = new Set<number>();
  const mapping = {} as LeadImportMapping;
  for (const field of leadImportFields) {
    const exact = field.aliases.map(alias => keys.findIndex((key, index) => !used.has(index) && key === alias)).find(index => index >= 0);
    const partial = exact ?? field.aliases.map(alias => keys.findIndex((key, index) => !used.has(index) && alias.length > 3 && key.includes(alias))).find(index => index >= 0);
    const column = partial ?? -1;
    mapping[field.key] = column;
    if (column >= 0) used.add(column);
  }
  return mapping;
}

function countryCode(value: string) {
  const text = value.trim();
  if (!text) return '';
  const upper = text.toUpperCase();
  if (isCountry(upper)) return upper;
  return countryOptions.find(code => countryName(code).toLowerCase() === text.toLowerCase()) || '';
}

export type LeadImportPlan = { rows: LeadImportRow[]; missingName: number[]; repeated: number[]; fixes: string[] };

/** Turns the sheet into rows Scout can save, and says plainly what it left out or changed. */
export function planLeadImport(table: string[][], mapping: LeadImportMapping, defaults: { industry: string; city: string }): LeadImportPlan {
  const cell = (cells: string[], field: LeadImportField) => (mapping[field] >= 0 ? cells[mapping[field]] || '' : '').replace(/\s+/g, ' ').trim();
  const rows: LeadImportRow[] = [];
  const missingName: number[] = [];
  const repeated: number[] = [];
  const badEmail: number[] = [];
  const badFacebook: number[] = [];
  const seen = new Set<string>();
  table.slice(1).forEach((cells, index) => {
    const line = index + 2;
    const name = cell(cells, 'name').slice(0, 160);
    if (!name) { missingName.push(line); return; }
    if (seen.has(nameKey(name))) { repeated.push(line); return; }
    seen.add(nameKey(name));
    let email = cell(cells, 'email').slice(0, 254);
    if (email && !emailPattern.test(email)) { badEmail.push(line); email = ''; }
    let facebookUrl = cell(cells, 'facebookUrl').slice(0, 500);
    if (facebookUrl && !facebookPattern.test(facebookUrl)) { badFacebook.push(line); facebookUrl = ''; }
    if (facebookUrl && !/^https?:\/\//i.test(facebookUrl)) facebookUrl = `https://${facebookUrl}`;
    rows.push({
      line, name, email, facebookUrl,
      industry: (cell(cells, 'industry') || defaults.industry.trim() || 'Not set').slice(0, 120),
      city: (cell(cells, 'city') || defaults.city.trim() || 'Not set').slice(0, 120),
      country: countryCode(cell(cells, 'country')) || DEFAULT_COUNTRY,
      contact: cell(cells, 'contact').slice(0, 160),
      phone: cell(cells, 'phone').slice(0, 80),
    });
  });
  const lines = (items: number[]) => items.length > 6 ? `${items.slice(0, 6).join(', ')} and ${items.length - 6} more` : items.join(', ');
  const fixes = [
    badEmail.length ? `Emails that don't look valid were left blank (row ${lines(badEmail)}).` : '',
    badFacebook.length ? `Links that aren't Facebook pages were left blank (row ${lines(badFacebook)}).` : '',
  ].filter(Boolean);
  return { rows: rows.slice(0, LEAD_IMPORT_MAX_ROWS), missingName, repeated, fixes };
}

export const leadImportTemplate = 'Business name,Industry,City,Country,Contact person,Phone,Email,Facebook page\r\nSmile Dental Clinic,Dental clinics,Cebu City,Philippines,Ana Santos,+63 912 345 6789,hello@smiledental.ph,https://facebook.com/smiledentalcebu\r\n';

const facebookUrl = z.string().trim().max(500).refine(value => !value || facebookPattern.test(value), 'Use a Facebook page link.');
export const leadImportSchema = z.object({
  ownerId: z.string().trim().min(1).max(240),
  status: z.enum(LEAD_IMPORT_STATUSES),
  priority: z.enum(['Low', 'Medium', 'High']),
  allowPhoneMatches: z.boolean().default(false),
  rows: z.array(z.object({
    line: z.number().int().positive(),
    name: z.string().trim().min(1).max(160),
    industry: z.string().trim().min(1).max(120),
    city: z.string().trim().min(1).max(120),
    country: z.string().trim().length(2),
    contact: z.string().trim().max(160),
    phone: z.string().trim().max(80),
    email: z.union([z.literal(''), z.email().max(254)]),
    facebookUrl,
  }).strict()).min(1).max(25),
}).strict();
