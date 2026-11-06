import app from 'vinext/server/app-router-entry';
import { processFinderMessage, type FinderJobMessage } from '@/lib/finder-store';
import { reportFailure, type AlertEnv } from '@/lib/alerts';
import { finderRuntimeConfig, type FinderEnv } from '@/lib/finder-runtime';
import { logSentEmail } from '@/lib/email-log';
import { ensureFoundationSchema } from '@/lib/foundation-store';

type CloudflareAccessIdentity = {
  email?: string;
  name?: string;
};

type CloudflareExecutionContext = ExecutionContext & {
  access?: {
    getIdentity(): Promise<CloudflareAccessIdentity | null>;
  };
};

const identityHeaders = [
  'oai-authenticated-user-id',
  'oai-authenticated-user-email',
  'oai-authenticated-user-name',
  'oai-authenticated-user-full-name',
  'oai-authenticated-user-full-name-encoding',
  'oai-authenticated-user-avatar-url',
];

function validTeamDomain(value?: string) {
  const domain = value?.trim().toLowerCase();
  return domain && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/.test(domain) ? domain : null;
}

async function accessIdentity(request: Request, env: FinderEnv, ctx: CloudflareExecutionContext) {
  try {
    const identity = await ctx.access?.getIdentity();
    if (identity?.email) return identity;
  } catch {
    // Framework static-asset routers currently do not forward ctx.access.
  }

  const teamDomain = validTeamDomain(env.CLOUDFLARE_ACCESS_TEAM_DOMAIN);
  const cookie = request.headers.get('cookie');
  if (!teamDomain || !cookie || !/(?:^|;\s*)CF_Authorization=/.test(cookie)) return null;

  try {
    const response = await fetch(`https://${teamDomain}/cdn-cgi/access/get-identity`, {
      headers: { accept: 'application/json', cookie },
      redirect: 'manual',
    });
    if (!response.ok) return null;
    const identity = await response.json() as CloudflareAccessIdentity;
    return identity.email ? identity : null;
  } catch {
    return null;
  }
}

async function authenticatedRequest(request: Request, env: FinderEnv, ctx: CloudflareExecutionContext) {
  const provider = env.GOOGLE_OAUTH_CLIENT_ID ? 'scout' : (env.AUTH_PROVIDER || 'scout');
  const headers = new Headers(request.headers);
  identityHeaders.forEach(header => headers.delete(header));
  headers.set('x-scout-auth-provider', provider);

  if (provider !== 'cloudflare-access') return new Request(request, { headers });

  const identity = await accessIdentity(request, env, ctx);
  const email = identity?.email?.trim().toLowerCase();
  if (email) {
    const name = identity?.name?.trim() || email.split('@')[0];
    headers.set('oai-authenticated-user-id', `cloudflare-access:${email}`);
    headers.set('oai-authenticated-user-email', email);
    headers.set('oai-authenticated-user-name', encodeURIComponent(name));
  }

  return new Request(request, { headers });
}

declare const __SCOUT_DEV_SERVER__: boolean;

const securityHeaders: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(self), payment=()',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
};

const basePolicy = "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'";

/** Only scripts carrying this page's one-time token run, and those may load what they need (Google sign-in and Maps). */
function pagePolicy(nonce: string) {
  return [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic' https: 'unsafe-inline'`,
    "style-src 'self' 'unsafe-inline' https://accounts.google.com https://fonts.googleapis.com",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' https://accounts.google.com https://*.googleapis.com https://*.google.com https://*.gstatic.com data: blob:",
    "frame-src https://accounts.google.com",
    "worker-src 'self' blob:",
    basePolicy,
  ].join('; ');
}

function withSecurityHeaders(response: Response) {
  const html = (response.headers.get('content-type') || '').includes('text/html');
  let output = response;
  let policy = __SCOUT_DEV_SERVER__ ? '' : basePolicy;
  if (html && !__SCOUT_DEV_SERVER__) {
    const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
    // The framework streams inline scripts, so the token is added to every script tag as the page passes through.
    output = new HTMLRewriter().on('script', { element(element) { element.setAttribute('nonce', nonce); } }).transform(response);
    policy = pagePolicy(nonce);
  }
  const secured = new Response(output.body, output);
  for (const [name, value] of Object.entries(securityHeaders)) if (!secured.headers.has(name)) secured.headers.set(name, value);
  if (policy && !secured.headers.has('content-security-policy')) secured.headers.set('content-security-policy', policy);
  return secured;
}

const worker = {
  async fetch(request: Request, env: FinderEnv, ctx: CloudflareExecutionContext) {
    const started = Date.now();
    const path = new URL(request.url).pathname;
    try {
      const trustedRequest = await authenticatedRequest(request, env, ctx);
      const response = await app.fetch(trustedRequest, env as unknown as Parameters<typeof app.fetch>[1], ctx);
      if (response.status >= 500) ctx.waitUntil(reportFailure(env as unknown as AlertEnv, { event: 'request_failed', path, status: response.status, message: `${request.method} after ${Date.now() - started}ms` }));
      return withSecurityHeaders(response);
    } catch (error) {
      ctx.waitUntil(reportFailure(env as unknown as AlertEnv, { event: 'request_crashed', path, message: error instanceof Error ? error.message : 'unknown' }));
      return withSecurityHeaders(Response.json({ error: 'Something went wrong. Try again.' }, { status: 500 }));
    }
  },
  /** The BCC copy of a rep's email. Only the headers are read, and the message is not kept. */
  async email(message: ForwardableEmailMessage, env: FinderEnv) {
    try {
      await ensureFoundationSchema(env.DB);
      await logSentEmail(env.DB, { address: message.to, to: message.headers.get('to'), cc: message.headers.get('cc'), subject: message.headers.get('subject'), messageId: message.headers.get('message-id') });
    } catch (error) {
      await reportFailure(env as unknown as AlertEnv, { event: 'email_log_failed', message: error instanceof Error ? error.message.slice(0, 400) : 'Email log failed.' });
    }
  },
  async queue(batch: MessageBatch<FinderJobMessage>, env: FinderEnv) {
    for (const message of batch.messages) {
      try {
        await processFinderMessage(env.DB, message.body, finderRuntimeConfig(env), env.FINDER_QUEUE ? next => env.FINDER_QUEUE!.send(next) : undefined);
        message.ack();
      } catch (error) {
        if (message.attempts < 3) {
          message.retry({ delaySeconds: Math.min(30, 2 ** message.attempts) });
          continue;
        }
        const text = error instanceof Error ? error.message.slice(0, 400) : 'Finder queue job failed.';
        await reportFailure(env as unknown as AlertEnv, { event: 'finder_job_failed', source: message.body.kind, message: text });
        if (message.body.kind === 'search') {
          await env.DB.prepare("UPDATE finder_searches SET status='Failed',stage='Search failed',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND status IN ('Queued','Running')").bind(text, message.body.searchId, message.body.workspaceId).run();
        } else {
          await env.DB.prepare("UPDATE finder_results SET ai_status='failed',ai_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?").bind(text, message.body.resultId, message.body.workspaceId).run();
        }
        // Let Queues perform the final failed delivery so the configured DLQ
        // receives the original message and its diagnostic context.
        throw error;
      }
    }
  },
};

export default worker;
