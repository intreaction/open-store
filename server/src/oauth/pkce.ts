/** PKCE (RFC 7636), S256 only. `plain` is never accepted. */
import { utf8Bytes } from '../bytes.js';
import { encodeBase64Url } from './base64url.js';

const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export function isValidCodeChallenge(challenge: string): boolean {
  return CHALLENGE.test(challenge);
}

export async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    utf8Bytes(verifier)
  );
  return encodeBase64Url(new Uint8Array(digest));
}

/** Constant-time-ish comparison of two equal-alphabet strings. */
function equals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True when `verifier` is well formed and S256-hashes to `challenge`. */
export async function verifyPkceS256(verifier: string, challenge: string): Promise<boolean> {
  if (!VERIFIER.test(verifier ?? '') || !isValidCodeChallenge(challenge ?? '')) return false;
  return equals(await s256(verifier), challenge);
}
