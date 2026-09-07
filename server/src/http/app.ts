/**
 * The hosted OpenStore server: an OAuth 2.1 authorization server, a GitHub App
 * login and setup flow, and the MCP protected resource, all stateless.
 *
 * Every piece of state a request needs arrives inside a sealed token the client
 * (or the browser, in a hidden form field) carried in. The server keeps one
 * symmetric key and the GitHub App credentials, and nothing else — no session
 * table, no cache, no storage binding to configure.
 */
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { routePath } from 'hono/route';
import { ShellError } from '../errors.js';
import {
  createUserRepo,
  exchangeCode,
  fullName,
  generateFromTemplate,
  getRepo,
  getViewerLogin,
  GitHubApiError,
  hasContextFile,
  listInstallations,
  listInstallationRepos,
  readTemplateFiles,
  refreshGitHubToken,
  type Installation,
  type RepoRef
} from '../oauth/github.js';
import { verifyPkceS256, isValidCodeChallenge } from '../oauth/pkce.js';
import {
  nowSeconds,
  seal,
  SealError,
  TTL,
  unseal,
  type ClientPayload,
  type PickPayload
} from '../oauth/seal.js';
import { GitHubStore } from '../store/github.js';
import {
  DEFAULT_STORE_NAME,
  originOf,
  readSettings,
  sealKey,
  type Env,
  type Settings
} from './env.js';
import { errorPage, htmlResponse } from './html.js';
import { consoleLog, type LogSink, type RequestLogEntry } from './log.js';
import { handleMcpRequest, rpcMethodOf } from './mcp.js';
import { confirmPage, grantAccessPage, homePage, installPage, setupPage } from './pages.js';

export interface AppOptions {
  /** Metadata-only sink. Defaults to `console.log`. */
  log?: LogSink;
  /** Overrides the wall-clock sleep between repository polls (tests set it to 0). */
  sleep?: (ms: number) => Promise<void>;
  /** Milliseconds to wait for a freshly created repository to resolve. */
  createPollMs?: number;
}

type Variables = { logTool?: string; logRpc?: string };
type AppEnv = { Bindings: Env; Variables: Variables };

const REPO_NAME = /^[A-Za-z0-9._-]{1,90}$/;
const SCOPE_READONLY = 'store:readonly';
const SCOPE_FULL = 'store';
/** Above this many accessible repositories, probing each for CONTEXT.md is not worth it. */
const RETURNING_USER_PROBE_LIMIT = 20;

const noStore = { 'cache-control': 'no-store', pragma: 'no-cache' } as const;

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...noStore, ...headers }
  });
}

function oauthError(error: string, description: string, status = 400): Response {
  return json({ error, error_description: description }, status);
}

function rpcError(status: number, code: number, message: string): Response {
  return json({ jsonrpc: '2.0', error: { code, message }, id: null }, status);
}

/** A 302 built by hand, so no helper below needs a Hono context. */
function redirectTo(location: string): Response {
  return new Response(null, { status: 302, headers: { location, ...noStore } });
}

async function formOf(request: Request): Promise<URLSearchParams> {
  const type = request.headers.get('content-type') ?? '';
  if (type.includes('application/x-www-form-urlencoded')) {
    return new URLSearchParams(await request.text());
  }
  if (type.includes('multipart/form-data')) {
    const data = await request.formData();
    const params = new URLSearchParams();
    for (const [key, value] of data.entries()) {
      if (typeof value === 'string') params.append(key, value);
    }
    return params;
  }
  return new URLSearchParams(await request.text());
}

/**
 * https, or http on loopback with any port (RFC 8252). Nothing else may receive
 * an auth code.
 *
 * The length cap matters more than it looks: a registered redirect_uri is sealed
 * into the `client_id`, and that `client_id` is in turn sealed into every
 * `state`, `code`, `access` and `refresh` token. Unbounded URIs would let one
 * registration inflate every token this server ever issues for it, past what a
 * URL or an `Authorization` header can carry.
 */
export const MAX_REDIRECT_URI = 512;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isAllowedRedirectUri(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_REDIRECT_URI) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.username || url.password) return false;
  if (url.protocol === 'https:') return url.hostname.length > 0;
  if (url.protocol === 'http:') return LOOPBACK_HOSTS.has(url.hostname);
  return false;
}

function scopeFor(readonly: boolean): string {
  return readonly ? SCOPE_READONLY : SCOPE_FULL;
}

function bearerOf(request: Request): string | undefined {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1];
}

const sleepDefault = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export function createApp(options: AppOptions = {}): Hono<AppEnv> {
  const log = options.log ?? consoleLog;
  const sleep = options.sleep ?? sleepDefault;
  const createPollMs = options.createPollMs ?? 10_000;
  const app = new Hono<AppEnv>();

  // ---- cross-cutting: metadata-only request logging -----------------------
  app.use('*', async (c, next) => {
    const started = Date.now();
    await next();
    const entry: RequestLogEntry = {
      // Registered routes only: even an unknown pathname can contain secrets.
      route: routePath(c, -1),
      method: c.req.method,
      status: c.res.status,
      ms: Date.now() - started
    };
    const length = c.res.headers.get('content-length');
    if (length) entry.bytes = Number(length);
    const rpc = c.get('logRpc');
    if (rpc) entry.rpc = rpc;
    const tool = c.get('logTool');
    if (tool) entry.tool = tool;
    log(entry);
  });

  // Browser-based MCP clients exist, so the machine-readable surface is open.
  app.use(
    '/mcp/*',
    cors({
      origin: '*',
      allowMethods: ['POST', 'GET', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Authorization', 'Content-Type', 'Mcp-Protocol-Version', 'Mcp-Session-Id'],
      exposeHeaders: ['Mcp-Protocol-Version', 'WWW-Authenticate'],
      maxAge: 86400
    })
  );
  for (const pattern of ['/mcp', '/.well-known/*', '/register', '/token']) {
    app.use(
      pattern,
      cors({
        origin: '*',
        allowMethods: ['POST', 'GET', 'DELETE', 'OPTIONS'],
        allowHeaders: ['Authorization', 'Content-Type', 'Mcp-Protocol-Version', 'Mcp-Session-Id'],
        exposeHeaders: ['Mcp-Protocol-Version', 'WWW-Authenticate'],
        maxAge: 86400
      })
    );
  }

  app.onError((error, c) => {
    if (error instanceof ConfigProblem) {
      return htmlResponse(
        errorPage({
          title: 'Not configured',
          heading: 'This endpoint is not configured yet',
          detail: 'Its GitHub App credentials are missing. Nothing you did caused this.'
        }),
        500
      );
    }
    const accepts = c.req.header('accept') ?? '';
    if (accepts.includes('application/json') || new URL(c.req.url).pathname.startsWith('/mcp')) {
      return json({ error: 'server_error', error_description: 'Something went wrong.' }, 500);
    }
    return htmlResponse(
      errorPage({
        title: 'Something went wrong',
        heading: 'Something went wrong',
        detail: 'The request could not be completed. Nothing was stored, and nothing was changed.'
      }),
      500
    );
  });

  // ---- discovery ----------------------------------------------------------

  const authServerMetadata = (c: Context<AppEnv>) => {
    const origin = originOf(c.env, c.req.url);
    const settings = tryReadSettings(c.env);
    return json({
      issuer: origin,
      authorization_endpoint: `${origin}/authorize`,
      token_endpoint: `${origin}/token`,
      registration_endpoint: `${origin}/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: [SCOPE_FULL, SCOPE_READONLY],
      resource: `${origin}/mcp`,
      ...(settings ? { service_documentation: settings.siteUrl } : {})
    });
  };

  for (const path of [
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-authorization-server/mcp',
    '/.well-known/oauth-authorization-server/mcp/readonly'
  ]) {
    app.get(path, (c) => authServerMetadata(c));
  }

  for (const path of [
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/mcp',
    '/.well-known/oauth-protected-resource/mcp/readonly'
  ]) {
    app.get(path, (c) => {
      const origin = originOf(c.env, c.req.url);
      const suffix = new URL(c.req.url).pathname.replace('/.well-known/oauth-protected-resource', '');
      const settings = tryReadSettings(c.env);
      return json({
        resource: `${origin}${suffix || '/mcp'}`,
        authorization_servers: [origin],
        scopes_supported: [SCOPE_FULL, SCOPE_READONLY],
        bearer_methods_supported: ['header'],
        ...(settings ? { resource_documentation: settings.siteUrl } : {})
      });
    });
  }

  // ---- landing page -------------------------------------------------------

  app.get('/', (c) => {
    const settings = tryReadSettings(c.env);
    return htmlResponse(
      homePage({
        origin: originOf(c.env, c.req.url),
        siteUrl: settings?.siteUrl ?? 'https://github.com/intreaction/open-store'
      })
    );
  });

  // ---- dynamic client registration (RFC 7591) -----------------------------

  app.post('/register', async (c) => {
    const key = await sealKey(c.env);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return oauthError('invalid_client_metadata', 'The request body must be JSON.');
    }
    const input = (body ?? {}) as { redirect_uris?: unknown; client_name?: unknown };
    const uris = Array.isArray(input.redirect_uris) ? input.redirect_uris : [];
    if (uris.length === 0 || uris.length > 20) {
      return oauthError('invalid_redirect_uri', 'Provide between 1 and 20 redirect_uris.');
    }
    const redirectUris: string[] = [];
    for (const uri of uris) {
      if (typeof uri !== 'string' || !isAllowedRedirectUri(uri)) {
        return oauthError(
          'invalid_redirect_uri',
          `Every redirect_uri must be an absolute https URL, or http on localhost, 127.0.0.1 or [::1], carry no credentials, and be at most ${MAX_REDIRECT_URI} characters.`
        );
      }
      redirectUris.push(uri);
    }
    const clientName =
      typeof input.client_name === 'string' && input.client_name.trim().length > 0
        ? input.client_name.trim().slice(0, 120)
        : 'MCP client';

    const clientId = await seal(key, 'client', {
      t: 'client',
      redirect_uris: redirectUris,
      client_name: clientName
    });
    return json(
      {
        client_id: clientId,
        client_id_issued_at: nowSeconds(),
        client_name: clientName,
        redirect_uris: redirectUris,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none'
      },
      201
    );
  });

  // ---- authorize ----------------------------------------------------------

  app.get('/authorize', async (c) => {
    const settings = requireSettings(c.env);
    const key = await sealKey(c.env);
    const origin = originOf(c.env, c.req.url);
    const query = new URL(c.req.url).searchParams;

    const clientId = query.get('client_id') ?? '';
    let client: ClientPayload;
    try {
      client = await unseal(key, clientId, 'client');
    } catch {
      return htmlResponse(
        errorPage({
          title: 'Unknown client',
          heading: 'That client is not registered',
          detail:
            'The client_id this request carried is not one this endpoint issued, or it has been altered. Ask your AI client to connect again.',
          siteUrl: settings.siteUrl
        }),
        400
      );
    }

    const requested = query.get('redirect_uri');
    const redirectUri =
      requested ?? (client.redirect_uris.length === 1 ? client.redirect_uris[0]! : null);
    if (!redirectUri || !client.redirect_uris.includes(redirectUri)) {
      return htmlResponse(
        errorPage({
          title: 'Bad redirect',
          heading: 'That redirect address is not registered',
          detail:
            'The redirect_uri must exactly match one the client registered. Nothing was sent anywhere.',
          siteUrl: settings.siteUrl
        }),
        400
      );
    }

    // Past this point the client and its redirect are trusted, so failures go
    // back to the client as RFC 6749 error redirects instead of an HTML page.
    const clientState = query.get('state') ?? undefined;
    const bounce = (error: string, description: string): Response => {
      const target = new URL(redirectUri);
      target.searchParams.set('error', error);
      target.searchParams.set('error_description', description);
      if (clientState !== undefined) target.searchParams.set('state', clientState);
      return redirectTo(target.toString());
    };

    if (query.get('response_type') !== 'code') {
      return bounce('unsupported_response_type', 'Only response_type=code is supported.');
    }
    const challenge = query.get('code_challenge') ?? '';
    if (query.get('code_challenge_method') !== 'S256' || !isValidCodeChallenge(challenge)) {
      return bounce('invalid_request', 'A PKCE code_challenge with code_challenge_method=S256 is required.');
    }
    const resource = query.get('resource');
    if (resource !== null && resource !== `${origin}/mcp` && resource !== `${origin}/mcp/readonly`) {
      return bounce('invalid_target', `This authorization server only issues tokens for ${origin}/mcp.`);
    }
    const scopes = (query.get('scope') ?? '').split(/\s+/);
    // Clients such as Claude request every advertised scope. Full store access
    // includes read access; only the readonly resource overrides that grant.
    const readonly =
      (scopes.includes(SCOPE_READONLY) && !scopes.includes(SCOPE_FULL)) ||
      resource === `${origin}/mcp/readonly`;

    const state = await seal(key, 'state', {
      t: 'state',
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      ...(clientState !== undefined ? { client_state: clientState } : {}),
      ...(resource !== null ? { resource } : {}),
      readonly,
      client_name: client.client_name,
      ttlSeconds: TTL.state
    });

    const githubAuthorize = new URL('/login/oauth/authorize', settings.oauthOrigin ?? 'https://github.com');
    githubAuthorize.searchParams.set('client_id', settings.clientId);
    githubAuthorize.searchParams.set('redirect_uri', `${origin}/callback`);
    githubAuthorize.searchParams.set('state', state);
    return redirectTo(githubAuthorize.toString());
  });

  // ---- GitHub comes back --------------------------------------------------

  app.get('/callback', async (c) => {
    const settings = requireSettings(c.env);
    const key = await sealKey(c.env);
    const origin = originOf(c.env, c.req.url);
    const query = new URL(c.req.url).searchParams;

    let state;
    try {
      state = await unseal(key, query.get('state') ?? '', 'state');
    } catch {
      return htmlResponse(
        errorPage({
          title: 'Sign-in expired',
          heading: 'That sign-in link has expired',
          detail:
            'Sign-in links are good for ten minutes and can only be used once. Start the connection again from your AI client.',
          siteUrl: settings.siteUrl
        }),
        400
      );
    }

    // Two ways in: the plain OAuth callback, and the App install flow, which
    // returns here with `installation_id` and `setup_action=install` and the very
    // same sealed state we put on the install URL.
    const code = query.get('code');
    if (!code) {
      const retry = new URL('/login/oauth/authorize', settings.oauthOrigin ?? 'https://github.com');
      retry.searchParams.set('client_id', settings.clientId);
      retry.searchParams.set('redirect_uri', `${origin}/callback`);
      retry.searchParams.set('state', query.get('state') ?? '');
      return htmlResponse(
        errorPage({
          title: 'One more step',
          heading: 'GitHub did not send an authorization',
          detail:
            'The app is installed, but it still needs your permission to act for you. This takes one click.',
          retryUrl: retry.toString(),
          retryLabel: 'Continue with GitHub',
          siteUrl: settings.siteUrl
        }),
        400
      );
    }

    const tokens = await exchangeCode(
      {
        clientId: settings.clientId,
        clientSecret: settings.clientSecret,
        code,
        redirectUri: `${origin}/callback`
      },
      settings.oauthOrigin
    ).catch(() => null);
    if (!tokens) {
      return htmlResponse(
        errorPage({
          title: 'Sign-in failed',
          heading: 'GitHub could not complete the sign-in',
          detail: 'The authorization GitHub sent back was rejected. Start the connection again from your AI client.',
          siteUrl: settings.siteUrl
        }),
        400
      );
    }

    const installations = await listInstallations(tokens.accessToken, settings.appId, settings.apiOrigin);
    if (installations.length === 0) {
      const freshState = await seal(key, 'state', { ...stateSeed(state), ttlSeconds: TTL.state });
      const installUrl = new URL(
        `/apps/${encodeURIComponent(settings.appSlug)}/installations/new`,
        settings.oauthOrigin ?? 'https://github.com'
      );
      installUrl.searchParams.set('state', freshState);
      return htmlResponse(
        installPage({ installUrl: installUrl.toString(), siteUrl: settings.siteUrl })
      );
    }

    const login =
      (await getViewerLogin(tokens.accessToken, settings.apiOrigin).catch(() => '')) ||
      (installations.find((i) => i.accountType === 'User')?.accountLogin ?? '');
    const repos = await collectRepos(tokens.accessToken, installations, settings);

    const personal = installations.find((i) => i.accountLogin === login) ?? installations[0]!;
    const pick = await seal(key, 'pick', {
      ...stateSeed(state),
      t: 'pick',
      gh_access: tokens.accessToken,
      ...(tokens.refreshToken ? { gh_refresh: tokens.refreshToken } : {}),
      ...(tokens.expiresAt ? { gh_exp: tokens.expiresAt } : {}),
      repos: repos.map(fullName),
      login: login || personal.accountLogin,
      installation_id: personal.id,
      ttlSeconds: TTL.pick
    });

    // Returning user: exactly one accessible repository that looks like a store.
    // We still never hand out a code without asking. Registration is open to any
    // client, so a crafted link could otherwise carry an already-authorized user
    // straight through to a token for a client they never chose.
    if (repos.length > 0 && repos.length <= RETURNING_USER_PROBE_LIMIT) {
      const stores: string[] = [];
      for (const repo of repos) {
        if (await hasContextFile(tokens.accessToken, repo.owner, repo.name, settings.apiOrigin)) {
          stores.push(fullName(repo));
          if (stores.length > 1) break;
        }
      }
      if (stores.length === 1) {
        return htmlResponse(
          confirmPage({
            pickToken: pick,
            repo: stores[0]!,
            readonly: state.readonly,
            siteUrl: settings.siteUrl,
            ...clientHint(state)
          })
        );
      }
    }

    return htmlResponse(
      setupPage({
        pickToken: pick,
        repos,
        defaultName: DEFAULT_STORE_NAME,
        siteUrl: settings.siteUrl,
        forcedReadonly: state.readonly,
        ...clientHint(state)
      })
    );
  });

  // ---- the returning user's one click ------------------------------------

  app.post('/callback/confirm', async (c) => {
    const settings = requireSettings(c.env);
    const key = await sealKey(c.env);
    const form = await formOf(c.req.raw);
    const pickToken = form.get('pick') ?? '';

    let pick: PickPayload;
    try {
      pick = await unseal(key, pickToken, 'pick');
    } catch {
      return htmlResponse(
        errorPage({
          title: 'Confirmation expired',
          heading: 'That confirmation page has expired',
          detail:
            'Confirmation pages are good for ten minutes. Nothing was connected. Start the connection again from your AI client.',
          siteUrl: settings.siteUrl
        }),
        400
      );
    }

    // "Use a different repository" drops the user into the full setup page, and a
    // repository that is not in the sealed list does the same with a message.
    const showSetup = (message?: string, status = 200): Response =>
      htmlResponse(
        setupPage({
          pickToken,
          repos: pick.repos.map(toRepoRef),
          defaultName: DEFAULT_STORE_NAME,
          siteUrl: settings.siteUrl,
          forcedReadonly: pick.readonly,
          ...clientHint(pick),
          ...(message ? { error: message } : {})
        }),
        status
      );

    if (form.get('action') === 'choose') return showSetup();

    const chosen = form.get('repo') ?? '';
    if (!pick.repos.includes(chosen)) {
      return showSetup('Choose one of the repositories the OpenStore app can reach.', 400);
    }

    return redirectWithCode(key, {
      state: pick,
      tokens: {
        accessToken: pick.gh_access,
        ...(pick.gh_refresh ? { refreshToken: pick.gh_refresh } : {}),
        ...(pick.gh_exp ? { expiresAt: pick.gh_exp } : {})
      },
      repo: chosen,
      readonly: pick.readonly
    });
  });

  // ---- the setup page's one form -----------------------------------------

  app.post('/callback/setup', async (c) => {
    const settings = requireSettings(c.env);
    const key = await sealKey(c.env);
    const form = await formOf(c.req.raw);

    let pick: PickPayload;
    try {
      pick = await unseal(key, form.get('pick') ?? '', 'pick');
    } catch {
      return htmlResponse(
        errorPage({
          title: 'Setup expired',
          heading: 'That setup page has expired',
          detail:
            'Setup pages are good for ten minutes. Nothing was created. Start the connection again from your AI client.',
          siteUrl: settings.siteUrl
        }),
        400
      );
    }

    const readonly = pick.readonly || form.get('readonly') === '1';
    const action = form.get('action') ?? 'create';
    const tokens = {
      accessToken: pick.gh_access,
      ...(pick.gh_refresh ? { refreshToken: pick.gh_refresh } : {}),
      ...(pick.gh_exp ? { expiresAt: pick.gh_exp } : {})
    };

    const rerender = (message: string, status = 400): Response =>
      htmlResponse(
        setupPage({
          pickToken: form.get('pick') ?? '',
          repos: pick.repos.map(toRepoRef),
          defaultName: form.get('name')?.trim() || DEFAULT_STORE_NAME,
          siteUrl: settings.siteUrl,
          forcedReadonly: pick.readonly,
          ...clientHint(pick),
          error: message
        }),
        status
      );

    if (action === 'existing') {
      const chosen = form.get('repo') ?? '';
      if (!pick.repos.includes(chosen)) {
        return rerender('Choose one of the repositories the OpenStore app can reach.');
      }
      return redirectWithCode(key, { state: pick, tokens, repo: chosen, readonly });
    }

    if (action === 'continue') {
      const created = pick.created ?? '';
      if (!created) return rerender('Nothing to continue. Create a store or pick an existing one.');
      return finishCreated(key, { settings, pick, tokens, repo: created, readonly, sleep, pollMs: 0 });
    }

    // action === 'create'
    const name = (form.get('name') ?? '').trim() || DEFAULT_STORE_NAME;
    if (!REPO_NAME.test(name) || name === '.' || name === '..') {
      return rerender('Repository names may use letters, numbers, dots, dashes and underscores.');
    }
    const owner = pick.login;
    if (!owner) {
      return rerender('GitHub did not say who you are. Start the connection again from your AI client.');
    }

    let created: RepoRef | null = null;
    try {
      created = await generateFromTemplate(
        pick.gh_access,
        {
          templateOwner: settings.templateOwner,
          templateRepo: settings.templateRepo,
          owner,
          name
        },
        settings.apiOrigin
      );
    } catch (error) {
      const status = error instanceof GitHubApiError ? error.status : 0;
      if (status === 422) {
        return rerender(
          `GitHub would not create ${owner}/${name}: ${
            error instanceof Error ? error.message : 'the name may already be taken'
          }`
        );
      }
      if (status === 403) {
        return rerender(
          'GitHub refused to create the repository. The OpenStore app needs "Administration: write" on your account to make one for you; you can also create it yourself and pick it under Advanced.'
        );
      }
      // The template repository is unreachable (404, or not marked as a template).
      // Documented fallback: an empty private repo seeded from the template's files.
      created = await createFromScratch(pick.gh_access, name, settings).catch(() => null);
      if (!created) {
        return rerender(
          'The OpenStore template could not be reached and the repository could not be created. Try again, or create a repository yourself and pick it under Advanced.'
        );
      }
    }

    if (!created) {
      return rerender('GitHub did not return the new repository. Try again in a moment.');
    }

    return finishCreated(key, {
      settings,
      pick,
      tokens,
      repo: fullName(created),
      readonly,
      sleep,
      pollMs: createPollMs
    });
  });

  // ---- token --------------------------------------------------------------

  app.post('/token', async (c) => {
    const settings = requireSettings(c.env);
    const key = await sealKey(c.env);
    const form = await formOf(c.req.raw);
    const grantType = form.get('grant_type') ?? '';

    if (grantType === 'authorization_code') {
      let code;
      try {
        code = await unseal(key, form.get('code') ?? '', 'code');
      } catch {
        return oauthError('invalid_grant', 'The authorization code is invalid or has expired.');
      }
      const clientId = form.get('client_id');
      if (clientId !== null && clientId !== code.client_id) {
        return oauthError('invalid_client', 'This code was issued to a different client.', 401);
      }
      const redirectUri = form.get('redirect_uri');
      if (redirectUri !== null && redirectUri !== code.redirect_uri) {
        return oauthError('invalid_grant', 'The redirect_uri does not match the one used to authorize.');
      }
      const verifier = form.get('code_verifier') ?? '';
      if (!(await verifyPkceS256(verifier, code.code_challenge))) {
        return oauthError('invalid_grant', 'The PKCE code_verifier does not match the code_challenge.');
      }
      return json(
        await issueTokens(key, {
          clientId: code.client_id,
          access: code.gh_access,
          ...(code.gh_refresh ? { refresh: code.gh_refresh } : {}),
          ...(code.gh_exp ? { ghExp: code.gh_exp } : {}),
          repo: code.repo,
          readonly: code.readonly
        })
      );
    }

    if (grantType === 'refresh_token') {
      let refresh;
      try {
        refresh = await unseal(key, form.get('refresh_token') ?? '', 'refresh');
      } catch {
        return oauthError('invalid_grant', 'The refresh token is invalid or has expired.');
      }
      const clientId = form.get('client_id');
      if (clientId !== null && clientId !== refresh.client_id) {
        return oauthError('invalid_client', 'This refresh token was issued to a different client.', 401);
      }
      let renewed;
      try {
        renewed = await refreshGitHubToken(
          {
            clientId: settings.clientId,
            clientSecret: settings.clientSecret,
            refreshToken: refresh.gh_refresh
          },
          settings.oauthOrigin
        );
      } catch {
        return oauthError('invalid_grant', 'GitHub would not renew this authorization. Sign in again.');
      }
      return json(
        await issueTokens(key, {
          clientId: refresh.client_id,
          access: renewed.accessToken,
          ...(renewed.refreshToken ? { refresh: renewed.refreshToken } : {}),
          ...(renewed.expiresAt ? { ghExp: renewed.expiresAt } : {}),
          repo: refresh.repo,
          readonly: refresh.readonly
        })
      );
    }

    return oauthError(
      'unsupported_grant_type',
      'Supported grant types are authorization_code and refresh_token.'
    );
  });

  // ---- the protected resource --------------------------------------------

  /** 401 with the exact challenge the MCP spec's discovery flow follows. */
  const unauthorized = (c: Context<AppEnv>): Response => {
    const origin = originOf(c.env, c.req.url);
    return json(
      {
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Unauthorized: a valid OpenStore bearer token is required' },
        id: null
      },
      401,
      {
        'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`
      }
    );
  };

  const mcpPost = async (c: Context<AppEnv>): Promise<Response> => {
    const key = await sealKey(c.env);
    const token = bearerOf(c.req.raw);
    if (!token) return unauthorized(c);
    let access;
    try {
      access = await unseal(key, token, 'access');
    } catch (error) {
      if (!(error instanceof SealError)) throw error;
      return unauthorized(c);
    }
    if (!access.repo.includes('/')) return unauthorized(c);

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(await c.req.raw.text());
    } catch {
      return rpcError(400, -32700, 'Parse error: Invalid JSON');
    }
    const rpc = rpcMethodOf(parsedBody);
    if (rpc) c.set('logRpc', rpc);

    const settings = tryReadSettings(c.env);
    return handleMcpRequest(c.req.raw, {
      access,
      forceReadonly: new URL(c.req.url).pathname === '/mcp/readonly',
      parsedBody,
      ...(settings?.apiOrigin ? { apiUrl: settings.apiOrigin } : {}),
      onTool: (tool) => c.set('logTool', tool)
    });
  };

  app.post('/mcp', mcpPost);
  app.post('/mcp/readonly', mcpPost);

  // Stateless mode has no server-initiated stream and no session to delete.
  for (const path of ['/mcp', '/mcp/readonly']) {
    app.get(path, () => methodNotAllowed());
    app.delete(path, () => methodNotAllowed());
  }

  app.notFound((c) => {
    const settings = tryReadSettings(c.env);
    if (new URL(c.req.url).pathname.startsWith('/mcp')) {
      return rpcError(404, -32601, 'Not found');
    }
    return htmlResponse(
      errorPage({
        title: 'Not found',
        heading: 'There is nothing here',
        detail: 'This endpoint only serves the OpenStore MCP connection and its sign-in flow.',
        ...(settings ? { siteUrl: settings.siteUrl } : {})
      }),
      404
    );
  });

  return app;
}

function methodNotAllowed(): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed: this endpoint is stateless and accepts POST only' },
      id: null
    }),
    { status: 405, headers: { 'content-type': 'application/json', allow: 'POST', ...noStore } }
  );
}

/** Thrown when the deployment is missing its GitHub App credentials. */
class ConfigProblem extends Error {}

function requireSettings(env: Env): Settings {
  try {
    return readSettings(env);
  } catch (error) {
    throw new ConfigProblem(error instanceof Error ? error.message : 'not configured');
  }
}

function tryReadSettings(env: Env): Settings | undefined {
  try {
    return readSettings(env);
  } catch {
    return undefined;
  }
}

/** The fields a `state` and a `pick` share, copied forward untouched. */
function stateSeed(state: {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  client_state?: string;
  resource?: string;
  readonly: boolean;
  client_name?: string;
}) {
  return {
    t: 'state' as const,
    client_id: state.client_id,
    redirect_uri: state.redirect_uri,
    code_challenge: state.code_challenge,
    ...(state.client_state !== undefined ? { client_state: state.client_state } : {}),
    ...(state.resource !== undefined ? { resource: state.resource } : {}),
    ...(state.client_name !== undefined ? { client_name: state.client_name } : {}),
    readonly: state.readonly
  };
}

/**
 * What the setup page says about who is asking. Dynamic registration means any
 * client can register, so naming the client and the host the token will be sent
 * to is the only chance a user gets to notice a connection they did not start.
 */
function clientHint(state: { client_name?: string; redirect_uri: string }): {
  clientName?: string;
  clientHost?: string;
} {
  const hint: { clientName?: string; clientHost?: string } = {};
  if (state.client_name) hint.clientName = state.client_name;
  try {
    const url = new URL(state.redirect_uri);
    hint.clientHost =
      url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
        ? 'this computer'
        : url.host;
  } catch {
    /* a redirect_uri that will not parse never got this far; say nothing */
  }
  return hint;
}

function toRepoRef(name: string): RepoRef {
  const slash = name.indexOf('/');
  return {
    id: 0,
    owner: name.slice(0, slash),
    name: name.slice(slash + 1),
    defaultBranch: null,
    private: true
  };
}

/** Every repository our installations grant, de-duplicated by full name. */
async function collectRepos(
  token: string,
  installations: Installation[],
  settings: Settings
): Promise<RepoRef[]> {
  const seen = new Map<string, RepoRef>();
  for (const installation of installations) {
    const repos = await listInstallationRepos(token, installation.id, settings.apiOrigin).catch(
      () => [] as RepoRef[]
    );
    for (const repo of repos) seen.set(fullName(repo), repo);
  }
  return [...seen.values()];
}

interface CodeArgs {
  state: {
    client_id: string;
    redirect_uri: string;
    code_challenge: string;
    client_state?: string;
  };
  tokens: { accessToken: string; refreshToken?: string; expiresAt?: number };
  repo: string;
  readonly: boolean;
}

/** Seals the authorization code and sends the browser back to the client. */
async function redirectWithCode(key: CryptoKey, args: CodeArgs): Promise<Response> {
  const code = await seal(key, 'code', {
    t: 'code',
    client_id: args.state.client_id,
    redirect_uri: args.state.redirect_uri,
    code_challenge: args.state.code_challenge,
    gh_access: args.tokens.accessToken,
    ...(args.tokens.refreshToken ? { gh_refresh: args.tokens.refreshToken } : {}),
    ...(args.tokens.expiresAt ? { gh_exp: args.tokens.expiresAt } : {}),
    repo: args.repo,
    readonly: args.readonly,
    ttlSeconds: TTL.code
  });
  const target = new URL(args.state.redirect_uri);
  target.searchParams.set('code', code);
  if (args.state.client_state !== undefined) {
    target.searchParams.set('state', args.state.client_state);
  }
  return redirectTo(target.toString());
}

interface IssueArgs {
  clientId: string;
  access: string;
  refresh?: string;
  ghExp?: number;
  repo: string;
  readonly: boolean;
}

async function issueTokens(key: CryptoKey, args: IssueArgs) {
  const now = nowSeconds();
  const expiresAt = Math.min(now + TTL.access, args.ghExp ?? Number.MAX_SAFE_INTEGER);
  const accessToken = await seal(key, 'access', {
    t: 'access',
    client_id: args.clientId,
    gh_access: args.access,
    repo: args.repo,
    readonly: args.readonly,
    expiresAt
  });
  const body: Record<string, unknown> = {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: Math.max(1, expiresAt - now),
    scope: scopeFor(args.readonly)
  };
  if (args.refresh) {
    body.refresh_token = await seal(key, 'refresh', {
      t: 'refresh',
      client_id: args.clientId,
      gh_refresh: args.refresh,
      repo: args.repo,
      readonly: args.readonly,
      ttlSeconds: TTL.refresh
    });
  }
  return body;
}

/**
 * Template generation is asynchronous: GitHub answers before the first commit
 * exists. Poll until the default branch resolves, then hand back the code.
 *
 * A `selected repositories` installation is the other reason the new repository
 * may stay invisible, and GitHub does not let a user-to-server token add one
 * (see `PUT /user/installations/{id}/repositories/{id}`, PAT-only), so that case
 * ends on a page that asks the user for the one click only they can make.
 */
async function finishCreated(
  key: CryptoKey,
  args: {
    settings: Settings;
    pick: PickPayload;
    tokens: { accessToken: string; refreshToken?: string; expiresAt?: number };
    repo: string;
    readonly: boolean;
    sleep: (ms: number) => Promise<void>;
    pollMs: number;
  }
): Promise<Response> {
  const slash = args.repo.indexOf('/');
  const owner = args.repo.slice(0, slash);
  const name = args.repo.slice(slash + 1);
  const deadline = Date.now() + args.pollMs;

  for (;;) {
    const repo = await getRepo(args.tokens.accessToken, owner, name, args.settings.apiOrigin).catch(
      () => null
    );
    if (repo?.defaultBranch) {
      return redirectWithCode(key, {
        state: args.pick,
        tokens: args.tokens,
        repo: args.repo,
        readonly: args.readonly
      });
    }
    if (Date.now() >= deadline) break;
    await args.sleep(Math.min(1000, Math.max(0, deadline - Date.now())));
  }

  const pickToken = await seal(key, 'pick', {
    t: 'pick',
    client_id: args.pick.client_id,
    redirect_uri: args.pick.redirect_uri,
    code_challenge: args.pick.code_challenge,
    ...(args.pick.client_state !== undefined ? { client_state: args.pick.client_state } : {}),
    ...(args.pick.resource !== undefined ? { resource: args.pick.resource } : {}),
    ...(args.pick.client_name !== undefined ? { client_name: args.pick.client_name } : {}),
    readonly: args.readonly,
    gh_access: args.tokens.accessToken,
    ...(args.tokens.refreshToken ? { gh_refresh: args.tokens.refreshToken } : {}),
    ...(args.tokens.expiresAt ? { gh_exp: args.tokens.expiresAt } : {}),
    repos: args.pick.repos,
    created: args.repo,
    login: args.pick.login,
    ...(args.pick.installation_id ? { installation_id: args.pick.installation_id } : {}),
    ttlSeconds: TTL.pick
  });

  const settingsUrl = args.pick.installation_id
    ? `https://github.com/settings/installations/${args.pick.installation_id}`
    : `https://github.com/settings/installations`;

  return htmlResponse(
    grantAccessPage({
      pickToken,
      repo: args.repo,
      settingsUrl,
      siteUrl: args.settings.siteUrl
    })
  );
}

/**
 * Fallback path, used only when the template repository cannot be generated
 * from: an empty private repository plus a single commit carrying the template's
 * text files, written through the same store code the tools use.
 */
async function createFromScratch(
  token: string,
  name: string,
  settings: Settings
): Promise<RepoRef | null> {
  const repo = await createUserRepo(token, { name }, settings.apiOrigin);
  if (!repo) return null;
  const files = await readTemplateFiles(
    token,
    settings.templateOwner,
    settings.templateRepo,
    settings.apiOrigin
  ).catch(() => []);
  if (files.length === 0) return repo;

  const store = new GitHubStore({
    owner: repo.owner,
    repo: repo.name,
    token,
    readOnly: false,
    client: 'hosted',
    ...(settings.apiOrigin ? { apiUrl: settings.apiOrigin } : {})
  });
  try {
    const head = await store.head();
    await store.commit({
      parent: head.commit,
      changes: files.map((file) => ({ path: file.path, content: file.content })),
      message: 'Seed store from the OpenStore template'
    });
  } catch (error) {
    // A seeded-but-empty store is still a working store; never fail the flow here.
    if (!(error instanceof ShellError)) throw error;
  }
  return repo;
}
