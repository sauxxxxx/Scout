'use client';

import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';

export type SyncProblem = { kind: 'failed' | 'conflict' | 'offline'; message: string; key?: string };

type Options<T> = {
  enabled: boolean;
  items: T[];
  setItems: Dispatch<SetStateAction<T[]>>;
  baseline: RefObject<Map<string, T>>;
  keyOf: (item: T) => string | undefined;
  withKeys: (item: T) => T;
  /** 'wait' holds a record back until something it needs is saved; 'drop' removes a record whose parent no longer exists. */
  holdBack?: (item: T) => 'wait' | 'drop' | null;
  endpoint: string;
  responseKey: string;
  labelOf: (item: T) => string;
  same: (left: T, right: T) => boolean;
  merge: (item: T, saved: T) => T;
  normalize?: (saved: T) => T;
  delay?: number;
  onProblem: (problem: SyncProblem) => void;
};

async function readResponse(response: Response) {
  return await response.json().catch(() => ({})) as { error?: string; conflict?: boolean } & Record<string, unknown>;
}

/**
 * Saves local changes in the background. A record the server refuses is rolled back and reported, so the screen
 * never shows something that was not stored. A conflict keeps the person's edit and waits for their decision.
 */
export function useRecordSync<T>({ enabled, items, setItems, baseline, keyOf, withKeys, holdBack, endpoint, responseKey, labelOf, same, merge, normalize, delay = 300, onProblem }: Options<T>) {
  const syncing = useRef(false);
  const busy = useRef(false);
  const held = useRef(new Set<string>());
  const [attempt, setAttempt] = useState(0);
  const latest = useRef({ keyOf, withKeys, holdBack, labelOf, same, merge, normalize, onProblem });
  useEffect(() => { latest.current = { keyOf, withKeys, holdBack, labelOf, same, merge, normalize, onProblem }; });

  useEffect(() => {
    const { keyOf: key, withKeys: addKeys, holdBack: hold, same: matches } = latest.current;
    if (!enabled) { busy.current = false; return; }
    if (syncing.current) return;
    if (items.some(item => !key(item))) { setItems(value => value.map(addKeys)); return; }
    const orphaned = hold ? items.filter(item => !baseline.current.has(key(item)!) && hold(item) === 'drop') : [];
    if (orphaned.length) { setItems(value => value.filter(item => !orphaned.some(gone => key(gone) === key(item)))); return; }

    const changed = items.filter(item => {
      const id = key(item)!;
      const previous = baseline.current.get(id);
      return !held.current.has(id) && (previous ? !matches(item, previous) : hold?.(item) !== 'wait');
    });
    const present = new Set(items.map(item => key(item)));
    const removed = [...baseline.current.entries()].filter(([id]) => !present.has(id));
    if (!changed.length && !removed.length) { busy.current = false; return; }

    busy.current = true;
    const timer = window.setTimeout(async () => {
      syncing.current = true;
      const { labelOf: label, merge: combine, normalize: tidy, onProblem: report } = latest.current;
      try {
        for (const item of changed) {
          const id = key(item)!;
          const previous = baseline.current.get(id);
          const response = await fetch(endpoint, { method: previous ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(item) });
          const data = await readResponse(response);
          if (response.ok) {
            const saved = tidy ? tidy(data[responseKey] as T) : data[responseKey] as T;
            baseline.current.set(id, saved);
            // Untouched since sending: take the server's copy. Edited meanwhile: keep the edit and only adopt the new version.
            setItems(value => value.map(current => (key(current) !== id ? current : current === item ? saved : combine(current, saved))));
          } else if (data.conflict) {
            held.current.add(id);
            report({ kind: 'conflict', key: id, message: `${label(item)} was changed by someone else.` });
          } else {
            setItems(value => (previous ? value.map(current => (key(current) === id ? previous : current)) : value.filter(current => key(current) !== id)));
            report({ kind: 'failed', message: `${label(item)} was not saved. ${data.error || 'Try again.'}` });
          }
        }
        for (const [id, previous] of removed) {
          const response = await fetch(`${endpoint}?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
          if (response.ok) baseline.current.delete(id);
          else {
            const data = await readResponse(response);
            setItems(value => [...value, previous]);
            report({ kind: 'failed', message: `${label(previous)} was not deleted. ${data.error || 'Try again.'}` });
          }
        }
      } catch {
        report({ kind: 'offline', message: 'Scout can’t reach the server. Your changes will save when you’re back online.' });
        window.setTimeout(() => setAttempt(value => value + 1), 15000);
      } finally {
        syncing.current = false;
        busy.current = false;
        setAttempt(value => value + 1);
      }
    }, delay);
    return () => window.clearTimeout(timer);
  }, [items, enabled, attempt, baseline, delay, endpoint, responseKey, setItems]);

  const release = useCallback((id: string) => { held.current.delete(id); setAttempt(value => value + 1); }, []);
  return { busy, held, release };
}
