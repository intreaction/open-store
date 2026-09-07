import { ShellError } from '../src/errors.js';
import { argvFor, type CommandResult } from '../src/commands/common.js';
import { toolByName } from '../src/commands/index.js';
import { MemoryStore } from '../src/store/memory.js';

export const FIXTURE: Record<string, string> = {
  'CONTEXT.md': '# Store context\n\nSearch before you answer. Update rather than duplicate.\n',
  'README.md': '# my-openstore\n\nA store you own.\n',
  'profile/about.md': '# John Wheeler\n\nGitHub: intreaction\nBuilds OpenStore.\n',
  'home/network.md': '# Network\n\nGateway: UDM Pro Max\nReplaced an Amplifi Alien.\n',
  'technology/computers.md': '# Computers\n\nMac mini (M4, 24 GB RAM).\n',
  'projects/open-store.md': '# OpenStore\n\nStatus: v0.1 in progress.\n',
  // Never visible: wrong type, and a dot-directory.
  'notes.pdf': '%PDF-1.7 binary-ish',
  '.github/workflows/ci.yml': 'name: ci\n'
};

export function makeStore(files: Record<string, string> = FIXTURE): MemoryStore {
  const store = new MemoryStore();
  store.seed(files, 'seed store');
  return store;
}

/**
 * Runs a whole command line ("grep -n gateway home") the way the server does:
 * tokenize, dispatch, and turn a ShellError back into the `{stdout, exitCode}`
 * a shell would produce.
 */
export async function run(
  store: MemoryStore,
  line: string,
  content?: string
): Promise<CommandResult> {
  const space = line.indexOf(' ');
  const name = space === -1 ? line : line.slice(0, space);
  const args = space === -1 ? '' : line.slice(space + 1);
  const tool = toolByName(name);
  if (!tool) throw new Error(`unknown tool ${name}`);
  try {
    const argv = argvFor(name, args);
    return await tool.run({ store, client: 'openstore-test' }, argv, content);
  } catch (error) {
    if (error instanceof ShellError) {
      return { stdout: `${error.message}\n`, exitCode: error.exitCode };
    }
    throw error;
  }
}

/** Convenience: the stdout of a call that must succeed. */
export async function out(
  store: MemoryStore,
  line: string,
  content?: string
): Promise<string> {
  const result = await run(store, line, content);
  if (result.exitCode !== 0) {
    throw new Error(`${line} failed: ${result.stdout}`);
  }
  return result.stdout;
}
