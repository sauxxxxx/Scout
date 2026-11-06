'use client';

import { useEffect, useRef, useState } from 'react';

const backdrops = '.drawer-backdrop,.action-modal-backdrop,.modal-backdrop,.command-backdrop';
const focusable = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

const visible = (element: HTMLElement) => element.getClientRects().length > 0;
const topBackdrop = () => [...document.querySelectorAll<HTMLElement>(backdrops)].pop();

/**
 * Every drawer and modal in the app gets the same behaviour from here: focus moves in when it opens, Tab stays inside,
 * Escape closes it, focus returns to where you were, and typed work is never thrown away without asking.
 */
export function DialogManager() {
  const dirty = useRef(new WeakSet<Element>());
  const allowed = useRef<Element | null>(null);
  const returnTo = useRef(new Map<Element, HTMLElement | null>());
  const [pending, setPending] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const opened = (backdrop: HTMLElement) => {
      if (returnTo.current.has(backdrop)) return;
      const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      returnTo.current.set(backdrop, previous);
      const panel = backdrop.firstElementChild as HTMLElement | null;
      if (!panel) return;
      if (!panel.getAttribute('role')) panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      if (!panel.getAttribute('aria-label') && !panel.getAttribute('aria-labelledby')) {
        const heading = panel.querySelector('h2')?.textContent;
        if (heading) panel.setAttribute('aria-label', heading);
      }
      if (!panel.contains(document.activeElement)) {
        panel.setAttribute('tabindex', '-1');
        panel.focus({ preventScroll: true });
      }
    };
    const sync = () => {
      document.querySelectorAll<HTMLElement>(backdrops).forEach(opened);
      for (const [backdrop, previous] of returnTo.current) {
        if (backdrop.isConnected) continue;
        returnTo.current.delete(backdrop);
        if (previous?.isConnected && !topBackdrop()) previous.focus({ preventScroll: true });
      }
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });

    const markDirty = (event: Event) => {
      const backdrop = (event.target as Element).closest?.(backdrops);
      if (backdrop && !backdrop.matches('.command-backdrop')) dirty.current.add(backdrop);
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.matches?.(backdrops)) return;
      if (allowed.current === target) { allowed.current = null; return; }
      if (dirty.current.has(target)) { event.stopPropagation(); event.preventDefault(); setPending(target); }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (document.querySelector('.select-menu,.finder-combobox-menu,.team-menu,.finder-run-menu')) return;
      const backdrop = topBackdrop();
      if (!backdrop) return;
      if (event.key === 'Escape') {
        if (!backdrop.classList.contains('unsaved-guard')) backdrop.click();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = [...backdrop.querySelectorAll<HTMLElement>(focusable)].filter(visible);
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1], active = document.activeElement as HTMLElement;
      if (!backdrop.contains(active)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && (active === first || !items.includes(active))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('input', markDirty, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey);
    sync();
    return () => {
      observer.disconnect();
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
        <button autoFocus className="text-link" onClick={() => setPending(null)}>Keep editing</button>
        <button className="primary" onClick={() => { allowed.current = pending; setPending(null); pending.click(); }}>Discard</button>
      </footer>
    </div>
  </div>;
}
