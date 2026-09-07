/**
 * A bash-style failure. The message is printed verbatim, exactly as a shell
 * would print it to stderr (e.g. `cat: home/router.md: No such file or directory`).
 */
export class ShellError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = 'ShellError';
    this.exitCode = exitCode;
  }
}

/** The branch ref moved while we were building a commit. */
export class RefConflictError extends Error {
  constructor(message = 'ref moved') {
    super(message);
    this.name = 'RefConflictError';
  }
}
