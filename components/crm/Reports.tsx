'use client';

import { useEffect, useMemo, useState } from 'react';
import { FiChevronLeft, FiChevronRight, FiX } from 'react-icons/fi';
import { useWorkspaceMembers } from '@/components/WorkspaceMembers';
import { Avatar, CustomSelect, EmptyState, Heading, OwnerSelect, PageSkeleton } from '@/components/crm/shared';
import { ExportMenu } from '@/components/crm/ExportMenu';
import { TrendBars } from '@/components/crm/TrendBars';
import { formatDate } from '@/lib/format';
import { describeChange, overviewPeriods, periodRange, type OverviewPeriod } from '@/lib/overview-period';
import { customRange, daysBetween, emptyCounts, hasActivity, MAX_CUSTOM_DAYS, reportBuckets, reportMetrics, type Report, type ReportBucket, type ReportCounts, type ReportMetric, type ReportRecord } from '@/lib/reports';
import { localIso } from '@/lib/task-dates';

type Period = OverviewPeriod | 'Custom';
type Drill = { metric: ReportMetric; from: string; to: string; owner: string; heading: string };

function RecordsDrawer({ drill, query, onClose, onOpenLead }: { drill: Drill; query: URLSearchParams; onClose: () => void; onOpenLead: (name: string) => void }) {
  const [records, setRecords] = useState<ReportRecord[] | null>(null);
  const [failed, setFailed] = useState(false);
  const metric = reportMetrics.find(item => item.key === drill.metric)!;
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams(query);
    params.set('metric', drill.metric); params.set('from', drill.from); params.set('to', drill.to); params.set('owner', drill.owner);
    fetch(`/api/reports?${params}`, { signal: controller.signal }).then(response => {
      if (!response.ok) throw new Error('Report unavailable');
      return response.json() as Promise<{ records: ReportRecord[] }>;
    }).then(data => setRecords(data.records)).catch(error => { if ((error as Error).name !== 'AbortError') setFailed(true); });
    return () => controller.abort();
  }, [drill, query]);
  return <div className="drawer-backdrop" onClick={onClose}><aside className="lead-drawer report-drawer" role="dialog" aria-modal="true" aria-labelledby="report-drawer-title" onClick={event => event.stopPropagation()}>
    <header className="drawer-header"><div><h2 id="report-drawer-title">{metric.label}</h2><p>{drill.heading}</p></div><button onClick={onClose} aria-label="Close"><FiX /></button></header>
    {failed && <p className="workflow-empty">These records could not be loaded. Try again.</p>}
    {!failed && !records && <p className="workflow-empty">Loading…</p>}
    {records && records.length === 0 && <p className="workflow-empty">Nothing to show.</p>}
    {records && records.length > 0 && <div className="report-records">{records.map(record => <article key={record.key}><div><button className="text-link" onClick={() => onOpenLead(record.lead)}>{record.lead}</button><p>{record.detail}</p></div><div><time>{formatDate(record.date)}</time><small>{record.rep}</small></div></article>)}{records.length === 200 && <p className="report-records-note">Showing the latest 200.</p>}</div>}
  </aside></div>;
}

export function Reports({ currency, notify, openLead }: { currency: string; notify: (message: string) => void; openLead: (name: string) => void }) {
  const { capabilities, assignableMembers, currentMember } = useWorkspaceMembers();
  const seesTeam = capabilities['records:view_all'];
  const [period, setPeriod] = useState<Period>('Weekly');
  const [offset, setOffset] = useState(0);
  const today = localIso();
  const [custom, setCustom] = useState({ from: today, to: today });
  const [person, setPerson] = useState('All team');
  const [view, setView] = useState<'rep' | 'day'>(seesTeam ? 'rep' : 'day');
  const [chart, setChart] = useState<ReportMetric>('calls');
  const [report, setReport] = useState<Report | null>(null);
  const [failed, setFailed] = useState(false);
  const [drill, setDrill] = useState<Drill | null>(null);

  const customProblem = period !== 'Custom' ? '' : !custom.from || !custom.to ? 'Choose both dates.' : custom.from > custom.to ? 'The start date must be before the end date.' : daysBetween(custom.from, custom.to) > MAX_CUSTOM_DAYS ? 'Choose a range of a year or less.' : '';
  const range = useMemo(() => period === 'Custom' ? (customProblem ? null : customRange(custom.from, custom.to)) : periodRange(period, today, offset), [period, offset, today, custom, customProblem]);
  const ownerParam = seesTeam ? person : currentMember?.name || '';
  const query = useMemo(() => new URLSearchParams(range ? { from: range.from, to: range.to, previousFrom: range.previousFrom, previousTo: range.previousTo, owner: ownerParam } : {}), [range, ownerParam]);
  const queryText = query.toString();

  useEffect(() => {
    if (!queryText) return;
    const controller = new AbortController();
    fetch(`/api/reports?${queryText}`, { signal: controller.signal }).then(response => {
      if (!response.ok) throw new Error('Report unavailable');
      return response.json() as Promise<Report>;
    }).then(data => { setReport(data); setFailed(false); }).catch(error => { if ((error as Error).name !== 'AbortError') setFailed(true); });
    return () => controller.abort();
  }, [queryText]);

  const money = (value: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
  const buckets: ReportBucket[] = report && range ? reportBuckets(range.from, range.to, report.byDay) : [];
  const repRows = useMemo(() => {
    if (!report) return [];
    const names = new Set(report.byRep.map(row => row.name));
    const everyone = person === 'All team' ? assignableMembers.filter(member => !names.has(member.name)).map(member => ({ ...emptyCounts, name: member.name })) : [];
    return [...report.byRep, ...everyone].sort((a, b) => b.wonValue - a.wonValue || b.calls - a.calls || a.name.localeCompare(b.name));
  }, [report, assignableMembers, person]);
  const showingRep = seesTeam && person === 'All team' && view === 'rep';
  const chartMetric = reportMetrics.find(item => item.key === chart)!;
  const label = range?.label || '';
  const open = (metric: ReportMetric, from: string, to: string, owner: string, heading: string) => setDrill({ metric, from, to, owner, heading });
  const everyMetric = [...reportMetrics.map(metric => metric.key)] as ReportMetric[];

  const cell = (row: ReportCounts, metric: ReportMetric, from: string, to: string, owner: string, heading: string) => {
    const value = row[metric];
    return value ? <button className="report-count" aria-label={`${value} ${reportMetrics.find(item => item.key === metric)?.plural}, ${heading}`} onClick={() => open(metric, from, to, owner, heading)}>{value}</button> : <span className="report-zero">0</span>;
  };

  return <>
    <Heading title="Reports" action={range && capabilities['records:export'] ? <div className="page-actions"><ExportMenu path={`/api/reports/export?${queryText}&view=${showingRep ? 'rep' : 'day'}`} title={`Scout report ${range.from} to ${range.to}`} sheetName="Report" emptyMessage="Nothing to export for this period" countLabel="rows" notify={notify} /></div> : undefined} />
    <div className="overview-filters report-filters">
      <div className="pipeline-mode-toggle" role="group" aria-label="Period">{[...overviewPeriods, 'Custom' as const].map(item => <button aria-pressed={period === item} className={period === item ? 'active' : ''} onClick={() => { setPeriod(item); setOffset(0); }} key={item}>{item}</button>)}</div>
      {period !== 'Custom' && <div className="period-stepper"><button aria-label="Previous period" onClick={() => setOffset(value => value - 1)}><FiChevronLeft /></button><strong aria-live="polite">{label}</strong><button aria-label="Next period" disabled={offset >= 0} onClick={() => setOffset(value => value + 1)}><FiChevronRight /></button></div>}
      {period === 'Custom' && <div className="report-dates"><label>From<input type="date" max={custom.to || today} value={custom.from} onChange={event => setCustom({ ...custom, from: event.target.value })} /></label><label>To<input type="date" min={custom.from} max={today} value={custom.to} onChange={event => setCustom({ ...custom, to: event.target.value })} /></label></div>}
      {seesTeam && <div className="overview-filter-selects"><OwnerSelect value={person} allLabel="All team" onChange={setPerson} /></div>}
    </div>
    {customProblem && <p className="overview-load-failed" role="alert">{customProblem}</p>}
    {failed && <p className="overview-load-failed" role="status">This report could not be updated. Check your connection and try again.</p>}
    {!report && !failed && !customProblem && <PageSkeleton />}
    {report && range && <>
      <section className="report-tiles" aria-label={`Totals for ${label}`}>{reportMetrics.map(metric => {
        const value = report.current[metric.key];
        const note = describeChange(value, report.previous[metric.key], range.previousLabel);
        return <button key={metric.key} disabled={!value} onClick={() => open(metric.key, range.from, range.to, ownerParam, label)}><span>{metric.label}</span><strong>{value}</strong><small>{note}</small></button>;
      })}<div><span>Revenue</span><strong>{money(report.current.wonValue)}</strong><small>{describeChange(report.current.wonValue, report.previous.wonValue, range.previousLabel)}</small></div></section>

      {!hasActivity(report.current) ? <EmptyState title="Nothing recorded for this period">Calls, follow-ups and proposals appear here once they&apos;re logged in Scout.</EmptyState> : <>
        {buckets.length > 1 && <section className="report-chart"><div className="pipeline-mode-toggle" role="group" aria-label="Chart shows">{reportMetrics.map(metric => <button aria-pressed={chart === metric.key} className={chart === metric.key ? 'active' : ''} onClick={() => setChart(metric.key)} key={metric.key}>{metric.label}</button>)}</div><TrendBars title={`${chartMetric.label} over time`} points={buckets.map(bucket => ({ key: bucket.key, label: bucket.label, value: bucket[chart] }))} format={value => `${value} ${value === 1 ? chartMetric.singular : chartMetric.plural}`} /></section>}

        {seesTeam && person === 'All team' && <div className="report-tabs" role="group" aria-label="Break down by"><button aria-pressed={view === 'rep'} className={view === 'rep' ? 'active' : ''} onClick={() => setView('rep')}>By rep</button><button aria-pressed={view === 'day'} className={view === 'day' ? 'active' : ''} onClick={() => setView('day')}>Over time</button></div>}
        <div className="report-table-wrap"><table className="report-table">
          <thead><tr><th scope="col">{showingRep ? 'Rep' : 'Period'}</th>{reportMetrics.map(metric => <th scope="col" key={metric.key}>{metric.label}</th>)}<th scope="col">Revenue</th></tr></thead>
          <tbody>
            {showingRep
              ? repRows.map(row => <tr key={row.name}><th scope="row"><span className="team-rep"><Avatar name={row.name} />{row.name}</span></th>{everyMetric.map(metric => <td key={metric}>{cell(row, metric, range.from, range.to, row.name, `${row.name} · ${label}`)}</td>)}<td>{money(row.wonValue)}</td></tr>)
              : buckets.filter(hasActivity).map(row => <tr key={row.key}><th scope="row">{row.label}</th>{everyMetric.map(metric => <td key={metric}>{cell(row, metric, row.from, row.to, ownerParam, row.label)}</td>)}<td>{money(row.wonValue)}</td></tr>)}
          </tbody>
          <tfoot><tr><th scope="row">Total</th>{everyMetric.map(metric => <td key={metric}>{report.current[metric]}</td>)}<td>{money(report.current.wonValue)}</td></tr></tfoot>
        </table></div>
      </>}
      <p className="report-note">Reports count what&apos;s logged in Scout. Follow-ups are completed tasks, other than internal reminders. A finished call task counts as a call and a follow-up. A proposal counts once per lead, even if it&apos;s logged and moved to Proposal.</p>
    </>}
    {drill && <RecordsDrawer drill={drill} query={query} onClose={() => setDrill(null)} onOpenLead={name => { setDrill(null); openLead(name); }} />}
  </>;
}
