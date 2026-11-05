import { activityFiles } from '@/lib/activity-store';
import { authenticateRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';
const maximumSize = 2 * 1024 * 1024;

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  if (Number(request.headers.get('content-length')) > maximumSize + 65536) return Response.json({ error: 'The cropped photo must be under 2 MB.' }, { status: 413 });
  let form: FormData;
  try { form = await request.formData(); } catch { return Response.json({ error: 'Choose a photo to upload.' }, { status: 400 }); }
  const file = form.get('file');
  if (!(file instanceof File) || file.type !== 'image/jpeg') return Response.json({ error: 'Upload a cropped JPEG photo.' }, { status: 400 });
  if (!file.size || file.size > maximumSize) return Response.json({ error: 'The cropped photo must be under 2 MB.' }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return Response.json({ error: 'The photo is not a valid JPEG.' }, { status: 400 });
  const key = `profiles/${encodeURIComponent(auth.session.user.id)}/${crypto.randomUUID()}.jpg`;
  await activityFiles().put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
  return Response.json({ url: `/api/profile/photo?key=${encodeURIComponent(key)}` });
}

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const key = new URL(request.url).searchParams.get('key') || '';
  const match = /^profiles\/([^/]+)\/[a-f0-9-]+\.jpg$/.exec(key);
  if (!match) return new Response('Photo not found', { status: 404 });
  let ownerId: string;
  try { ownerId = decodeURIComponent(match[1]); } catch { return new Response('Photo not found', { status: 404 }); }
  const member = await auth.db.prepare('SELECT user_id FROM workspace_memberships WHERE workspace_id=? AND user_id=?').bind(auth.session.workspace.id, ownerId).first();
  if (!member) return new Response('Photo not found', { status: 404 });
  const object = await activityFiles().get(key);
  if (!object) return new Response('Photo not found', { status: 404 });
  return new Response(object.body, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' } });
}

export async function DELETE(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const key = new URL(request.url).searchParams.get('key') || '';
  if (!key.startsWith(`profiles/${encodeURIComponent(auth.session.user.id)}/`) || !/^profiles\/[^/]+\/[a-f0-9-]+\.jpg$/.test(key)) return Response.json({ error: 'Photo not found.' }, { status: 404 });
  const current = await auth.db.prepare('SELECT avatar_url FROM users WHERE id=?').bind(auth.session.user.id).first<{ avatar_url: string }>();
  if (current?.avatar_url === `/api/profile/photo?key=${encodeURIComponent(key)}`) return Response.json({ error: 'Remove the photo from your profile first.' }, { status: 409 });
  await activityFiles().delete(key);
  return Response.json({ ok: true });
}
