/**
 * Metadata-only logging. There is exactly one function that can emit a log line
 * and it takes a fixed set of numeric and enumerated fields, so no token, no
 * content, no path inside a store and no query string can reach a log by accident.
 */

export interface RequestLogEntry {
  /** Route path only. Never a query string: `/callback` carries a code and a state. */
  route: string;
  method: string;
  status: number;
  ms: number;
  /** Response body size in bytes, when known. */
  bytes?: number;
  /** MCP tool name, for `/mcp` requests. */
  tool?: string;
  /** MCP JSON-RPC method, for `/mcp` requests. */
  rpc?: string;
}

export type LogSink = (entry: RequestLogEntry) => void;

export function formatRequestLog(entry: RequestLogEntry): string {
  const parts = [
    'openstore',
    `${entry.method} ${entry.route}`,
    `status=${entry.status}`,
    `ms=${entry.ms}`
  ];
  if (typeof entry.bytes === 'number') parts.push(`bytes=${entry.bytes}`);
  if (entry.rpc) parts.push(`rpc=${entry.rpc}`);
  if (entry.tool) parts.push(`tool=${entry.tool}`);
  return parts.join(' ');
}

export const consoleLog: LogSink = (entry) => {
  console.log(formatRequestLog(entry));
};

export const silentLog: LogSink = () => {};
