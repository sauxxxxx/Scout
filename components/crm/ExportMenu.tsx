'use client';

import { useState } from 'react';
import { FiUpload } from 'react-icons/fi';
import { useWorkspaceMembers } from '@/components/WorkspaceMembers';
import { ToolMenu } from '@/components/crm/shared';
import { exportToGoogleSheets, SheetsCancelled, SheetsNotSetUp } from '@/lib/google-sheets';

/** `path` is an export route that returns a CSV, or a table for Google Sheets when asked for `format=rows`. */
export function ExportMenu({ path, title, sheetName, emptyMessage, countLabel, notify }: { path: string; title: string; sheetName?: string; emptyMessage: string; countLabel: string; notify: (message: string) => void }) {
  const { currentMember } = useWorkspaceMembers();
  const [working, setWorking] = useState(false);
  const [sheetUrl, setSheetUrl] = useState('');
  const openSheet = async () => {
    setWorking(true); setSheetUrl('');
    try {
      const response = await fetch(`${path}&format=rows`);
      if (!response.ok) throw new Error('The data could not be read.');
      const table = await response.json() as { headers: string[]; rows: (string | number)[][] };
      if (!table.rows.length) { notify(emptyMessage); return; }
      const url = await exportToGoogleSheets(table, title, currentMember?.email, sheetName);
      // The browser may block a tab opened after Google's sign-in window, so the link stays on the page too.
      if (!window.open(url, '_blank', 'noreferrer')) setSheetUrl(url);
      notify(`${table.rows.length} ${countLabel} sent to Google Sheets`);
    } catch (error) {
      if (error instanceof SheetsCancelled) return;
      notify(error instanceof SheetsNotSetUp ? 'Google Sheets isn’t set up yet. Ask your workspace owner, or download a CSV.' : 'Google Sheets could not be reached. Try again, or download a CSV.');
    } finally { setWorking(false); }
  };
  return <>{sheetUrl && <a className="secondary" href={sheetUrl} target="_blank" rel="noreferrer">Open your sheet</a>}<ToolMenu label={working ? 'Creating sheet…' : 'Export'} icon={<FiUpload />} disabled={working}>{close => <><button onClick={() => { close(); void openSheet(); }}>Open in Google Sheets</button><a href={path} download onClick={close}>Download CSV</a></>}</ToolMenu></>;
}
