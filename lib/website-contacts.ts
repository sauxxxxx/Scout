import { normalizeFacebookPageUrl } from '@/lib/finder-sales';

import type { ContactChannels } from '@/lib/contact-channels';
export type { ContactChannels };
export type WebsiteContacts = { email: string; emails: string[]; phone: string; socialUrl: string; channels: ContactChannels };

const emailPattern = /[a-z0-9][a-z0-9._%+-]*@[a-z0-9][a-z0-9.-]*\.[a-z]{2,24}/gi;
const junkEmail = /\.(?:png|jpe?g|gif|webp|svg|avif|css|js)$|@(?:\d+x\.|example\.|domain\.|email\.com$|yourdomain|yoursite|sentry|wixpress\.com|sentry-next|.*\.sentry\.)/i;
const preferredBox = /^(?:info|hello|contact|inquir(?:y|ies)|enquir(?:y|ies)|sales|booking|bookings|reservations?|appointments?|admin|office|support|cs|customerservice)@/i;

function decodeEntities(text: string) {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&(?:amp|#38);/gi, '&').replace(/&commat;/gi, '@').replace(/&period;/gi, '.').replace(/&nbsp;/gi, ' ');
}

/** Cloudflare hides emails on the sites it protects; the address is XORed with the first byte. */
export function decodeCloudflareEmail(hex: string) {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length < 4 || hex.length % 2) return '';
  const key = parseInt(hex.slice(0, 2), 16);
  let out = '';
  for (let index = 2; index < hex.length; index += 2) out += String.fromCharCode(parseInt(hex.slice(index, index + 2), 16) ^ key);
  return out;
}

/** "sales [at] clinic [dot] ph" and similar spellings people use to dodge spam bots. */
function undoObfuscation(text: string) {
  return text
    .replace(/\s*[[({]\s*at\s*[\])}]\s*/gi, '@')
    .replace(/\s*[[({]\s*dot\s*[\])}]\s*/gi, '.');
}

function hostOf(url: string) {
  try { return new URL(url).hostname.replace(/^www\./i, '').toLowerCase(); } catch { return ''; }
}

function rankEmails(emails: string[], websiteHost: string) {
  const unique = [...new Set(emails.map(value => value.toLowerCase().replace(/^mailto:/, '').replace(/[.,;:]+$/, '')))]
    .filter(value => /^[^\s@]+@[^\s@]+\.[a-z]{2,24}$/i.test(value) && !junkEmail.test(value) && value.length <= 254);
  const score = (value: string) => (websiteHost && value.endsWith(`@${websiteHost}`) ? 2 : 0) + (preferredBox.test(value) ? 1 : 0);
  return unique.sort((a, b) => score(b) - score(a));
}

function jsonLdBlocks(html: string) {
  const blocks: unknown[] = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { blocks.push(JSON.parse(match[1].trim())); } catch { /* Sites often ship broken structured data; skip it. */ }
  }
  const flat: Record<string, unknown>[] = [];
  const walk = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') {
      flat.push(value as Record<string, unknown>);
      for (const key of ['@graph', 'contactPoint', 'publisher', 'author', 'location']) walk((value as Record<string, unknown>)[key]);
    }
  };
  blocks.forEach(walk);
  return flat;
}

const strings = (value: unknown): string[] => Array.isArray(value) ? value.flatMap(strings) : typeof value === 'string' ? [value] : [];

function messengerLink(href: string) {
  const match = href.match(/^https?:\/\/(?:www\.)?(?:m\.me|messenger\.com\/t)\/([A-Za-z0-9.\-_]{2,80})\/?(?:[?#].*)?$/i);
  return match ? { url: `https://m.me/${match[1]}`, page: match[1] } : null;
}
function whatsappLink(href: string) {
  const match = href.match(/^(?:https?:\/\/(?:wa\.me\/|(?:api|web)\.whatsapp\.com\/send\/?\?(?:[^#]*&)?phone=)|whatsapp:\/\/send\/?\?(?:[^#]*&)?phone=)\+?(\d{7,15})/i);
  return match ? `https://wa.me/${match[1]}` : '';
}
function viberLink(href: string) {
  const match = href.match(/^viber:\/\/(?:chat|add|contact)\?number=(?:%2B|\+)?(\d{7,15})/i);
  if (match) return `viber://chat?number=%2B${match[1]}`;
  return /^https?:\/\/invite\.viber\.com\//i.test(href) ? href : '';
}
function instagramLink(href: string) {
  const match = href.match(/^https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]{2,30})\/?(?:[?#].*)?$/i);
  if (!match || /^(?:p|reel|reels|explore|accounts|stories|tv|about|developer|legal)$/i.test(match[1])) return '';
  return `https://www.instagram.com/${match[1]}/`;
}

/** Everything a sales rep could use to reach the business, read from the pages of its own website. */
export function extractContacts(pages: string[], websiteUrl: string): WebsiteContacts {
  const websiteHost = hostOf(websiteUrl);
  const html = pages.filter(Boolean).join('\n');
  const decoded = decodeEntities(html.replace(/\\\//g, '/').replace(/\\u0040/gi, '@'));
  const hrefs = [...decoded.matchAll(/href=["']([^"']+)["']/gi)].map(match => match[1].trim());
  const visible = undoObfuscation(decoded.replace(/<script(?![^>]+ld\+json)[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));
  const structured = jsonLdBlocks(decoded);

  const emails = rankEmails([
    ...hrefs.filter(href => /^mailto:/i.test(href)).map(href => decodeURIComponent(href.slice(7).split('?')[0])),
    ...[...decoded.matchAll(/data-cfemail=["']([0-9a-f]+)["']/gi)].map(match => decodeCloudflareEmail(match[1])),
    ...[...decoded.matchAll(/\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/gi)].map(match => decodeCloudflareEmail(match[1])),
    ...structured.flatMap(item => strings(item.email)),
    ...(visible.match(emailPattern) || []),
  ], websiteHost);

  const phone = [
    ...structured.flatMap(item => strings(item.telephone)),
    ...hrefs.filter(href => /^tel:/i.test(href)).map(href => decodeURIComponent(href.slice(4))),
  ].map(value => value.trim()).find(value => (value.match(/\d/g) || []).length >= 7) || '';

  const links = [...hrefs, ...structured.flatMap(item => strings(item.sameAs)), ...(decoded.match(/https?:\/\/(?:www\.|m\.|mbasic\.)?facebook\.com\/[^'"\s<>]+/gi) || [])];
  const channels: ContactChannels = {};
  let socialUrl = '';
  for (const link of links) {
    const messenger = messengerLink(link);
    if (messenger && !channels.messenger) channels.messenger = messenger.url;
    if (!channels.whatsapp) channels.whatsapp = whatsappLink(link) || undefined;
    if (!channels.viber) channels.viber = viberLink(link) || undefined;
    if (!channels.instagram) channels.instagram = instagramLink(link) || undefined;
    if (!socialUrl) socialUrl = normalizeFacebookPageUrl(link.replace(/&amp;/gi, '&'));
  }
  // A Messenger link names the page, so it gives the Facebook page when the site never links it directly.
  if (!socialUrl && channels.messenger) socialUrl = normalizeFacebookPageUrl(`https://www.facebook.com/${messengerLink(channels.messenger)?.page || ''}`);
  for (const key of Object.keys(channels) as (keyof ContactChannels)[]) if (!channels[key]) delete channels[key];
  return { email: emails[0] || '', emails, phone, socialUrl, channels };
}

/** Same-site pages likely to list contact details: linked from the homepage, or named in the sitemap. */
export function contactPageUrls(homepage: string, sitemap: string, root: URL, limit = 3) {
  const fromLinks = [...homepage.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .filter(match => /(?:contact|about|reach|location|branch|visit|find-us|get-in-touch)/i.test(`${match[1]} ${match[2].replace(/<[^>]+>/g, ' ')}`))
    .map(match => match[1]);
  const fromSitemap = [...sitemap.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(match => match[1]).filter(url => /(?:contact|about|location|branch)/i.test(url));
  const urls = [...fromLinks, ...fromSitemap, '/contact', '/contact-us'].map(href => {
    try { const url = new URL(decodeEntities(href), root); url.hash = ''; return url.origin === root.origin && url.href !== root.href ? url.href : ''; } catch { return ''; }
  }).filter(Boolean);
  return [...new Set(urls)].slice(0, limit);
}
