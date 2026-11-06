import { recordAudit } from '@/lib/audit';
import { authenticateRequest } from '@/lib/auth';
import { tableToCsv } from '@/lib/lead-export';
import { seesOnlyOwnRecords } from '@/lib/record-scope';
import { loadReport, validDay } from '@/lib/report-store';
import { reportTable } from '@/lib/reports';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await authenticateRequest(request, 'records:export');
  if (!auth.ok) return auth.response;
  const { db, session } = auth;
  const params = new URL(request.url).searchParams;
  const [from, to, previousFrom, previousTo] = ['from', 'to', 'previousFrom', 'previousTo'].map(key => params.get(key) || '');
  if (![from, to, previousFrom, previousTo].every(validDay) || from > to) return Response.json({ error: 'A valid date range is required.' }, { status: 400 });
  const requested = params.get('owner');
  const ownOnly = seesOnlyOwnRecords(session);
  const owner = ownOnly ? session.user.name : requested && requested !== 'All team' ? requested : '';
  const report = await loadReport(db, { workspaceId: session.workspace.id, timezone: session.timezone, owner, source: params.get('source') }, { from, to, previousFrom, previousTo });
  const table = reportTable(report, !ownOnly && params.get('view') === 'rep' ? 'rep' : 'day', from, to);
  await recordAudit(auth, 'report.exported', `${from} to ${to}`);
  if (params.get('format') === 'rows') return Response.json(table);
  return new Response(`﻿${tableToCsv(table.headers, table.rows)}`, {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="scout-report-${from}-to-${to}.csv"`, 'cache-control': 'no-store' },
  });
}
