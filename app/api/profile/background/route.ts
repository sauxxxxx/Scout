import { activityFiles } from '@/lib/activity-store';
import { authenticateRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';
const maximumSize = 4 * 1024 * 1024;
const keyPattern = /^backgrounds\/[^/]+\/[a-f0-9-]+\.jpg$/;
const ownFolder = (userId: string) => `backgrounds/${encodeURIComponent(userId)}/`;

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  if (Number(request.headers.get('content-length')) > maximumSize + 65536) return Response.json({ error: 'That image is too large.' }, { status: 413 });
  let form: FormData;
  try { form = await request.formData(); } catch { return Response.json({ error: 'Choose an image to upload.' }, { status: 400 }); }
  const file = form.get('file');
  if (!(file instanceof File) || file.type !== 'image/jpeg') return Response.json({ error: 'Choose an image to upload.' }, { status: 400 });
  if (!file.size || file.size > maximumSize) return Response.json({ error: 'That image is too large.' }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return Response.json({ error: 'That file is not a valid image.' }, { status: 400 });
  const key = `${ownFolder(auth.session.user.id)}${crypto.randomUUID()}.jpg`;
  await activityFiles().put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
  return Response.json({ url: `/api/profile/background?key=${encodeURIComponent(key)}` });
}

/** A background is personal, so only the person who uploaded it can load it. */
export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const key = new URL(request.url).searchParams.get('key') || '';
  if (!keyPattern.test(key) || !key.startsWith(ownFolder(auth.session.user.id))) return new Response('Image not found', { status: 404 });
  const object = await activityFiles().get(key);
  if (!object) return new Response('Image not found', { status: 404 });
  return new Response(object.body, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' } });
}

export async function DELETE(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const key = new URL(request.url).searchParams.get('key') || '';
  if (!keyPattern.test(key) || !key.startsWith(ownFolder(auth.session.user.id))) return Response.json({ error: 'Image not found.' }, { status: 404 });
  await activityFiles().delete(key);
  return Response.json({ ok: true });
}
