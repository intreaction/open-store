/**
 * Byte helpers built on web standards only, so every module that the hosted
 * Worker imports stays free of `node:` builtins and the `Buffer` global. Node
 * 22 and Cloudflare Workers both provide TextEncoder/TextDecoder and atob/btoa.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * A byte array backed by a plain ArrayBuffer. WebCrypto's typings reject the
 * `ArrayBufferLike` a bare `Uint8Array` carries, so every helper here is explicit.
 */
export type Bytes = Uint8Array<ArrayBuffer>;

/** Length of `text` in UTF-8 bytes. */
export function utf8Length(text: string): number {
  return encoder.encode(text).length;
}

export function utf8Bytes(text: string): Bytes {
  return encoder.encode(text) as Bytes;
}

export function bytesToUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/** Standard base64 (with padding) of a byte array. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  // Chunked so a large blob never blows the argument limit of String.fromCharCode.
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Bytes of a standard base64 string. Whitespace (GitHub wraps at 60 chars) is ignored. */
export function base64ToBytes(base64: string): Bytes {
  const binary = atob(base64.replace(/\s+/g, ''));
  const bytes: Bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function utf8ToBase64(text: string): string {
  return bytesToBase64(encoder.encode(text));
}

export function base64ToUtf8(base64: string): string {
  return decoder.decode(base64ToBytes(base64));
}
