'use client';

import { useEffect } from 'react';
import { reportClientError } from '@/components/ErrorReporter';

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => { reportClientError(error.message); }, [error]);
  return <main className="scout-auth-page">
    <section className="scout-auth-card" role="alert">
      <h1>Something went wrong</h1>
      <p>Your saved work is safe. Try again, and if this keeps happening let your workspace owner know.</p>
      <button className="primary" onClick={reset}>Try again</button>
    </section>
  </main>;
}
