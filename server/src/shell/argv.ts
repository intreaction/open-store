/**
 * Bash-quote tokenizer plus a small getopt-style flag parser.
 *
 * There is no real shell anywhere in OpenStore: this splits a single `args`
 * string the way bash would split a command line (single quotes, double quotes,
 * backslash escapes) and nothing else. No pipes, no redirection, no globbing,
 * no substitution.
 */

export class TokenizeError extends Error {}
export class FlagError extends Error {}

/** Splits `input` into argv using bash quoting rules. */
export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let started = false;
  let i = 0;

  const push = () => {
    if (started) {
      tokens.push(current);
      current = '';
      started = false;
    }
  };

  while (i < input.length) {
    const ch = input[i]!;

    if (ch === '\\') {
      const next = input[i + 1];
      if (next === undefined) {
        // A trailing backslash continues the line in bash; here it is literal.
        current += '\\';
        started = true;
        i += 1;
        continue;
      }
      if (next === '\n') {
        i += 2;
        continue;
      }
      current += next;
      started = true;
      i += 2;
      continue;
    }

    if (ch === "'") {
      started = true;
      i += 1;
      const end = input.indexOf("'", i);
      if (end === -1) {
        throw new TokenizeError("unexpected EOF while looking for matching `''");
      }
      current += input.slice(i, end);
      i = end + 1;
      continue;
    }

    if (ch === '"') {
      started = true;
      i += 1;
      let closed = false;
      while (i < input.length) {
        const c = input[i]!;
        if (c === '\\') {
          const next = input[i + 1];
          if (next === undefined) break;
          // Inside double quotes bash only honours these escapes.
          if (next === '"' || next === '\\' || next === '$' || next === '`') {
            current += next;
            i += 2;
            continue;
          }
          if (next === '\n') {
            i += 2;
            continue;
          }
          current += '\\';
          i += 1;
          continue;
        }
        if (c === '"') {
          closed = true;
          i += 1;
          break;
        }
        current += c;
        i += 1;
      }
      if (!closed) {
        throw new TokenizeError('unexpected EOF while looking for matching `"\'');
      }
      continue;
    }

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      push();
      i += 1;
      continue;
    }

    current += ch;
    started = true;
    i += 1;
  }

  push();
  return tokens;
}

export type FlagKind = 'bool' | 'value' | 'values';
export type FlagSpec = Record<string, FlagKind>;

export interface ParseOptions {
  /** Collect everything after `--` as a pathspec instead of positionals. */
  pathspec?: boolean;
  /** Accept bare numeric shorts (`-20`) and store them under this flag name. */
  numeric?: string;
}

export class Args {
  private readonly store: Map<string, boolean | string | string[]>;
  readonly positional: string[];
  readonly pathspec: string[];

  constructor(
    store: Map<string, boolean | string | string[]>,
    positional: string[],
    pathspec: string[]
  ) {
    this.store = store;
    this.positional = positional;
    this.pathspec = pathspec;
  }

  bool(...names: string[]): boolean {
    return names.some((n) => this.store.get(n) === true);
  }

  value(...names: string[]): string | undefined {
    for (const n of names) {
      const v = this.store.get(n);
      if (typeof v === 'string') return v;
    }
    return undefined;
  }

  list(...names: string[]): string[] {
    const out: string[] = [];
    for (const n of names) {
      const v = this.store.get(n);
      if (Array.isArray(v)) out.push(...v);
      else if (typeof v === 'string') out.push(v);
    }
    return out;
  }
}

/**
 * Parses argv against `spec`, producing bash-style errors for unknown flags and
 * missing arguments. Short flags cluster (`-la`, `-rn`) and long flags accept
 * both `--author=X` and `--author X`.
 */
export function parseFlags(argv: string[], spec: FlagSpec, options: ParseOptions = {}): Args {
  const store = new Map<string, boolean | string | string[]>();
  const positional: string[] = [];
  const pathspec: string[] = [];
  let afterDoubleDash = false;

  const set = (name: string, kind: FlagKind, value?: string) => {
    if (kind === 'bool') {
      store.set(name, true);
      return;
    }
    if (kind === 'value') {
      store.set(name, value!);
      return;
    }
    const existing = store.get(name);
    if (Array.isArray(existing)) existing.push(value!);
    else store.set(name, [value!]);
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;

    if (afterDoubleDash) {
      (options.pathspec ? pathspec : positional).push(token);
      continue;
    }

    if (token === '--') {
      afterDoubleDash = true;
      continue;
    }

    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      const name = eq === -1 ? token : token.slice(0, eq);
      const kind = spec[name];
      if (!kind) {
        throw new FlagError(`unrecognized option '${name}'`);
      }
      if (kind === 'bool') {
        if (eq !== -1) {
          throw new FlagError(`option '${name}' doesn't allow an argument`);
        }
        set(name, kind);
        continue;
      }
      let value: string | undefined;
      if (eq !== -1) {
        value = token.slice(eq + 1);
      } else {
        value = argv[i + 1];
        if (value === undefined) {
          throw new FlagError(`option '${name}' requires an argument`);
        }
        i += 1;
      }
      set(name, kind, value);
      continue;
    }

    if (token.length > 1 && token.startsWith('-')) {
      if (options.numeric && /^-\d+$/.test(token)) {
        store.set(options.numeric, token.slice(1));
        continue;
      }
      // Single-dash long options (`find -name`, `find -maxdepth`) match whole.
      const whole = spec[token];
      if (whole) {
        if (whole === 'bool') {
          set(token, whole);
          continue;
        }
        const next = argv[i + 1];
        if (next === undefined) {
          throw new FlagError(
            token.length === 2
              ? `option requires an argument -- '${token[1]}'`
              : `missing argument to '${token}'`
          );
        }
        set(token, whole, next);
        i += 1;
        continue;
      }
      let j = 1;
      while (j < token.length) {
        const letter = token[j]!;
        const name = `-${letter}`;
        const kind = spec[name];
        if (!kind) {
          throw new FlagError(`invalid option -- '${letter}'`);
        }
        if (kind === 'bool') {
          set(name, kind);
          j += 1;
          continue;
        }
        const inline = token.slice(j + 1);
        if (inline.length > 0) {
          set(name, kind, inline);
          j = token.length;
          break;
        }
        const next = argv[i + 1];
        if (next === undefined) {
          throw new FlagError(`option requires an argument -- '${letter}'`);
        }
        set(name, kind, next);
        i += 1;
        j = token.length;
      }
      continue;
    }

    positional.push(token);
  }

  return new Args(store, positional, pathspec);
}
