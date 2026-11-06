const POINTS = 72;

/** An uneven blob around (x, y). Every shape has the same number of points, so the browser can animate between them. */
export function inkBlob(x: number, y: number, radius: number, wobble: number, phases: [number, number, number]) {
  const points = Array.from({ length: POINTS }, (_, index) => {
    const angle = index / POINTS * Math.PI * 2;
    const edge = 1 + wobble * (0.55 * Math.sin(3 * angle + phases[0]) + 0.3 * Math.sin(7 * angle + phases[1]) + 0.15 * Math.sin(13 * angle + phases[2]));
    return `${(x + Math.cos(angle) * radius * edge).toFixed(1)}px ${(y + Math.sin(angle) * radius * edge).toFixed(1)}px`;
  });
  return `polygon(${points.join(',')})`;
}

/** The stages of ink soaking outward: uneven while it spreads, and far enough past the corners at the end to cover the screen. */
export function inkKeyframes(x: number, y: number, width: number, height: number, random = Math.random) {
  const reach = Math.hypot(Math.max(x, width - x), Math.max(y, height - y));
  const phases = (): [number, number, number] => [random() * 6.28, random() * 6.28, random() * 6.28];
  const first = phases();
  const second = phases();
  return [
    { clipPath: inkBlob(x, y, 0, 0, first) },
    { clipPath: inkBlob(x, y, reach * 0.22, 0.3, first), offset: 0.3 },
    { clipPath: inkBlob(x, y, reach * 0.62, 0.22, second), offset: 0.68 },
    { clipPath: inkBlob(x, y, reach * 1.5, 0.12, second) },
  ];
}

/** Runs `change` with ink spreading from the point, or straight away where the browser can't animate it or the person prefers less motion. */
export function spreadInk(x: number, y: number, change: () => void) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || document.visibilityState !== 'visible' || typeof document.startViewTransition !== 'function') { change(); return; }
  // A window that isn't drawing holds the browser's callback back, and the switch must still happen.
  let changed = false;
  const once = () => { if (!changed) { changed = true; change(); } };
  window.setTimeout(once, 300);
  const transition = document.startViewTransition(once);
  void transition.ready.then(() => {
    document.documentElement.animate(inkKeyframes(x, y, window.innerWidth, window.innerHeight), { duration: 750, easing: 'cubic-bezier(.45,.05,.25,1)', pseudoElement: '::view-transition-new(root)' });
  }).catch(() => {});
}
