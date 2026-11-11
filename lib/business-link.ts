/** Returns an HTTP(S) link, an empty string for a cleared field, or null for invalid input. */
export function normalizeBusinessLink(value: string): string | null {
  const text = value.trim();
  if (!text) return '';
  if (text.length > 2000 || /[\s\\]/.test(text)) return null;

  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password || !/[.:]/.test(url.hostname)) return null;
    return url.href.length <= 2000 ? url.href : null;
  } catch {
    return null;
  }
}
