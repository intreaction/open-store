import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { utf8Length } from './bytes.js';
import type { Config } from './config.js';
import { ShellError } from './errors.js';
import { truncateOutput } from './limits.js';
import { argvFor, type CommandContext } from './commands/common.js';
import { READ_TOOLS, WRITE_TOOLS, type ToolDefinition } from './commands/index.js';
import { GitHubStore } from './store/github.js';
import { snapshot } from './store/view.js';
import type { Store } from './store/types.js';

export const SERVER_NAME = 'openstore';
export const SERVER_VERSION = '0.1.0';

export const DEFAULT_INSTRUCTIONS = [
  'This server is the user\'s OpenStore: a private GitHub repository of plain Markdown that holds',
  'durable facts about them. It is the only copy; nothing is cached anywhere else.',
  '',
  'Use the bash-like tools the way you would use a shell on a small notes folder:',
  '- Recall: grep -ril first, then cat the files it names. Never answer from memory about the user',
  '  when the store could say otherwise.',
  '- Remember: show the user the exact text you plan to write, then write only after they agree.',
  '  Update an existing file rather than adding a near-duplicate, and follow the folders already there.',
  '- Undo: git_log to find the commit, git_show to inspect it, git_revert to reverse it.',
  '',
  'Paths are repo-relative. Only text files are visible (.md .markdown .txt .yml .yaml .json .csv).',
  'Every write is exactly one commit on the branch. Never store secrets, passwords or tokens.'
].join('\n');

export interface ServerDeps {
  config: Config;
  /** Overridable for tests; the default builds a fresh GitHub store per call. */
  createStore?: () => Store;
  instructions?: string;
  /** Structured, content-free logging sink. */
  log?: (entry: LogEntry) => void;
}

export interface LogEntry {
  tool: string;
  exitCode: number;
  ms: number;
  inBytes: number;
  outBytes: number;
}

/** Never logs content, paths or the token: name, exit code, duration, sizes. */
export function formatLogEntry(entry: LogEntry): string {
  return `openstore ${entry.tool} exit=${entry.exitCode} ms=${entry.ms} in=${entry.inBytes}B out=${entry.outBytes}B`;
}

function toolResult(text: string, isError: boolean) {
  return {
    content: [{ type: 'text' as const, text }],
    ...(isError ? { isError: true } : {})
  };
}

export function createServer(deps: ServerDeps): McpServer {
  const { config } = deps;
  const createStore = deps.createStore ?? (() => new GitHubStore(config));
  const log = deps.log ?? (() => {});

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: deps.instructions ?? DEFAULT_INSTRUCTIONS }
  );

  const register = (tool: ToolDefinition) => {
    const inputSchema: Record<string, z.ZodType> = {
      args: tool.takesContent
        ? z.string().describe('Command line, parsed with bash quoting rules.')
        : z.string().optional().describe('Command line, parsed with bash quoting rules.')
    };
    if (tool.takesContent) {
      inputSchema.content = z.string().describe('Full text to write (or to append with -a).');
    }

    server.registerTool(
      tool.name,
      {
        title: tool.annotations.title,
        description: tool.description,
        inputSchema,
        annotations: tool.annotations
      },
      async (input: { args?: string; content?: string }) => {
        const started = Date.now();
        const inBytes =
          utf8Length(input.args ?? '') + utf8Length(input.content ?? '');
        let exitCode = 0;
        let text: string;
        try {
          const argv = argvFor(tool.name, input.args);
          const ctx: CommandContext = { store: createStore(), client: config.client };
          const result = await tool.run(ctx, argv, input.content);
          exitCode = result.exitCode;
          text = truncateOutput(result.stdout);
        } catch (error) {
          exitCode = error instanceof ShellError ? error.exitCode : 1;
          text = errorText(tool.name, error);
        }
        log({
          tool: tool.name,
          exitCode,
          ms: Date.now() - started,
          inBytes,
          outBytes: utf8Length(text)
        });
        return toolResult(text, exitCode !== 0);
      }
    );
  };

  for (const tool of READ_TOOLS) register(tool);
  if (!config.readOnly) {
    for (const tool of WRITE_TOOLS) register(tool);
  }

  return server;
}

function errorText(name: string, error: unknown): string {
  if (error instanceof ShellError) return `${error.message}\n`;
  const message = error instanceof Error ? error.message : String(error);
  return `${name}: ${message}\n`;
}

/**
 * The store's CONTEXT.md, used as the MCP `instructions` field. Falls back to a
 * short built-in explanation when the file is missing or unreachable.
 */
export async function loadInstructions(store: Store): Promise<string> {
  try {
    const { view } = await snapshot(store);
    const entry = view.file('CONTEXT.md');
    if (!entry) return DEFAULT_INSTRUCTIONS;
    const text = (await store.readBlob(entry.sha)).trim();
    return text.length > 0 ? text : DEFAULT_INSTRUCTIONS;
  } catch {
    return DEFAULT_INSTRUCTIONS;
  }
}
