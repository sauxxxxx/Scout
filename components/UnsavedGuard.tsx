'use client';

import { useEffect, useRef, useState } from 'react';

const backdrops = '.drawer-backdrop,.action-modal-backdrop,.modal-backdrop';

/**
 * Forms across the app close when you click outside them. This watches for typing inside any of them and asks
 * first, so a stray click or Escape can't throw away work. Save and Cancel buttons are unaffected.
 */
export function UnsavedGuard() {
  const dirty = useRef(new WeakSet<Element>());
  const allowed = useRef<Element | null>(null);
  const [pending, setPending] = useState<Element | null>(null);

  useEffect(() => {
    const markDirty = (event: Event) => {
      const backdrop = (event.target as Element).closest?.(backdrops);
      if (backdrop) dirty.current.add(backdrop);
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element;
      if (!target.matches?.(backdrops)) return;
      if (allowed.current === target) { allowed.current = null; return; }
      if (dirty.current.has(target)) { event.stopPropagation(); event.preventDefault(); setPending(target); }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('.select-menu,.finder-combobox-menu,.team-menu,.finder-run-menu')) return;
      const open = [...document.querySelectorAll(backdrops)].filter(item => !item.classList.contains('unsaved-guard'));
      (open[open.length - 1] as HTMLElement | undefined)?.click();
    };
    document.addEventListener('input', markDirty, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('input', markDirty, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  if (!pending) return null;
  return <div className="modal-backdrop unsaved-guard">
    <div className="modal team-dialog" role="alertdialog" aria-modal="true" aria-label="Discard your changes?">
      <header><h2>Discard your changes?</h2></header>
      <div className="team-dialog-body"><p>What you typed hasn&apos;t been saved.</p></div>
      <footer>
        <button className="text-link" onClick={() => setPending(null)}>Keep editing</button>
        <button className="primary" onClick={() => { allowed.current = pending; setPending(null); (pending as HTMLElement).click(); }}>Discard</button>
      </footer>
    </div>
  </div>;
}
