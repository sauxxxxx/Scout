import { env } from 'cloudflare:workers';
import { parseCustomization, publicBranding } from '@/lib/customization';
import type { FinderEnv } from '@/lib/finder-runtime';
import { DEFAULT_WORKSPACE_ID, ensureFoundationSchema } from '@/lib/foundation-store';
import { workspaceDb } from '@/lib/workspace-store';

export const dynamic = 'force-dynamic';

/** The default workspace's look, so the sign-in page matches it. Falls back to Scout's own if the database isn't reachable. */
async function branding() {
  try {
    const db = workspaceDb();
    await ensureFoundationSchema(db);
    const row = await db.prepare('SELECT w.name,s.customization_json FROM workspaces w LEFT JOIN workspace_settings s ON s.workspace_id=w.id WHERE w.id=?').bind(DEFAULT_WORKSPACE_ID).first<{ name: string; customization_json: string }>();
    return row ? publicBranding(parseCustomization(row.customization_json), row.name) : null;
  } catch { return null; }
}

export async function GET() {
  const clientId = (env as unknown as FinderEnv).GOOGLE_OAUTH_CLIENT_ID?.trim();
  return Response.json({ provider: 'google', clientId: clientId || null, enabled: Boolean(clientId), branding: await branding() });
}
