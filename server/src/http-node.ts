/**
 * Node entry for the same Hono app the Worker serves, so local runs and the test
 * suite never need wrangler. Behaviour is identical; only the socket differs.
 *
 * Configuration comes from the process environment. `.dev.vars` is not read here
 * (that is wrangler's file); export the variables, or use `npm run dev`.
 */
import { serve } from '@hono/node-server';
import { createApp } from './http/app.js';
import type { Env } from './http/env.js';
import { consoleLog } from './http/log.js';

const port = Number.parseInt(process.env.PORT ?? '8787', 10);
const app = createApp({ log: consoleLog });

const env: Env = {
  GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID ?? '',
  GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET ?? '',
  OPENSTORE_SEAL_KEY: process.env.OPENSTORE_SEAL_KEY ?? '',
  ...(process.env.GITHUB_APP_SLUG ? { GITHUB_APP_SLUG: process.env.GITHUB_APP_SLUG } : {}),
  ...(process.env.GITHUB_APP_ID ? { GITHUB_APP_ID: process.env.GITHUB_APP_ID } : {}),
  ...(process.env.PUBLIC_SITE_URL ? { PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL } : {}),
  ...(process.env.OPENSTORE_TEMPLATE_REPO
    ? { OPENSTORE_TEMPLATE_REPO: process.env.OPENSTORE_TEMPLATE_REPO }
    : {}),
  ...(process.env.PUBLIC_BASE_URL ? { PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL } : {})
};

serve({ fetch: (request: Request) => app.fetch(request, env), port }, (info) => {
  process.stderr.write(`openstore http listening on http://localhost:${info.port}\n`);
});
