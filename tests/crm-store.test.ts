import { describe, expect, it } from 'vitest';
import { mapCompany, mapContact, mapOpportunity } from '@/lib/crm-store';

describe('core CRM row mapping', () => {
  it('maps company and contact relationships from database rows', () => {
    expect(mapCompany({ id: 'company-1', version: 2, name: 'Scout Dental', industry: 'Healthcare', city: 'Cebu', phone: '', email: '', owner: 'Shaun', archived: 0 })).toMatchObject({ id: 'company-1', version: 2, name: 'Scout Dental', archived: false });
    expect(mapContact({ id: 'contact-1', company_id: 'company-1', name: 'Angela Lim', email: '', phone: '', is_primary: 1, archived: 0 })).toMatchObject({ id: 'contact-1', companyId: 'company-1', name: 'Angela Lim', isPrimary: true });
  });

  it('keeps opportunity identity separate from its company and lead', () => {
    expect(mapOpportunity({ id: 'opportunity-1', company_id: 'company-1', lead_id: 'lead-1', primary_contact_id: 'contact-1', name: 'Expansion', stage: 'Negotiation', value: 85000, probability: 75, owner: 'Mika', priority: 'High', archived: 0 })).toEqual({
      id: 'opportunity-1', version: 1, companyId: 'company-1', leadId: 'lead-1', primaryContactId: 'contact-1', name: 'Expansion', stage: 'Negotiation', value: 85000, probability: 75, closeDate: undefined, owner: 'Mika', priority: 'High', outcome: undefined, archived: false,
    });
  });
});
