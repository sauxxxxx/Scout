import { z } from 'zod';
import { workspaceRoles } from '@/lib/permissions';

const optionalText = z.string().trim().max(500).optional().nullable();
const recordId = z.string().uuid();

export const leadStatuses = ['New', 'Contacted', 'Interested', 'Follow-up', 'Proposal', 'Negotiation', 'Won', 'Lost'] as const;
export const taskStatuses = ['Open', 'Backlog', 'Scheduled', 'In progress', 'Waiting', 'Completed'] as const;

export const leadInputSchema = z.object({
  id: recordId.optional(),
  version: z.number().int().positive().optional(),
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

export const taskInputSchema = z.object({
  uid: recordId.optional(),
  id: z.number().int().nonnegative(),
  version: z.number().int().positive().optional(),
  title: z.string().trim().min(1).max(200),
  lead: z.string().trim().min(1).max(160),
  leadId: recordId.optional(),
  owner: z.string().trim().min(1).max(120),
  priority: z.enum(['Low', 'Medium', 'High']),
  due: z.string().trim().min(1).max(80),
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

export function validationError(error: z.ZodError) {
  return Response.json({ error: 'Validation failed.', fields: z.flattenError(error).fieldErrors }, { status: 422 });
}
