import { describe, expect, it } from 'vitest';
import { FlagError, TokenizeError, parseFlags, tokenize } from '../src/shell/argv.js';

describe('tokenize', () => {
  it('splits on whitespace', () => {
    expect(tokenize('grep -rn gateway home')).toEqual(['grep', '-rn', 'gateway', 'home']);
  });

  it('returns nothing for an empty string', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   ')).toEqual([]);
  });

  it('keeps single-quoted runs intact and literal', () => {
    expect(tokenize(`grep 'UDM Pro Max' home`)).toEqual(['grep', 'UDM Pro Max', 'home']);
    expect(tokenize(`echo 'a\\b'`)).toEqual(['echo', 'a\\b']);
  });

  it('keeps double-quoted runs intact', () => {
    expect(tokenize('write -m "add the gateway" home/network.md')).toEqual([
      'write',
      '-m',
      'add the gateway',
      'home/network.md'
    ]);
  });

  it('honours backslash escapes outside quotes', () => {
    expect(tokenize('cat home/my\\ file.md')).toEqual(['cat', 'home/my file.md']);
    expect(tokenize("grep it\\'s")).toEqual(['grep', "it's"]);
  });

  it('honours the bash escape set inside double quotes', () => {
    expect(tokenize('grep "say \\"hi\\""')).toEqual(['grep', 'say "hi"']);
    expect(tokenize('grep "a\\nb"')).toEqual(['grep', 'a\\nb']);
    expect(tokenize('grep "50\\$"')).toEqual(['grep', '50$']);
  });

  it('joins adjacent quoted and bare pieces', () => {
    expect(tokenize(`-m'one two'`)).toEqual(['-mone two']);
    expect(tokenize('a"b"c')).toEqual(['abc']);
  });

  it('preserves an empty quoted argument', () => {
    expect(tokenize("cat ''")).toEqual(['cat', '']);
  });

  it('rejects an unterminated quote the way bash does', () => {
    expect(() => tokenize("grep 'oops")).toThrow(TokenizeError);
    expect(() => tokenize("grep 'oops")).toThrow("unexpected EOF while looking for matching `''");
    expect(() => tokenize('grep "oops')).toThrow('unexpected EOF while looking for matching `"\'');
  });
});

describe('parseFlags', () => {
  const spec = {
    '-l': 'bool',
    '-a': 'bool',
    '-n': 'value',
    '-e': 'values',
    '--oneline': 'bool',
    '--author': 'value'
  } as const;

  it('parses clustered short flags', () => {
    const args = parseFlags(['-la', 'home'], { ...spec });
    expect(args.bool('-l')).toBe(true);
    expect(args.bool('-a')).toBe(true);
    expect(args.positional).toEqual(['home']);
  });

  it('takes a value from the next token or from the cluster tail', () => {
    expect(parseFlags(['-n', '5'], { ...spec }).value('-n')).toBe('5');
    expect(parseFlags(['-n5'], { ...spec }).value('-n')).toBe('5');
  });

  it('parses long flags with and without =', () => {
    expect(parseFlags(['--author=John'], { ...spec }).value('--author')).toBe('John');
    expect(parseFlags(['--author', 'John'], { ...spec }).value('--author')).toBe('John');
    expect(parseFlags(['--oneline'], { ...spec }).bool('--oneline')).toBe(true);
  });

  it('collects repeated values', () => {
    expect(parseFlags(['-e', 'a', '-e', 'b'], { ...spec }).list('-e')).toEqual(['a', 'b']);
  });

  it('reports unknown flags the way bash tools do', () => {
    expect(() => parseFlags(['-z'], { ...spec })).toThrow(FlagError);
    expect(() => parseFlags(['-z'], { ...spec })).toThrow("invalid option -- 'z'");
    expect(() => parseFlags(['-lz'], { ...spec })).toThrow("invalid option -- 'z'");
    expect(() => parseFlags(['--nope'], { ...spec })).toThrow("unrecognized option '--nope'");
    expect(() => parseFlags(['--nope=1'], { ...spec })).toThrow("unrecognized option '--nope'");
  });

  it('reports missing option arguments', () => {
    expect(() => parseFlags(['-n'], { ...spec })).toThrow("option requires an argument -- 'n'");
    expect(() => parseFlags(['--author'], { ...spec })).toThrow(
      "option '--author' requires an argument"
    );
  });

  it('supports single-dash long options like find', () => {
    const args = parseFlags(['-name', '*.md'], { '-name': 'value' });
    expect(args.value('-name')).toBe('*.md');
  });

  it('splits a pathspec after --', () => {
    const args = parseFlags(['--oneline', '--', 'home/network.md'], { ...spec }, { pathspec: true });
    expect(args.pathspec).toEqual(['home/network.md']);
    expect(args.positional).toEqual([]);
  });

  it('accepts git-style numeric shorthand', () => {
    const args = parseFlags(['-5'], { ...spec }, { numeric: '-n' });
    expect(args.value('-n')).toBe('5');
  });
});
