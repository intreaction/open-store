import { base64ToBytes, bytesToBase64, type Bytes } from '../bytes.js';

/** base64url (RFC 4648 §5), unpadded. */
export function encodeBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Inverse of {@link encodeBase64Url}. Throws on characters outside the alphabet. */
export function decodeBase64Url(text: string): Bytes {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('not base64url');
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  return base64ToBytes(padded + '='.repeat((4 - (padded.length % 4)) % 4));
}
