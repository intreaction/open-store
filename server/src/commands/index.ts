import type { CommandRun } from './common.js';
import { cat } from './cat.js';
import { find } from './find.js';
import { gitDiff } from './gitDiff.js';
import { gitLog } from './gitLog.js';
import { gitRevert } from './gitRevert.js';
import { gitShow } from './gitShow.js';
import { grep } from './grep.js';
import { head } from './head.js';
import { ls } from './ls.js';
import { mv } from './mv.js';
import { pwd } from './pwd.js';
import { rm } from './rm.js';
import { tail } from './tail.js';
import { tree } from './tree.js';
import { write } from './write.js';

export interface ToolAnnotationSet {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** Write tools also take a `content` string. */
  takesContent: boolean;
  readOnly: boolean;
  annotations: ToolAnnotationSet;
  run: CommandRun;
}

const read = (title: string): ToolAnnotationSet => ({
  title,
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
});

const mutate = (title: string, destructive: boolean): ToolAnnotationSet => ({
  title,
  readOnlyHint: false,
  destructiveHint: destructive,
  idempotentHint: false,
  openWorldHint: false
});

const STORE_NOTE =
  'Paths are repo-relative (no leading /, no ..). Only text files are visible: ' +
  '.md .markdown .txt .yml .yaml .json .csv; anything else does not exist as far as these tools ' +
  'are concerned. Arguments are parsed with bash quoting rules; there is no shell, no pipes and no globs.';

export const READ_TOOLS: ToolDefinition[] = [
  {
    name: 'pwd',
    description: `Print the store root and which repository, branch and commit it points at. Takes no arguments. ${STORE_NOTE}`,
    takesContent: false,
    readOnly: true,
    annotations: read('Print store location'),
    run: pwd
  },
  {
    name: 'ls',
    description: `List store entries. args: [-l] [-a] [-R] [path...] (default "."). -l adds size and the last-commit date. ${STORE_NOTE}`,
    takesContent: false,
    readOnly: true,
    annotations: read('List files'),
    run: ls
  },
  {
    name: 'find',
    description: `Find paths by name. args: [path] [-name PATTERN] [-iname PATTERN] [-type f|d] [-maxdepth N]. Patterns are globs matched against the file name. ${STORE_NOTE}`,
    takesContent: false,
    readOnly: true,
    annotations: read('Find paths'),
    run: find
  },
  {
    name: 'grep',
    description: `Search file contents. args: [-r|-R] [-i] [-n] [-l] [-c] [-w] [-F] [-e PATTERN] PATTERN [path...]. Patterns are fixed strings, directories are searched recursively, and output is path:line:text. Start every recall here. ${STORE_NOTE}`,
    takesContent: false,
    readOnly: true,
    annotations: read('Search contents'),
    run: grep
  },
  {
    name: 'cat',
    description: `Print whole files. args: [-n] path... ${STORE_NOTE}`,
    takesContent: false,
    readOnly: true,
    annotations: read('Print file'),
    run: cat
  },
  {
    name: 'head',
    description: `Print the first lines of a file. args: [-n N] path (default 10). ${STORE_NOTE}`,
    takesContent: false,
    readOnly: true,
    annotations: read('Print first lines'),
    run: head
  },
  {
    name: 'tail',
    description: `Print the last lines of a file. args: [-n N] path (default 10). ${STORE_NOTE}`,
    takesContent: false,
    readOnly: true,
    annotations: read('Print last lines'),
    run: tail
  },
  {
    name: 'tree',
    description: `Show the store layout. args: [path] [-L N]. ${STORE_NOTE}`,
    takesContent: false,
    readOnly: true,
    annotations: read('Show tree'),
    run: tree
  },
  {
    name: 'git_log',
    description: `Show commit history. args: [--oneline] [-n N | -N] [--author=X] [--since=DATE] [-- path] (default --oneline -20). ${STORE_NOTE}`,
    takesContent: false,
    readOnly: true,
    annotations: read('Show history'),
    run: gitLog
  },
  {
    name: 'git_show',
    description: `Show one commit: header plus the diff of its text files. args: <sha> [-- path]. ${STORE_NOTE}`,
    takesContent: false,
    readOnly: true,
    annotations: read('Show commit'),
    run: gitShow
  },
  {
    name: 'git_diff',
    description: `Diff two commits. args: <sha1> [sha2] [-- path]; sha2 defaults to the branch head. ${STORE_NOTE}`,
    takesContent: false,
    readOnly: true,
    annotations: read('Diff commits'),
    run: gitDiff
  }
];

export const WRITE_TOOLS: ToolDefinition[] = [
  {
    name: 'write',
    description:
      `Create or replace a file in one commit; -a appends instead. args: [-m MESSAGE] [-a] path, plus the full file body in "content". ` +
      `Parent folders are created implicitly. Max file size 128 KiB. Show the user the exact change and get their agreement first. ${STORE_NOTE}`,
    takesContent: true,
    readOnly: false,
    annotations: mutate('Write file', false),
    run: write
  },
  {
    name: 'mv',
    description: `Rename a file or a directory in one commit; fails if the destination exists. args: [-m MESSAGE] src dst. ${STORE_NOTE}`,
    takesContent: false,
    readOnly: false,
    annotations: mutate('Rename path', false),
    run: mv
  },
  {
    name: 'rm',
    description: `Delete files in one commit. args: [-m MESSAGE] [-r] path... A directory needs -r. The content stays in git history. ${STORE_NOTE}`,
    takesContent: false,
    readOnly: false,
    annotations: mutate('Remove path', true),
    run: rm
  },
  {
    name: 'git_revert',
    description:
      `Undo a commit with a new commit that reverses it; history is never rewritten. args: [-m MESSAGE] <sha>. ` +
      `Fails if those files changed again afterwards. ${STORE_NOTE}`,
    takesContent: false,
    readOnly: false,
    annotations: mutate('Revert commit', true),
    run: gitRevert
  }
];

export const ALL_TOOLS: ToolDefinition[] = [...READ_TOOLS, ...WRITE_TOOLS];

export function toolByName(name: string): ToolDefinition | undefined {
  return ALL_TOOLS.find((tool) => tool.name === name);
}
