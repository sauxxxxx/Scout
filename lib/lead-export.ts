type ExportLead = { name: string; industry: string; city: string; status: string; score: number; owner: string; contact: string; phone: string; email: string; priority: string; next: string; lastTouchAt?: string };

const columns: [string, keyof ExportLead][] = [['Business', 'name'], ['Industry', 'industry'], ['City', 'city'], ['Status', 'status'], ['Score', 'score'], ['Owner', 'owner'], ['Contact', 'contact'], ['Phone', 'phone'], ['Email', 'email'], ['Priority', 'priority'], ['Last touch', 'lastTouchAt'], ['Next action', 'next']];

const readable = (lead: ExportLead, key: keyof ExportLead) => {
  if (key === 'score') return lead.score || '';
  if (key === 'lastTouchAt') return lead.lastTouchAt ? lead.lastTouchAt.slice(0, 16).replace('T', ' ') : '';
  return lead[key] ?? '';
};

/** Spreadsheets run cells starting with these characters as formulas, and business names come from public sources. */
function cell(value: unknown) {
  const text = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function tableToCsv(headers: string[], rows: (string | number)[][]) {
  return [headers.map(cell).join(','), ...rows.map(row => row.map(cell).join(','))].join('\r\n');
}

export function leadsToCsv(leads: ExportLead[]) {
  const rows = leads.map(lead => columns.map(([, key]) => cell(readable(lead, key))).join(','));
  return [columns.map(([label]) => label).join(','), ...rows].join('\r\n');
}

/** The same table for Google Sheets, which receives each cell as plain text or a number and never runs it as a formula. */
export function leadsToRows(leads: ExportLead[]) {
  return { headers: columns.map(([label]) => label), rows: leads.map(lead => columns.map(([, key]) => readable(lead, key))) };
}
