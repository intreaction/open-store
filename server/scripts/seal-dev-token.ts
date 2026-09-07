#!/usr/bin/env tsx
/**
 * Dev only. Prints a sealed `access` token so `POST /mcp` can be exercised
 * locally without registering a GitHub App at all.
 *
 *   export OPENSTORE_SEAL_KEY=$(node scripts/gen-seal-key.mjs)
 *   export OPENSTORE_REPO=you/my-openstore
 *   export OPENSTORE_TOKEN=$(gh auth token)
 *   npm run seal:dev-token
 *
 * The GitHub token goes inside the sealed blob and is never printed. Treat the
 * output exactly like a password: it reaches your store until it expires.
 */
import { seal, importSealKey, TTL } from '../src/oauth/seal.js';

const key = process.env.OPENSTORE_SEAL_KEY ?? '';
const repo = (process.env.OPENSTORE_REPO ?? '').trim();
const token = (process.env.OPENSTORE_TOKEN ?? '').trim();
const readonly = /^(1|true|yes|on)$/i.test((process.env.OPENSTORE_READONLY ?? '').trim());

function fail(message: string): never {
  process.stderr.write(`seal-dev-token: ${message}\n`);
  process.exit(1);
}

if (!key) fail('OPENSTORE_SEAL_KEY is required (node scripts/gen-seal-key.mjs)');
if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) fail('OPENSTORE_REPO is required (owner/name)');
if (!token) fail('OPENSTORE_TOKEN is required (e.g. `gh auth token`)');

const sealed = await seal(await importSealKey(key), 'access', {
  t: 'access',
  client_id: 'dev',
  gh_access: token,
  repo,
  readonly,
  ttlSeconds: TTL.access
});

process.stderr.write(
  `sealed access token for ${repo}${readonly ? ' (read-only)' : ''}, valid ${TTL.access / 3600} hours:\n`
);
process.stdout.write(`${sealed}\n`);
