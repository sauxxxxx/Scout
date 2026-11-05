'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { FiX } from 'react-icons/fi';

export function ProfileDialog({ title, children, onClose, busy = false, className = '' }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean; className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close(); }, []);
  return <dialog ref={dialog} className={`profile-dialog ${className}`} aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div><header><h2>{title}</h2><button type="button" aria-label="Close dialog" disabled={busy} onClick={onClose}><FiX /></button></header>{children}</div>
  </dialog>;
}
