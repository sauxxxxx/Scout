import { z } from 'zod';
import { leadStatuses } from '@/lib/validation';

/** Each colour has a light and dark version in globals.css, tested for readable button text. */
export const accentColors = ['Graphite', 'Ocean blue', 'Royal violet', 'Rose', 'Sunset', 'Scout green'] as const;
export type AccentColor = (typeof accentColors)[number];

/** The light-mode colour, for places the stylesheet can't reach, like invitation emails and the colour picker. */
export const accentHex: Record<AccentColor, string> = {
  'Scout green': '#0b7a5f', 'Ocean blue': '#1f66c1', 'Royal violet': '#6a45c7', Rose: '#c2325f', Sunset: '#b4500f', Graphite: '#14181d',
};

export const defaultTaskTypes = ['Facebook message', 'Call', 'Callback', 'Email', 'Meeting', 'Follow-up', 'Send proposal', 'Review proposal', 'Research', 'Prepare quote', 'Collect documents', 'Internal reminder', 'General task'];

export type LeadStatus = (typeof leadStatuses)[number];
export type Customization = {
  accent: AccentColor;
  logoUrl: string;
  welcomeMessage: string;
  /** Records always store the original status, so a rename can never break reports or Won and Lost. */
  statusLabels: Partial<Record<LeadStatus, string>>;
  taskTypes: string[];
};

export const defaultCustomization: Customization = { accent: 'Graphite', logoUrl: '', welcomeMessage: '', statusLabels: {}, taskTypes: defaultTaskTypes };

export const logoUrlPattern = /^\/api\/workspace\/logo\?key=logos%2F[^&/]+%2F[a-f0-9-]+\.(png|jpg|webp)$/;

export const customizationSchema = z.object({
  accent: z.enum(accentColors),
  logoUrl: z.string().max(300).refine(value => !value || logoUrlPattern.test(value), 'Upload the logo again.'),
  welcomeMessage: z.string().trim().max(200),
  statusLabels: z.object(Object.fromEntries(leadStatuses.map(status => [status, z.string().trim().max(30).optional()])) as Record<LeadStatus, z.ZodOptional<z.ZodString>>).strict(),
  taskTypes: z.array(z.string().trim().min(1, 'Task types cannot be blank.').max(40)).min(1, 'Keep at least one task type.').max(30),
}).strict().superRefine((value, context) => {
  const labels = leadStatuses.map(status => (value.statusLabels[status] || status).toLowerCase());
  if (new Set(labels).size !== labels.length) context.addIssue({ code: 'custom', message: 'Each status needs its own name.', path: ['statusLabels'] });
  if (new Set(value.taskTypes.map(type => type.toLowerCase())).size !== value.taskTypes.length) context.addIssue({ code: 'custom', message: 'Each task type needs its own name.', path: ['taskTypes'] });
});

export function parseCustomization(json: unknown): Customization {
  if (typeof json !== 'string' || !json) return defaultCustomization;
  try {
    const parsed = customizationSchema.safeParse({ ...defaultCustomization, ...JSON.parse(json) as object });
    return parsed.success ? parsed.data as Customization : defaultCustomization;
  } catch { return defaultCustomization; }
}

export function statusLabelOf(customization: Pick<Customization, 'statusLabels'>, status: string) {
  return customization.statusLabels[status as LeadStatus] || status;
}

/** The sign-in page needs these before anyone has a session, so nothing private belongs here. */
export function publicBranding(customization: Customization, workspaceName: string) {
  return { accent: customization.accent, logoUrl: customization.logoUrl, welcomeMessage: customization.welcomeMessage, workspaceName };
}
export type PublicBranding = ReturnType<typeof publicBranding>;

export function applyAccent(accent: AccentColor) {
  document.documentElement.dataset.accent = accent;
  try { window.localStorage.setItem('scout.accent', accent); } catch { /* Private mode: it applies again on the next load. */ }
}
