import { recordAudit } from '@/lib/audit';
import { authenticateRequest } from '@/lib/auth';
import { leadsToCsv } from '@/lib/lead-export';
import { seesOnlyOwnRecords, visibleLeadIds } from '@/lib/record-scope';
import { mapLead } from '@/lib/workspace-store';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await authenticateRequest(request, 'records:export');
  if (!auth.ok) return auth.response;
  const { db, session } = auth;
  const rows = await db.prepare('SELECT * FROM leads WHERE workspace_id=? AND archived=0 ORDER BY name').bind(session.workspace.id).all<Record<string, unknown>>();
  let leads = rows.results.map(mapLead);
  if (seesOnlyOwnRecords(session)) {
    const visible = await visibleLeadIds(db, session.workspace.id, session.user.name);
    leads = leads.filter(lead => lead.id && visible.has(String(lead.id)));
  }
  await recordAudit(auth, 'lead.exported', `${leads.length} leads`);
  return new Response(`﻿${leadsToCsv(leads)}`, {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="scout-leads.csv"', 'cache-control': 'no-store' },
  });
}
