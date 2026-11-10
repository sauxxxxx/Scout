import { FINDER_MAX_LEADS } from '@/lib/finder-cells';
import { isCountry } from '@/lib/countries';
import { z } from 'zod';
import { finderAreaSchema, finderBoundsSchema } from '@/lib/finder-map';
import { facebookResearchSchema, normalizeFacebookPageUrl, salesFocuses } from '@/lib/finder-sales';

const optionalText = z.string().trim().max(500).optional().nullable();
const recordId = z.string().uuid();

export const leadStatuses = ['New', 'Prospect', 'Contacted', 'Interested', 'Follow-up', 'Proposal', 'Negotiation', 'Won', 'Lost'] as const;
export const taskStatuses = ['Open', 'Backlog', 'Scheduled', 'In progress', 'Waiting', 'Completed'] as const;

export const leadInputSchema = z.object({
  id: recordId.optional(),
  version: z.number().int().positive().optional(),
  companyId: recordId.optional(),
  primaryContactId: recordId.optional(),
  name: z.string().trim().min(1).max(160),
  industry: z.string().trim().min(1).max(120),
  city: z.string().trim().min(1).max(120),
  status: z.enum(leadStatuses),
  score: z.number().int().min(0).max(100),
  owner: z.string().trim().min(1).max(120),
  last: z.string().trim().max(120),
  next: z.string().trim().max(240),
  phone: z.string().trim().max(80),
  email: z.union([z.literal(''), z.email().max(254)]),
  facebookUrl: z.string().trim().max(500).refine(value => !value || /^(?:https?:\/\/)?(?:[\w-]+\.)?(?:facebook|fb)\.com\//i.test(value), 'Use the business’s Facebook page link.').optional(),
  contact: z.string().trim().max(160),
  priority: z.enum(['Low', 'Medium', 'High']),
  opportunity: z.string().trim().max(240),
  value: z.number().finite().nonnegative().optional(),
  probability: z.number().int().min(0).max(100).optional(),
  closeDate: optionalText,
  archived: z.boolean().optional(),
  country: z.string().refine(isCountry, 'Choose a country.').optional(),
  createdAt: optionalText,
  lastTouchAt: optionalText,
  changedAt: optionalText,
}).strict();

export const companyInputSchema = z.object({
  id: recordId.optional(), version:z.number().int().positive().optional(), name:z.string().trim().min(1).max(160),
  industry:z.string().trim().max(120), city:z.string().trim().max(120), phone:z.string().trim().max(80),
  email:z.union([z.literal(''),z.email().max(254)]), website:z.union([z.literal(''),z.url().max(2000)]).optional().nullable(),
  facebookUrl:z.union([z.literal(''),z.url().max(2000)]).optional().nullable(),
  facebookStatus:z.enum(['confirmed','possible','not_found']).optional(),
  facebookResearch:facebookResearchSchema.safeExtend({ reviewedAt:optionalText, reviewedBy:optionalText }).optional(),
  owner:z.string().trim().min(1).max(120), archived:z.boolean().optional(),
}).strict();

export const contactInputSchema = z.object({
  id:recordId.optional(), version:z.number().int().positive().optional(), companyId:recordId,
  name:z.string().trim().min(1).max(160), title:optionalText, email:z.union([z.literal(''),z.email().max(254)]),
  phone:z.string().trim().max(80), isPrimary:z.boolean().optional(), archived:z.boolean().optional(),
}).strict();

export const opportunityInputSchema = z.object({
  id:recordId.optional(), version:z.number().int().positive().optional(), companyId:recordId, leadId:recordId.optional(), primaryContactId:recordId.optional(),
  name:z.string().trim().min(1).max(200), stage:z.enum(leadStatuses), value:z.number().finite().nonnegative(), probability:z.number().int().min(0).max(100),
  closeDate:optionalText, owner:z.string().trim().min(1).max(120), priority:z.enum(['Low','Medium','High']), outcome:optionalText, archived:z.boolean().optional(),
  fromFinder: z.boolean().optional(),
  closedAt: optionalText,
}).strict();

export const taskInputSchema = z.object({
  uid: recordId.optional(),
  id: z.number().int().nonnegative(),
  version: z.number().int().positive().optional(),
  title: z.string().trim().min(1).max(200),
  lead: z.string().trim().min(1).max(160),
  leadId: recordId.optional(),
  companyId: recordId.optional(),
  contactId: recordId.optional(),
  opportunityId: recordId.optional(),
  owner: z.string().trim().min(1).max(120),
  priority: z.enum(['Low', 'Medium', 'High']),
  due: z.string().trim().min(1).max(80),
  dueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  type: z.string().trim().min(1).max(80),
  notes: z.string().trim().max(2000),
  status: z.enum(taskStatuses),
  reminder: optionalText,
  recurrence: optionalText,
  outcome: optionalText,
}).strict();

export const activityInputSchema = z.object({
  uid: recordId.optional(),
  id: z.number().int().nonnegative(),
  version: z.number().int().positive().optional(),
  lead: z.string().trim().min(1).max(160),
  leadId: recordId.optional(),
  companyId: recordId.optional(),
  contactId: recordId.optional(),
  opportunityId: recordId.optional(),
  type: z.string().trim().min(1).max(80),
  detail: z.string().trim().min(1).max(2000),
  time: z.string().trim().min(1).max(120),
  owner: z.string().trim().min(1).max(120),
  status: z.enum(['Completed', 'Scheduled']).optional(),
  occurredAt: optionalText,
  outcome: optionalText,
  duration: optionalText,
  subject: optionalText,
  value: optionalText,
  documentLink: z.union([z.literal(''), z.url().max(2000)]).optional().nullable(),
  attachmentKey: optionalText,
  attachmentName: optionalText,
  relatedTaskId: z.number().int().nonnegative().optional(),
  relatedTaskUid: recordId.optional(),
  opportunity: optionalText,
  deletedAt: optionalText,
}).strict();

export const finderRequirements = ['Phone', 'Website', 'Email', 'Facebook', 'Social'] as const;

export const finderSearchSchema = z.object({
  area: finderAreaSchema.optional(),
  bounds: finderBoundsSchema.optional(),
  action: z.enum(['run', 'save']),
  searchId: recordId.optional(),
  industry: z.string().trim().min(2).max(120).optional(),
  industryType: z.string().trim().max(120).optional(),
  industryPsicCode: z.string().trim().max(30).optional(),
  country: z.string().refine(isCountry, 'Choose a country.').optional(),
  location: z.string().trim().min(2).max(160).optional(),
  locationCode: z.string().trim().max(30).optional(),
  locationType: z.string().trim().max(50).optional(),
  locationProvince: z.string().trim().max(160).optional(),
  locationRegion: z.string().trim().max(160).optional(),
  targetCount: z.number().int().min(1).max(FINDER_MAX_LEADS).optional(),
  includeFound: z.boolean().optional(),
  requirements: z.array(z.enum(finderRequirements)).min(1).max(finderRequirements.length).optional(),
  salesFocus: z.enum(salesFocuses).default('Website & booking'),
  requirementMode: z.enum(['all', 'any']).default('all'),
}).strict().superRefine((value, context) => {
  if (value.searchId) return;
  if (!value.industry) context.addIssue({ code: 'custom', path: ['industry'], message: 'Industry is required.' });
  if (!value.location) context.addIssue({ code: 'custom', path: ['location'], message: 'Location is required.' });
  if (!value.targetCount) context.addIssue({ code: 'custom', path: ['targetCount'], message: 'Lead count is required.' });
});

export const finderImportSchema = z.object({
  action: z.literal('import'),
  searchId: recordId,
  resultIds: z.array(recordId).min(1).max(60),
  assignmentMode: z.enum(['single', 'round_robin', 'manual']),
  ownerId: z.string().trim().min(1).max(240).optional(),
  assigneeIds: z.array(z.string().trim().min(1).max(240)).max(100).optional(),
  manualAssignments: z.record(recordId, z.string().trim().min(1).max(240)).optional(),
  priority: z.enum(['Low', 'Medium', 'High']),
  status: z.enum(['New', 'Prospect', 'Contacted', 'Interested']),
  followUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  channel: z.enum(['Recommended', 'Facebook', 'Phone', 'Email', 'Research']).default('Recommended'),
  allowPossibleDuplicates: z.boolean().default(false),
}).strict().superRefine((value, context) => {
  if (value.assignmentMode === 'single' && !value.ownerId) context.addIssue({ code: 'custom', path: ['ownerId'], message: 'Select an owner.' });
  if (value.assignmentMode === 'round_robin' && !value.assigneeIds?.length) context.addIssue({ code: 'custom', path: ['assigneeIds'], message: 'Select at least one assignee.' });
  if (value.assignmentMode === 'manual' && value.resultIds.some(id => !value.manualAssignments?.[id])) context.addIssue({ code: 'custom', path: ['manualAssignments'], message: 'Assign every selected business.' });
});

export const finderAiRetrySchema = z.object({
  action: z.literal('retry-ai'),
  searchId: recordId,
  resultId: recordId,
}).strict();

export const finderFacebookSchema = z.object({
  action: z.literal('facebook'),
  searchId: recordId,
  resultId: recordId,
  facebookUrl: z.union([z.literal(''), z.url().max(2000)]),
  status: z.enum(['confirmed', 'possible', 'not_found']),
  research: facebookResearchSchema.optional(),
  reviewVersion: z.number().int().nonnegative().optional(),
}).strict().superRefine((value, context) => {
  if (value.status !== 'not_found' && !normalizeFacebookPageUrl(value.facebookUrl)) {
    context.addIssue({ code: 'custom', path: ['facebookUrl'], message: 'Enter a valid Facebook page URL.' });
  }
  if (value.status === 'confirmed' && (!value.research?.identityChecks.includes('name') || value.research.identityChecks.length < 2 || !value.research.pageName)) context.addIssue({ code: 'custom', path: ['research'], message: 'Match the page name and at least one location or contact detail before confirming.' });
});

export const finderBulkProspectsSchema = z.object({
  action: z.literal('add-prospects'), searchId: recordId, city: z.string().trim().min(2).max(160),
  prospects: z.array(z.object({
    name: z.string().trim().min(2).max(160),
    facebookUrl: z.string().max(2000).refine(value => !!normalizeFacebookPageUrl(value), 'Enter a business Facebook page URL.'),
  }).strict()).min(1).max(50),
  locationConfirmed: z.literal(true, { error: 'Check that these businesses are in your selected search area.' }),
}).strict();

export const finderManualProspectSchema = z.object({
  action: z.literal('add-prospect'), searchId: recordId, name: z.string().trim().min(2).max(160),
  city: z.string().trim().min(2).max(160), address: z.string().trim().max(300),
  facebookUrl: z.string().max(2000).refine(value => !!normalizeFacebookPageUrl(value), 'Enter a business Facebook page URL.'),
  phone: z.string().trim().max(80), email: z.union([z.literal(''), z.email().max(254)]),
  website: z.union([z.literal(''), z.url().max(2000)]).refine(value => !normalizeFacebookPageUrl(value), 'Put the Facebook page in the Facebook field; add a separate business website here.'),
  locationConfirmed: z.literal(true, { error: 'Check that this business is in your selected search area.' }),
}).strict();

const fieldLabels: Record<string, string> = { name: 'Name', industry: 'Industry', city: 'City', email: 'Email', phone: 'Phone', owner: 'Owner', title: 'Title', value: 'Value', probability: 'Probability', lead: 'Lead', companyId: 'Company', stage: 'Stage' };

export function validationError(error: z.ZodError) {
  const fields = z.flattenError(error).fieldErrors as Record<string, string[] | undefined>;
  const field = Object.keys(fields)[0];
  const message = field ? `${fieldLabels[field] || field} is missing or not valid.` : 'Check the details and try again.';
  return Response.json({ error: message, fields }, { status: 422 });
}
