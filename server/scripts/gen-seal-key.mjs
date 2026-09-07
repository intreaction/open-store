#!/usr/bin/env node
/**
 * Prints a fresh OPENSTORE_SEAL_KEY: 32 random bytes, base64.
 *
 * The key seals every token clients carry. Rotating it invalidates every
 * outstanding authorization, which is the intended way to log everyone out.
 *
 *   node scripts/gen-seal-key.mjs
 *   wrangler secret put OPENSTORE_SEAL_KEY
 */
const raw = new Uint8Array(32);
crypto.getRandomValues(raw);
let binary = '';
for (const byte of raw) binary += String.fromCharCode(byte);
process.stdout.write(`${btoa(binary)}\n`);
