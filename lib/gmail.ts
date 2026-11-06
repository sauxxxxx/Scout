/** Opens Gmail's compose window. `account` keeps reps with several Google accounts on the one they use for Scout. */
export function gmailComposeUrl(to: string, account?: string, bcc?: string) {
  const params = new URLSearchParams({ view: 'cm', fs: '1', to });
  if (account && !account.endsWith('@local.scout')) params.set('authuser', account);
  // Scout gets a copy only if the email is really sent, which is how sent emails are counted.
  if (bcc) params.set('bcc', bcc);
  return `https://mail.google.com/mail/?${params.toString()}`;
}

const WINDOW_WIDTH = 720;
const WINDOW_HEIGHT = 680;

/** Keeps the window near the right of the screen, the same side as Gmail's own compose box, and never past its edges. */
export function composeWindowFeatures(screen: { availLeft?: number; availTop?: number; availWidth: number; availHeight: number }) {
  const width = Math.min(WINDOW_WIDTH, screen.availWidth);
  const height = Math.min(WINDOW_HEIGHT, screen.availHeight);
  const left = (screen.availLeft || 0) + Math.max(0, screen.availWidth - width - 40);
  const top = (screen.availTop || 0) + Math.max(0, screen.availHeight - height - 40);
  return `popup=yes,width=${width},height=${height},left=${left},top=${top}`;
}
