import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Activities } from '../components/crm/Activities';
import { Leads } from '../components/crm/Leads';
import { PipelineWorkspace } from '../components/crm/Pipeline';
import { Settings } from '../components/crm/Settings';
import { PageSkeleton, ScoutLogo } from '../components/crm/shared';
import { Tasks } from '../components/crm/Tasks';
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
  it('shows map search without exposing developer spending concepts', () => {
    const markup = renderToString(createElement(FinderWorkspace, { notify: noop, leads: [], onImportedLeads: noop, setPage: noop, finderView: 'New search', setFinderView: noop }));
    expect(markup).toContain('Business map');
    expect(markup).toContain('Find businesses');
    expect(markup).not.toMatch(/AI spend|AI cost|monthly limit|credits/i);
  });
  it('shows an unscored lead as unscored instead of inventing a number', () => {
    const props = { leads: [{ ...lead, score: 0 }], setLeads: noop, activities: [], setActivities: noop, setTasks: noop, leadView: 'Leads', notify: noop, focusedLead: null, setFocusedLead: noop, companies: [company], contacts: [contact], opportunities: [opportunity], onSaveCompany: asyncNoop, onCreateContact: asyncNoop, onSaveContact: asyncNoop, onDeleteContact: asyncNoop, onCreateOpportunity: asyncNoop, onSaveOpportunity: asyncNoop };
    const markup = renderToString(createElement(Leads as never, props as never));
    expect(markup).toContain('<strong>—</strong>');
    expect(markup).not.toMatch(/>(Low|Medium|High)<\/small>/);
  });
  it('shows the score with its priority and never a rank', () => {
    const props = { leads: [lead], setLeads: noop, activities: [], setActivities: noop, setTasks: noop, leadView: 'Leads', notify: noop, focusedLead: null, setFocusedLead: noop, companies: [company], contacts: [contact], opportunities: [opportunity], onSaveCompany: asyncNoop, onCreateContact: asyncNoop, onSaveContact: asyncNoop, onDeleteContact: asyncNoop, onCreateOpportunity: asyncNoop, onSaveOpportunity: asyncNoop };
    const markup = renderToString(createElement(Leads as never, props as never));
    expect(markup).toContain('<strong>91</strong>');
    expect(markup).toContain('priority-badge high');
    expect(markup).not.toMatch(/#d+/);
  });
  it('announces the loading state to screen readers', () => {
    const markup = renderToString(createElement(PageSkeleton));
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-label="Loading"');
  });
  it('ships a logo for light and dark themes', () => {
    const markup = renderToString(createElement(ScoutLogo));
    expect(markup).toContain('/scout-logo.svg');
    expect(markup).toContain('/scout-logo-dark.svg');
  });
  it('starts Finder without repeating the form back to the user', () => {
    const markup = renderToString(createElement(FinderWorkspace, { notify: noop, leads: [], onImportedLeads: noop, setPage: noop, finderView: 'New search', setFinderView: noop }));
    expect(markup).not.toMatch(/Build your prospect list|Your search|worth contacting/);
  });
  it.each([
    ['Leads', Leads, { leads: [lead], setLeads: noop, activities: [], setActivities: noop, setTasks: noop, leadView: 'Leads', notify: noop, focusedLead: null, setFocusedLead: noop, companies: [company], contacts: [contact], opportunities: [opportunity], onSaveCompany: asyncNoop, onCreateContact: asyncNoop, onSaveContact: asyncNoop, onDeleteContact: asyncNoop, onCreateOpportunity: asyncNoop, onSaveOpportunity: asyncNoop }],
    ['Finder workflow', FinderWorkspace, { notify: noop, leads: [lead], onImportedLeads: noop, setPage: noop, finderView: 'New search', setFinderView: noop }],
    ['Pipeline', PipelineWorkspace, { view: 'All pipeline', setView: noop, opportunities: [opportunity], companies: [company], contacts: [contact], leads: [lead], tasks: [], activities: [], onCreate: asyncNoop, onSave: asyncNoop, notify: noop, openLead: noop, focusedOpportunity: null, setFocusedOpportunity: noop }],
    ['Tasks', Tasks, { tasks: [], setTasks: noop, leads: [lead], setLeads: noop, setActivities: noop, notify: noop, openLead: noop, taskView: 'Today', focusedTaskId: null, setFocusedTaskId: noop }],
    ['Activities', Activities, { activities: [], setActivities: noop, leads: [lead], tasks: [], setTasks: noop, notify: noop, openLead: noop, openTask: noop, openOpportunity: noop, activityView: 'All activity', setActivityView: noop }],
    ['Settings', Settings, { session: { user: { id: 'user-1', name: 'Shaun', email: 'shaun@example.com' }, workspace: { id: 'workspace-1', name: 'Sales workspace' }, role: 'owner' }, notify: noop }],
  ] as const)('%s renders without throwing', (_name, Component, props) => {
    expect(() => renderToString(createElement(Component as never, props as never))).not.toThrow();
  });
});
