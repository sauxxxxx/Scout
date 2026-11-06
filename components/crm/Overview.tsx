'use client';

import { useEffect, useMemo, useState } from 'react';
import { FiChevronDown, FiChevronLeft, FiChevronRight, FiChevronUp, FiPlus, FiSearch, FiSliders } from 'react-icons/fi';
import { localIso } from '@/lib/task-dates';
import { useWorkspaceMembers } from '@/components/WorkspaceMembers';
import { type ProfileUpdate } from '@/lib/profile';
import type { Page, Opportunity, ActivityEntry, TaskItem } from '@/lib/crm-types';
import { Avatar, EmptyState, Heading, ToolMenu, CustomSelect, OwnerSelect, PriorityBadge, useCustomization, useViewSettings } from '@/components/crm/shared';
import { moved, overviewSectionOptions, type OverviewSection } from '@/lib/view-settings';
import { GettingStarted } from '@/components/GettingStarted';
import { TrendBars } from '@/components/crm/TrendBars';
import { conversionRate, describeChange, emptyResults, overviewPeriods, periodRange, trendBuckets, type OverviewPeriod, type OverviewSummary, type OverviewTeamRow } from '@/lib/overview-period';

const stageNames = ['New', 'Contacted', 'Interested', 'Follow-up', 'Proposal', 'Negotiation', 'Won'];

function LayoutPicker() {
  const { view, updateView } = useViewSettings();
  const sections = view.overviewSections;
  return <ToolMenu label="Customize" icon={<FiSliders />}>{() => <div className="column-picker">{sections.map((section, index) => {
    const label = overviewSectionOptions.find(option => option.key === section.key)?.label;
    return <div key={section.key}><label><input type="checkbox" checked={section.visible} onChange={() => updateView({ overviewSections: sections.map(item => item.key === section.key ? { ...item, visible: !item.visible } : item) })} />{label}</label><button aria-label={`Move ${label} up`} disabled={index === 0} onClick={() => updateView({ overviewSections: moved(sections, index, -1) })}><FiChevronUp /></button><button aria-label={`Move ${label} down`} disabled={index === sections.length - 1} onClick={() => updateView({ overviewSections: moved(sections, index, 1) })}><FiChevronDown /></button></div>;
  })}</div>}</ToolMenu>;
}

function Metric({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return <div><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>;
}

function TeamTable({ rows, money }: { rows: OverviewTeamRow[]; money: (value: number) => string }) {
  return <section className="team-results"><h2>Team results</h2>
    <div className="team-results-table" role="table" aria-label="Team results">
      <div className="team-results-head" role="row">{['Rep', 'Calls', 'Emails', 'Meetings', 'New leads', 'Won', 'Revenue'].map(label => <span role="columnheader" key={label}>{label}</span>)}</div>
      {rows.map(row => <div role="row" key={row.name}><strong role="cell" className="team-rep"><Avatar name={row.name} />{row.name}</strong><span role="cell">{row.calls}</span><span role="cell">{row.emails}</span><span role="cell">{row.meetings}</span><span role="cell">{row.newLeads}</span><span role="cell">{row.wonCount}</span><span role="cell">{money(row.wonValue)}</span></div>)}
    </div>
  </section>;
}

export function Overview({ setPage, onOpenReports, onCreateLead, onColdLeads, leadCount, opportunities, tasks, activities, openTask, currency }: { setPage: (page: Page) => void; onOpenReports: () => void; onCreateLead: () => void; onColdLeads: () => void; leadCount: number; opportunities: Opportunity[]; tasks: TaskItem[]; activities: ActivityEntry[]; openTask: (id: number) => void; currency: ProfileUpdate['preferences']['currency'] }) {
  const { currentMember, members, assignableMembers, canInvite, currentRole, capabilities } = useWorkspaceMembers();
  const { view } = useViewSettings();
  const { statusLabel } = useCustomization();
  const seesTeam = capabilities['records:view_all'];
  const [taskScope, setTaskScope] = useState<'Mine' | 'Team'>('Mine');
  const [metric, setMetric] = useState<'Leads' | 'Value'>('Leads');
  const [source, setSource] = useState('All sources');
  const [period, setPeriod] = useState<OverviewPeriod>('Monthly');
  const [offset, setOffset] = useState(0);
  const [person, setPerson] = useState('All team');
  const [summary, setSummary] = useState<OverviewSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const today = localIso();
  const range = useMemo(() => periodRange(period, today, offset), [period, today, offset]);
  const money = (value: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);

  const wonOnScreen = opportunities.filter(item => item.stage === 'Won' || item.stage === 'Lost').length;
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ from: range.from, to: range.to, previousFrom: range.previousFrom, previousTo: range.previousTo, source, owner: person });
    fetch(`/api/overview?${query}`, { signal: controller.signal }).then(response => {
      if (!response.ok) throw new Error('Overview unavailable');
      return response.json() as Promise<OverviewSummary>;
    }).then(data => { setSummary(data); setFailed(false); }).catch(error => { if ((error as Error).name !== 'AbortError') setFailed(true); });
    return () => controller.abort();
  }, [range, source, person, wonOnScreen, activities.length, leadCount]);

  const finderCompanyIds = new Set(activities.filter(activity => activity.type === 'Finder import' && activity.companyId).map(activity => activity.companyId));
  const scoped = opportunities.filter(item => !item.archived
    && (person === 'All team' || item.owner === person)
    && (source === 'All sources' || (source === 'Finder' && (item.fromFinder || finderCompanyIds.has(item.companyId))) || (source === 'Manual' && !item.fromFinder && !finderCompanyIds.has(item.companyId))));
  const open = scoped.filter(item => !['Won', 'Lost'].includes(item.stage));
  const pipelineValue = open.reduce((sum, item) => sum + item.value, 0);
  const stageData = stageNames.map(name => { const items = scoped.filter(item => item.stage === name); return { name, count: items.length, value: items.reduce((sum, item) => sum + item.value, 0) }; });
  const hasPipelineData = stageData.some(item => item.count > 0);

  const myName = currentMember?.name;
  const taskOwner = (task: TaskItem) => taskScope === 'Team' ? (person === 'All team' || task.owner === person) : task.owner === myName;
  const todayTasks = tasks.filter(task => task.status !== 'Completed' && taskOwner(task) && (task.dueAt === today || task.due === 'Today')).sort((a, b) => a.time.localeCompare(b.time)).slice(0, 6);
  const overdue = tasks.filter(task => task.status !== 'Completed' && (person === 'All team' ? (seesTeam || task.owner === myName) : task.owner === person) && ((task.dueAt && task.dueAt < today) || task.due === 'Overdue')).length;

  const now = summary?.current;
  const before = summary?.previous;
  const change = (key: 'wonValue' | 'wonCount' | 'newLeads') => (now && before ? describeChange(now[key], before[key], range.previousLabel) : undefined);
  const counted = (value: number | undefined) => (now ? value ?? 0 : failed ? '—' : '…');
  const trend = summary ? trendBuckets(period, range, summary.series) : [];
  const teamRows = seesTeam && person === 'All team' ? assignableMembers.map(member => summary?.team.find(row => row.name === member.name) || { ...emptyResults, name: member.name }).sort((a, b) => b.wonValue - a.wonValue || b.calls - a.calls) : [];

  const sections: Record<OverviewSection, React.ReactNode> = {
    results: <section className="overview-section" aria-label={`Results for ${range.label}`} key="results">
      <div className="overview-hero">
        <div className="overview-hero-number"><span>Won revenue</span><strong>{now ? money(now.wonValue) : counted(undefined)}</strong>{change('wonValue') && <small>{change('wonValue')}</small>}<p className="overview-hero-facts"><span><strong>{counted(now?.wonCount)}</strong> {now?.wonCount === 1 ? 'deal' : 'deals'} won</span><span><strong>{now ? `${conversionRate(now)}%` : counted(undefined)}</strong> conversion</span></p></div>
        <TrendBars title="Won revenue over time" points={trend} format={money} />
      </div>
      <div className="overview-work" aria-label="Sales activity">{([['Prospects', now?.newLeads], ['Calls', now?.calls], ['Emails', now?.emails], ['Meetings', now?.meetings], ['Follow-ups', now?.followUps], ['Proposals', now?.proposals]] as const).map(([label, value]) => <div key={label}><span>{label}</span><strong>{counted(value)}</strong></div>)}</div>
      <button className="text-link overview-report-link" onClick={onOpenReports}>View full report <FiChevronRight /></button>
    </section>,
    team: teamRows.length > 1 ? <TeamTable rows={teamRows} money={money} key="team" /> : null,
    pipeline: <section className="overview-analysis pipeline-flow-analysis" aria-label="Pipeline right now" key="pipeline"><div className="analysis-main">
      <div className="pipeline-overview-head"><div><h2>Right now</h2><div className="pipeline-mode-toggle" aria-label="Chart metric"><button className={metric === 'Leads' ? 'active' : ''} onClick={() => setMetric('Leads')}>Leads</button><button className={metric === 'Value' ? 'active' : ''} onClick={() => setMetric('Value')}>Value</button></div></div></div>
      <div className="overview-pipeline-metrics">
        <Metric label="Pipeline value" value={money(pipelineValue)} />
        <Metric label="Open opportunities" value={open.length} />
        <button className="metric-link" onClick={onColdLeads}><span>No touch in 14+ days</span><strong>{summary ? summary.coldLeads : '…'}</strong><small>View these leads</small></button>
        <button className="metric-link" onClick={() => setPage('Tasks')}><span>Overdue follow-ups</span><strong>{overdue}</strong><small>View tasks</small></button>
      </div>
      {hasPipelineData ? <div className="pipeline-flow">{stageData.map(item => <button className="pipeline-flow-stage" onClick={() => setPage('Pipeline')} key={item.name}><span>{statusLabel(item.name)}</span><strong>{metric === 'Leads' ? item.count : money(item.value)}</strong><small>{metric === 'Leads' ? money(item.value) : `${item.count} lead${item.count === 1 ? '' : 's'}`}</small></button>)}</div> : <EmptyState title="Your pipeline is empty" action={<><button className="primary" onClick={onCreateLead}><FiPlus /> Add lead</button><button className="secondary" onClick={() => setPage('Finder')}><FiSearch /> Find businesses</button></>}>Add a lead or find businesses to start building your pipeline.</EmptyState>}
    </div></section>,
    followups: <section className="today-work" key="followups"><div className="section-head"><h2>Today&apos;s follow-ups</h2><div className="today-scope">{seesTeam && <div className="pipeline-mode-toggle" aria-label="Whose follow-ups"><button className={taskScope === 'Mine' ? 'active' : ''} onClick={() => setTaskScope('Mine')}>Mine</button><button className={taskScope === 'Team' ? 'active' : ''} onClick={() => setTaskScope('Team')}>Team</button></div>}<button onClick={() => setPage('Tasks')}>View all tasks</button></div></div><div className="followup-table"><div className="followup-head"><span>Time</span><span>Business</span><span>Next action</span><span>Priority</span><span /></div>{todayTasks.map(task => <div key={task.uid || task.id}><time>{task.time}</time><strong>{task.lead}</strong><span>{task.title}</span><PriorityBadge priority={task.priority} /><button aria-label={`Open ${task.title}`} onClick={() => openTask(task.id)}><FiChevronRight /></button></div>)}{todayTasks.length === 0 && <p className="workflow-empty">No follow-ups are due today.</p>}</div></section>,
  };

  return <><Heading title="Sales overview" action={<div className="page-actions"><LayoutPicker /><button className="primary" onClick={onCreateLead}><FiPlus /> Add lead</button></div>} />
    {currentRole !== 'viewer' && <GettingStarted steps={[{ label: 'Add your first lead', done: leadCount > 0, onClick: onCreateLead }, { label: 'Find businesses near you', done: leadCount > 1, onClick: () => setPage('Finder') }, { label: 'Schedule a follow-up', done: tasks.length > 0, onClick: () => setPage('Tasks') }, ...(canInvite ? [{ label: 'Invite a teammate', done: members.length > 1, onClick: () => setPage('Settings') }] : [])]} />}

    <div className="overview-filters">
      <div className="pipeline-mode-toggle" role="group" aria-label="Period">{overviewPeriods.map(item => <button aria-pressed={period === item} className={period === item ? 'active' : ''} onClick={() => { setPeriod(item); setOffset(0); }} key={item}>{item}</button>)}</div>
      <div className="period-stepper"><button aria-label="Previous period" onClick={() => setOffset(value => value - 1)}><FiChevronLeft /></button><strong aria-live="polite">{range.label}</strong><button aria-label="Next period" disabled={offset >= 0} onClick={() => setOffset(value => value + 1)}><FiChevronRight /></button></div>
      <div className="overview-filter-selects">
        {seesTeam && <OwnerSelect value={person} allLabel="All team" onChange={setPerson} />}
        <CustomSelect value={source} options={['All sources', 'Finder', 'Manual']} onChange={setSource} />
      </div>
    </div>
    {failed && <p className="overview-load-failed" role="status">These figures could not be updated. Check your connection and try again.</p>}

    {view.overviewSections.filter(section => section.visible).map(section => sections[section.key])}
  </>;
}
