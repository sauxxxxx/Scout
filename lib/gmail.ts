/** Opens Gmail's compose window. `account` keeps reps with several Google accounts on the one they use for Scout. */
export function gmailComposeUrl(to: string, account?: string) {
  const params = new URLSearchParams({ view: 'cm', fs: '1', to });
  if (account && !account.endsWith('@local.scout')) params.set('authuser', account);
  return `https://mail.google.com/mail/?${params.toString()}`;
}
