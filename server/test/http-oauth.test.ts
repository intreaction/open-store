import { afterEach, describe, expect, it } from 'vitest';
import { createApp, isAllowedRedirectUri } from '../src/http/app.js';
import type { Env } from '../src/http/env.js';
import { s256 } from '../src/oauth/pkce.js';
import {
  API,
  installFetch,
  installationsRoute,
  OAUTH,
  repoJson,
  reposRoute,
  testEnv,
  TOKEN_ROUTE,
  VIEWER_ROUTE,
  type FetchMock,
  type Route
} from './http-helpers.js';

const REDIRECT = 'http://127.0.0.1:33418/oauth/callback';
const VERIFIER = 'K6cA0dPqLm3xTb7VgYhN1sRw9ZeUj4iOpQ2fXcMvBnH';

let mock: FetchMock | undefined;
afterEach(() => {
  mock?.restore();
  mock = undefined;
});

function app(overrides: Parameters<typeof createApp>[0] = {}) {
  // Tests never wait on the wall clock, and never log.
  return createApp({ log: () => {}, sleep: async () => {}, createPollMs: 0, ...overrides });
}

async function register(server: ReturnType<typeof createApp>, env: Env, uris = [REDIRECT]) {
  const response = await server.request(
    '/register',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: uris, client_name: 'Test Client' })
    },
    env
  );
  expect(response.status).toBe(201);
  return (await response.json()) as { client_id: string; redirect_uris: string[] };
}

async function authorize(
  server: ReturnType<typeof createApp>,
  env: Env,
  clientId: string,
  extra: Record<string, string> = {}
) {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: await s256(VERIFIER),
    code_challenge_method: 'S256',
    state: 'client-state-42',
    ...extra
  });
  return server.request(`/authorize?${query.toString()}`, {}, env);
}

/** Runs register -> authorize and returns the sealed state GitHub would carry. */
async function upToGitHub(
  server: ReturnType<typeof createApp>,
  env: Env,
  extra: Record<string, string> = {}
) {
  const client = await register(server, env);
  const response = await authorize(server, env, client.client_id, extra);
  expect(response.status).toBe(302);
  const target = new URL(response.headers.get('location')!);
  expect(target.origin).toBe(OAUTH);
  expect(target.pathname).toBe('/login/oauth/authorize');
  expect(target.searchParams.get('client_id')).toBe(env.GITHUB_CLIENT_ID);
  expect(target.searchParams.get('redirect_uri')).toBe('http://localhost/callback');
  return { client, state: target.searchParams.get('state')! };
}

describe('discovery metadata', () => {
  it('advertises the authorization server', async () => {
    const env = testEnv();
    const response = await app().request('/.well-known/oauth-authorization-server', {}, env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      issuer: 'http://localhost',
      authorization_endpoint: 'http://localhost/authorize',
      token_endpoint: 'http://localhost/token',
      registration_endpoint: 'http://localhost/register',
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['store', 'store:readonly'],
      resource: 'http://localhost/mcp'
    });
  });

  it('advertises the protected resource, including the /mcp-suffixed form', async () => {
    const env = testEnv();
    const plain = await app().request('/.well-known/oauth-protected-resource', {}, env);
    expect((await plain.json()) as Record<string, unknown>).toMatchObject({
      resource: 'http://localhost/mcp',
      authorization_servers: ['http://localhost']
    });
    const suffixed = await app().request('/.well-known/oauth-protected-resource/mcp', {}, env);
    expect(((await suffixed.json()) as { resource: string }).resource).toBe('http://localhost/mcp');
    const readonly = await app().request(
      '/.well-known/oauth-protected-resource/mcp/readonly',
      {},
      env
    );
    expect(((await readonly.json()) as { resource: string }).resource).toBe(
      'http://localhost/mcp/readonly'
    );
  });

  it('answers a CORS preflight for /mcp', async () => {
    const response = await app().request(
      '/mcp',
      { method: 'OPTIONS', headers: { origin: 'https://claude.ai', 'access-control-request-method': 'POST' } },
      testEnv()
    );
    expect(response.status).toBeLessThan(300);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('authorization');
    expect(response.headers.get('access-control-allow-headers')?.toLowerCase()).toContain(
      'mcp-protocol-version'
    );
  });
});

describe('dynamic client registration', () => {
  it('issues a sealed client_id with no secret', async () => {
    const env = testEnv();
    const client = await register(app(), env);
    expect(client.client_id.startsWith('os1.')).toBe(true);
    expect(client.redirect_uris).toEqual([REDIRECT]);
  });

  it('rejects redirect URIs that are not https or loopback http', async () => {
    const env = testEnv();
    for (const uri of [
      'http://example.com/cb',
      'ftp://example.com/cb',
      'javascript:alert(1)',
      'not a url',
      'https://example.com/cb#frag'
    ]) {
      const response = await app().request(
        '/register',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ redirect_uris: [uri] })
        },
        env
      );
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toBe('invalid_redirect_uri');
    }
    expect(isAllowedRedirectUri('http://localhost:1/x')).toBe(true);
    expect(isAllowedRedirectUri('https://example.com/x')).toBe(true);
  });

  it('rejects a body with no redirect_uris', async () => {
    const response = await app().request(
      '/register',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      testEnv()
    );
    expect(response.status).toBe(400);
  });
});

describe('authorize', () => {
  it('rejects an unknown client with an HTML page, never a redirect', async () => {
    const response = await authorize(app(), testEnv(), 'os1.aaaa.bbbb');
    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('not registered');
  });

  it('rejects a redirect_uri the client did not register', async () => {
    const env = testEnv();
    const server = app();
    const client = await register(server, env);
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: 'http://127.0.0.1:33418/oauth/callback/evil',
      code_challenge: await s256(VERIFIER),
      code_challenge_method: 'S256'
    });
    const response = await server.request(`/authorize?${query}`, {}, env);
    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
    expect(await response.text()).toContain('not registered');
  });

  it('sends RFC 6749 errors back to a valid redirect_uri', async () => {
    const env = testEnv();
    const server = app();
    const client = await register(server, env);

    const noPkce = await authorize(server, env, client.client_id, { code_challenge: '', code_challenge_method: '' });
    expect(noPkce.status).toBe(302);
    const first = new URL(noPkce.headers.get('location')!);
    expect(first.origin + first.pathname).toBe('http://127.0.0.1:33418/oauth/callback');
    expect(first.searchParams.get('error')).toBe('invalid_request');
    expect(first.searchParams.get('state')).toBe('client-state-42');

    const wrongType = await authorize(server, env, client.client_id, { response_type: 'token' });
    expect(new URL(wrongType.headers.get('location')!).searchParams.get('error')).toBe(
      'unsupported_response_type'
    );

    const wrongResource = await authorize(server, env, client.client_id, {
      resource: 'https://someone-else.example/mcp'
    });
    expect(new URL(wrongResource.headers.get('location')!).searchParams.get('error')).toBe(
      'invalid_target'
    );
  });

  it('accepts the matching RFC 8707 resource and redirects to GitHub', async () => {
    const env = testEnv();
    const server = app();
    const client = await register(server, env);
    const response = await authorize(server, env, client.client_id, {
      resource: 'http://localhost/mcp'
    });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')!.startsWith(`${OAUTH}/login/oauth/authorize`)).toBe(true);
  });
});

describe('callback: the GitHub App hand-off', () => {
  it('offers the install page, carrying the sealed state, when nothing is installed', async () => {
    const env = testEnv();
    const server = app();
    const { state } = await upToGitHub(server, env);
    mock = installFetch([TOKEN_ROUTE, installationsRoute([])]);

    const response = await server.request(`/callback?code=gh_code&state=${encodeURIComponent(state)}`, {}, env);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('Install OpenStore on your GitHub account');

    const href = /href="([^"]*installations\/new[^"]*)"/.exec(body)?.[1];
    expect(href).toBeTruthy();
    const installUrl = new URL(href!.replace(/&amp;/g, '&'));
    expect(installUrl.pathname).toBe('/apps/openstore/installations/new');
    // GitHub preserves `state` across the install, which is how we get back here.
    expect(installUrl.searchParams.get('state')!.startsWith('os1.')).toBe(true);
  });

  it('ignores installations belonging to other GitHub Apps', async () => {
    const env = testEnv();
    const server = app();
    const { state } = await upToGitHub(server, env);
    mock = installFetch([TOKEN_ROUTE, installationsRoute([{ id: 5 }], 9999)]);
    const response = await server.request(`/callback?code=gh_code&state=${state}`, {}, env);
    expect(await response.text()).toContain('Install OpenStore');
  });

  it('renders the setup page with a sealed pick token', async () => {
    const env = testEnv();
    const server = app();
    const { state } = await upToGitHub(server, env);
    mock = installFetch([
      TOKEN_ROUTE,
      VIEWER_ROUTE,
      installationsRoute([{ id: 5 }]),
      reposRoute(5, ['intreaction/notes', 'intreaction/website']),
      { url: /\/contents\/CONTEXT\.md$/, status: 404, body: { message: 'Not Found' } }
    ]);

    const response = await server.request(`/callback?code=gh_code&state=${state}`, {}, env);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('Create my OpenStore');
    expect(body).toContain('value="my-openstore"');
    expect(body).toContain('Advanced');
    expect(body).toContain('intreaction/website');
    expect(/name="pick" value="(os1\.[^"]+)"/.test(body)).toBe(true);
    // No GitHub token ever reaches the page in the clear.
    expect(body).not.toContain('gho_user_token');
  });

  it('offers a one-click confirmation for a returning user with exactly one store', async () => {
    const env = testEnv();
    const server = app();
    const { state } = await upToGitHub(server, env);
    mock = installFetch([
      TOKEN_ROUTE,
      VIEWER_ROUTE,
      installationsRoute([{ id: 5 }]),
      reposRoute(5, ['intreaction/my-openstore', 'intreaction/website']),
      {
        url: `${API}/repos/intreaction/my-openstore/contents/CONTEXT.md`,
        body: { name: 'CONTEXT.md', type: 'file' }
      },
      { url: /\/contents\/CONTEXT\.md$/, status: 404, body: { message: 'Not Found' } }
    ]);

    const response = await server.request(`/callback?code=gh_code&state=${state}`, {}, env);
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    const body = await response.text();
    expect(body).toContain('Connect to Test Client');
    expect(body).toContain('intreaction/my-openstore');
    expect(body).toContain('Use a different repository');
    const pick = /name="pick" value="(os1\.[^"]+)"/.exec(body)![1]!;

    const done = await server.request(
      '/callback/confirm',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          pick,
          action: 'connect',
          repo: 'intreaction/my-openstore'
        }).toString()
      },
      env
    );
    expect(done.status).toBe(302);
    const back = new URL(done.headers.get('location')!);
    expect(back.origin + back.pathname).toBe('http://127.0.0.1:33418/oauth/callback');
    expect(back.searchParams.get('state')).toBe('client-state-42');
    expect(back.searchParams.get('code')!.startsWith('os1.')).toBe(true);
  });

  it('refuses a state that was not sealed by this server', async () => {
    const response = await app().request('/callback?code=x&state=os1.aa.bb', {}, testEnv());
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('expired');
  });
});

describe('setup form', () => {
  async function toSetup(server: ReturnType<typeof createApp>, env: Env, routes: Route[]) {
    const { state } = await upToGitHub(server, env);
    mock = installFetch([
      TOKEN_ROUTE,
      VIEWER_ROUTE,
      installationsRoute([{ id: 5 }]),
      reposRoute(5, ['intreaction/notes']),
      { url: /\/contents\/CONTEXT\.md$/, status: 404, body: { message: 'Not Found' } },
      ...routes
    ]);
    const response = await server.request(`/callback?code=gh_code&state=${state}`, {}, env);
    const body = await response.text();
    return /name="pick" value="(os1\.[^"]+)"/.exec(body)![1]!;
  }

  function form(fields: Record<string, string>) {
    return {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString()
    };
  }

  it('creates a repository from the template and hands back a code', async () => {
    const env = testEnv();
    const server = app();
    const pick = await toSetup(server, env, [
      {
        method: 'POST',
        url: `${API}/repos/intreaction/openstore-template/generate`,
        status: 201,
        body: repoJson('intreaction/my-openstore', 900, null)
      },
      { url: `${API}/repos/intreaction/my-openstore`, body: repoJson('intreaction/my-openstore', 900) }
    ]);

    const response = await server.request(
      '/callback/setup',
      form({ pick, action: 'create', name: 'my-openstore' }),
      env
    );
    expect(response.status).toBe(302);
    const back = new URL(response.headers.get('location')!);
    expect(back.searchParams.get('code')!.startsWith('os1.')).toBe(true);

    const generate = mock!.calls.find((call) => call.url.includes('/generate'))!;
    expect(JSON.parse(generate.body)).toMatchObject({
      owner: 'intreaction',
      name: 'my-openstore',
      private: true
    });
  });

  it('re-renders the page with a readable error when the name is taken', async () => {
    const env = testEnv();
    const server = app();
    const pick = await toSetup(server, env, [
      {
        method: 'POST',
        url: `${API}/repos/intreaction/openstore-template/generate`,
        status: 422,
        body: { message: 'Repository creation failed: name already exists on this account' }
      }
    ]);
    const response = await server.request(
      '/callback/setup',
      form({ pick, action: 'create', name: 'my-openstore' }),
      env
    );
    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).toContain('name already exists');
    expect(body).toContain('Create my OpenStore');
    expect(body).not.toContain('<script');
  });

  it('asks for one click when a selected-repositories installation cannot see the new repo', async () => {
    const env = testEnv();
    const server = app();
    const pick = await toSetup(server, env, [
      {
        method: 'POST',
        url: `${API}/repos/intreaction/openstore-template/generate`,
        status: 201,
        body: repoJson('intreaction/my-openstore', 900, null)
      },
      { url: `${API}/repos/intreaction/my-openstore`, status: 404, body: { message: 'Not Found' } }
    ]);
    const response = await server.request(
      '/callback/setup',
      form({ pick, action: 'create', name: 'my-openstore' }),
      env
    );
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('Open installation settings');
    expect(body).toContain('settings/installations/5');
    expect(/name="pick" value="(os1\.[^"]+)"/.test(body)).toBe(true);
  });

  it('accepts an existing repository and honours the read-only checkbox', async () => {
    const env = testEnv();
    const server = app();
    const pick = await toSetup(server, env, []);
    const response = await server.request(
      '/callback/setup',
      form({ pick, action: 'existing', repo: 'intreaction/notes', readonly: '1' }),
      env
    );
    expect(response.status).toBe(302);
    expect(new URL(response.headers.get('location')!).searchParams.get('code')).toBeTruthy();
  });

  it('refuses a repository that is not in the sealed list', async () => {
    const env = testEnv();
    const server = app();
    const pick = await toSetup(server, env, []);
    const response = await server.request(
      '/callback/setup',
      form({ pick, action: 'existing', repo: 'someone-else/private' }),
      env
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('Choose one of the repositories');
  });

  it('refuses a pick token this server did not seal', async () => {
    const response = await app().request(
      '/callback/setup',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'pick=os1.aa.bb&action=create&name=x'
      },
      testEnv()
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('expired');
  });
});

describe('token endpoint', () => {
  /** Register -> authorize -> callback -> confirm, returning the authorization code. */
  async function toCode(
    server: ReturnType<typeof createApp>,
    env: Env,
    extra: Record<string, string> = {}
  ) {
    const { client, state } = await upToGitHub(server, env, extra);
    mock = installFetch([
      TOKEN_ROUTE,
      VIEWER_ROUTE,
      installationsRoute([{ id: 5 }]),
      reposRoute(5, ['intreaction/my-openstore']),
      {
        url: `${API}/repos/intreaction/my-openstore/contents/CONTEXT.md`,
        body: { name: 'CONTEXT.md', type: 'file' }
      }
    ]);
    const page = await server.request(`/callback?code=gh_code&state=${state}`, {}, env);
    const pick = /name="pick" value="(os1\.[^"]+)"/.exec(await page.text())![1]!;
    const response = await server.request(
      '/callback/confirm',
      tokenForm({ pick, action: 'connect', repo: 'intreaction/my-openstore' }),
      env
    );
    const code = new URL(response.headers.get('location')!).searchParams.get('code')!;
    return { client, code };
  }

  function tokenForm(fields: Record<string, string>) {
    return {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString()
    };
  }

  it('exchanges a code plus a valid verifier for a token pair', async () => {
    const env = testEnv();
    const server = app();
    const { client, code } = await toCode(server, env);
    const response = await server.request(
      '/token',
      tokenForm({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        client_id: client.client_id,
        code_verifier: VERIFIER
      }),
      env
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.token_type).toBe('Bearer');
    expect(body.scope).toBe('store');
    expect(String(body.access_token).startsWith('os1.')).toBe(true);
    expect(String(body.refresh_token).startsWith('os1.')).toBe(true);
    expect(Number(body.expires_in)).toBeGreaterThan(0);
    expect(Number(body.expires_in)).toBeLessThanOrEqual(8 * 60 * 60);
  });

  it.each([
    ['store store:readonly', 'http://localhost/mcp', 'store'],
    ['store:readonly', 'http://localhost/mcp', 'store:readonly'],
    ['store store:readonly', 'http://localhost/mcp/readonly', 'store:readonly']
  ])('grants scope %s for resource %s as %s', async (scope, resource, expectedScope) => {
    const env = testEnv();
    const server = app();
    const { client, code } = await toCode(server, env, { scope, resource });
    const response = await server.request(
      '/token',
      tokenForm({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        client_id: client.client_id,
        code_verifier: VERIFIER,
        resource
      }),
      env
    );
    expect(response.status).toBe(200);
    expect((await response.json() as { scope: string }).scope).toBe(expectedScope);
  });

  it('rejects a bad code_verifier', async () => {
    const env = testEnv();
    const server = app();
    const { client, code } = await toCode(server, env);
    const response = await server.request(
      '/token',
      tokenForm({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        client_id: client.client_id,
        code_verifier: `${'z'.repeat(43)}`
      }),
      env
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe('invalid_grant');
  });

  it('rejects a mismatched redirect_uri and a mismatched client', async () => {
    const env = testEnv();
    const server = app();
    const { client, code } = await toCode(server, env);

    const wrongRedirect = await server.request(
      '/token',
      tokenForm({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'http://127.0.0.1:1/other',
        client_id: client.client_id,
        code_verifier: VERIFIER
      }),
      env
    );
    expect(((await wrongRedirect.json()) as { error: string }).error).toBe('invalid_grant');

    const wrongClient = await server.request(
      '/token',
      tokenForm({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        client_id: 'os1.someone.else',
        code_verifier: VERIFIER
      }),
      env
    );
    expect(wrongClient.status).toBe(401);
    expect(((await wrongClient.json()) as { error: string }).error).toBe('invalid_client');
  });

  it('rejects an unknown grant type and an unsealed code', async () => {
    const env = testEnv();
    const server = app();
    const unsupported = await server.request('/token', tokenForm({ grant_type: 'password' }), env);
    expect(((await unsupported.json()) as { error: string }).error).toBe('unsupported_grant_type');

    const badCode = await server.request(
      '/token',
      tokenForm({ grant_type: 'authorization_code', code: 'os1.aa.bb', code_verifier: VERIFIER }),
      env
    );
    expect(((await badCode.json()) as { error: string }).error).toBe('invalid_grant');
  });

  it('renews a pair through GitHub with the refresh grant', async () => {
    const env = testEnv();
    const server = app();
    const { client, code } = await toCode(server, env);
    const first = (await (
      await server.request(
        '/token',
        tokenForm({
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT,
          client_id: client.client_id,
          code_verifier: VERIFIER
        }),
        env
      )
    ).json()) as { refresh_token: string };

    const renewed = await server.request(
      '/token',
      tokenForm({
        grant_type: 'refresh_token',
        refresh_token: first.refresh_token,
        client_id: client.client_id
      }),
      env
    );
    expect(renewed.status).toBe(200);
    const body = (await renewed.json()) as Record<string, unknown>;
    expect(String(body.access_token).startsWith('os1.')).toBe(true);
    expect(body.access_token).not.toBe(first.refresh_token);

    const call = mock!.calls.filter((entry) => entry.url.includes('/login/oauth/access_token')).at(-1)!;
    expect(new URLSearchParams(call.body).get('grant_type')).toBe('refresh_token');
  });
});

describe('landing page', () => {
  it('explains the endpoint and carries the trust statement', async () => {
    const response = await app().request('/', {}, testEnv());
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('http://localhost/mcp');
    expect(body).toContain('OpenStore keeps nothing');
    expect(body).toContain('prefers-color-scheme');
  });
});
