import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fontSizes, profileDefaults, profilePreferencesSchema } from '@/lib/profile';

const css = readFileSync('app/globals.css', 'utf8');

describe('Scout design tokens', () => {
  it('defines every variable the stylesheet uses', () => {
    const used = new Set([...css.matchAll(/var\((--[\w-]+)\s*\)/g)].map(match => match[1]));
    const defined = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1]));
    expect([...used].filter(name => !defined.has(name))).toEqual([]);
  });

  it('keeps a visible keyboard focus ring', () => {
    expect(css).toMatch(/--focus-ring:\s*0 0 0 2px/);
    expect(css).toMatch(/:focus-visible\s*\{[^}]*box-shadow:\s*var\(--focus-ring\)!important/);
  });
});

describe('Scout appearance preference', () => {
  it('follows the system theme unless the person chooses otherwise', () => {
    expect(profileDefaults.theme).toBe('System');
    expect(profilePreferencesSchema.safeParse({ ...profileDefaults, theme: 'Dark' }).success).toBe(true);
    expect(profilePreferencesSchema.safeParse({ ...profileDefaults, theme: 'Neon' }).success).toBe(false);
  });

  it('keeps people who saved preferences before font size existed on the default', () => {
    const older: Partial<typeof profileDefaults> = { ...profileDefaults };
    delete older.fontSize;
    expect(profilePreferencesSchema.parse(older).fontSize).toBe('Default');
    expect(profilePreferencesSchema.safeParse({ ...profileDefaults, fontSize: 'Tiny' }).success).toBe(false);
  });

  it('has a scale in the stylesheet for every font size', () => {
    for (const size of fontSizes.filter(size => size !== 'Default')) expect(css).toContain(`html[data-font-size='${size}'] { --font-scale:`);
  });

  it('routes every text size through the scale', () => {
    expect([...css.matchAll(/--text-[w-]+:s*[d.]+px/g)]).toEqual([]);
    expect([...css.matchAll(/font-size:s*[d.]+(px|rem)/g)].map(match => match[0])).toEqual([]);
  });
});

describe('card styling', () => {
  it('never marks a card with a coloured edge stripe', () => {
    expect(css.match(/border-left-color|border-left(-width)?:s*[2-9]px/g)).toBeNull();
  });
});
