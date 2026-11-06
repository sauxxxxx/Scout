export const leadColumns = 'leads.*,companies.name company_name,companies.industry company_industry,companies.city company_city,companies.phone company_phone,companies.email company_email,contacts.name primary_contact_name,contacts.phone primary_contact_phone,contacts.email primary_contact_email';
export const leadJoins = 'FROM leads LEFT JOIN companies ON companies.id=leads.company_id LEFT JOIN contacts ON contacts.id=leads.primary_contact_id';

const sortColumns: Record<string, string> = { name: 'COALESCE(companies.name,leads.name)', status: 'leads.status', score: 'leads.score', owner: 'leads.owner', next: 'leads.next', lastTouch: 'leads.last_touch_at', recent: 'COALESCE(leads.changed_at,leads.updated_at)' };

export function pageParams(params: URLSearchParams, defaultSize = 100, maximum = 200) {
  const page = Math.max(1, Number(params.get('page')) || 1);
  const pageSize = Math.min(maximum, Math.max(1, Number(params.get('pageSize')) || defaultSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/**
 * The leads a person may see at all: their own, plus any lead where they hold an open task, because they can't do the
 * task without it. Written as SQL because a large id list would exceed D1's limit on bound values.
 */
export function ownScope(workspaceId: string, owner: string) {
  return {
    sql: "(leads.owner=? OR leads.id IN (SELECT lead_id FROM tasks WHERE workspace_id=? AND owner=? AND status!='Completed' AND lead_id IS NOT NULL))",
    values: [owner, workspaceId, owner],
  };
}

export function buildLeadFilter(params: URLSearchParams, workspaceId: string, currentUser: string, ownOnly: boolean) {
  const clauses = ['leads.workspace_id=?'];
  const values: (string | number)[] = [workspaceId];
  const view = params.get('view') || 'Leads';
  clauses.push(view === 'Archived' ? 'leads.archived=1' : 'leads.archived=0');
  if (view === 'Assigned to me') { clauses.push('leads.owner=?'); values.push(currentUser); }
  if (view === 'High priority') clauses.push("leads.priority='High'");
  if (view === 'Recently added') clauses.push("leads.created_at>=datetime('now','-7 days')");
  const exact: [string, string, string][] = [['country', 'leads.country', 'All countries'], ['status', 'leads.status', 'All statuses'], ['owner', 'leads.owner', 'All owners'], ['priority', 'leads.priority', 'All priorities'], ['industry', 'leads.industry', 'All industries']];
  for (const [key, column, empty] of exact) {
    const value = params.get(key);
    if (value && value !== empty) { clauses.push(`${column}=?`); values.push(value); }
  }
  const touchFrom = params.get('touchFrom');
  const touchTo = params.get('touchTo');
  const touchBefore = params.get('touchBefore');
  if (params.get('touchNever')) clauses.push('leads.last_touch_at IS NULL');
  if (touchBefore) { clauses.push('(leads.last_touch_at IS NULL OR substr(leads.last_touch_at,1,10)<?)'); values.push(touchBefore); }
  if (touchFrom) { clauses.push('substr(leads.last_touch_at,1,10)>=?'); values.push(touchFrom); }
  if (touchTo) { clauses.push('substr(leads.last_touch_at,1,10)<=?'); values.push(touchTo); }
  const minimum = Number(params.get('minScore'));
  if (minimum > 0) { clauses.push('leads.score>=?'); values.push(minimum); }
  const name = params.get('name');
  if (name) { clauses.push('(leads.name=? OR companies.name=?)'); values.push(name, name); }
  const query = params.get('query')?.trim().toLowerCase();
  if (query) {
    clauses.push("LOWER(COALESCE(companies.name,leads.name)||' '||leads.city||' '||leads.industry||' '||leads.contact) LIKE ?");
    values.push(`%${query.replace(/[%_]/g, '')}%`);
  }
  if (ownOnly) {
    const scope = ownScope(workspaceId, currentUser);
    clauses.push(scope.sql);
    values.push(...scope.values);
  }
  return { where: clauses.join(' AND '), values };
}

export function leadOrder(params: URLSearchParams) {
  const column = sortColumns[params.get('sort') || 'name'] || sortColumns.name;
  return `${column} ${params.get('direction') === 'desc' ? 'DESC' : 'ASC'},leads.id`;
}
