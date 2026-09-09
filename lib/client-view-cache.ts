'use client';

import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';

const viewState = new Map<string, unknown>();

export function clearViewState(...keys: string[]) {
  keys.forEach((key) => viewState.delete(key));
}

export function useViewState<T>(key: string, initialValue: T | (() => T)) {
  const [state, setState] = useState<T>(() => {
    if (viewState.has(key)) return viewState.get(key) as T;
    const value = typeof initialValue === 'function' ? (initialValue as () => T)() : initialValue;
    viewState.set(key, value);
    return value;
  });

  const setCachedState = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    const current = viewState.get(key) as T;
    const value = typeof next === 'function' ? (next as (previous: T) => T)(current) : next;
    viewState.set(key, value);
    setState(value);
  }, [key]);

  return [state, setCachedState] as const;
}
