import { z } from 'zod';
import { customizationSchema, defaultCustomization, parseCustomization, type Customization } from '@/lib/customization';
import { defaultRolePermissions, workspaceCapabilities, type CapabilitySet, type RolePermissions, type WorkspaceCapability, type WorkspaceRole } from '@/lib/permissions';
import { landingPages } from '@/lib/profile';

export const inviteExpiryOptions = [1, 7, 30] as const;
export const maxInvitesPerRequest = 20;

export const roleDescriptions: Record<WorkspaceRole, string> = {
  owner: 'Full access, including managing other owners and workspace settings.',
  admin: 'Manages people, roles and all CRM records.',
  member: 'Creates and updates CRM records.',
  viewer: 'Can look but not change anything.',
};

export const capabilityDetails: Record<WorkspaceCapability, { label: string; description: string }> = {
  'finder:run': { label: 'Run Finder searches', description: 'Each search uses your Google and Gemini quota.' },
  'records:delete': { label: 'Delete records', description: 'Delete tasks, contacts, activities and searches.' },
  'records:export': { label: 'Export leads', description: 'Download leads as a CSV file.' },
  'records:view_all': { label: 'See all records', description: 'Off means they only see leads assigned to them, plus any lead where they hold an open task.' },
};

export type WorkspaceSettings = {
  customization: Customization;
  defaultRole: 'admin' | 'member' | 'viewer';
  senderName: string;
  emailMessage: string;
  allowedDomains: string[];
  adminsCanInvite: boolean;
  rolePermissions: RolePermissions;
};

export type CustomRole = { id: string; name: string; baseRole: 'member' | 'viewer'; capabilities: CapabilitySet };

export const defaultWorkspaceSettings: WorkspaceSettings = {
  customization: defaultCustomization,
  defaultRole: 'member',
  senderName: '',
  emailMessage: '',
  allowedDomains: [],
  adminsCanInvite: true,
  rolePermissions: defaultRolePermissions,
};

const capabilitySetSchema = z.object(Object.fromEntries(workspaceCapabilities.map(name => [name, z.boolean()])) as Record<WorkspaceCapability, z.ZodBoolean>).strict();

const domainSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/, 'Enter a domain such as example.com.');

export const workspaceSettingsSchema = z.object({
  workspaceName: z.string().trim().min(2).max(80).optional(),
  defaultRole: z.enum(['admin', 'member', 'viewer']),
  senderName: z.string().trim().max(80).regex(/^[^<>"\r\n]*$/, 'Sender name cannot contain quotes or angle brackets.'),
  emailMessage: z.string().trim().max(1000),
  allowedDomains: z.array(domainSchema).max(20),
  adminsCanInvite: z.boolean(),
  rolePermissions: z.object({ member: capabilitySetSchema, viewer: capabilitySetSchema }).strict(),
  customization: customizationSchema,
}).strict();

export const customRoleInputSchema = z.object({
  name: z.string().trim().min(2).max(40),
  baseRole: z.enum(['member', 'viewer']),
  capabilities: capabilitySetSchema,
}).strict();

export const customRoleUpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(2).max(40),
  capabilities: capabilitySetSchema,
}).strict();

export const invitationInputSchema = z.object({
  emails: z.array(z.email().max(254)).min(1).max(maxInvitesPerRequest),
  name: z.string().trim().max(120).optional(),
  role: z.enum(['viewer', 'member', 'admin', 'owner']),
  customRoleId: z.string().uuid().nullable().optional(),
  note: z.string().trim().max(500).optional(),
  expiresInDays: z.union([z.literal(1), z.literal(7), z.literal(30)]).default(7),
  landingPage: z.enum(landingPages).optional(),
  handoffOwner: z.string().trim().max(120).optional(),
}).strict();

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export function parseWorkspaceSettings(row: Record<string, unknown> | null | undefined): WorkspaceSettings {
  if (!row) return defaultWorkspaceSettings;
  const stored = parseJson<Partial<RolePermissions>>(row.role_permissions_json, {});
  const allowedDomains = parseJson<string[]>(row.allowed_domains_json, []);
  return {
    customization: parseCustomization(row.customization_json),
    defaultRole: row.default_role === 'admin' || row.default_role === 'viewer' ? row.default_role : 'member',
    senderName: String(row.sender_name || ''),
    emailMessage: String(row.email_message || ''),
    allowedDomains: Array.isArray(allowedDomains) ? allowedDomains : [],
    adminsCanInvite: row.admins_can_invite === undefined ? true : Boolean(row.admins_can_invite),
    rolePermissions: {
      member: { ...defaultRolePermissions.member, ...stored.member },
      viewer: { ...defaultRolePermissions.viewer, ...stored.viewer },
    },
  };
}

export function parseCustomRole(row: Record<string, unknown>): CustomRole {
  return {
    id: String(row.id),
    name: String(row.name),
    baseRole: row.base_role === 'viewer' ? 'viewer' : 'member',
    capabilities: { ...defaultRolePermissions[row.base_role === 'viewer' ? 'viewer' : 'member'], ...parseJson<Partial<CapabilitySet>>(row.permissions_json, {}) },
  };
}

/** Shown to anyone holding the link, so it confirms the address without giving it away. */
export function maskEmail(email: string) {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const visible = local.length > 2 ? `${local[0]}***${local[local.length - 1]}` : `${local[0] || ''}***`;
  return `${visible}@${domain}`;
}

export function parseInviteEmails(text: string) {
  const entries = [...new Set(text.split(/[\s,;]+/).map(item => item.trim().toLowerCase()).filter(Boolean))];
  const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return { valid: entries.filter(item => pattern.test(item)), invalid: entries.filter(item => !pattern.test(item)) };
}

export function isDomainAllowed(email: string, domains: string[]) {
  if (!domains.length) return true;
  return domains.includes(email.split('@')[1]?.toLowerCase() || '');
}

/** An invite lives in one database, so its link has to point back at the app that created it. */
export function inviteOrigin(requestUrl: string, publicUrl?: string) {
  const url = new URL(requestUrl);
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname.endsWith('.localhost');
  return local || !publicUrl ? url.origin : publicUrl.replace(/\/$/, '');
}

export function inviteLink(origin: string, id: string) {
  return `${origin}/?invite=${encodeURIComponent(id)}`;
}
