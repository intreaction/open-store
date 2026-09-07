import { describe, expect, it } from 'vitest';
import { MAX_OUTPUT_BYTES, MAX_VISIBLE_FILES, truncateOutput } from '../src/limits.js';
import { MemoryStore } from '../src/store/memory.js';
import { makeStore, out } from './helpers.js';

describe('truncateOutput', () => {
  it('leaves small output alone', () => {
    expect(truncateOutput('hello\nworld\n')).toBe('hello\nworld\n');
  });

  it('cuts on a line boundary and says how much was dropped', () => {
    const line = `${'x'.repeat(99)}\n`;
    const text = line.repeat(1000); // ~100 KB
    const cut = truncateOutput(text);
    expect(Buffer.byteLength(cut, 'utf8')).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
    const lines = cut.split('\n');
    const notice = lines[lines.length - 1];
    expect(notice).toMatch(/^\.\.\. \(output truncated, \d+ more lines\)$/);
    const dropped = Number(/(\d+) more lines/.exec(notice!)![1]);
    // 1000 content lines plus the trailing empty one.
    expect(lines.length - 1 + dropped).toBe(1001);
  });

  it('counts a single dropped line in the singular', () => {
    const text = `${'a'.repeat(40)}\n${'b'.repeat(40)}`;
    expect(truncateOutput(text, 80)).toBe(`${'a'.repeat(40)}\n... (output truncated, 1 more line)`);
  });
});

describe('visible file limit', () => {
  it('stops at 5,000 files and says the search was incomplete', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < MAX_VISIBLE_FILES + 1; i += 1) {
      files[`notes/n${String(i).padStart(5, '0')}.md`] = `# note ${i}\n`;
    }
    const store = new MemoryStore();
    store.seed(files);

    const found = (await out(store, "find . -type f")).trim().split('\n');
    expect(found).toHaveLength(MAX_VISIBLE_FILES + 1);
    expect(found[found.length - 1]).toBe('(search incomplete: file limit reached)');

    const grepped = (await out(store, 'grep "# note 4999"')).trim().split('\n');
    expect(grepped[grepped.length - 1]).toBe('(search incomplete: file limit reached)');
  });

  it('passes a host-truncated tree through as an incomplete search', async () => {
    const store = makeStore();
    store.hostTruncatedTree = true;
    const lines = (await out(store, 'grep Gateway')).trim().split('\n');
    expect(lines[lines.length - 1]).toBe('(search incomplete: file limit reached)');
  });
});
