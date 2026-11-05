'use client';

import { useEffect } from 'react';

export function reportClientError(message: string) {
  const body = JSON.stringify({ message, page: window.location.pathname });
  if (!navigator.sendBeacon?.('/api/client-errors', new Blob([body], { type: 'application/json' }))) {
    fetch('/api/client-errors', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
  }
}

/** Sends uncaught browser errors to the server, where they're logged and can trigger an alert. */
export function ErrorReporter() {
  useEffect(() => {
    const seen = new Set<string>();
    const send = (message: string) => {
      if (!message || seen.has(message) || seen.size >= 5) return;
      seen.add(message);
      reportClientError(message);
    };
    const onError = (event: ErrorEvent) => send(event.message);
    const onRejection = (event: PromiseRejectionEvent) => send(event.reason instanceof Error ? event.reason.message : String(event.reason));
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection); };
  }, []);
  return null;
}
