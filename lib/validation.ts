import { z } from 'zod';
import { workspaceRoles } from '@/lib/permissions';

const optionalText = z.string().trim().max(500).optional().nullable();
const recordId = z.string().uuid();

export const leadStatuses = ['New', 'Contacted', 'Interested', 'Follow-up', 'Proposal', 'Negotiation', 'Won', 'Lost'] as const;
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
  contact: z.string().trim().max(160),
  priority: z.enum(['Low', 'Medium', 'High']),
  opportunity: z.string().trim().max(240),
  value: z.number().finite().nonnegative().optional(),
  probability: z.number().int().min(0).max(100).optional(),
  closeDate: optionalText,
  archived: z.boolean().optional(),
}).strict();

export const companyInputSchema = z.object({
  id: recordId.optional(), version:z.number().int().positive().optional(), name:z.string().trim().min(1).max(160),
  industry:z.string().trim().max(120), city:z.string().trim().max(120), phone:z.string().trim().max(80),
  email:z.union([z.literal(''),z.email().max(254)]), website:z.union([z.literal(''),z.url().max(2000)]).optional().nullable(),
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

export const memberInputSchema = z.object({
  email: z.email().max(254),
  name: z.string().trim().min(1).max(120),
  role: z.enum(workspaceRoles),
}).strict();

export const finderRequirements = ['Phone', 'Website', 'Email', 'Social'] as const;

export const finderSearchSchema = z.object({
  action: z.enum(['run', 'save']),
  searchId: recordId.optional(),
  industry: z.string().trim().min(2).max(120).optional(),
  location: z.string().trim().min(2).max(160).optional(),
  targetCount: z.number().int().min(1).max(60).optional(),
  requirements: z.array(z.enum(finderRequirements)).max(finderRequirements.length).optional(),
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
  owner: z.string().trim().min(1).max(120),
  priority: z.enum(['Low', 'Medium', 'High']),
  status: z.enum(['New', 'Contacted', 'Interested']),
  followUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict();

export function validationError(error: z.ZodError) {
  return Response.json({ error: 'Validation failed.', fields: z.flattenError(error).fieldErrors }, { status: 422 });
}
