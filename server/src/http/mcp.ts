/**
 * `POST /mcp` and `POST /mcp/readonly`: the protected resource.
 *
 * Stateless in the strict sense. Every request builds a fresh `McpServer` and a
 * fresh transport, runs one JSON-RPC exchange and throws both away. Nothing —
 * not a session, not a store, not a token — survives the response.
 */
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Config } from '../config.js';
import { createServer, loadInstructions } from '../server.js';
import { GitHubStore } from '../store/github.js';
import type { AccessPayload } from '../oauth/seal.js';

/** The SDK's JSON responses carry only a content type; the whole app pins no-store. */
const noStore = { 'cache-control': 'no-store', pragma: 'no-cache' } as const;

export interface McpRequestOptions {
  access: AccessPayload;
  /** True for `/mcp/readonly`, which forces read-only regardless of the token. */
  forceReadonly: boolean;
  /** Pre-parsed JSON body, so the route can inspect the method before handing it over. */
  parsedBody: unknown;
  apiUrl?: string;
  /** Receives the tool name a tool call used, for metadata-only logging. */
  onTool?: (tool: string) => void;
}

/**
 * The JSON-RPC method of a request body, for logging and for the instructions
 * fetch. Only the protocol's own method names are ever returned — the
 * `mcp.protocol` field in the trace is a fixed vocabulary, so an arbitrary
 * client-supplied string cannot be logged.
 */
export function rpcMethodOf(body: unknown): string | undefined {
  const first = Array.isArray(body) ? body[0] : body;
  if (typeof first === 'object' && first !== null && 'method' in first) {
    if (typeof first.method === 'string') return RPC_METHODS[first.method];
  }
  return undefined;
}

const RPC_METHODS: Readonly<Record<string, string>> = {
  initialize: 'initialize',
  ping: 'ping',
  'notifications/initialized': 'notifications/initialized',
  'notifications/cancelled': 'notifications/cancelled',
  'notifications/progress': 'notifications/progress',
  'notifications/roots/list_changed': 'notifications/roots/list_changed',
  'resources/list': 'resources/list',
  'resources/templates/list': 'resources/templates/list',
  'resources/read': 'resources/read',
  'prompts/list': 'prompts/list',
  'prompts/get': 'prompts/get',
  'tools/list': 'tools/list',
  'tools/call': 'tools/call',
  'logging/setLevel': 'logging/setLevel',
  'completion/complete': 'completion/complete'
};

export function configFor(options: McpRequestOptions): Config {
  const { access } = options;
  const slash = access.repo.indexOf('/');
  const config: Config = {
    owner: access.repo.slice(0, slash),
    repo: access.repo.slice(slash + 1),
    token: access.gh_access,
    readOnly: access.readonly || options.forceReadonly,
    client: 'hosted'
  };
  if (options.apiUrl) config.apiUrl = options.apiUrl;
  return config;
}

export async function handleMcpRequest(
  request: Request,
  options: McpRequestOptions
): Promise<Response> {
  const config = configFor(options);

  // The store's CONTEXT.md becomes the MCP `instructions`. Fetched only on
  // `initialize`, so ordinary tool calls cost exactly the calls they make.
  const instructions =
    rpcMethodOf(options.parsedBody) === 'initialize'
      ? await loadInstructions(new GitHubStore(config))
      : undefined;

  const server = createServer({
    config,
    ...(instructions ? { instructions } : {}),
    log: (entry) => options.onTool?.(entry.tool)
  });

  const transport = new WebStandardStreamableHTTPServerTransport({
    // Stateless: no session id is generated, none is expected back.
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });

  try {
    await server.connect(transport);
    // `enableJsonResponse` means the returned Response is fully materialised, so
    // tearing the transport down immediately afterwards is safe. The SDK's
    // response carries only a content type, so the store's private content gets
    // the same no-store pin as every other response this server makes.
    const response = await transport.handleRequest(request, { parsedBody: options.parsedBody });
    return new Response(response.body, {
      status: response.status,
      headers: { ...Object.fromEntries(response.headers.entries()), ...noStore }
    });
  } finally {
    await server.close().catch(() => {});
  }
}
