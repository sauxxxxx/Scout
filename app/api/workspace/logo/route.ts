import { activityFiles } from '@/lib/activity-store';
import { recordAudit } from '@/lib/audit';
import { authenticateRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';
const maximumSize = 1024 * 1024;
// SVG is left out on purpose: it can carry scripts, and this file is served to people who aren't signed in.
const formats = [
  { type: 'image/png', extension: 'png', matches: (bytes: Uint8Array) => bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 },
  { type: 'image/jpeg', extension: 'jpg', matches: (bytes: Uint8Array) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  { type: 'image/webp', extension: 'webp', matches: (bytes: Uint8Array) => String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP' },
];
const keyPattern = /^logos\/[^/]+\/[a-f0-9-]+\.(png|jpg|webp)$/;

async function ownerOnly(request: Request) {
  const auth = await authenticateRequest(request, 'users:manage');
  if (!auth.ok) return auth;
  if (auth.session.role !== 'owner') return { ok: false as const, response: Response.json({ error: 'Only an owner can change the workspace logo.' }, { status: 403 }) };
  return auth;
}

export async function POST(request: Request) {
  const auth = await ownerOnly(request);
  if (!auth.ok) return auth.response;
  if (Number(request.headers.get('content-length')) > maximumSize + 65536) return Response.json({ error: 'The logo must be under 1 MB.' }, { status: 413 });
  let form: FormData;
  try { form = await request.formData(); } catch { return Response.json({ error: 'Choose a logo to upload.' }, { status: 400 }); }
  const file = form.get('file');
  if (!(file instanceof File)) return Response.json({ error: 'Choose a logo to upload.' }, { status: 400 });
  if (!file.size || file.size > maximumSize) return Response.json({ error: 'The logo must be under 1 MB.' }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = formats.find(item => item.type === file.type && item.matches(bytes));
  if (!format) return Response.json({ error: 'Upload a PNG, JPEG, or WebP image.' }, { status: 400 });
  const key = `logos/${encodeURIComponent(auth.session.workspace.id)}/${crypto.randomUUID()}.${format.extension}`;
  await activityFiles().put(key, bytes, { httpMetadata: { contentType: format.type } });
  await recordAudit(auth, 'logo.updated');
  return Response.json({ url: `/api/workspace/logo?key=${encodeURIComponent(key)}` });
}

/** Public on purpose: sign-in pages and invitation emails show it. The key is unguessable and holds only a logo. */
export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get('key') || '';
  if (!keyPattern.test(key)) return new Response('Logo not found', { status: 404 });
  const object = await activityFiles().get(key);
  if (!object) return new Response('Logo not found', { status: 404 });
  return new Response(object.body, { headers: { 'content-type': object.httpMetadata?.contentType || 'application/octet-stream', 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" } });
}

export async function DELETE(request: Request) {
  const auth = await ownerOnly(request);
  if (!auth.ok) return auth.response;
  const key = new URL(request.url).searchParams.get('key') || '';
  if (!keyPattern.test(key) || !key.startsWith(`logos/${encodeURIComponent(auth.session.workspace.id)}/`)) return Response.json({ error: 'Logo not found.' }, { status: 404 });
  await activityFiles().delete(key);
  return Response.json({ ok: true });
}
