type ExportLead = { name: string; industry: string; city: string; status: string; score: number; owner: string; contact: string; phone: string; email: string; priority: string; next: string };

const columns: [string, keyof ExportLead][] = [['Business', 'name'], ['Industry', 'industry'], ['City', 'city'], ['Status', 'status'], ['Score', 'score'], ['Owner', 'owner'], ['Contact', 'contact'], ['Phone', 'phone'], ['Email', 'email'], ['Priority', 'priority'], ['Next action', 'next']];

/** Spreadsheets run cells starting with these characters as formulas, and business names come from public sources. */
function cell(value: unknown) {
  const text = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function leadsToCsv(leads: ExportLead[]) {
  const rows = leads.map(lead => columns.map(([, key]) => cell(key === 'score' ? lead.score || '' : lead[key])).join(','));
  return [columns.map(([label]) => label).join(','), ...rows].join('\r\n');
}
