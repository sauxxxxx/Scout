'use client';

import { useState } from 'react';

/** One series, so the title names it. Hovering or focusing a bar gives its exact figure. */
export function TrendBars({ title, points, format }: { title: string; points: { key: string; label: string; value: number }[]; format: (value: number) => string }) {
  const [active, setActive] = useState<number | null>(null);
  const top = Math.max(...points.map(point => point.value), 0);
  if (!points.length || !top) return null;
  const shown = active === null ? null : points[active];
  return <figure className="won-trend">
    <figcaption><strong>{title}</strong><span>{shown ? `${shown.label}: ${format(shown.value)}` : `Highest: ${format(top)}`}</span></figcaption>
    <div className="won-trend-bars" onMouseLeave={() => setActive(null)}>
      {points.map((point, index) => <button type="button" key={point.key} aria-label={`${point.label}: ${format(point.value)}`} className={active === index ? 'active' : ''} onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onBlur={() => setActive(null)}>
        <i style={{ height: point.value ? `${Math.max(3, point.value / top * 100)}%` : 0 }} />
      </button>)}
    </div>
    <div className="won-trend-axis"><span>{points[0].label}</span><span>{points[points.length - 1].label}</span></div>
  </figure>;
}
