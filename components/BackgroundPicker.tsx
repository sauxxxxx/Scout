'use client';

import { useRef, useState } from 'react';
import { FiImage } from 'react-icons/fi';
import { useViewSettings } from '@/components/crm/shared';

const LONGEST_SIDE = 2400;

/** Photos from a phone can be huge, so they're shrunk here. Redrawing also strips anything hidden in the original file. */
async function shrink(file: File) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, LONGEST_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.84));
  if (!blob) throw new Error('unreadable');
  return blob;
}

const keyOf = (url: string) => new URL(url, window.location.origin).searchParams.get('key') || '';

export function BackgroundPicker() {
  const { view, updateView } = useViewSettings();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const current = view.backgroundUrl;
  const forget = (url: string) => { if (url) void fetch(`/api/profile/background?key=${encodeURIComponent(keyOf(url))}`, { method: 'DELETE' }).catch(() => {}); };

  const upload = async (file: File) => {
    setBusy(true); setProblem('');
    try {
      const form = new FormData();
      form.set('file', await shrink(file), 'background.jpg');
      const response = await fetch('/api/profile/background', { method: 'POST', body: form });
      const data = await response.json() as { url?: string; error?: string };
      if (!response.ok || !data.url) { setProblem(data.error || 'The image could not be uploaded.'); return; }
      updateView({ backgroundUrl: data.url });
      forget(current);
    } catch { setProblem('Scout could not read that image. Try a JPEG, PNG or WebP.'); } finally { setBusy(false); }
  };

  return <div className="background-picker">
    <span className="background-preview" style={current ? { backgroundImage: `url("${current}")` } : undefined}>{!current && <FiImage />}</span>
    <div>
      <p>Shows around Scout for you only. Your pages stay on a frosted panel so any picture stays easy to read. It saves as soon as you choose it.</p>
      <div className="background-actions">
        <button type="button" className="secondary" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Uploading…' : current ? 'Change image' : 'Upload image'}</button>
        {current && <button type="button" className="text-link" disabled={busy} onClick={() => { updateView({ backgroundUrl: '' }); forget(current); }}>Remove</button>}
      </div>
      {problem && <p className="profile-error" role="alert">{problem}</p>}
      <input ref={input} type="file" hidden accept="image/jpeg,image/png,image/webp" aria-label="Choose a background image" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file); }} />
    </div>
  </div>;
}
