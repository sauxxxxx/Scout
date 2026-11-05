'use client';

import { useEffect, useRef, useState } from 'react';
import { ProfileDialog } from './ProfileDialog';

export function ProfilePhotoEditor({ file, onClose, onApply }: { file: File; onClose: () => void; onApply: (blob: Blob) => void }) {
  const [source, setSource] = useState('');
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const picture = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  // The image preview owns an object URL that must be released when this dialog closes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { const url = URL.createObjectURL(file); setSource(url); return () => URL.revokeObjectURL(url); }, [file]);
  const scale = size.width ? Math.max(240 / size.width, 240 / size.height) * zoom : 1;
  const width = size.width * scale, height = size.height * scale;
  const overflowX = (width - 240) / 2, overflowY = (height - 240) / 2;
  const apply = () => {
    if (!picture.current || !size.width) return;
    setBusy(true); setError('');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
    const context = canvas.getContext('2d');
    if (!context) { setError('Photo preview is unavailable. Please try again.'); setBusy(false); return; }
    const ratio = 512 / 240;
    context.drawImage(picture.current, ((240 - width) / 2 + position.x * overflowX) * ratio, ((240 - height) / 2 + position.y * overflowY) * ratio, width * ratio, height * ratio);
    canvas.toBlob(blob => { setBusy(false); if (blob) onApply(blob); else setError('Photo could not be prepared. Try another image.'); }, 'image/jpeg', .9);
  };
  return <ProfileDialog title="Adjust photo" onClose={onClose} busy={busy}>
    <div className="profile-crop" onPointerDown={event => { if (!size.width) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, startX: position.x, startY: position.y }; }} onPointerMove={event => { const start = drag.current; if (start) setPosition({ x: overflowX > 0 ? Math.max(-1, Math.min(1, start.startX + (event.clientX - start.x) / overflowX)) : 0, y: overflowY > 0 ? Math.max(-1, Math.min(1, start.startY + (event.clientY - start.y) / overflowY)) : 0 }); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      {source && <img ref={picture} src={source} alt="Photo crop preview" draggable={false} onLoad={event => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onError={() => setError('This image could not be opened. Choose a JPEG, PNG, or WebP photo.')} style={{ width, height, left: (240 - width) / 2 + position.x * overflowX, top: (240 - height) / 2 + position.y * overflowY }} />}
      <span aria-hidden="true" />
    </div>
    <p className="profile-crop-hint">Drag to reposition, or use the controls below.</p>
    <div className="profile-crop-controls"><label>Zoom<input type="range" min="1" max="3" step=".01" value={zoom} onChange={event => setZoom(Number(event.target.value))} /></label><label>Horizontal position<input type="range" min="-1" max="1" step=".01" value={position.x} disabled={overflowX <= 0} onChange={event => setPosition({ ...position, x: Number(event.target.value) })} /></label><label>Vertical position<input type="range" min="-1" max="1" step=".01" value={position.y} disabled={overflowY <= 0} onChange={event => setPosition({ ...position, y: Number(event.target.value) })} /></label></div>
    {error && <p className="profile-error" role="alert">{error}</p>}
    <footer><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button type="button" className="profile-primary" disabled={busy || !size.width || !!error} onClick={apply}>{busy ? 'Preparing…' : 'Use photo'}</button></footer>
  </ProfileDialog>;
}
