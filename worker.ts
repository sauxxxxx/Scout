import app from 'vinext/server/app-router-entry';
import { processFinderMessage, type FinderJobMessage } from '@/lib/finder-store';
import { finderRuntimeConfig, type FinderEnv } from '@/lib/finder-runtime';

const worker = {
  fetch(request: Request, env: FinderEnv, ctx: ExecutionContext) {
    return app.fetch(request, env as unknown as Parameters<typeof app.fetch>[1], ctx);
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
