import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Activities, Finder, Leads, PipelineWorkspace, Settings, Tasks } from '../app/page';
import { FinderWorkspace } from '../components/FinderWorkspace';

const noop = vi.fn();
const asyncNoop = vi.fn(async () => undefined);

const lead = {
  id: 'lead-1', version: 1, companyId: 'company-1', primaryContactId: 'contact-1',
  name: 'ABC Dental Clinic', industry: 'Dental clinic', city: 'Cebu City', status: 'Interested',
  score: 91, owner: 'Shaun', last: 'Today, 09:18', next: 'Follow up today · 10:30',
  phone: '+63 917 430 1182', email: 'hello@example.com', contact: 'Juan Dela Cruz',
  priority: 'High', opportunity: 'Website redesign',
};
const company = { id: 'company-1', version: 1, name: lead.name, industry: lead.industry, city: lead.city, phone: lead.phone, email: lead.email, owner: lead.owner, archived: false };
const contact = { id: 'contact-1', version: 1, companyId: company.id, name: lead.contact, email: lead.email, phone: lead.phone, isPrimary: true, archived: false };
const opportunity = { id: 'opportunity-1', version: 1, companyId: company.id, leadId: lead.id, primaryContactId: contact.id, name: lead.opportunity, stage: lead.status, value: 0, probability: 91, owner: lead.owner, priority: lead.priority, archived: false };

describe('primary workspace views', () => {
  it.each([
    ['Leads', Leads, { leads: [lead], setLeads: noop, activities: [], setActivities: noop, setTasks: noop, leadView: 'Leads', notify: noop, focusedLead: null, setFocusedLead: noop, companies: [company], contacts: [contact], opportunities: [opportunity], onSaveCompany: asyncNoop, onCreateContact: asyncNoop, onSaveContact: asyncNoop, onDeleteContact: asyncNoop, onCreateOpportunity: asyncNoop, onSaveOpportunity: asyncNoop }],
    ['Finder', Finder, { notify: noop, leads: [lead], onImportedLeads: noop, setPage: noop, finderView: 'New search', setFinderView: noop }],
    ['Finder workflow', FinderWorkspace, { notify: noop, leads: [lead], onImportedLeads: noop, setPage: noop, finderView: 'New search', setFinderView: noop }],
    ['Pipeline', PipelineWorkspace, { view: 'All pipeline', setView: noop, opportunities: [opportunity], companies: [company], contacts: [contact], leads: [lead], tasks: [], activities: [], onCreate: asyncNoop, onSave: asyncNoop, notify: noop, openLead: noop, focusedOpportunity: null, setFocusedOpportunity: noop }],
    ['Tasks', Tasks, { tasks: [], setTasks: noop, leads: [lead], setLeads: noop, setActivities: noop, notify: noop, openLead: noop, taskView: 'Today', focusedTaskId: null, setFocusedTaskId: noop }],
    ['Activities', Activities, { activities: [], setActivities: noop, leads: [lead], tasks: [], setTasks: noop, notify: noop, openLead: noop, openTask: noop, openOpportunity: noop, activityView: 'All activity', setActivityView: noop }],
    ['Settings', Settings, { session: { user: { id: 'user-1', name: 'Shaun', email: 'shaun@example.com' }, workspace: { id: 'workspace-1', name: 'Sales workspace' }, role: 'owner' }, notify: noop }],
  ] as const)('%s renders without throwing', (_name, Component, props) => {
    expect(() => renderToString(createElement(Component as never, props as never))).not.toThrow();
  });
});
