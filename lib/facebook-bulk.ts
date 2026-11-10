import { normalizeFacebookPageUrl } from '@/lib/finder-sales';

export const FACEBOOK_BULK_MAX = 50;
export type BulkFacebookRow = { line: number; name: string; facebookUrl: string };
export type BulkFacebookProblem = { line: number; text: string; reason: string };

const linkPattern = /(?:https?:\/\/)?(?:www\.|m\.|web\.|mbasic\.)?(?:facebook|fb)\.com\/[^\s,\t|]+/i;

/** "SmileDentalCebu" or "smile.dental-cebu" from a page address, read as "Smile Dental Cebu". */
export function nameFromPageUrl(url: string) {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '');
    if (/^\/profile\.php$/i.test(path) || /^\/(?:pages|people)\//i.test(path) && !/\/(?:pages|people)\/[^/]+\//i.test(path)) return '';
    const slug = decodeURIComponent((/^\/(?:pages|people)\/([^/]+)\//i.exec(path)?.[1]) || path.slice(1));
    const words = slug.replace(/[._-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/(\D)(\d{3,})$/, '$1').trim();
    if (!/[a-z]/i.test(words)) return '';
    return words.split(/\s+/).map(word => word.length > 3 && word === word.toUpperCase() ? word : word.charAt(0).toUpperCase() + word.slice(1)).join(' ').slice(0, 160);
  } catch { return ''; }
}

/** Reads pasted lines: a page link on its own, or a business name and link (tab, comma, pipe or dash between them). */
export function parseFacebookLines(text: string) {
  const rows: BulkFacebookRow[] = [];
  const problems: BulkFacebookProblem[] = [];
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    const value = raw.trim();
    if (!value) return;
    const match = value.match(linkPattern);
    if (!match) { problems.push({ line, text: value, reason: 'No Facebook page link' }); return; }
    const facebookUrl = normalizeFacebookPageUrl(/^https?:\/\//i.test(match[0]) ? match[0] : `https://${match[0]}`);
    if (!facebookUrl) { problems.push({ line, text: value, reason: 'Not a business page link (a post, group or share link)' }); return; }
    if (seen.has(facebookUrl)) { problems.push({ line, text: value, reason: 'Repeated in the list' }); return; }
    const typed = value.replace(match[0], ' ').replace(/^[\s\t,|–—-]+|[\s\t,|–—-]+$/g, '').replace(/\s+/g, ' ').slice(0, 160);
    const name = typed.length >= 2 ? typed : nameFromPageUrl(facebookUrl);
    if (name.length < 2) { problems.push({ line, text: value, reason: 'Add the business name before the link' }); return; }
    seen.add(facebookUrl);
    rows.push({ line, name, facebookUrl });
  });
  return { rows: rows.slice(0, FACEBOOK_BULK_MAX), extra: Math.max(0, rows.length - FACEBOOK_BULK_MAX), problems };
}
