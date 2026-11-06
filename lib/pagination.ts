export const pageSizes = [25, 50, 100] as const;
export type PageSize = (typeof pageSizes)[number];

/** Which page buttons to show: always the first, the last and the ones around the current page. `gap` marks the skipped pages. */
export function pageNumbers(current: number, last: number): (number | 'gap')[] {
  const wanted = new Set([1, last, current - 1, current, current + 1].filter(page => page >= 1 && page <= last));
  const sorted = [...wanted].sort((a, b) => a - b);
  const pages: (number | 'gap')[] = [];
  sorted.forEach((page, index) => {
    const previous = sorted[index - 1];
    if (previous !== undefined && page - previous === 2) pages.push(previous + 1);
    else if (previous !== undefined && page - previous > 2) pages.push('gap');
    pages.push(page);
  });
  return pages;
}

export function pageWindow(total: number, pageSize: number, requestedPage: number) {
  const last = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, requestedPage), last);
  return { page, last, start: (page - 1) * pageSize, end: page * pageSize, from: total ? (page - 1) * pageSize + 1 : 0, to: Math.min(total, page * pageSize) };
}
