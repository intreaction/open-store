import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { loadConfig, type Config } from '../src/config.js';
import { DEFAULT_INSTRUCTIONS, createServer, loadInstructions } from '../src/server.js';
import { MemoryStore } from '../src/store/memory.js';
import { FIXTURE, makeStore } from './helpers.js';

const CONFIG: Config = {
  owner: 'intreaction',
  repo: 'my-openstore',
  token: 'not-a-real-token',
  readOnly: false,
  client: 'openstore-test'
};

interface TextContent {
  type: string;
  text: string;
}

async function connect(store: MemoryStore, config: Config = CONFIG, instructions?: string) {
  const server = createServer({
    config,
    createStore: () => store,
    log: () => {},
    ...(instructions ? { instructions } : {})
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, server };
}

const textOf = (result: unknown): string =>
  ((result as { content: TextContent[] }).content[0]?.text ?? '');

describe('MCP server', () => {
  it('registers every tool with the documented annotations', async () => {
    const { client } = await connect(makeStore());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'cat',
        'find',
        'git_diff',
        'git_log',
        'git_revert',
        'git_show',
        'grep',
        'head',
        'ls',
        'mv',
        'pwd',
        'rm',
        'tail',
        'tree',
        'write'
      ].sort()
    );

    const cat = tools.find((t) => t.name === 'cat')!;
    expect(cat.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false
    });

    const write = tools.find((t) => t.name === 'write')!;
    expect(write.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(write.inputSchema.required).toEqual(expect.arrayContaining(['args', 'content']));

    for (const name of ['rm', 'git_revert']) {
      expect(tools.find((t) => t.name === name)!.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true
      });
    }
  });

  it('does not register the write tools in read-only mode', async () => {
    const { client } = await connect(makeStore(), { ...CONFIG, readOnly: true });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain('grep');
    for (const name of ['write', 'mv', 'rm', 'git_revert']) {
      expect(names).not.toContain(name);
    }
  });

  it('runs a tool and returns terminal-shaped text', async () => {
    const { client } = await connect(makeStore());
    const result = await client.callTool({ name: 'cat', arguments: { args: 'home/network.md' } });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toBe(FIXTURE['home/network.md']);
  });

  it('returns bash-style errors as MCP tool errors', async () => {
    const { client } = await connect(makeStore());
    const result = await client.callTool({ name: 'cat', arguments: { args: 'home/router.md' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('cat: home/router.md: No such file or directory\n');
  });

  it('marks a grep with no matches as an error, exactly like exit 1', async () => {
    const { client } = await connect(makeStore());
    const result = await client.callTool({ name: 'grep', arguments: { args: 'nothing-here' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('grep: no matches\n');
  });

  it('writes through the tool interface', async () => {
    const store = makeStore();
    const { client } = await connect(store);
    const result = await client.callTool({
      name: 'write',
      arguments: { args: 'people/alex.md', content: '# Alex\n' }
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toMatch(/^wrote people\/alex\.md \(\+1 -0\) @ [0-9a-f]{7}\n$/);
    expect(store.snapshotFiles()['people/alex.md']).toBe('# Alex\n');
  });

  it('truncates oversized output', async () => {
    const store = new MemoryStore();
    store.seed({ 'big.md': `${'y'.repeat(120)}\n`.repeat(2000) });
    const { client } = await connect(store);
    const text = textOf(await client.callTool({ name: 'cat', arguments: { args: 'big.md' } }));
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(64 * 1024);
    expect(text.trimEnd().endsWith('more lines)')).toBe(true);
  });

  it('logs only metadata, never content', async () => {
    const entries: unknown[] = [];
    const server = createServer({
      config: CONFIG,
      createStore: () => makeStore(),
      log: (entry) => entries.push(entry)
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    await client.callTool({ name: 'cat', arguments: { args: 'home/network.md' } });
    expect(entries).toHaveLength(1);
    expect(Object.keys(entries[0] as object).sort()).toEqual([
      'exitCode',
      'inBytes',
      'ms',
      'outBytes',
      'tool'
    ]);
    expect(JSON.stringify(entries[0])).not.toContain('UDM');
  });

  it('serves the store CONTEXT.md as the MCP instructions', async () => {
    const store = makeStore();
    const instructions = await loadInstructions(store);
    expect(instructions).toBe(FIXTURE['CONTEXT.md']!.trim());
    const { client } = await connect(store, CONFIG, instructions);
    expect(client.getInstructions()).toBe(FIXTURE['CONTEXT.md']!.trim());
    expect(client.getServerVersion()?.name).toBe('openstore');
  });

  it('falls back to the built-in instructions without CONTEXT.md', async () => {
    const store = new MemoryStore();
    store.seed({ 'README.md': '# store\n' });
    expect(await loadInstructions(store)).toBe(DEFAULT_INSTRUCTIONS);
  });
});

describe('config', () => {
  it('requires a repo and a token', () => {
    expect(() => loadConfig({})).toThrow('openstore: OPENSTORE_REPO is required (owner/name)');
    expect(() => loadConfig({ OPENSTORE_REPO: 'intreaction/my-openstore' })).toThrow(
      'openstore: OPENSTORE_TOKEN is required'
    );
    expect(() => loadConfig({ OPENSTORE_REPO: 'nope', OPENSTORE_TOKEN: 't' })).toThrow(
      'openstore: OPENSTORE_REPO must look like owner/name (got nope)'
    );
  });

  it('reads the optional settings', () => {
    const config = loadConfig({
      OPENSTORE_REPO: 'intreaction/my-openstore',
      OPENSTORE_TOKEN: 'secret',
      OPENSTORE_BRANCH: 'notes',
      OPENSTORE_READONLY: 'true',
      OPENSTORE_CLIENT: 'claude-code'
    });
    expect(config).toMatchObject({
      owner: 'intreaction',
      repo: 'my-openstore',
      branch: 'notes',
      readOnly: true,
      client: 'claude-code'
    });
    expect(loadConfig({ OPENSTORE_REPO: 'a/b', OPENSTORE_TOKEN: 't' })).toMatchObject({
      readOnly: false,
      client: 'openstore'
    });
  });
});
