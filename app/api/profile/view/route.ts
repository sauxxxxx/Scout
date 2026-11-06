import { authenticateRequest } from '@/lib/auth';
import { validationError } from '@/lib/validation';
import { normalizeViewSettings, viewSettingsSchema } from '@/lib/view-settings';

export const dynamic = 'force-dynamic';

/** Layout choices save as they're made, separately from the profile form and its Save button. */
export async function PATCH(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const parsed = viewSettingsSchema.safeParse(await request.json());
  if (!parsed.success) return validationError(parsed.error);
  const view = normalizeViewSettings(parsed.data);
  await auth.db.prepare('UPDATE users SET view_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(JSON.stringify(view), auth.session.user.id).run();
  return Response.json({ view });
}
