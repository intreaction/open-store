import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/store/memory.js';
import { FIXTURE, makeStore, out, run } from './helpers.js';

let store: MemoryStore;

beforeEach(() => {
  store = makeStore();
});

describe('pwd', () => {
  it('prints the root and where the store points', async () => {
    const head = await store.head();
    expect(await out(store, 'pwd')).toBe(
      `/\n# store: intreaction/my-openstore@main (head ${head.commit.slice(0, 7)})\n`
    );
  });
});

describe('ls', () => {
  it('lists the root with directories marked', async () => {
    expect(await out(store, 'ls')).toBe(
      'CONTEXT.md\nREADME.md\nhome/\nprofile/\nprojects/\ntechnology/\n'
    );
  });

  it('lists one directory', async () => {
    expect(await out(store, 'ls home')).toBe('network.md\n');
  });

  it('adds size and last-commit date with -l', async () => {
    const lines = (await out(store, 'ls -l')).trim().split('\n');
    expect(lines[0]).toMatch(/^-rw-r--r--\s+\d+\s+2026-09-06\s+CONTEXT\.md$/);
    expect(lines[2]).toMatch(/^drwxr-xr-x\s+-\s+2026-09-06\s+home\/$/);
  });

  it('prints a header per operand when there is more than one', async () => {
    expect(await out(store, 'ls home profile')).toBe(
      'home:\nnetwork.md\n\nprofile:\nabout.md\n'
    );
  });

  it('recurses with -R', async () => {
    expect(await out(store, 'ls -R profile')).toBe('profile:\nabout.md\n');
  });

  it('names a file operand back', async () => {
    expect(await out(store, 'ls home/network.md')).toBe('home/network.md\n');
  });

  it('cannot see non-text files', async () => {
    const result = await run(store, 'ls notes.pdf');
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('ls: notes.pdf: No such file or directory\n');
  });

  it('reports a missing path', async () => {
    expect((await run(store, 'ls nope')).stdout).toBe('ls: nope: No such file or directory\n');
  });

  it('reports an unknown flag like bash', async () => {
    expect((await run(store, 'ls -z')).stdout).toBe("ls: invalid option -- 'z'\n");
  });
});

describe('find', () => {
  it('walks the whole store from .', async () => {
    expect(await out(store, 'find')).toBe(
      [
        '.',
        './CONTEXT.md',
        './README.md',
        './home',
        './home/network.md',
        './profile',
        './profile/about.md',
        './projects',
        './projects/open-store.md',
        './technology',
        './technology/computers.md',
        ''
      ].join('\n')
    );
  });

  it('filters by name and type', async () => {
    expect(await out(store, "find . -name '*.md' -type f")).toBe(
      [
        './CONTEXT.md',
        './README.md',
        './home/network.md',
        './profile/about.md',
        './projects/open-store.md',
        './technology/computers.md',
        ''
      ].join('\n')
    );
  });

  it('matches case-insensitively with -iname', async () => {
    expect(await out(store, "find . -iname 'context*'")).toBe('./CONTEXT.md\n');
  });

  it('limits depth', async () => {
    expect(await out(store, 'find . -maxdepth 1 -type d')).toBe(
      ['.', './home', './profile', './projects', './technology', ''].join('\n')
    );
  });

  it('starts from a subdirectory', async () => {
    expect(await out(store, 'find home')).toBe('home\nhome/network.md\n');
  });

  it('never finds invisible files', async () => {
    expect(await out(store, "find . -name '*.pdf'")).toBe('');
    expect(await out(store, "find . -name 'ci.yml'")).toBe('');
  });

  it('rejects a bad -type', async () => {
    expect((await run(store, 'find . -type x')).stdout).toBe('find: Unknown argument to -type: x\n');
  });

  it('rejects a bad -maxdepth', async () => {
    expect((await run(store, 'find . -maxdepth deep')).stdout).toBe(
      "find: invalid argument 'deep' to '-maxdepth'\n"
    );
  });

  it('reports a missing start path', async () => {
    expect((await run(store, 'find nope')).stdout).toBe(
      "find: 'nope': No such file or directory\n"
    );
  });
});

describe('grep', () => {
  it('prints path:text by default', async () => {
    expect(await out(store, 'grep Gateway')).toBe('home/network.md:Gateway: UDM Pro Max\n');
  });

  it('prints path:line:text with -n', async () => {
    expect(await out(store, 'grep -n Gateway')).toBe('home/network.md:3:Gateway: UDM Pro Max\n');
  });

  it('is case-insensitive with -i', async () => {
    expect(await out(store, 'grep -in gateway')).toBe('home/network.md:3:Gateway: UDM Pro Max\n');
  });

  it('lists paths with -l', async () => {
    expect(await out(store, 'grep -rl OpenStore')).toBe(
      'profile/about.md\nprojects/open-store.md\n'
    );
  });

  it('counts with -c', async () => {
    const lines = (await out(store, 'grep -c Mac')).trim().split('\n');
    expect(lines).toContain('technology/computers.md:1');
    expect(lines).toContain('home/network.md:0');
  });

  it('treats the pattern as a fixed string', async () => {
    expect((await run(store, "grep 'M4.'")).stdout).toBe('grep: no matches\n');
    expect(await out(store, "grep 'M4,'")).toBe(
      'technology/computers.md:Mac mini (M4, 24 GB RAM).\n'
    );
  });

  it('honours word boundaries with -w', async () => {
    expect(await out(store, 'grep -w Mac')).toBe(
      'technology/computers.md:Mac mini (M4, 24 GB RAM).\n'
    );
    expect((await run(store, 'grep -w Ma')).stdout).toBe('grep: no matches\n');
  });

  it('accepts several -e patterns', async () => {
    expect(await out(store, 'grep -l -e Gateway -e "Mac mini"')).toBe(
      'home/network.md\ntechnology/computers.md\n'
    );
  });

  it('searches inside one directory', async () => {
    expect(await out(store, "grep 'UDM Pro Max' home")).toBe(
      'home/network.md:Gateway: UDM Pro Max\n'
    );
  });

  it('exits 1 with a message when nothing matches', async () => {
    const result = await run(store, 'grep nothing-here');
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('grep: no matches\n');
  });

  it('reports a missing path', async () => {
    expect((await run(store, 'grep x nope')).stdout).toBe(
      'grep: nope: No such file or directory\n'
    );
  });

  it('needs a pattern', async () => {
    expect((await run(store, 'grep')).stdout).toBe('grep: missing pattern\n');
  });

  it('reports an unterminated quote', async () => {
    expect((await run(store, "grep 'oops")).stdout).toBe(
      "grep: unexpected EOF while looking for matching `''\n"
    );
  });
});

describe('cat / head / tail', () => {
  it('prints a whole file', async () => {
    expect(await out(store, 'cat home/network.md')).toBe(FIXTURE['home/network.md']);
  });

  it('numbers lines with -n', async () => {
    expect(await out(store, 'cat -n home/network.md')).toBe(
      '     1\t# Network\n     2\t\n     3\tGateway: UDM Pro Max\n     4\tReplaced an Amplifi Alien.\n'
    );
  });

  it('concatenates several files', async () => {
    expect(await out(store, 'cat CONTEXT.md README.md')).toBe(
      `${FIXTURE['CONTEXT.md']}${FIXTURE['README.md']}`
    );
  });

  it('reports missing files and directories', async () => {
    expect((await run(store, 'cat home/router.md')).stdout).toBe(
      'cat: home/router.md: No such file or directory\n'
    );
    expect((await run(store, 'cat home')).stdout).toBe('cat: home: Is a directory\n');
    expect((await run(store, 'cat notes.pdf')).stdout).toBe(
      'cat: notes.pdf: No such file or directory\n'
    );
    expect((await run(store, 'cat')).stdout).toBe('cat: missing file operand\n');
  });

  it('heads and tails with a default of 10', async () => {
    expect(await out(store, 'head -n 2 home/network.md')).toBe('# Network\n\n');
    expect(await out(store, 'head home/network.md')).toBe(FIXTURE['home/network.md']);
    expect(await out(store, 'tail -n 1 home/network.md')).toBe('Replaced an Amplifi Alien.\n');
    expect(await out(store, 'tail -1 home/network.md')).toBe('Replaced an Amplifi Alien.\n');
  });

  it('rejects a bad line count', async () => {
    expect((await run(store, 'head -n x home/network.md')).stdout).toBe(
      "head: invalid number of lines: 'x'\n"
    );
    expect((await run(store, 'tail')).stdout).toBe('tail: missing file operand\n');
  });
});

describe('tree', () => {
  it('renders the classic tree with a summary', async () => {
    expect(await out(store, 'tree')).toBe(
      [
        '.',
        '├── CONTEXT.md',
        '├── README.md',
        '├── home',
        '│   └── network.md',
        '├── profile',
        '│   └── about.md',
        '├── projects',
        '│   └── open-store.md',
        '└── technology',
        '    └── computers.md',
        '',
        '4 directories, 6 files',
        ''
      ].join('\n')
    );
  });

  it('limits depth with -L', async () => {
    expect(await out(store, 'tree -L 1')).toBe(
      [
        '.',
        '├── CONTEXT.md',
        '├── README.md',
        '├── home',
        '├── profile',
        '├── projects',
        '└── technology',
        '',
        '4 directories, 2 files',
        ''
      ].join('\n')
    );
  });

  it('renders a subdirectory', async () => {
    expect(await out(store, 'tree home')).toBe(
      ['home', '└── network.md', '', '0 directories, 1 file', ''].join('\n')
    );
  });

  it('reports a missing path', async () => {
    expect((await run(store, 'tree nope')).stdout).toBe('tree: nope: No such file or directory\n');
  });
});
