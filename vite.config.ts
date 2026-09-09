import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
import hostingConfig from './.openai/hosting.json';

const SCOUT_D1_DATABASE_ID =
  '2432f6c6-851b-4097-9e0d-d7f2a1e5ca82';

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

const localBindingConfig = {
  name: 'scout',
  main: './worker.ts',
  compatibility_flags: ['nodejs_compat'],
  vars: {
    AUTH_PROVIDER: 'cloudflare-access',
    GEMINI_MODEL: 'gemini-3.1-flash-lite',
    FINDER_AI_MONTHLY_BUDGET_USD: '2',
    FINDER_AI_MAX_CANDIDATES: '20',
  },
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: 'scout-db',
          database_id: SCOUT_D1_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: 'scout-files',
        },
      ]
    : [],
  queues: {
    producers: [{ binding: 'FINDER_QUEUE', queue: 'scout-finder' }],
    consumers: [{ queue: 'scout-finder', max_batch_size: 1, max_retries: 3, dead_letter_queue: 'scout-finder-dlq' }],
  },
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import('@cloudflare/vite-plugin');

  return {
    css: { postcss: { plugins: [tailwindcss()] } },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: localBindingConfig,
      }),
    ],
  };
});
