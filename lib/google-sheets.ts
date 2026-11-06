type SheetTable = { headers: string[]; rows: (string | number)[][] };
type TokenResponse = { access_token?: string; error?: string };
type TokenClient = { requestAccessToken: () => void };
type GoogleOauth = { accounts?: { oauth2?: { initTokenClient: (options: {
  client_id: string; scope: string; hint?: string; prompt?: string;
  callback: (response: TokenResponse) => void;
  error_callback?: (error: { type?: string }) => void;
}) => TokenClient } } };

/** Lets Scout create a sheet and touch only the sheets it created, never the rest of the rep's Drive. */
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export class SheetsCancelled extends Error {}
export class SheetsNotSetUp extends Error {}

/** Sent as typed values, so a business name starting with "=" stays text and never runs as a formula. */
export function buildSpreadsheet(title: string, table: SheetTable, sheetName = 'Leads') {
  const cell = (value: string | number, bold = false) => ({
    userEnteredValue: typeof value === 'number' ? { numberValue: value } : { stringValue: value },
    ...(bold ? { userEnteredFormat: { textFormat: { bold: true } } } : {}),
  });
  return {
    properties: { title },
    sheets: [{
      properties: { title: sheetName, gridProperties: { frozenRowCount: 1 } },
      data: [{ startRow: 0, startColumn: 0, rowData: [
        { values: table.headers.map(header => cell(header, true)) },
        ...table.rows.map(row => ({ values: row.map(value => cell(value)) })),
      ] }],
    }],
  };
}

function loadGoogleScript() {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-scout-google]');
    const loaded = () => !!(window as unknown as { google?: GoogleOauth }).google?.accounts?.oauth2;
    if (loaded()) { resolve(); return; }
    const script = existing || document.createElement('script');
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('Google could not be reached.')), { once: true });
    if (!existing) {
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.dataset.scoutGoogle = 'true';
      document.head.appendChild(script);
    }
  });
}

/** The token stays in the browser for this one export. Scout's server never receives it. */
async function requestToken(clientId: string, email?: string) {
  await loadGoogleScript();
  const oauth = (window as unknown as { google?: GoogleOauth }).google?.accounts?.oauth2;
  if (!oauth) throw new Error('Google could not be reached.');
  return new Promise<string>((resolve, reject) => {
    oauth.initTokenClient({
      client_id: clientId, scope: SHEETS_SCOPE,
      // A local test account isn't a Google account, so let the person choose one instead of Google guessing.
      ...(email && !email.endsWith('@local.scout') ? { hint: email } : { prompt: 'select_account' }),
      callback: response => { if (response.access_token) resolve(response.access_token); else reject(new SheetsCancelled()); },
      error_callback: () => reject(new SheetsCancelled()),
    }).requestAccessToken();
  });
}

export async function exportToGoogleSheets(table: SheetTable, title: string, email?: string, sheetName?: string) {
  const config = await fetch('/api/auth/config').then(response => response.json() as Promise<{ clientId?: string | null }>);
  if (!config.clientId) throw new SheetsNotSetUp();
  const token = await requestToken(config.clientId, email);
  const response = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(buildSpreadsheet(title, table, sheetName)),
  });
  if (response.status === 403 || response.status === 404) throw new SheetsNotSetUp();
  if (!response.ok) throw new Error('Google Sheets could not create the file.');
  return (await response.json() as { spreadsheetUrl: string }).spreadsheetUrl;
}
