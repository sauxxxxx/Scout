import { recordAudit } from '@/lib/audit';
import { authenticateRequest } from '@/lib/auth';
import { statusLabelOf } from '@/lib/customization';
import { buildLeadFilter, leadColumns, leadJoins, leadOrder } from '@/lib/lead-query';
import { leadsToCsv, leadsToRows } from '@/lib/lead-export';
import { seesOnlyOwnRecords } from '@/lib/record-scope';
import { mapLead } from '@/lib/workspace-store';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await authenticateRequest(request, 'records:export');
  if (!auth.ok) return auth.response;
  const { db, session } = auth;
  const params = new URL(request.url).searchParams;
  // The export follows whatever the rep has filtered, and never reaches past what they can see.
  const { where, values } = buildLeadFilter(params, session.workspace.id, session.user.name, seesOnlyOwnRecords(session));
  const rows = await db.prepare(`SELECT ${leadColumns} ${leadJoins} WHERE ${where} ORDER BY ${leadOrder(params)}`).bind(...values).all<Record<string, unknown>>();
  const leads = rows.results.map(mapLead).map(lead => ({ ...lead, status: statusLabelOf(session.customization, lead.status) }));
  await recordAudit(auth, 'lead.exported', `${leads.length} leads`);
  if (params.get('format') === 'rows') return Response.json(leadsToRows(leads));
  return new Response(`﻿${leadsToCsv(leads)}`, {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="scout-leads.csv"', 'cache-control': 'no-store' },
  });
}
