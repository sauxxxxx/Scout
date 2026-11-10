/** How many businesses one "Add to Leads" request carries. Small enough that each request finishes well inside the Worker's limits. */
export const FINDER_IMPORT_BATCH = 25;

export function importBatches<T>(items: T[], size = FINDER_IMPORT_BATCH): T[][] {
  const batches: T[][] = [];
  for (let start = 0; start < items.length; start += size) batches.push(items.slice(start, start + size));
  return batches;
}

/** Round robin across every selected business, so splitting the import into batches still shares them out evenly. */
export function rotateAssignments(ids: string[], assigneeIds: string[]): Record<string, string> {
  if (!assigneeIds.length) return {};
  return Object.fromEntries(ids.map((id, index) => [id, assigneeIds[index % assigneeIds.length]]));
}
