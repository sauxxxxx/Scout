import { z } from 'zod';

export const salesFocuses = ['Website & booking', 'Digital marketing', 'General outreach'] as const;
export type SalesFocus = typeof salesFocuses[number];
export type RequirementMode = 'all' | 'any';
const note = z.string().trim().max(1200).optional();
export const facebookResearchSchema = z.object({
  pageName: z.string().trim().max(160).optional(), pageLocation: z.string().trim().max(240).optional(),
  identityChecks: z.array(z.enum(['name', 'location', 'contact'])).max(3).refine(checks => new Set(checks).size === checks.length, 'Each identity check must be different.').default([]),
  lastPostAt: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional(),
  postUrl: z.union([z.literal(''), z.string().max(2000).refine(value => !!facebookEvidenceUrl(value), 'Enter a Facebook source URL.')]).optional(),
  messenger: z.enum(['unknown', 'available', 'unavailable']).default('unknown'),
  websiteStatus: z.enum(['unknown', 'present', 'not_found']).default('unknown'),
  services: note, promotions: note, activity: note, tone: note, customerSignals: note, conversationAngle: note, notes: note,
}).strict().superRefine((value, context) => {
  if (value.lastPostAt) {
    const date = new Date(`${value.lastPostAt}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value.lastPostAt || value.lastPostAt > new Date().toISOString().slice(0, 10)) context.addIssue({ code: 'custom', path: ['lastPostAt'], message: 'Choose a real post date that is not in the future.' });
    if (!value.postUrl) context.addIssue({ code: 'custom', path: ['postUrl'], message: 'Add the post link supporting this date.' });
  }
});
export type FacebookResearch = z.infer<typeof facebookResearchSchema> & { reviewedAt?: string; reviewedBy?: string };

function facebookUrl(value: string): URL | undefined {
  try { const url = new URL(value.trim()); const host = url.hostname.toLowerCase().replace(/^(www\.|m\.|mbasic\.)/, ''); if (host !== 'facebook.com' || !['https:', 'http:'].includes(url.protocol) || url.username || url.password) return; url.protocol = 'https:'; url.hostname = 'www.facebook.com'; url.hash = ''; return url; } catch { return; }
}
export function normalizeFacebookPageUrl(value: string): string {
  const url = facebookUrl(value); if (!url) return '';
  const path = url.pathname.replace(/\/+$/, '');
  if (!path || /^\/(?:share|sharer|login|plugins|groups|events|marketplace|search|watch|reel|reels|story\.php|permalink\.php|photo(?:s|\.php)?|l\.php|dialog|gaming|help|privacy|policies)\b/i.test(path) || /\/(?:posts|videos|photos|reels)\//i.test(path)) return '';
  if (path.toLowerCase() === '/profile.php') { const id = url.searchParams.get('id'); if (!id || !/^\d+$/.test(id)) return ''; url.search = ''; url.searchParams.set('id', id); }
  else { if (!/^\/[\w.-]+$/.test(path) && !/^\/(?:pages|people)\/[^/]+\/\d+$/i.test(path)) return ''; url.search = ''; }
  url.pathname = path; return url.href;
}
export function facebookEvidenceUrl(value: string): string {
  const url = facebookUrl(value); if (!url || url.pathname === '/' || /^\/(?:login|sharer|share|plugins|l\.php|dialog)\b/i.test(url.pathname)) return '';
  if (!/\/(?:posts|videos|reel)\//i.test(url.pathname) && !(/^\/(?:story|permalink|photo)\.php$/i.test(url.pathname) && (url.searchParams.has('story_fbid') || url.searchParams.has('fbid')))) return '';
  for (const key of [...url.searchParams.keys()]) if (!['id', 'story_fbid', 'fbid', 'v'].includes(key)) url.searchParams.delete(key);
  return url.href;
}
export function readFacebookResearch(value: unknown): FacebookResearch {
  try { const raw = typeof value === 'string' ? JSON.parse(value) : value; const { reviewedAt, reviewedBy, ...editable } = raw || {}; const parsed = facebookResearchSchema.safeParse(editable); return parsed.success ? { ...parsed.data, reviewedAt, reviewedBy } : { identityChecks: [], messenger: 'unknown', websiteStatus: 'unknown' }; } catch { return { identityChecks: [], messenger: 'unknown', websiteStatus: 'unknown' }; }
}

export type SalesProspect = { name: string; city?: string; address?: string; provider?: string; providerRecordId?: string; phone: string; email: string; website: string; socialUrl: string; facebookStatus?: string; facebookVerifiedAt?: string; facebookResearch?: FacebookResearch; businessStatus?: string; score?: number; aiScore?: number; aiStatus?: string; ruleScore?: number; aiIcpMatch?: string; importedLeadId?: string };
export function pageConfirmed(prospect: SalesProspect) { const research = prospect.facebookResearch; return prospect.facebookStatus === 'confirmed' && !!normalizeFacebookPageUrl(prospect.socialUrl) && !!research?.pageName?.trim() && research.identityChecks.includes('name') && research.identityChecks.length >= 2; }
export function facebookActivity(prospect: SalesProspect, now = Date.now()): 'recent' | 'older' | 'unknown' {
  const research = prospect.facebookResearch;
  if (!pageConfirmed(prospect) || !research?.lastPostAt || !research.postUrl || !research.identityChecks.includes('name') || research.identityChecks.length < 2) return 'unknown';
  const post = Date.parse(`${research.lastPostAt}T00:00:00Z`); const reviewed = Date.parse(research.reviewedAt || prospect.facebookVerifiedAt || '');
  if (!Number.isFinite(post) || !Number.isFinite(reviewed) || post > now || reviewed > now + 60_000 || now - reviewed > 90 * 86400000) return 'unknown';
  return now - post <= 30 * 86400000 ? 'recent' : 'older';
}
export function contactChannel(prospect: SalesProspect): 'Facebook' | 'Phone' | 'Email' | 'Review' {
  if (pageConfirmed(prospect) && prospect.facebookResearch?.messenger === 'available') return 'Facebook';
  if (prospect.email) return 'Email'; if (prospect.phone) return 'Phone'; return 'Review';
}
export function matchesContactRequirements(prospect: Pick<SalesProspect, 'phone' | 'website' | 'email' | 'socialUrl'> & Partial<SalesProspect>, requirements: string[], mode: RequirementMode = 'all') {
  if (!requirements.length) return true;
  const matches = (field: string) => field === 'Phone' ? !!prospect.phone : field === 'Email' ? !!prospect.email : field === 'Website' ? !!prospect.website : ['Facebook', 'Social'].includes(field) ? pageConfirmed(prospect as SalesProspect) : false;
  return mode === 'any' ? requirements.some(matches) : requirements.every(matches);
}
export function prospectScore(prospect: SalesProspect) { return Math.round(['complete', 'cached'].includes(prospect.aiStatus || '') ? prospect.aiScore ?? prospect.score ?? 0 : prospect.ruleScore ?? prospect.score ?? 0); }
export function readiness(prospect: SalesProspect, requirements: string[], mode: RequirementMode = 'all') {
  if (prospect.businessStatus && prospect.businessStatus !== 'OPERATIONAL') return 'Business status needs review';
  if (!matchesContactRequirements(prospect, requirements, mode)) return 'Criteria need review';
  if (contactChannel(prospect) === 'Review') return 'Contact needs review';
  if (prospectScore(prospect) < 65 || ['complete','cached'].includes(prospect.aiStatus || '') && prospect.aiIcpMatch === 'weak') return 'Low fit';
  return prospectScore(prospect) >= 82 && ['complete', 'cached'].includes(prospect.aiStatus || '') ? 'Strong match' : 'Ready for outreach';
}
export function outreachPlan(prospect: SalesProspect, focus: SalesFocus = 'Website & booking') {
  const channel = contactChannel(prospect);
  const research = prospect.facebookResearch;
  const offer = focus === 'Website & booking' ? 'website and booking improvements' : focus === 'Digital marketing' ? 'digital marketing support' : 'services';
  const reviewedAngle = pageConfirmed(prospect) ? research?.conversationAngle?.trim() : '';
  const draft = reviewedAngle ? `Hi ${prospect.name} team, ${reviewedAngle}` : `Hi ${prospect.name} team, who would be the right person to speak with about ${offer}?`;
  return { channel, taskType: channel === 'Facebook' ? 'Facebook message' : channel === 'Email' ? 'Email' : channel === 'Phone' ? 'Call' : 'Research', title: channel === 'Review' ? 'Verify contact channel' : `Initial ${channel === 'Facebook' ? 'Facebook' : channel.toLowerCase()} follow-up`, draft, reason: channel === 'Facebook' ? 'Confirmed page with messaging availability reviewed.' : channel === 'Review' ? 'No usable contact channel has been verified.' : `Published business ${channel.toLowerCase()}.` };
}
export function normalizedIdentity(value?: string) { return (value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
export function sameProspect(a: SalesProspect, b: SalesProspect) {
  if (a.provider && a.providerRecordId && a.provider === b.provider && a.providerRecordId === b.providerRecordId) return true;
  return normalizedIdentity(a.name) === normalizedIdentity(b.name) && !!normalizedIdentity(a.city) && normalizedIdentity(a.city) === normalizedIdentity(b.city) && !!normalizedIdentity(a.address) && normalizedIdentity(a.address) === normalizedIdentity(b.address);
}
export function salesOpportunity(prospect: SalesProspect, focus: SalesFocus = 'Website & booking') {
  if (focus === 'General outreach') return 'Explore business needs';
  if (focus === 'Digital marketing') return pageConfirmed(prospect) && prospect.facebookResearch?.customerSignals ? 'Review observed marketing needs' : 'Explore marketing needs';
  if (prospect.website) return 'Review website conversion';
  return prospect.facebookResearch?.websiteStatus === 'not_found' && pageConfirmed(prospect) ? 'Explore website & booking needs' : 'Verify website presence';
}
