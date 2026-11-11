'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { FiArrowRight, FiChevronDown, FiChevronLeft, FiChevronRight, FiChevronUp, FiPlus, FiSearch, FiSliders } from 'react-icons/fi';
import { callMetrics } from '@/lib/reports';
import { localIso } from '@/lib/task-dates';
import { leadStatuses } from '@/lib/validation';
import { useWorkspaceMembers } from '@/components/WorkspaceMembers';
import { type ProfileUpdate } from '@/lib/profile';
import type { Page, Opportunity, ActivityEntry, TaskItem } from '@/lib/crm-types';
import { Avatar, EmptyState, ToolMenu, CustomSelect, OwnerSelect, PriorityBadge, useCustomization, useViewSettings } from '@/components/crm/shared';
import { moved, overviewSectionOptions, type OverviewSection } from '@/lib/view-settings';
import { GettingStarted } from '@/components/GettingStarted';
import { TrendBars } from '@/components/crm/TrendBars';
import { conversionRate, describeChange, emptyResults, overviewPeriods, periodRange, trendBuckets, type OverviewPeriod, type OverviewSummary, type OverviewTeamRow } from '@/lib/overview-period';

const stageNames: string[] = leadStatuses.filter(status => status !== 'Lost');

function LayoutPicker() {
  const { view, updateView } = useViewSettings();
  const sections = view.overviewSections;
  return <ToolMenu label="Customize" icon={<FiSliders />}>{() => <div className="column-picker">{sections.map((section, index) => {
    const label = overviewSectionOptions.find(option => option.key === section.key)?.label;
    return <div key={section.key}><label><input type="checkbox" checked={section.visible} onChange={() => updateView({ overviewSections: sections.map(item => item.key === section.key ? { ...item, visible: !item.visible } : item) })} />{label}</label><button aria-label={`Move ${label} up`} disabled={index === 0} onClick={() => updateView({ overviewSections: moved(sections, index, -1) })}><FiChevronUp /></button><button aria-label={`Move ${label} down`} disabled={index === sections.length - 1} onClick={() => updateView({ overviewSections: moved(sections, index, 1) })}><FiChevronDown /></button></div>;
  })}</div>}</ToolMenu>;
}

function TeamTable({ rows, money }: { rows: OverviewTeamRow[]; money: (value: number) => string }) {
  return <section className="team-results"><h2>Team results</h2>
    <div className="team-results-table" role="table" aria-label="Team results">
      <div className="team-results-head" role="row">{['Rep', ...callMetrics.map(metric => metric.label), 'Emails', 'Meetings', 'New leads', 'Won', 'Revenue'].map(label => <span role="columnheader" key={label}>{label}</span>)}</div>
      {rows.map(row => <div role="row" key={row.name}><strong role="cell" className="team-rep"><Avatar name={row.name} />{row.name}</strong>{callMetrics.map(metric => <span role="cell" key={metric.key}>{row[metric.key]}</span>)}<span role="cell">{row.emails}</span><span role="cell">{row.meetings}</span><span role="cell">{row.newLeads}</span><span role="cell">{row.wonCount}</span><span role="cell">{money(row.wonValue)}</span></div>)}
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

  const firstName = (currentMember?.name || '').split(' ')[0];
  const hour = new Date().getHours();
  const greeting = `Good ${hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'}${firstName ? `, ${firstName}` : ''}`;
  const stageValue = (item: { count: number; value: number }) => metric === 'Leads' ? item.count : item.value;
  const stageTop = Math.max(...stageData.map(stageValue), 1);
  const dueTasks = [...tasks.filter(task => task.status !== 'Completed' && taskOwner(task) && ((task.dueAt && task.dueAt < today) || task.due === 'Overdue')), ...todayTasks];
  const nextTask = dueTasks[0];
  const work = [['Prospects', now?.newLeads], ...callMetrics.map(metric => [metric.label, now?.[metric.key]] as const), ['Emails', now?.emails], ['Meetings', now?.meetings], ['Follow-ups', now?.followUps], ['Proposals', now?.proposals]] as const;

  const sections: Record<OverviewSection, React.ReactNode> = {
    pipeline: <React.Fragment key="pipeline">
      <section className={`bento-tile bento-wide${hasPipelineData ? '' : ' bento-empty'}`} aria-label="Your pipeline">
        <div className="bento-tile-head"><div><span className="bento-label">Your pipeline</span><strong className="bento-figure">{money(pipelineValue)}</strong><span className="bento-label">{open.length} open {open.length === 1 ? 'opportunity' : 'opportunities'}</span></div><div className="pipeline-mode-toggle" aria-label="Pipeline shows"><button className={metric === 'Leads' ? 'active' : ''} onClick={() => setMetric('Leads')}>Leads</button><button className={metric === 'Value' ? 'active' : ''} onClick={() => setMetric('Value')}>Value</button></div></div>
        {hasPipelineData ? <div className="bento-stages">{stageData.map(item => <button className={`bento-stage is-${item.name.toLowerCase().replace('-', '')}`} style={{ '--stage-width': `${Math.max(38, stageValue(item) / stageTop * 100)}%` } as React.CSSProperties} onClick={() => setPage('Pipeline')} aria-label={`${statusLabel(item.name)}: ${item.count} leads, ${money(item.value)}`} key={item.name}><span>{statusLabel(item.name)}</span><b>{metric === 'Leads' ? item.count : money(item.value)}</b></button>)}</div> : <EmptyState title="Your pipeline is empty" action={<button className="bento-pop-button" onClick={() => setPage('Finder')}><FiSearch /> Find businesses</button>}>Add a lead or find businesses to start building it.</EmptyState>}
      </section>
      <section className="bento-tile bento-narrow bento-next" aria-label="Next follow-up">
        {nextTask ? <><span className="bento-label">Next follow-up</span><h2>{nextTask.lead}</h2><p>{nextTask.title}</p><div className="bento-next-foot"><small>{nextTask.due === 'Today' ? `Today, ${nextTask.time}` : nextTask.due}{dueTasks.length > 1 ? ` · ${dueTasks.length - 1} more` : ''}</small><button className="bento-pop-button" onClick={() => openTask(nextTask.id)}>Open task <FiArrowRight /></button></div></>
          : <><span className="bento-label">Next follow-up</span><h2>You&apos;re all clear</h2><p>Nothing is due today.</p><div className="bento-next-foot"><small /><button className="bento-pop-button" onClick={() => setPage('Finder')}>Find businesses <FiArrowRight /></button></div></>}
      </section>
    </React.Fragment>,
    results: <React.Fragment key="results">
      <section className="bento-tile bento-wide bento-revenue" aria-label={`Results for ${range.label}`}>
        <span className="bento-label">Won revenue</span><strong className="bento-figure">{now ? money(now.wonValue) : counted(undefined)}</strong>{change('wonValue') && <small>{change('wonValue')}</small>}
        <p className="bento-facts"><span><strong>{counted(now?.wonCount)}</strong> {now?.wonCount === 1 ? 'deal' : 'deals'} won</span><span><strong>{now ? `${conversionRate(now)}%` : counted(undefined)}</strong> conversion</span></p>
        <TrendBars title="Over time" points={trend} format={money} />
      </section>
      <section className="bento-tile bento-narrow bento-work" aria-label="Sales activity">
        <span className="bento-label">{range.label}</span>
        <div className="bento-counts">{work.map(([label, value]) => <div key={label}><strong>{counted(value)}</strong><span>{label}</span></div>)}</div>
        <button className="text-link overview-report-link" onClick={onOpenReports}>View full report <FiChevronRight /></button>
      </section>
    </React.Fragment>,
    followups: <React.Fragment key="followups">
      <section className="bento-tile bento-wide bento-list" aria-label="Today's follow-ups">
        <div className="bento-tile-head"><h2>Today&apos;s follow-ups</h2><div className="bento-list-actions">{seesTeam && <div className="pipeline-mode-toggle" aria-label="Whose follow-ups"><button className={taskScope === 'Mine' ? 'active' : ''} onClick={() => setTaskScope('Mine')}>Mine</button><button className={taskScope === 'Team' ? 'active' : ''} onClick={() => setTaskScope('Team')}>Team</button></div>}<button onClick={() => setPage('Tasks')}>View all</button></div></div>
        {todayTasks.map(task => <button className="bento-list-item" onClick={() => openTask(task.id)} key={task.uid || task.id}><time>{task.time}</time><span><strong>{task.lead}</strong><small>{task.title}</small></span><PriorityBadge priority={task.priority} compact /></button>)}
        {todayTasks.length === 0 && <p className="bento-quiet">No follow-ups are due today.</p>}
      </section>
      <section className="bento-tile bento-narrow bento-attention" aria-label="Needs attention">
        <button onClick={onColdLeads}><strong>{summary ? summary.coldLeads : '…'}</strong><span>No touch in 14+ days</span></button>
        <button onClick={() => setPage('Tasks')}><strong>{overdue}</strong><span>Overdue follow-ups</span></button>
      </section>
    </React.Fragment>,
    team: teamRows.length > 1 ? <section className="bento-tile bento-full bento-team" key="team"><TeamTable rows={teamRows} money={money} /></section> : null,
  };

  return <>
    <div className="bento-head page-head"><h1>{greeting}</h1><div className="page-actions"><LayoutPicker /><button className="primary" onClick={onCreateLead}><FiPlus /> Add lead</button></div></div>
    {currentRole !== 'viewer' && <GettingStarted steps={[{ label: 'Add your first lead', done: leadCount > 0, onClick: onCreateLead }, { label: 'Find businesses near you', done: leadCount > 1, onClick: () => setPage('Finder') }, { label: 'Schedule a follow-up', done: tasks.length > 0, onClick: () => setPage('Tasks') }, ...(canInvite ? [{ label: 'Invite a teammate', done: members.length > 1, onClick: () => setPage('Settings') }] : [])]} />}
    <div className="bento-controls">
      <div className="pipeline-mode-toggle" role="group" aria-label="Period">{overviewPeriods.map(item => <button aria-pressed={period === item} className={period === item ? 'active' : ''} onClick={() => { setPeriod(item); setOffset(0); }} key={item}>{item}</button>)}</div>
      <div className="period-stepper"><button aria-label="Previous period" onClick={() => setOffset(value => value - 1)}><FiChevronLeft /></button><strong aria-live="polite">{range.label}</strong><button aria-label="Next period" disabled={offset >= 0} onClick={() => setOffset(value => value + 1)}><FiChevronRight /></button></div>
      <div className="overview-filter-selects">
        {seesTeam && <OwnerSelect value={person} allLabel="All team" onChange={setPerson} />}
        <CustomSelect value={source} options={['All sources', 'Finder', 'Manual']} onChange={setSource} />
      </div>
    </div>
    {failed && <p className="overview-load-failed" role="status">These figures could not be updated. Check your connection and try again.</p>}
    <div className="bento-grid">{view.overviewSections.filter(section => section.visible).map(section => sections[section.key])}</div>
  </>;
}
