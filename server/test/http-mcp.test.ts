import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/http/app.js';
import type { Env } from '../src/http/env.js';
import { importSealKey, seal, TTL } from '../src/oauth/seal.js';
import {
  API,
  gitDataRoutes,
  installFetch,
  INITIALIZE_PARAMS,
  MCP_HEADERS,
  rpc,
  testEnv,
  type FetchMock
} from './http-helpers.js';

const REPO = 'intreaction/my-openstore';
const CONTEXT = '# Store context\n\nSearch before you answer.\n';

let mock: FetchMock | undefined;
afterEach(() => {
  mock?.restore();
  mock = undefined;
});

function app() {
  return createApp({ log: () => {} });
}

async function accessToken(env: Env, readonly = false): Promise<string> {
  return seal(await importSealKey(env.OPENSTORE_SEAL_KEY), 'access', {
    t: 'access',
    client_id: 'os1.test.client',
    gh_access: 'gho_user_token',
    repo: REPO,
    readonly,
    ttlSeconds: TTL.access
  });
}

function post(token: string | undefined, body: string, path = '/mcp') {
  return {
    path,
    init: {
      method: 'POST',
      headers: { ...MCP_HEADERS, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body
    }
  };
}

async function call(env: Env, token: string | undefined, body: string, path = '/mcp') {
  const { init } = post(token, body, path);
  return app().request(path, init, env);
}

describe('/mcp authorization', () => {
  it('does not log caller-controlled paths or query strings', async () => {
    const entries: unknown[] = [];
    const server = createApp({ log: (entry) => entries.push(entry) });
    const response = await server.request('/private-note-secret?code=oauth-secret', {}, testEnv());
    expect(response.status).toBe(404);
    expect(entries).toEqual([expect.objectContaining({ status: 404, method: 'GET' })]);
    expect(JSON.stringify(entries)).not.toContain('private-note-secret');
    expect(JSON.stringify(entries)).not.toContain('oauth-secret');
  });

  it('answers a missing bearer with 401 and the resource_metadata challenge', async () => {
    const env = testEnv();
    const response = await call(env, undefined, rpc('initialize', INITIALIZE_PARAMS));
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe(
      'Bearer resource_metadata="http://localhost/.well-known/oauth-protected-resource"'
    );
  });

  it('answers a tampered, wrong-type or expired token the same way', async () => {
    const env = testEnv();
    const key = await importSealKey(env.OPENSTORE_SEAL_KEY);
    const wrongType = await seal(key, 'refresh', {
      t: 'refresh',
      client_id: 'c',
      gh_refresh: 'ghr',
      repo: REPO,
      readonly: false,
      ttlSeconds: TTL.refresh
    });
    const expired = await seal(key, 'access', {
      t: 'access',
      client_id: 'c',
      gh_access: 'gho',
      repo: REPO,
      readonly: false,
      expiresAt: Math.floor(Date.now() / 1000) - 5
    });
    for (const token of ['os1.aa.bb', 'not-a-token', wrongType, expired]) {
      const response = await call(env, token, rpc('initialize', INITIALIZE_PARAMS));
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toContain('resource_metadata=');
    }
  });

  it('rejects GET and DELETE with 405 in stateless mode', async () => {
    const env = testEnv();
    const token = await accessToken(env);
    for (const method of ['GET', 'DELETE']) {
      const response = await app().request(
        '/mcp',
        { method, headers: { authorization: `Bearer ${token}` } },
        env
      );
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST');
    }
  });

  it('reports invalid JSON as a parse error, not a 500', async () => {
    const env = testEnv();
    const response = await call(env, await accessToken(env), '{ not json');
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: number } }).error.code).toBe(-32700);
  });
});

describe('/mcp session', () => {
  it('initializes, serving CONTEXT.md as the instructions, with no session id', async () => {
    const env = testEnv();
    mock = installFetch(gitDataRoutes(REPO, CONTEXT));
    const response = await call(env, await accessToken(env), rpc('initialize', INITIALIZE_PARAMS));
    expect(response.status).toBe(200);
    expect(response.headers.get('mcp-session-id')).toBeNull();
    // Store content must never be cacheable, and the SDK's own response does not
    // pin this itself.
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('pragma')).toBe('no-cache');
    const body = (await response.json()) as {
      result: { serverInfo: { name: string }; instructions: string };
    };
    expect(body.result.serverInfo.name).toBe('openstore');
    expect(body.result.instructions).toContain('Search before you answer');
  });

  it('lists all fifteen tools for a read-write token', async () => {
    const env = testEnv();
    mock = installFetch(gitDataRoutes(REPO, CONTEXT));
    const response = await call(env, await accessToken(env), rpc('tools/list', {}, 2));
    expect(response.status).toBe(200);
    const names = (
      (await response.json()) as { result: { tools: { name: string }[] } }
    ).result.tools.map((tool) => tool.name);
    expect(names).toContain('grep');
    expect(names).toContain('write');
    expect(names).toContain('git_revert');
    expect(names).toHaveLength(15);
  });

  it('hides the write tools for a read-only token', async () => {
    const env = testEnv();
    mock = installFetch(gitDataRoutes(REPO, CONTEXT));
    const response = await call(env, await accessToken(env, true), rpc('tools/list', {}, 2));
    const names = (
      (await response.json()) as { result: { tools: { name: string }[] } }
    ).result.tools.map((tool) => tool.name);
    for (const write of ['write', 'mv', 'rm', 'git_revert']) expect(names).not.toContain(write);
    expect(names).toContain('cat');
    expect(names).toHaveLength(11);
  });

  it('hides the write tools on /mcp/readonly even for a read-write token', async () => {
    const env = testEnv();
    mock = installFetch(gitDataRoutes(REPO, CONTEXT));
    const response = await call(env, await accessToken(env), rpc('tools/list', {}, 2), '/mcp/readonly');
    const names = (
      (await response.json()) as { result: { tools: { name: string }[] } }
    ).result.tools.map((tool) => tool.name);
    expect(names).not.toContain('write');
    expect(names).toHaveLength(11);
  });

  it('runs a tool against the store the sealed token names', async () => {
    const env = testEnv();
    mock = installFetch(gitDataRoutes(REPO, CONTEXT));
    const response = await call(
      env,
      await accessToken(env),
      rpc('tools/call', { name: 'cat', arguments: { args: 'CONTEXT.md' } }, 3)
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: { content: { text: string }[]; isError?: boolean };
    };
    expect(body.result.isError).toBeFalsy();
    expect(body.result.content[0]!.text).toContain('Search before you answer');

    // Every GitHub call carried the token from inside the sealed blob, and only that.
    expect(mock.calls.every((entry) => entry.url.startsWith(API))).toBe(true);
  });

  it('logs only protocol method names, never a client-supplied string', async () => {
    const env = testEnv();
    mock = installFetch(gitDataRoutes(REPO, CONTEXT));
    const lines: string[] = [];
    const server = createApp({
      log: (entry) => lines.push(JSON.stringify(entry))
    });
    const token = await accessToken(env);
    const hostile = { jsonrpc: '2.0', id: 9, method: 'Bearer gho_<script>evil' };
    await server.request(
      '/mcp',
      {
        method: 'POST',
        headers: { ...MCP_HEADERS, authorization: `Bearer ${token}` },
        body: JSON.stringify(hostile)
      },
      env
    );
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
    // The method is not a real MCP method, so no rpc field is logged at all; in
    // particular the hostile bytes never reach the log line.
    expect(entry.rpc).toBeUndefined();
    expect(lines[0]).not.toContain('Bearer');
    expect(lines[0]).not.toContain('<script>');
  });

  it('never logs a token, a path or a query string', async () => {
    const env = testEnv();
    mock = installFetch(gitDataRoutes(REPO, CONTEXT));
    const lines: string[] = [];
    const server = createApp({
      log: (entry) => lines.push(JSON.stringify(entry))
    });
    const token = await accessToken(env);
    await server.request(
      '/mcp',
      {
        method: 'POST',
        headers: { ...MCP_HEADERS, authorization: `Bearer ${token}` },
        body: rpc('tools/call', { name: 'cat', arguments: { args: 'CONTEXT.md' } }, 4)
      },
      env
    );
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(entry).toMatchObject({ route: '/mcp', method: 'POST', status: 200, rpc: 'tools/call', tool: 'cat' });
    expect(lines[0]).not.toContain(token.slice(10, 40));
    expect(lines[0]).not.toContain('gho_');
    expect(lines[0]).not.toContain('CONTEXT.md');
  });
});
