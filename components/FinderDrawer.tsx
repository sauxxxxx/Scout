'use client';
import { useEffect, useRef, type ReactNode } from 'react';

export function FinderDrawer({ children, onClose, title }: { children: ReactNode; onClose: () => void; title: string }) {
  const node = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = node.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={node} className="finder-native-drawer" aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>{children}</dialog>;
}
