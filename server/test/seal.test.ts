import { describe, expect, it } from 'vitest';
import { decodeBase64Url, encodeBase64Url } from '../src/oauth/base64url.js';
import { isValidCodeChallenge, s256, verifyPkceS256 } from '../src/oauth/pkce.js';
import {
  generateSealKeyBase64,
  importSealKey,
  nowSeconds,
  seal,
  SealError,
  TTL,
  unseal
} from '../src/oauth/seal.js';

async function freshKey() {
  return importSealKey(generateSealKeyBase64());
}

describe('base64url', () => {
  it('round-trips arbitrary bytes without padding', () => {
    for (let length = 0; length < 40; length += 1) {
      const bytes = new Uint8Array(length);
      crypto.getRandomValues(bytes);
      const text = encodeBase64Url(bytes);
      expect(text).not.toMatch(/[+/=]/);
      expect([...decodeBase64Url(text)]).toEqual([...bytes]);
    }
  });

  it('rejects characters outside the alphabet', () => {
    expect(() => decodeBase64Url('abc$def')).toThrow();
  });
});

describe('seal key', () => {
  it('generates a 32-byte base64 key', async () => {
    const key = generateSealKeyBase64();
    expect(decodeBase64Url(key.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')).length).toBe(32);
    await expect(importSealKey(key)).resolves.toBeTruthy();
  });

  it('refuses a key of the wrong length or shape', async () => {
    await expect(importSealKey('')).rejects.toThrow(/required/);
    await expect(importSealKey('c2hvcnQ=')).rejects.toThrow(/32 bytes/);
    await expect(importSealKey('not base64 at all!!')).rejects.toThrow();
  });
});

describe('seal / unseal', () => {
  it('round-trips a payload and keeps the wire format', async () => {
    const key = await freshKey();
    const token = await seal(key, 'access', {
      t: 'access',
      client_id: 'client-1',
      gh_access: 'gho_secret',
      repo: 'intreaction/my-openstore',
      readonly: false,
      ttlSeconds: TTL.access
    });
    expect(token.startsWith('os1.')).toBe(true);
    expect(token.split('.')).toHaveLength(3);
    // The GitHub token must not be readable from the wire form.
    expect(token).not.toContain('gho_secret');

    const payload = await unseal(key, token, 'access');
    expect(payload.gh_access).toBe('gho_secret');
    expect(payload.repo).toBe('intreaction/my-openstore');
    expect(payload.readonly).toBe(false);
    expect(payload.exp! - payload.iat).toBe(TTL.access);
  });

  it('produces a different ciphertext every time (fresh IV)', async () => {
    const key = await freshKey();
    const input = { t: 'client' as const, redirect_uris: ['https://a.test/cb'], client_name: 'A' };
    expect(await seal(key, 'client', input)).not.toBe(await seal(key, 'client', input));
  });

  it('rejects a token sealed with a different key', async () => {
    const token = await seal(await freshKey(), 'state', {
      t: 'state',
      client_id: 'c',
      redirect_uri: 'https://a.test/cb',
      code_challenge: 'x'.repeat(43),
      readonly: false,
      ttlSeconds: TTL.state
    });
    await expect(unseal(await freshKey(), token, 'state')).rejects.toThrow(SealError);
  });

  it('rejects a token used as the wrong type', async () => {
    const key = await freshKey();
    const token = await seal(key, 'refresh', {
      t: 'refresh',
      client_id: 'c',
      gh_refresh: 'ghr_x',
      repo: 'a/b',
      readonly: false,
      ttlSeconds: TTL.refresh
    });
    await expect(unseal(key, token, 'access')).rejects.toThrow(SealError);
  });

  it('rejects a tampered ciphertext, IV, prefix or shape', async () => {
    const key = await freshKey();
    const token = await seal(key, 'code', {
      t: 'code',
      client_id: 'c',
      redirect_uri: 'https://a.test/cb',
      code_challenge: 'x'.repeat(43),
      gh_access: 'gho_x',
      repo: 'a/b',
      readonly: false,
      ttlSeconds: TTL.code
    });
    const [prefix, iv, cipher] = token.split('.') as [string, string, string];

    // The first character, never the last: the last base64url character of a
    // body whose length is not a multiple of three carries bits the decoder
    // ignores, so flipping it there would sometimes decode to the same bytes.
    const flip = (text: string): string => {
      const first = text[0]!;
      return (first === 'A' ? 'B' : 'A') + text.slice(1);
    };

    for (const bad of [
      `${prefix}.${iv}.${flip(cipher)}`,
      `${prefix}.${flip(iv)}.${cipher}`,
      `os2.${iv}.${cipher}`,
      `${prefix}.${cipher}`,
      `${prefix}.${iv}.${cipher}.extra`,
      '',
      'not-a-token'
    ]) {
      await expect(unseal(key, bad, 'code')).rejects.toThrow(SealError);
    }
  });

  it('rejects an expired token, and every failure reads the same', async () => {
    const key = await freshKey();
    const token = await seal(key, 'state', {
      t: 'state',
      client_id: 'c',
      redirect_uri: 'https://a.test/cb',
      code_challenge: 'x'.repeat(43),
      readonly: true,
      ttlSeconds: 60
    });
    await expect(unseal(key, token, 'state')).resolves.toBeTruthy();
    await expect(unseal(key, token, 'state', nowSeconds() + 61)).rejects.toThrow(
      'invalid or expired token'
    );
    await expect(unseal(key, token, 'pick')).rejects.toThrow('invalid or expired token');
  });

  it('never expires a client registration, and clamps to the earlier of two limits', async () => {
    const key = await freshKey();
    const client = await unseal(
      key,
      await seal(key, 'client', {
        t: 'client',
        redirect_uris: ['https://a.test/cb'],
        client_name: 'A'
      }),
      'client'
    );
    expect(client.exp).toBeUndefined();

    const soon = nowSeconds() + 30;
    const access = await unseal(
      key,
      await seal(key, 'access', {
        t: 'access',
        client_id: 'c',
        gh_access: 'gho',
        repo: 'a/b',
        readonly: false,
        ttlSeconds: TTL.access,
        expiresAt: soon
      }),
      'access'
    );
    expect(access.exp).toBe(soon);
  });
});

describe('PKCE', () => {
  it('accepts a verifier that S256-hashes to the challenge', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = await s256(verifier);
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    expect(isValidCodeChallenge(challenge)).toBe(true);
    await expect(verifyPkceS256(verifier, challenge)).resolves.toBe(true);
  });

  it('rejects the wrong verifier, a malformed one, and a plain challenge', async () => {
    const verifier = 'a'.repeat(64);
    const challenge = await s256(verifier);
    await expect(verifyPkceS256('b'.repeat(64), challenge)).resolves.toBe(false);
    await expect(verifyPkceS256('too-short', challenge)).resolves.toBe(false);
    await expect(verifyPkceS256(`${'a'.repeat(63)}!`, challenge)).resolves.toBe(false);
    await expect(verifyPkceS256(verifier, verifier)).resolves.toBe(false);
    expect(isValidCodeChallenge('short')).toBe(false);
  });
});
