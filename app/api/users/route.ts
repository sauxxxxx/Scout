import { authenticateRequest } from '@/lib/auth';
import { accentHex } from '@/lib/customization';
import { canAssignRole, canChangeRole, type WorkspaceRole } from '@/lib/permissions';
import { recordAudit } from '@/lib/audit';
import { allowRequest, tooManyRequests } from '@/lib/rate-limit';
import { validationError } from '@/lib/validation';
import { env } from 'cloudflare:workers';
import type { FinderEnv } from '@/lib/finder-runtime';
import { sendInvitationEmail } from '@/lib/invitation-email';
import { inviteLink, inviteOrigin, invitationInputSchema, isDomainAllowed } from '@/lib/team';
import { listMembers, loadCustomRoles, loadWorkspaceSettings, openRecordCounts, transferOpenRecords } from '@/lib/team-store';

export const dynamic = 'force-dynamic';

type Delivery = 'sent' | 'manual' | 'failed';
type Authenticated = Extract<Awaited<ReturnType<typeof authenticateRequest>>, { ok: true }>;
type InviteResult = { email: string; status: Delivery | 'member' | 'blocked'; inviteUrl?: string };

const runtime = () => env as unknown as FinderEnv;
const originFor = (request: Request) => inviteOrigin(request.url, runtime().SCOUT_PUBLIC_URL);
const members = (request: Request, auth: Authenticated) => listMembers(auth.db, auth.session.workspace.id, originFor(request), auth.session.canInvite);

async function deliver(auth: Authenticated, invite: { to: string; name: string; url: string; note: string; expiresInDays: number }): Promise<Delivery> {
  const settings = await loadWorkspaceSettings(auth.db, auth.session.workspace.id);
  try {
    const email = await sendInvitationEmail({ apiKey: runtime().RESEND_API_KEY, from: runtime().SCOUT_EMAIL_FROM }, {
      to: invite.to,
      name: invite.name,
      inviterName: auth.session.user.name,
      workspaceName: auth.session.workspace.name,
      inviteUrl: invite.url,
      expiresInDays: invite.expiresInDays,
      note: invite.note,
      workspaceMessage: settings.emailMessage,
      senderName: settings.senderName,
      accentHex: accentHex[settings.customization.accent],
      logoUrl: settings.customization.logoUrl,
    });
    return email.delivered ? 'sent' : 'manual';
  } catch {
    return 'failed';
  }
}

async function ownerCount(auth: Authenticated) {
  const owners = await auth.db.prepare("SELECT COUNT(*) total FROM workspace_memberships WHERE workspace_id=? AND role='owner'").bind(auth.session.workspace.id).first<{ total: number }>();
  return Number(owners?.total || 0);
}

async function customRoleMatches(auth: Authenticated, role: WorkspaceRole, customRoleId?: string | null) {
  if (!customRoleId) return true;
  const roles = await loadCustomRoles(auth.db, auth.session.workspace.id);
  return roles.some(item => item.id === customRoleId && item.baseRole === role);
}

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const impact = new URL(request.url).searchParams.get('impact');
  if (impact) {
    if (!['owner', 'admin'].includes(auth.session.role)) return Response.json({ error: 'Your workspace role does not allow this action.' }, { status: 403 });
    const target = await auth.db.prepare('SELECT u.name FROM users u JOIN workspace_memberships m ON m.user_id=u.id WHERE m.workspace_id=? AND u.id=?').bind(auth.session.workspace.id, impact).first<{ name: string }>();
    if (!target) return Response.json({ error: 'Workspace user not found.' }, { status: 404 });
    return Response.json({ counts: await openRecordCounts(auth.db, auth.session.workspace.id, target.name) });
  }
  return Response.json({ users: await members(request, auth), currentUserId: auth.session.user.id, currentRole: auth.session.role });
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request, 'users:invite');
  if (!auth.ok) return auth.response;
  const parsed = invitationInputSchema.safeParse(await request.json());
  if (!parsed.success) return validationError(parsed.error);
  const input = parsed.data;
  const workspaceId = auth.session.workspace.id;
  if (!await allowRequest(auth.db, `invite:${auth.session.user.id}`, 100, 3600)) return tooManyRequests(600);
  if (!canAssignRole(auth.session.role, input.role)) return Response.json({ error: 'Only an owner can assign the owner role.' }, { status: 403 });
  if (!await customRoleMatches(auth, input.role, input.customRoleId)) return Response.json({ error: 'That custom role no longer exists.' }, { status: 422 });
  if (input.handoffOwner) {
    const source = await auth.db.prepare('SELECT u.id FROM users u JOIN workspace_memberships m ON m.user_id=u.id WHERE m.workspace_id=? AND u.name=?').bind(workspaceId, input.handoffOwner).first();
    if (!source) return Response.json({ error: 'The person handing over leads is not a workspace member.' }, { status: 422 });
  }
  const settings = await loadWorkspaceSettings(auth.db, workspaceId);
  const origin = originFor(request);
  const results: InviteResult[] = [];

  for (const rawEmail of [...new Set(input.emails.map(item => item.toLowerCase()))]) {
    if (!isDomainAllowed(rawEmail, settings.allowedDomains)) { results.push({ email: rawEmail, status: 'blocked' }); continue; }
    const existing = await auth.db.prepare('SELECT u.id FROM users u JOIN workspace_memberships m ON m.user_id=u.id WHERE m.workspace_id=? AND lower(u.email)=lower(?)').bind(workspaceId, rawEmail).first();
    if (existing) { results.push({ email: rawEmail, status: 'member' }); continue; }
    const name = input.name || rawEmail.split('@')[0];
    const current = await auth.db.prepare("SELECT id FROM workspace_invitations WHERE workspace_id=? AND lower(email)=lower(?) AND status='pending'").bind(workspaceId, rawEmail).first<{ id: string }>();
    const id = current?.id || crypto.randomUUID();
    const fields = [name, input.role, input.customRoleId || null, input.note || '', input.landingPage || '', input.handoffOwner || '', input.expiresInDays, auth.session.user.id];
    if (current) {
      await auth.db.prepare("UPDATE workspace_invitations SET name=?,role=?,custom_role_id=?,note=?,landing_page=?,handoff_owner=?,expires_days=?,invited_by=?,expires_at=datetime('now',?),updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(...fields, `+${input.expiresInDays} days`, id).run();
    } else {
      await auth.db.prepare("INSERT INTO workspace_invitations (name,role,custom_role_id,note,landing_page,handoff_owner,expires_days,invited_by,id,workspace_id,email,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now',?))").bind(...fields, id, workspaceId, rawEmail, `+${input.expiresInDays} days`).run();
    }
    const url = inviteLink(origin, id);
    const delivery = await deliver(auth, { to: rawEmail, name, url, note: input.note || '', expiresInDays: input.expiresInDays });
    await auth.db.prepare('UPDATE workspace_invitations SET delivery=?,last_sent_at=CASE WHEN ?=? THEN CURRENT_TIMESTAMP ELSE last_sent_at END WHERE id=?').bind(delivery, delivery, 'sent', id).run();
    results.push({ email: rawEmail, status: delivery, inviteUrl: url });
    await recordAudit(auth, 'invite.sent', rawEmail, `Role: ${input.role}`);
  }

  const created = results.some(item => item.inviteUrl);
  return Response.json({ users: await members(request, auth), results, ...(created ? {} : { error: 'No invitations were created.' }) }, { status: created ? 201 : 422 });
}

export async function PATCH(request: Request) {
  const auth = await authenticateRequest(request, 'users:manage');
  if (!auth.ok) return auth.response;
  const workspaceId = auth.session.workspace.id;
  const body = await request.json() as { id?: string; role?: WorkspaceRole; customRoleId?: string | null; action?: string };
  if (!body.id) return Response.json({ error: 'User ID is required.' }, { status: 400 });

  if (body.action === 'resend') {
    if (!auth.session.canInvite || !body.id.startsWith('invite:')) return Response.json({ error: 'Your workspace role does not allow this action.' }, { status: 403 });
    const id = body.id.slice(7);
    const invite = await auth.db.prepare("SELECT email,name,note,expires_days FROM workspace_invitations WHERE id=? AND workspace_id=? AND status='pending'").bind(id, workspaceId).first<{ email: string; name: string; note: string; expires_days: number }>();
    if (!invite) return Response.json({ error: 'Pending invitation not found.' }, { status: 404 });
    const delivery = await deliver(auth, { to: invite.email, name: invite.name, url: inviteLink(originFor(request), id), note: invite.note, expiresInDays: invite.expires_days });
    await auth.db.prepare("UPDATE workspace_invitations SET delivery=?,expires_at=datetime('now',?),last_sent_at=CASE WHEN ?=? THEN CURRENT_TIMESTAMP ELSE last_sent_at END,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(delivery, `+${invite.expires_days} days`, delivery, 'sent', id).run();
    await recordAudit(auth, 'invite.resent', invite.email);
    return Response.json({ users: await members(request, auth), delivery });
  }

  if (body.action === 'suspend' || body.action === 'reactivate') {
    if (body.id === auth.session.user.id) return Response.json({ error: 'You cannot suspend yourself.' }, { status: 409 });
    const person = await auth.db.prepare('SELECT m.role,u.name FROM workspace_memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? AND m.user_id=?').bind(workspaceId, body.id).first<{ role: WorkspaceRole; name: string }>();
    if (!person) return Response.json({ error: 'Workspace user not found.' }, { status: 404 });
    if (!canAssignRole(auth.session.role, person.role)) return Response.json({ error: 'You cannot change this workspace user.' }, { status: 403 });
    const suspending = body.action === 'suspend';
    await auth.db.batch([
      auth.db.prepare('UPDATE workspace_memberships SET suspended=?,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND user_id=?').bind(suspending ? 1 : 0, workspaceId, body.id),
      ...(suspending ? [auth.db.prepare('DELETE FROM auth_sessions WHERE user_id=?').bind(body.id)] : []),
    ]);
    await recordAudit(auth, suspending ? 'member.suspended' : 'member.reactivated', person.name);
    return Response.json({ users: await members(request, auth) });
  }

  if (!body.role || !['owner', 'admin', 'member', 'viewer'].includes(body.role)) return Response.json({ error: 'User ID and valid role are required.' }, { status: 400 });
  if (!await customRoleMatches(auth, body.role, body.customRoleId)) return Response.json({ error: 'That custom role no longer exists.' }, { status: 422 });

  if (body.id.startsWith('invite:')) {
    if (!canAssignRole(auth.session.role, body.role)) return Response.json({ error: 'Only an owner can assign the owner role.' }, { status: 403 });
    const result = await auth.db.prepare("UPDATE workspace_invitations SET role=?,custom_role_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND status='pending'").bind(body.role, body.customRoleId || null, body.id.slice(7), workspaceId).run();
    if (!result.meta.changes) return Response.json({ error: 'Pending invitation not found.' }, { status: 404 });
    return Response.json({ users: await members(request, auth) });
  }

  const target = await auth.db.prepare('SELECT role FROM workspace_memberships WHERE workspace_id=? AND user_id=?').bind(workspaceId, body.id).first<{ role: WorkspaceRole }>();
  if (!target) return Response.json({ error: 'Workspace user not found.' }, { status: 404 });
  if (!canChangeRole(auth.session.role, target.role, body.role)) return Response.json({ error: 'Only an owner can change an owner role.' }, { status: 403 });
  if (target.role === 'owner' && body.role !== 'owner' && await ownerCount(auth) <= 1) return Response.json({ error: 'Assign another owner before changing this role.' }, { status: 409 });
  await auth.db.prepare('UPDATE workspace_memberships SET role=?,custom_role_id=?,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND user_id=?').bind(body.role, body.customRoleId || null, workspaceId, body.id).run();
  await recordAudit(auth, 'member.role_changed', body.id, `${target.role} to ${body.role}`);
  return Response.json({ users: await members(request, auth) });
}

export async function DELETE(request: Request) {
  const auth = await authenticateRequest(request, 'users:manage');
  if (!auth.ok) return auth.response;
  const workspaceId = auth.session.workspace.id;
  const params = new URL(request.url).searchParams;
  const id = params.get('id');
  if (!id) return Response.json({ error: 'User ID is required.' }, { status: 400 });

  if (id.startsWith('invite:')) {
    const result = await auth.db.prepare("UPDATE workspace_invitations SET status='revoked',updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND status='pending'").bind(id.slice(7), workspaceId).run();
    if (!result.meta.changes) return Response.json({ error: 'Pending invitation not found.' }, { status: 404 });
    await recordAudit(auth, 'invite.revoked', id.slice(7));
    return Response.json({ users: await members(request, auth) });
  }

  if (id === auth.session.user.id) return Response.json({ error: 'You cannot remove yourself from the workspace.' }, { status: 409 });
  const target = await auth.db.prepare('SELECT m.role,u.name FROM workspace_memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? AND m.user_id=?').bind(workspaceId, id).first<{ role: WorkspaceRole; name: string }>();
  if (!target) return Response.json({ error: 'Workspace user not found.' }, { status: 404 });
  if (!canAssignRole(auth.session.role, target.role)) return Response.json({ error: 'You cannot remove this workspace user.' }, { status: 403 });
  if (target.role === 'owner' && await ownerCount(auth) <= 1) return Response.json({ error: 'Scout must keep at least one owner.' }, { status: 409 });

  const counts = await openRecordCounts(auth.db, workspaceId, target.name);
  const reassignTo = params.get('reassignTo')?.trim();
  if (counts.total && !reassignTo) return Response.json({ error: 'Choose who takes over their open work first.', counts }, { status: 409 });
  if (reassignTo) {
    const successor = await auth.db.prepare("SELECT u.id FROM users u JOIN workspace_memberships m ON m.user_id=u.id WHERE m.workspace_id=? AND u.name=? AND u.id!=? AND m.role!='viewer' AND u.status='active'").bind(workspaceId, reassignTo, id).first();
    if (!successor) return Response.json({ error: 'Choose an active member to take over this work.' }, { status: 422 });
  }
  await auth.db.batch([
    ...(reassignTo ? transferOpenRecords(auth.db, workspaceId, target.name, reassignTo) : []),
    auth.db.prepare('DELETE FROM workspace_memberships WHERE workspace_id=? AND user_id=?').bind(workspaceId, id),
    auth.db.prepare('DELETE FROM auth_sessions WHERE user_id=?').bind(id),
  ]);
  await recordAudit(auth, 'member.removed', target.name, reassignTo ? `Open work moved to ${reassignTo}` : '');
  return Response.json({ users: await members(request, auth) });
}
