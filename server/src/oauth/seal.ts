/**
 * Sealed tokens: the whole of OpenStore's server-side state, encrypted and
 * handed to the client to carry. The hosted server keeps one symmetric key and
 * nothing else — no database, no cache, no session table.
 *
 * Wire format: `os1.<base64url iv>.<base64url ciphertext>`, AES-256-GCM over the
 * JSON payload, with the type tag and the expiry inside the sealed body so a
 * token cannot be replayed as a different kind of token or past its lifetime.
 */
import { bytesToUtf8, utf8Bytes, type Bytes } from '../bytes.js';
import { decodeBase64Url, encodeBase64Url } from './base64url.js';

export const TOKEN_PREFIX = 'os1';
const IV_BYTES = 12;

export type SealType = 'client' | 'state' | 'pick' | 'code' | 'access' | 'refresh';

interface Envelope {
  /** Type tag. Checked on unseal so one kind of token is never accepted as another. */
  t: SealType;
  /** Issued at, seconds since the epoch. */
  iat: number;
  /** Expiry, seconds since the epoch. Absent means "never expires". */
  exp?: number;
}

/** A registered client. Never expires: RFC 7591 registrations have no lifetime here. */
export interface ClientPayload extends Envelope {
  t: 'client';
  redirect_uris: string[];
  client_name: string;
}

/** Carried through the GitHub round trip in the `state` query parameter. 10 minutes. */
export interface StatePayload extends Envelope {
  t: 'state';
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  /** The client's own `state`, echoed back verbatim on the final redirect. */
  client_state?: string;
  resource?: string;
  readonly: boolean;
  /** The registered client's display name, shown on the setup page. */
  client_name?: string;
}

/** Everything the setup page needs to finish without server-side storage. 10 minutes. */
export interface PickPayload extends Envelope {
  t: 'pick';
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  client_state?: string;
  resource?: string;
  readonly: boolean;
  client_name?: string;
  gh_access: string;
  gh_refresh?: string;
  /** Absolute expiry of `gh_access`, seconds since the epoch. */
  gh_exp?: number;
  /** `owner/name` of every repository the installation grants this user. */
  repos: string[];
  /** Set once a repository has been created and we are waiting for it to become visible. */
  created?: string;
  /** Login of the authenticated GitHub user. */
  login: string;
  /** Installation the store lives under, when exactly one is relevant. */
  installation_id?: number;
}

/** The OAuth authorization code. 5 minutes. */
export interface CodePayload extends Envelope {
  t: 'code';
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  gh_access: string;
  gh_refresh?: string;
  gh_exp?: number;
  repo: string;
  readonly: boolean;
}

/** The bearer token `/mcp` accepts. min(GitHub token expiry, 8 hours). */
export interface AccessPayload extends Envelope {
  t: 'access';
  client_id: string;
  gh_access: string;
  repo: string;
  readonly: boolean;
}

/** Exchanged at `/token` for a fresh pair. 180 days. */
export interface RefreshPayload extends Envelope {
  t: 'refresh';
  client_id: string;
  gh_refresh: string;
  repo: string;
  readonly: boolean;
}

export type SealPayload =
  | ClientPayload
  | StatePayload
  | PickPayload
  | CodePayload
  | AccessPayload
  | RefreshPayload;

/** Maps a type tag to its payload shape, so `unseal(token, key, 'code')` is typed. */
export interface PayloadByType {
  client: ClientPayload;
  state: StatePayload;
  pick: PickPayload;
  code: CodePayload;
  access: AccessPayload;
  refresh: RefreshPayload;
}

/** Lifetimes in seconds, from the brief's token table. */
export const TTL = {
  state: 10 * 60,
  pick: 10 * 60,
  code: 5 * 60,
  access: 8 * 60 * 60,
  refresh: 180 * 24 * 60 * 60
} as const;

/**
 * The single failure a caller ever sees. Wrong key, wrong type, expired, tampered
 * ciphertext and malformed input are deliberately indistinguishable.
 */
export class SealError extends Error {
  constructor() {
    super('invalid or expired token');
    this.name = 'SealError';
  }
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Imports the base64 `OPENSTORE_SEAL_KEY` as an AES-256-GCM key. Throws a plain
 * Error (a misconfiguration, not a bad request) when the key is not 32 bytes.
 */
export async function importSealKey(base64Key: string): Promise<CryptoKey> {
  const trimmed = (base64Key ?? '').trim();
  if (!trimmed) throw new Error('OPENSTORE_SEAL_KEY is required (32 bytes, base64)');
  let raw: Bytes;
  try {
    // Accept both base64 and base64url spellings of the key.
    raw = decodeBase64Url(trimmed.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
  } catch {
    throw new Error('OPENSTORE_SEAL_KEY must be base64');
  }
  if (raw.length !== 32) {
    throw new Error('OPENSTORE_SEAL_KEY must decode to exactly 32 bytes');
  }
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt'
  ]);
}

/** Generates a fresh key in the format `OPENSTORE_SEAL_KEY` expects. */
export function generateSealKeyBase64(): string {
  const raw: Bytes = new Uint8Array(32);
  crypto.getRandomValues(raw);
  let binary = '';
  for (const byte of raw) binary += String.fromCharCode(byte);
  return btoa(binary);
}

type SealInput<T extends SealType> = Omit<PayloadByType[T], 'iat' | 'exp'> & {
  /** Seconds from now. Omit for a token that never expires. */
  ttlSeconds?: number;
  /** Absolute expiry, seconds since the epoch. Wins over `ttlSeconds` when smaller. */
  expiresAt?: number;
};

/** Encrypts a payload into an `os1.` token. */
export async function seal<T extends SealType>(
  key: CryptoKey,
  type: T,
  input: SealInput<T>
): Promise<string> {
  const { ttlSeconds, expiresAt, ...rest } = input as SealInput<T> & Record<string, unknown>;
  const iat = nowSeconds();
  const candidates: number[] = [];
  if (typeof ttlSeconds === 'number') candidates.push(iat + ttlSeconds);
  if (typeof expiresAt === 'number') candidates.push(expiresAt);
  const payload: Record<string, unknown> = { ...rest, t: type, iat };
  if (candidates.length > 0) payload.exp = Math.min(...candidates);

  const iv: Bytes = new Uint8Array(IV_BYTES);
  crypto.getRandomValues(iv);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      utf8Bytes(JSON.stringify(payload))
    )
  );
  return `${TOKEN_PREFIX}.${encodeBase64Url(iv)}.${encodeBase64Url(cipher)}`;
}

/**
 * Decrypts a token and checks its type and expiry. Every failure mode raises the
 * same {@link SealError}; nothing about why is ever revealed to the caller.
 */
export async function unseal<T extends SealType>(
  key: CryptoKey,
  token: string,
  expectedType: T,
  atSeconds = nowSeconds()
): Promise<PayloadByType[T]> {
  if (typeof token !== 'string') throw new SealError();
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) throw new SealError();

  let plaintext: string;
  try {
    const iv = decodeBase64Url(parts[1]!);
    const cipher = decodeBase64Url(parts[2]!);
    if (iv.length !== IV_BYTES) throw new Error('iv');
    const clear = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      cipher
    );
    plaintext = bytesToUtf8(new Uint8Array(clear));
  } catch {
    throw new SealError();
  }

  let payload: unknown;
  try {
    payload = JSON.parse(plaintext);
  } catch {
    throw new SealError();
  }
  if (typeof payload !== 'object' || payload === null) throw new SealError();
  const envelope = payload as Envelope;
  if (envelope.t !== expectedType) throw new SealError();
  if (typeof envelope.exp === 'number' && envelope.exp <= atSeconds) throw new SealError();
  return payload as PayloadByType[T];
}
