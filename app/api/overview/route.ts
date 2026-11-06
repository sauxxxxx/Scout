import { authenticateRequest } from '@/lib/auth';
import { seesOnlyOwnRecords } from '@/lib/record-scope';
import type { OverviewSummary } from '@/lib/overview-period';
import { loadReport, validDay } from '@/lib/report-store';
import { isoInZone } from '@/lib/task-dates';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const { db, session } = auth;
  const params = new URL(request.url).searchParams;
  const [from, to, previousFrom, previousTo] = ['from', 'to', 'previousFrom', 'previousTo'].map(key => params.get(key) || '');
  if (![from, to, previousFrom, previousTo].every(validDay)) return Response.json({ error: 'A valid date range is required.' }, { status: 400 });

  const workspaceId = session.workspace.id;
  const requestedOwner = params.get('owner');
  // A rep's numbers are always their own, whatever the request asks for.
  const owner = seesOnlyOwnRecords(session) ? session.user.name : requestedOwner && requestedOwner !== 'All team' ? requestedOwner : '';
  const report = await loadReport(db, { workspaceId, timezone: session.timezone, owner, source: params.get('source') }, { from, to, previousFrom, previousTo });

  const today = isoInZone(session.timezone);
  const coldBefore = new Date(`${today}T12:00:00Z`);
  coldBefore.setUTCDate(coldBefore.getUTCDate() - 13);
  const cold = await db.prepare(`SELECT COUNT(*) total FROM leads l WHERE l.workspace_id=? AND l.archived=0 AND l.status NOT IN ('Won','Lost') AND (l.last_touch_at IS NULL OR substr(l.last_touch_at,1,10)<?)${owner ? ' AND l.owner=?' : ''}`)
    .bind(workspaceId, coldBefore.toISOString().slice(0, 10), ...(owner ? [owner] : [])).first<{ total: number }>();

  const summary: OverviewSummary = {
    current: report.current,
    previous: report.previous,
    series: report.byDay.filter(row => row.wonValue).map(row => ({ day: row.day, value: row.wonValue })),
    team: seesOnlyOwnRecords(session) || owner ? [] : report.byRep,
    coldLeads: Number(cold?.total || 0),
  };
  return Response.json(summary);
}
