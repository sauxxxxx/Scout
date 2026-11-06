'use client';
/* eslint-disable react-hooks/set-state-in-effect -- The dismissed flag lives in localStorage, which only exists after mount. */

import { useEffect, useState } from 'react';
import { FiCheck, FiX } from 'react-icons/fi';

type Step = { label: string; done: boolean; onClick: () => void };

const key = 'scout.gettingStarted.dismissed';

export function GettingStarted({ steps }: { steps: Step[] }) {
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => { setDismissed(window.localStorage.getItem(key) === '1'); }, []);
  const remaining = steps.filter(step => !step.done).length;
  if (dismissed || !remaining) return null;
  return <section className="getting-started" aria-label="Getting started">
    <header>
      <div><h2>Get started with Scout</h2><p>{steps.length - remaining} of {steps.length} done</p></div>
      <button aria-label="Hide getting started" onClick={() => { window.localStorage.setItem(key, '1'); setDismissed(true); }}><FiX /></button>
    </header>
    <ol>
      {steps.map(step => <li className={step.done ? 'done' : ''} key={step.label}>
        <span aria-hidden="true">{step.done && <FiCheck />}</span>
        {step.done ? <span>{step.label}</span> : <button onClick={step.onClick}>{step.label}</button>}
      </li>)}
    </ol>
  </section>;
}
