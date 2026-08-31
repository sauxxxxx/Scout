import { describe, expect, it } from 'vitest';
import { activityInputSchema, companyInputSchema, contactInputSchema, leadInputSchema, memberInputSchema, opportunityInputSchema, taskInputSchema } from '@/lib/validation';

const validLead = {
  name: 'ABC Dental Clinic', industry: 'Dental clinic', city: 'Cebu City', status: 'Interested', score: 91,
  owner: 'Shaun', last: 'Today', next: 'Follow up', phone: '+63 917 430 1182', email: 'hello@abcdental.ph',
  contact: 'Juan Dela Cruz', priority: 'High', opportunity: 'Website redesign',
} as const;

describe('record validation', () => {
  it('accepts a valid lead and rejects unsafe lead fields', () => {
    expect(leadInputSchema.safeParse(validLead).success).toBe(true);
    expect(leadInputSchema.safeParse({ ...validLead, score: 101 }).success).toBe(false);
    expect(leadInputSchema.safeParse({ ...validLead, email: 'not-an-email' }).success).toBe(false);
    expect(leadInputSchema.safeParse({ ...validLead, injected: true }).success).toBe(false);
  });

  it('requires a valid task time and status', () => {
    const task = { id: 1, title: 'Call lead', lead: 'ABC Dental Clinic', owner: 'Shaun', priority: 'High', due: 'Today', dueAt: '2026-08-31', time: '10:30', type: 'Call', notes: '', status: 'Scheduled' };
    expect(taskInputSchema.safeParse(task).success).toBe(true);
    expect(taskInputSchema.safeParse({ ...task, time: '25:70' }).success).toBe(false);
    expect(taskInputSchema.safeParse({ ...task, dueAt: 'Aug 31' }).success).toBe(false);
  });

  it('validates activities and workspace invitations', () => {
    expect(activityInputSchema.safeParse({ id: 1, lead: 'ABC Dental Clinic', type: 'Call', detail: 'Connected', time: 'Today', owner: 'Shaun' }).success).toBe(true);
    expect(memberInputSchema.safeParse({ name: 'Mika Santos', email: 'mika@example.com', role: 'member' }).success).toBe(true);
    expect(memberInputSchema.safeParse({ name: 'Mika Santos', email: 'bad', role: 'superuser' }).success).toBe(false);
  });

  it('validates normalized company, contact, and opportunity records', () => {
    const companyId = '3d7bafde-c804-4a8f-b63f-d6fbec89ab19';
    const contactId = '337850f5-dbc5-4d8d-94b2-495641940060';
    expect(companyInputSchema.safeParse({ name: 'ABC Dental Clinic', industry: 'Healthcare', city: 'Cebu City', phone: '', email: '', website: 'https://example.com', owner: 'Shaun' }).success).toBe(true);
    expect(contactInputSchema.safeParse({ companyId, name: 'Angela Lim', email: 'angela@example.com', phone: '', isPrimary: true }).success).toBe(true);
    expect(opportunityInputSchema.safeParse({ companyId, primaryContactId: contactId, name: 'Website redesign', stage: 'Proposal', value: 125000, probability: 60, owner: 'Shaun', priority: 'High' }).success).toBe(true);
    expect(opportunityInputSchema.safeParse({ companyId, name: 'Invalid probability', stage: 'Proposal', value: 1000, probability: 101, owner: 'Shaun', priority: 'High' }).success).toBe(false);
    expect(contactInputSchema.safeParse({ companyId: 'not-a-stable-id', name: 'Angela Lim', email: '', phone: '' }).success).toBe(false);
  });
});
