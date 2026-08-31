import { authenticateRequest } from '@/lib/auth';
import { mapLead, mapTask } from '@/lib/workspace-store';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const { db, session } = auth;
  const [leadRows, taskRows] = await db.batch([
    db.prepare('SELECT * FROM leads WHERE workspace_id=? ORDER BY name').bind(session.workspace.id),
    db.prepare('SELECT * FROM tasks WHERE workspace_id=? ORDER BY id DESC').bind(session.workspace.id),
  ]);
  return Response.json({ leads: (leadRows.results as Record<string, unknown>[]).map(mapLead), tasks: (taskRows.results as Record<string, unknown>[]).map(mapTask) });
}

export async function PUT() {
  return Response.json({ error: 'Collection replacement is disabled. Use the record APIs.' }, { status: 405 });
}
