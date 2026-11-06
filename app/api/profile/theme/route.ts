import { z } from 'zod';
import { authenticateRequest } from '@/lib/auth';
import { themes } from '@/lib/profile';
import { validationError } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const themeSchema = z.object({ theme: z.enum(themes) }).strict();

/** The header switch saves on its own, without touching anything else in the profile. */
export async function PATCH(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const parsed = themeSchema.safeParse(await request.json());
  if (!parsed.success) return validationError(parsed.error);
  await auth.db.prepare("UPDATE users SET preferences_json=json_set(COALESCE(NULLIF(preferences_json,''),'{}'),'$.theme',?),updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(parsed.data.theme, auth.session.user.id).run();
  return Response.json({ theme: parsed.data.theme });
}
