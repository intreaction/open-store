import { utf8Length } from './bytes.js';

/** Hard limits from the OpenStore tool contract (brief section 4). */
export const MAX_FILE_BYTES = 128 * 1024;
export const MAX_OUTPUT_BYTES = 64 * 1024;
export const MAX_VISIBLE_FILES = 5000;

export const SEARCH_INCOMPLETE = '(search incomplete: file limit reached)';

/**
 * Clamps tool output to MAX_OUTPUT_BYTES on a line boundary, appending
 * `... (output truncated, N more lines)` when anything was dropped.
 */
export function truncateOutput(text: string, maxBytes = MAX_OUTPUT_BYTES): string {
  if (utf8Length(text) <= maxBytes) return text;

  const lines = text.split('\n');
  const kept: string[] = [];
  let used = 0;
  // Reserve room for the trailing notice (generous fixed reservation).
  const reserve = Math.min(64, Math.floor(maxBytes / 4));
  for (const line of lines) {
    const cost = utf8Length(line) + 1;
    if (used + cost > maxBytes - reserve) break;
    kept.push(line);
    used += cost;
  }
  const dropped = lines.length - kept.length;
  const body = kept.join('\n');
  const notice = `... (output truncated, ${dropped} more line${dropped === 1 ? '' : 's'})`;
  return body.length > 0 ? `${body}\n${notice}` : notice;
}
