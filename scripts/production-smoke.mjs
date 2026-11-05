const baseUrl = (process.env.SCOUT_BASE_URL || 'https://scoutcrm.pages.dev').replace(/\/$/, '');

async function check(name, path, expectedStatus, verify) {
  const response = await fetch(`${baseUrl}${path}`, { redirect: 'manual', headers: { 'user-agent': 'ScoutProductionSmoke/1.0' } });
  if (response.status !== expectedStatus) throw new Error(`${name}: expected ${expectedStatus}, received ${response.status}`);
  const body = await response.text();
  if (verify && !verify(body, response)) throw new Error(`${name}: response validation failed`);
  console.log(`✓ ${name}`);
}

await check('login shell', '/', 200, (body, response) => /Scout/i.test(body) && /'nonce-/.test(response.headers.get('content-security-policy') || ''));
await check('health', '/api/health', 200, body => JSON.parse(body).status === 'ok');
await check('brand asset', '/scout-logo.png', 200, (_body, response) => response.headers.get('content-type')?.startsWith('image/'));
await check('public auth configuration', '/api/auth/config', 200, body => Boolean(JSON.parse(body).clientId));
await check('session requires authentication', '/api/session', 401);
await check('Finder requires authentication', '/api/finder', 401);
await check('profile requires authentication', '/api/profile', 401);
await check('profile photos require authentication', '/api/profile/photo', 401);
console.log(`Scout production smoke checks passed for ${baseUrl}`);
