import { authenticateRequest } from '@/lib/auth';
import { seesOnlyOwnRecords } from '@/lib/record-scope';
import { loadReport, loadReportRecords, validDay } from '@/lib/report-store';
import { isReportMetric } from '@/lib/reports';

export const dynamic = 'force-dynamic';

/** Reports for a date range, or with `metric`, the records behind one number. */
export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const { db, session } = auth;
  const params = new URL(request.url).searchParams;
  const [from, to, previousFrom, previousTo] = ['from', 'to', 'previousFrom', 'previousTo'].map(key => params.get(key) || '');
  if (!validDay(from) || !validDay(to) || from > to) return Response.json({ error: 'A valid date range is required.' }, { status: 400 });
  const requested = params.get('owner');
  // A rep's numbers are always their own, whatever the request asks for.
  const owner = seesOnlyOwnRecords(session) ? session.user.name : requested && requested !== 'All team' ? requested : '';
  const scope = { workspaceId: session.workspace.id, timezone: session.timezone, owner, source: params.get('source') };
  const metric = params.get('metric');
  if (metric !== null) {
    if (!isReportMetric(metric)) return Response.json({ error: 'That report does not exist.' }, { status: 400 });
    return Response.json({ records: await loadReportRecords(db, scope, metric, from, to) });
  }
  if (!validDay(previousFrom) || !validDay(previousTo)) return Response.json({ error: 'A valid date range is required.' }, { status: 400 });
  return Response.json(await loadReport(db, scope, { from, to, previousFrom, previousTo }));
}
