/**
 * Cloudflare Workers entry point for the hosted OpenStore endpoint.
 *
 * There are no bindings — no KV, no D1, no Durable Object, no R2, no queue — and
 * `wrangler.toml` is deliberately free of them so that the deploy configuration
 * itself is evidence that nothing can be retained.
 */
import type { ExecutionContext } from 'hono';
import { createApp } from './http/app.js';
import type { Env } from './http/env.js';

const app = createApp();

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    return app.fetch(request, env, ctx);
  }
};

export type { Env };
