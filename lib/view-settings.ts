import { z } from 'zod';

export const leadColumnOptions = [
  { key: 'status', label: 'Status' }, { key: 'score', label: 'Score' }, { key: 'owner', label: 'Owner' }, { key: 'next', label: 'Next action' }, { key: 'lastTouch', label: 'Last touch' },
  { key: 'priority', label: 'Priority' }, { key: 'city', label: 'City' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' },
] as const;
export type LeadColumn = (typeof leadColumnOptions)[number]['key'];

export const overviewSectionOptions = [
  { key: 'pipeline', label: 'Pipeline and next follow-up' }, { key: 'results', label: 'Results' }, { key: 'followups', label: 'Today\u2019s follow-ups' }, { key: 'team', label: 'Team results' },
] as const;
export type OverviewSection = (typeof overviewSectionOptions)[number]['key'];

const leadColumnKeys = leadColumnOptions.map(option => option.key) as [LeadColumn, ...LeadColumn[]];
const overviewSectionKeys = overviewSectionOptions.map(option => option.key) as [OverviewSection, ...OverviewSection[]];

export const savedFilterSchema = z.object({
  id: z.string().min(1).max(60), name: z.string().trim().min(1).max(40),
  status: z.string().max(60), owner: z.string().max(120), priority: z.string().max(40), industry: z.string().max(120), minimumScore: z.string().max(20), touchFilter: z.string().max(40),
}).strict();
export type SavedFilter = z.infer<typeof savedFilterSchema>;

export const viewSettingsSchema = z.object({
  leadColumns: z.array(z.object({ key: z.enum(leadColumnKeys), visible: z.boolean() }).strict()).max(leadColumnKeys.length),
  overviewSections: z.array(z.object({ key: z.enum(overviewSectionKeys), visible: z.boolean() }).strict()).max(overviewSectionKeys.length),
  savedFilters: z.array(savedFilterSchema).max(20),
  tablePageSize: z.union([z.literal(25), z.literal(50), z.literal(100)]),
  backgroundUrl: z.string().max(300).refine(value => !value || /^\/api\/profile\/background\?key=backgrounds%2F[A-Za-z0-9._~-]+(?:%[0-9A-Fa-f]{2}[A-Za-z0-9._~-]*)*%2F[a-f0-9-]+\.jpg$/.test(value), 'Upload the image again.'),
});
export type ViewSettings = z.infer<typeof viewSettingsSchema>;

export const defaultViewSettings: ViewSettings = {
  leadColumns: leadColumnKeys.map(key => ({ key, visible: !['priority', 'city', 'phone', 'email'].includes(key) })),
  overviewSections: overviewSectionKeys.map(key => ({ key, visible: true })),
  savedFilters: [],
  tablePageSize: 25,
  backgroundUrl: '',
};

/** Anything added to Scout later joins the end of a saved list, so older settings keep working. */
function withEveryKey<K extends string>(saved: { key: K; visible: boolean }[], defaults: { key: K; visible: boolean }[]) {
  const unique = saved.filter((item, index) => saved.findIndex(other => other.key === item.key) === index);
  return [...unique, ...defaults.filter(item => !unique.some(other => other.key === item.key))];
}

export function normalizeViewSettings(value: ViewSettings): ViewSettings {
  return { ...value, leadColumns: withEveryKey(value.leadColumns, defaultViewSettings.leadColumns), overviewSections: withEveryKey(value.overviewSections, defaultViewSettings.overviewSections) };
}

export function parseViewSettings(json: unknown): ViewSettings {
  if (typeof json !== 'string' || !json) return defaultViewSettings;
  try {
    const parsed = viewSettingsSchema.safeParse({ ...defaultViewSettings, ...JSON.parse(json) as object });
    return parsed.success ? normalizeViewSettings(parsed.data) : defaultViewSettings;
  } catch { return defaultViewSettings; }
}

/** Moves one item up or down a list, and leaves the list alone at either end. */
export function moved<T>(list: T[], index: number, step: -1 | 1) {
  const target = index + step;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
