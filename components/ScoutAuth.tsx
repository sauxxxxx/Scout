'use client';

import { useEffect, useRef, useState } from 'react';
import type { PublicBranding } from '@/lib/customization';
import { ScoutLogo } from '@/components/crm/shared';

type GoogleCredential = { credential: string };
type GoogleIdentity = {
  initialize(options: { client_id: string; callback: (response: GoogleCredential) => void; auto_select?: boolean; cancel_on_tap_outside?: boolean }): void;
  renderButton(element: HTMLElement, options: { type: 'standard'; theme: 'outline' | 'filled_black'; size: 'large'; shape: 'pill'; text: 'continue_with'; logo_alignment: 'left'; width: number; locale: string }): void;
};

type Invitation = { branding?: PublicBranding; status: string; emailHint?: string; workspaceName?: string; inviterName?: string; roleLabel?: string; note?: string };

declare global { interface Window { google?: { accounts: { id: GoogleIdentity } } } }

export function ScoutAuth({ message }: { message?: string }) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const [clientId, setClientId] = useState('');
  const [loading, setLoading] = useState(true);
  const [googleReady, setGoogleReady] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [invite, setInvite] = useState<Invitation | null>(null);
  const inviteId = useRef('');

  const [branding, setBranding] = useState<PublicBranding | null>(null);
  useEffect(() => { if (branding) document.documentElement.dataset.accent = branding.accent; }, [branding]);

  useEffect(() => {
    fetch('/api/auth/config').then(response => response.json() as Promise<{ clientId?: string | null; branding?: PublicBranding | null }>).then(data => { setClientId(data.clientId || ''); if (data.branding) setBranding(current => current || data.branding!); }).catch(() => setError('Sign-in is temporarily unavailable.')).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('invite');
    if (!id) return;
    inviteId.current = id;
    fetch(`/api/auth/invite?id=${encodeURIComponent(id)}`).then(response => response.json() as Promise<Invitation>).then(data => { setInvite(data); if (data.branding) setBranding(data.branding); }).catch(() => setInvite({ status: 'not_found' }));
  }, []);

  useEffect(() => {
    if (!clientId || !buttonRef.current) return;
    const handleCredential = async ({ credential }: GoogleCredential) => {
      setWorking(true); setError('');
      try {
        const response = await fetch('/api/auth/google', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential, invite: inviteId.current || undefined }) });
        const data = await response.json() as { error?: string };
        if (!response.ok) throw new Error(data.error || 'Scout could not sign you in.');
        window.location.replace('/');
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Scout could not sign you in.'); setWorking(false); }
    };
    const render = () => {
      if (!window.google || !buttonRef.current) return;
      buttonRef.current.replaceChildren();
      window.google.accounts.id.initialize({ client_id: clientId, callback: handleCredential, auto_select: false, cancel_on_tap_outside: true });
      const width = Math.max(240, Math.min(400, Math.floor(buttonRef.current.getBoundingClientRect().width)));
      const theme = document.documentElement.dataset.theme === 'dark' ? 'filled_black' : 'outline';
      window.google.accounts.id.renderButton(buttonRef.current, { type: 'standard', theme, size: 'large', shape: 'pill', text: 'continue_with', logo_alignment: 'left', width, locale: 'en' });
      setGoogleReady(true);
    };
    const existing = document.querySelector<HTMLScriptElement>('script[data-scout-google]');
    if (existing) { if (window.google) render(); else existing.addEventListener('load', render, { once: true }); return; }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client?hl=en'; script.async = true; script.defer = true; script.dataset.scoutGoogle = 'true'; script.onload = render; script.onerror = () => setError('Google sign-in could not load.');
    document.head.appendChild(script);
  }, [clientId]);

  const pendingInvite = invite?.status === 'pending';
  const roleName = invite?.roleLabel ? invite.roleLabel.charAt(0).toUpperCase() + invite.roleLabel.slice(1) : 'a member';
  const closedInvite = !invite || pendingInvite ? '' : invite.status === 'expired' ? `This invitation has expired. Ask ${invite.inviterName} for a new one.` : invite.status === 'revoked' ? 'This invitation was revoked. Ask your workspace owner for a new one.' : invite.status === 'accepted' ? 'This invitation has already been used. Sign in below.' : 'This invitation link is not valid.';

  return <main className="scout-auth-page">
    <section className="scout-auth-card" aria-labelledby="scout-auth-title">
      <div className={`scout-auth-mark${branding?.logoUrl ? ' has-logo' : ''}`}><ScoutLogo logoUrl={branding?.logoUrl} />{!branding?.logoUrl && <span>Scout</span>}</div>
      <h1 id="scout-auth-title">{pendingInvite ? `Join ${invite?.workspaceName}` : 'Sign in to Scout'}</h1>
      {pendingInvite
        ? <p>{invite?.inviterName} invited you as {roleName}. Continue with the Google account for <strong>{invite?.emailHint}</strong>.</p>
        : <p>{branding?.welcomeMessage || 'Scout is invitation-only. Use the Google account your workspace added.'}</p>}
      {pendingInvite && invite?.note && <blockquote className="scout-auth-note">{invite.note}</blockquote>}
      {closedInvite && <div className="scout-auth-error" role="alert">{closedInvite}</div>}

      <div className="scout-google-stage" aria-live="polite" aria-busy={loading || !googleReady || working}>
        <div className={`scout-google-render${working ? ' is-hidden' : ''}`} ref={buttonRef} />
        {(loading || (!!clientId && !googleReady)) && <div className="scout-auth-loading"><span className="scout-spinner" />Loading…</div>}
        {working && <div className="scout-auth-loading is-active"><span className="scout-spinner" />Signing you in…</div>}
      </div>

      {!clientId && !loading && <div className="scout-auth-error" role="alert">Google sign-in isn&apos;t set up yet. Ask your workspace owner.</div>}
      {error && <div className="scout-auth-error" role="alert">{error}</div>}
      {message && !message.toLowerCase().includes('authentication required') && <div className="scout-auth-error" role="alert">{message}</div>}
      {!pendingInvite && <p className="scout-auth-help">No access yet? Ask your workspace owner.</p>}
    </section>
    <p className="scout-auth-tagline">Find them. Follow up. <mark>Close.</mark></p>
    {['localhost', '127.0.0.1'].includes(window.location.hostname) && <a className="scout-auth-local" href="/api/auth/local">Continue as local developer</a>}
  </main>;
}
