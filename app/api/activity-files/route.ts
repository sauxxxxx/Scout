import { activityFiles } from '@/lib/activity-store';
import { authenticateRequest } from '@/lib/auth';
import { allowRequest, tooManyRequests } from '@/lib/rate-limit';
import { guardRecord, seesOnlyOwnRecords } from '@/lib/record-scope';

export const dynamic = 'force-dynamic';

const prefix = 'activities/';
const uploadTypes: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', txt: 'text/plain', csv: 'text/csv',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
/** Only these are safe to open in the browser. Everything else downloads, so uploaded content can never run as part of Scout. */
const inlineTypes = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif']);

function safeType(name: string) {
  return uploadTypes[name.split('.').pop()?.toLowerCase() || ''] || null;
}

const asciiName = (name: string) => name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_').slice(0, 120) || 'attachment';

async function guardFile(auth: Parameters<typeof guardRecord>[0], key: string) {
  if (!seesOnlyOwnRecords(auth.session)) return null;
  const owner = await auth.db.prepare('SELECT uid FROM activities WHERE attachment_key=? AND workspace_id=?').bind(key, auth.session.workspace.id).first<{ uid: string }>();
  return guardRecord(auth, 'activity', owner?.uid);
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request, 'records:write');
  if (!auth.ok) return auth.response;
  if (!await allowRequest(auth.db, `upload:${auth.session.user.id}`, 60, 3600)) return tooManyRequests(600);
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return Response.json({ error: 'A file is required.' }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return Response.json({ error: 'Files must be 10 MB or smaller.' }, { status: 413 });
  const contentType = safeType(file.name);
  if (!contentType) return Response.json({ error: 'Upload a PDF, image, Office document, CSV or text file.' }, { status: 415 });
  const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-');
  const key = `${prefix}${auth.session.workspace.id}/${Date.now()}-${crypto.randomUUID()}-${safe}`;
  await activityFiles().put(key, file.stream(), { httpMetadata: { contentType }, customMetadata: { originalName: asciiName(file.name), workspaceId: auth.session.workspace.id } });
  return Response.json({ key, name: file.name, url: `/api/activity-files?key=${encodeURIComponent(key)}` });
}

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const key = new URL(request.url).searchParams.get('key');
  if (!key || !key.startsWith(prefix)) return new Response('Missing file key', { status: 400 });
  const blocked = await guardFile(auth, key);
  if (blocked) return blocked;
  const object = await activityFiles().get(key);
  if (!object) return new Response('File not found', { status: 404 });
  const workspaceId = object.customMetadata?.workspaceId;
  if (workspaceId && workspaceId !== auth.session.workspace.id) return new Response('File not found', { status: 404 });
  const contentType = safeType(key) || 'application/octet-stream';
  const headers = new Headers({
    'content-type': contentType,
    etag: object.httpEtag,
    'content-disposition': `${inlineTypes.has(contentType) ? 'inline' : 'attachment'}; filename="${asciiName(object.customMetadata?.originalName || 'attachment')}"`,
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  });
  return new Response(object.body, { headers });
}

export async function DELETE(request: Request) {
  const auth = await authenticateRequest(request, 'records:write');
  if (!auth.ok) return auth.response;
  const key = new URL(request.url).searchParams.get('key');
  if (!key || !key.startsWith(prefix)) return Response.json({ error: 'A valid activity file key is required.' }, { status: 400 });
  const blocked = await guardFile(auth, key);
  if (blocked) return blocked;
  await activityFiles().delete(key);
  return Response.json({ deleted: key });
}
