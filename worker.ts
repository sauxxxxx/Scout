import app from 'vinext/server/app-router-entry';
import { processFinderMessage, type FinderJobMessage } from '@/lib/finder-store';
import { finderRuntimeConfig, type FinderEnv } from '@/lib/finder-runtime';

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

async function authenticatedRequest(request: Request, env: FinderEnv, ctx: CloudflareExecutionContext) {
  if (env.AUTH_PROVIDER !== 'cloudflare-access') return request;

  const headers = new Headers(request.headers);
  identityHeaders.forEach(header => headers.delete(header));
  headers.set('x-scout-auth-provider', 'cloudflare-access');

  const identity = await ctx.access?.getIdentity();
  const email = identity?.email?.trim().toLowerCase();
  if (email) {
    const name = identity?.name?.trim() || email.split('@')[0];
    headers.set('oai-authenticated-user-id', `cloudflare-access:${email}`);
    headers.set('oai-authenticated-user-email', email);
    headers.set('oai-authenticated-user-name', encodeURIComponent(name));
  }

  return new Request(request, { headers });
}

const worker = {
  async fetch(request: Request, env: FinderEnv, ctx: CloudflareExecutionContext) {
    const trustedRequest = await authenticatedRequest(request, env, ctx);
    return app.fetch(trustedRequest, env as unknown as Parameters<typeof app.fetch>[1], ctx);
  },
  async queue(batch: MessageBatch<FinderJobMessage>, env: FinderEnv) {
    for (const message of batch.messages) {
      try {
        await processFinderMessage(env.DB, message.body, finderRuntimeConfig(env));
        message.ack();
      } catch (error) {
        if (message.attempts < 3) {
          message.retry({ delaySeconds: Math.min(30, 2 ** message.attempts) });
          continue;
        }
        const text = error instanceof Error ? error.message.slice(0, 400) : 'Finder queue job failed.';
        if (message.body.kind === 'search') {
          await env.DB.prepare("UPDATE finder_searches SET status='Failed',stage='Search failed',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND status IN ('Queued','Running')").bind(text, message.body.searchId, message.body.workspaceId).run();
        } else {
          await env.DB.prepare("UPDATE finder_results SET ai_status='failed',ai_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?").bind(text, message.body.resultId, message.body.workspaceId).run();
        }
        message.ack();
      }
    }
  },
};

export default worker;
