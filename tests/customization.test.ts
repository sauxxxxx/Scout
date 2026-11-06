import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accentColors, accentHex, customizationSchema, defaultCustomization, defaultTaskTypes, parseCustomization, publicBranding, statusLabelOf } from '@/lib/customization';
import { sendInvitationEmail } from '@/lib/invitation-email';
import { parseWorkspaceSettings, workspaceSettingsSchema } from '@/lib/team';
import { defaultViewSettings, moved, normalizeViewSettings, parseViewSettings, viewSettingsSchema } from '@/lib/view-settings';

const css = readFileSync('app/globals.css', 'utf8');

const channel = (value: number) => { const part = value / 255; return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4; };
const luminance = (hex: string) => {
  const full = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  const [red, green, blue] = [1, 3, 5].map(start => parseInt(full.slice(start, start + 2), 16));
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
};
const contrast = (first: string, second: string) => {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
};
const tokens = (selector: string) => {
  const rule = css.slice(css.indexOf(`${selector} {`)).split('}')[0];
  const read = (name: string) => rule.match(new RegExp(`${name}:(#[0-9a-f]+)`))?.[1] as string;
  return { accent: read('--accent'), soft: read('--accent-soft'), ink: read('--accent-ink'), on: read('--on-accent') };
};

describe('accent colours', () => {
  it.each(accentColors)('%s stays readable in light mode', accent => {
    const light = tokens(`html[data-accent='${accent}']`);
    expect(light.accent).toBe(accentHex[accent]);
    expect(contrast(light.accent, light.on)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(light.ink, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(light.ink, light.soft)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(accentColors)('%s stays readable in dark mode', accent => {
    const dark = tokens(`html[data-accent='${accent}'][data-theme=dark]`);
    expect(contrast(dark.accent, dark.on)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark.ink, '#15181a')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark.ink, dark.soft)).toBeGreaterThanOrEqual(4.5);
  });

  it('starts on neutral graphite before any workspace loads, with no green', () => {
    expect(defaultCustomization.accent).toBe('Graphite');
    expect(css.slice(css.indexOf(':root {'), css.indexOf('--focus-ring'))).toContain(`--accent:${accentHex.Graphite};`);
  });
});

describe('workspace customization', () => {
  const valid = { ...defaultCustomization };

  it('shows the workspace name for a status, and the original when there is none', () => {
    expect(statusLabelOf({ statusLabels: { Interested: 'Warm' } }, 'Interested')).toBe('Warm');
    expect(statusLabelOf({ statusLabels: {} }, 'Interested')).toBe('Interested');
    expect(statusLabelOf({ statusLabels: { Interested: 'Warm' } }, 'All statuses')).toBe('All statuses');
  });

  it('refuses two statuses with the same name, including an original one', () => {
    expect(customizationSchema.safeParse({ ...valid, statusLabels: { New: 'Fresh', Contacted: 'fresh' } }).success).toBe(false);
    expect(customizationSchema.safeParse({ ...valid, statusLabels: { New: 'Won' } }).success).toBe(false);
    expect(customizationSchema.safeParse({ ...valid, statusLabels: { New: 'Fresh' } }).success).toBe(true);
  });

  it('refuses a status that does not exist', () => {
    expect(customizationSchema.safeParse({ ...valid, statusLabels: { Maybe: 'x' } }).success).toBe(false);
  });

  it('keeps at least one task type, each unique', () => {
    expect(customizationSchema.safeParse({ ...valid, taskTypes: [] }).success).toBe(false);
    expect(customizationSchema.safeParse({ ...valid, taskTypes: ['Call', 'call'] }).success).toBe(false);
    expect(customizationSchema.safeParse({ ...valid, taskTypes: ['Site visit'] }).success).toBe(true);
  });

  it('only accepts logos uploaded to Scout', () => {
    expect(customizationSchema.safeParse({ ...valid, logoUrl: '/api/workspace/logo?key=logos%2Fscout-default%2Fab12-cd34.png' }).success).toBe(true);
    for (const logoUrl of ['https://evil.example/logo.png', 'javascript:alert(1)', '/api/workspace/logo?key=logos%2Fa%2Fb.svg', '/api/profile/photo?key=x']) {
      expect(customizationSchema.safeParse({ ...valid, logoUrl }).success).toBe(false);
    }
  });

  it('only allows the tested colours', () => {
    expect(customizationSchema.safeParse({ ...valid, accent: '#ff0000' }).success).toBe(false);
  });

  it('falls back to Scout defaults when stored values are missing or damaged', () => {
    expect(parseCustomization('')).toEqual(defaultCustomization);
    expect(parseCustomization('{not json')).toEqual(defaultCustomization);
    expect(parseCustomization('{"accent":"Neon"}')).toEqual(defaultCustomization);
    expect(parseCustomization('{"accent":"Rose"}')).toEqual({ ...defaultCustomization, accent: 'Rose' });
    expect(parseCustomization('{"accent":"Rose"}').taskTypes).toEqual(defaultTaskTypes);
  });

  it('keeps stored customization with the workspace settings', () => {
    expect(parseWorkspaceSettings({ customization_json: '{"accent":"Sunset"}' }).customization.accent).toBe('Sunset');
    expect(workspaceSettingsSchema.shape.customization).toBeDefined();
  });

  it('shares only what the sign-in page needs', () => {
    expect(Object.keys(publicBranding({ ...defaultCustomization, statusLabels: { New: 'Secret' } }, 'Acme')).sort()).toEqual(['accent', 'logoUrl', 'welcomeMessage', 'workspaceName']);
  });
});

describe('personal view settings', () => {
  it('moves an item, and leaves the list alone at either end', () => {
    expect(moved(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moved(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
    expect(moved(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(moved(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });

  it('keeps a saved column order, and adds anything new to the end', () => {
    const parsed = normalizeViewSettings({ ...defaultViewSettings, leadColumns: [{ key: 'email', visible: true }, { key: 'status', visible: false }] });
    expect(parsed.leadColumns.slice(0, 2)).toEqual([{ key: 'email', visible: true }, { key: 'status', visible: false }]);
    expect(parsed.leadColumns).toHaveLength(defaultViewSettings.leadColumns.length);
    expect(new Set(parsed.leadColumns.map(column => column.key)).size).toBe(parsed.leadColumns.length);
  });

  it('drops a repeated column', () => {
    const parsed = normalizeViewSettings({ ...defaultViewSettings, leadColumns: [{ key: 'city', visible: true }, { key: 'city', visible: false }] });
    expect(parsed.leadColumns.filter(column => column.key === 'city')).toEqual([{ key: 'city', visible: true }]);
  });

  it('uses the defaults when stored settings are damaged', () => {
    expect(parseViewSettings('')).toEqual(defaultViewSettings);
    expect(parseViewSettings('{oops')).toEqual(defaultViewSettings);
    expect(parseViewSettings('{"savedFilters":"yes"}')).toEqual(defaultViewSettings);
    expect(parseViewSettings('{"sidebarCollapsed":true}')).toEqual(defaultViewSettings);
  });

  it('limits saved views and refuses unknown columns', () => {
    const filter = { id: 'a', name: 'Hot', status: 'New', owner: 'All owners', priority: 'High', industry: 'All industries', minimumScore: 'Any score', touchFilter: 'Any last touch' };
    expect(viewSettingsSchema.safeParse({ ...defaultViewSettings, savedFilters: [filter] }).success).toBe(true);
    expect(viewSettingsSchema.safeParse({ ...defaultViewSettings, savedFilters: Array.from({ length: 21 }, () => filter) }).success).toBe(false);
    expect(viewSettingsSchema.safeParse({ ...defaultViewSettings, leadColumns: [{ key: 'secret', visible: true }] }).success).toBe(false);
  });
});

describe('invitation email branding', () => {
  afterEach(() => vi.unstubAllGlobals());
  const send = async (extra: { accentHex?: string; logoUrl?: string }) => {
    const request = vi.fn(async () => new Response('{"id":"1"}'));
    vi.stubGlobal('fetch', request);
    await sendInvitationEmail({ apiKey: 'test', from: 'a@b.co' }, { to: 'c@d.co', name: 'Sam', inviterName: 'Ana', workspaceName: 'Acme', inviteUrl: 'https://scout.example/?invite=1', ...extra });
    const options = (request.mock.calls[0] as unknown as [string, { body: string }])[1];
    return (JSON.parse(options.body) as { html: string }).html;
  };

  it('uses the workspace colour and logo', async () => {
    const html = await send({ accentHex: '#c2325f', logoUrl: '/api/workspace/logo?key=logos%2Fa%2Fb.png' });
    expect(html).toContain('background:#c2325f');
    expect(html).toContain('https://scout.example/api/workspace/logo?key=logos%2Fa%2Fb.png');
  });

  it('never puts an unexpected value into the button style', async () => {
    const html = await send({ accentHex: 'red;background:url(x)' });
    expect(html).not.toContain('url(x)');
    expect(html).toContain('https://scout.example/scout-logo.png');
  });
});

describe('bento colours', () => {
  it('keeps the highlight readable with every accent colour', () => {
    for (const accent of accentColors.filter(item => !['Scout green', 'Graphite'].includes(item))) {
      const pop = css.slice(css.indexOf(`html[data-accent='${accent}'] { --bento-pop`)).match(/--bento-pop:(#[0-9a-f]+)/)?.[1] as string;
      expect(contrast(pop, '#14181d')).toBeGreaterThanOrEqual(4.5);
    }
  });

  const token = (name: string, block: string) => block.match(new RegExp(`${name}:(#[0-9a-f]+)`))?.[1] as string;
  const light = css.slice(css.indexOf('--bento-canvas:#e9ecef')).split('}')[0];
  const dark = css.slice(css.indexOf('--bento-canvas:#0e1114')).split('}')[0];

  it('keeps pipeline stages readable in light and dark mode', () => {
    for (const block of [light, dark]) for (const stage of [1, 2, 3, 4]) expect(contrast(token(`--bento-stage-${stage}`, block), '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('--bento-pop', light), token('--bento-on-pop', light))).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the dark tile readable', () => {
    expect(contrast(token('--bento-dark', light), '#c7ced6')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('--bento-dark', dark), token('--bento-on-dark-muted', dark))).toBeGreaterThanOrEqual(4.5);
  });
});
