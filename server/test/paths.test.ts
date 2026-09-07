import { describe, expect, it } from 'vitest';
import { ShellError } from '../src/errors.js';
import {
  hasVisibleExtension,
  isVisibleFilePath,
  normalizePath,
  normalizeWritablePath
} from '../src/shell/paths.js';

const denied = (raw: string) => {
  expect(() => normalizePath('cat', raw)).toThrow(ShellError);
  expect(() => normalizePath('cat', raw)).toThrow(`cat: ${raw}: Permission denied`);
};

const invisible = (raw: string) => {
  expect(() => normalizePath('cat', raw)).toThrow(`cat: ${raw}: No such file or directory`);
};

describe('normalizePath', () => {
  it('accepts repo-relative paths', () => {
    expect(normalizePath('cat', 'home/network.md')).toBe('home/network.md');
    expect(normalizePath('ls', './home')).toBe('home');
    expect(normalizePath('ls', 'home/')).toBe('home');
    expect(normalizePath('ls', '.')).toBe('');
    expect(normalizePath('ls', 'a/./b.md')).toBe('a/b.md');
  });

  it('refuses to leave the store', () => {
    denied('..');
    denied('../secrets.md');
    denied('home/../../etc/passwd');
    denied('/etc/passwd');
    denied('home//network.md');
    denied('home\\network.md');
    denied('~/notes.md');
  });

  it('treats hidden paths as simply absent', () => {
    invisible('.git/config');
    invisible('.github/workflows/ci.yml');
    invisible('.env');
    invisible('home/.secret.md');
  });

  it('rejects an empty operand', () => {
    expect(() => normalizePath('cat', '')).toThrow("cat: '': No such file or directory");
  });
});

describe('visibility', () => {
  it('knows the text types', () => {
    for (const ok of ['a.md', 'a.markdown', 'a.txt', 'a.yml', 'a.yaml', 'a.json', 'a.csv', 'A.MD']) {
      expect(hasVisibleExtension(ok)).toBe(true);
    }
    for (const no of ['a.pdf', 'a.png', 'a', 'a.mdx', '.md']) {
      expect(hasVisibleExtension(no)).toBe(false);
    }
  });

  it('hides dot-directories and non-text files', () => {
    expect(isVisibleFilePath('home/network.md')).toBe(true);
    expect(isVisibleFilePath('.github/workflows/ci.yml')).toBe(false);
    expect(isVisibleFilePath('notes.pdf')).toBe(false);
    expect(isVisibleFilePath('')).toBe(false);
  });

  it('will not write a non-text file', () => {
    expect(() => normalizeWritablePath('write', 'notes.pdf')).toThrow(
      'write: notes.pdf: No such file or directory'
    );
    expect(normalizeWritablePath('write', 'home/new.md')).toBe('home/new.md');
  });
});
