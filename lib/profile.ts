import { z } from 'zod';

export const pipelineViews = ['Board', 'Detailed', 'Table'] as const;
export const currencies = ['PHP'] as const;
export const timezones = ['Asia/Manila', 'Asia/Singapore', 'UTC'] as const;
export const languages = ['English (Philippines)', 'English (United States)'] as const;
export const dateFormats = ['MMM d, yyyy', 'dd/MM/yyyy', 'MM/dd/yyyy'] as const;
export const timeFormats = ['12-hour', '24-hour'] as const;
export const landingPages = ['Overview', 'Leads', 'Finder', 'Pipeline', 'Tasks', 'Activities'] as const;

export const profileDefaults = {
  pipelineView: 'Board' as const,
  landingPage: 'Overview' as (typeof landingPages)[number],
  defaultOwner: 'Me',
  currency: 'PHP' as const,
  finderRadius: 10 as const,
  finderLeadCount: 20 as const,
  cardProperties: { value: true, owner: true, closeDate: true, probability: true, priority: true, nextAction: false },
};

export const notificationDefaults = {
  taskReminders: true,
  leadAssignments: true,
  opportunityChanges: true,
};

export const profilePreferencesSchema = z.object({
  pipelineView: z.enum(pipelineViews),
  landingPage: z.enum(landingPages).default('Overview'),
  defaultOwner: z.string().trim().min(1).max(120),
  currency: z.enum(currencies),
  finderRadius: z.union([z.literal(3), z.literal(5), z.literal(10), z.literal(15), z.literal(25), z.literal(50)]),
  finderLeadCount: z.union([z.literal(10), z.literal(20), z.literal(40), z.literal(60)]),
  cardProperties: z.object({
    value: z.boolean(), owner: z.boolean(), closeDate: z.boolean(), probability: z.boolean(), priority: z.boolean(), nextAction: z.boolean(),
  }).strict(),
}).strict();

export const profileNotificationsSchema = z.object({
  taskReminders: z.boolean(), leadAssignments: z.boolean(), opportunityChanges: z.boolean(),
}).strip();

export const profileUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  jobTitle: z.string().trim().max(120),
  phone: z.string().trim().max(80),
  avatarUrl: z.string().max(2000).refine(value => !value || /^\/api\/profile\/photo\?key=profiles%2F[^&]+%2F[a-f0-9-]+\.jpg$/.test(value) || /^https?:\/\//.test(value) && z.url().safeParse(value).success, 'Choose a valid profile photo.'),
  timezone: z.enum(timezones),
  language: z.enum(languages),
  dateFormat: z.enum(dateFormats),
  timeFormat: z.enum(timeFormats),
  preferences: profilePreferencesSchema,
  notifications: profileNotificationsSchema,
}).strict();

export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

export function parseObject<T extends object>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try { return { ...fallback, ...(JSON.parse(value) as Partial<T>) }; } catch { return fallback; }
}
