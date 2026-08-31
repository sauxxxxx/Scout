import { describe, expect, it } from 'vitest';
import { activityInputSchema, leadInputSchema, memberInputSchema, taskInputSchema } from '@/lib/validation';

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
    const task = { id: 1, title: 'Call lead', lead: 'ABC Dental Clinic', owner: 'Shaun', priority: 'High', due: 'Today', time: '10:30', type: 'Call', notes: '', status: 'Scheduled' };
    expect(taskInputSchema.safeParse(task).success).toBe(true);
    expect(taskInputSchema.safeParse({ ...task, time: '25:70' }).success).toBe(false);
  });

  it('validates activities and workspace invitations', () => {
    expect(activityInputSchema.safeParse({ id: 1, lead: 'ABC Dental Clinic', type: 'Call', detail: 'Connected', time: 'Today', owner: 'Shaun' }).success).toBe(true);
    expect(memberInputSchema.safeParse({ name: 'Mika Santos', email: 'mika@example.com', role: 'member' }).success).toBe(true);
    expect(memberInputSchema.safeParse({ name: 'Mika Santos', email: 'bad', role: 'superuser' }).success).toBe(false);
  });
});
