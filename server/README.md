# openstore-mcp

The OpenStore MCP server. It gives an AI bash-like tools over one branch of a private GitHub
repository of plain Markdown — the user's *store*.

**The repo is the only source of truth.** This server keeps nothing: no database, no cache, no disk
files, no state that outlives a single tool call. Every call resolves the branch head, fetches the
tree it needs, and forgets it. Every write is exactly one commit.

It runs two ways from the same code:

| Mode | Entry | Identity | Who it is for |
|---|---|---|---|
| **stdio** | `src/stdio.ts` → `dist/openstore.mjs` | env vars, your own token | developers and self-hosters |
| **hosted HTTP** | `src/worker.ts` (Cloudflare Workers) or `src/http-node.ts` (Node) | GitHub App, OAuth, sealed tokens | everyone else |

## Configure (stdio)

Environment only; `.env` files are never read and the token is never printed or logged.

| Variable | Required | Meaning |
|---|---|---|
| `OPENSTORE_REPO` | yes | `owner/name` of the store repository |
| `OPENSTORE_TOKEN` | yes | GitHub token with contents read/write on that one repo |
| `OPENSTORE_BRANCH` | no | branch to use (default: the repository's default branch) |
| `OPENSTORE_READONLY` | no | `1`/`true` registers only the read tools |
| `OPENSTORE_CLIENT` | no | label for the `OpenStore-Client:` commit trailer (default `openstore`) |
| `GITHUB_API_URL` | no | REST base URL, for GitHub Enterprise |

Run it: `node dist/openstore.mjs` (stdio transport). `serverInfo.name` is `openstore`, and the MCP
`instructions` field is the store's `CONTEXT.md` when that file exists.

## Tools

Every tool takes one `args` string, parsed with bash quoting rules (single quotes, double quotes,
backslash escapes). There is no shell: no pipes, no redirection, no substitution, no glob expansion
beyond the patterns a command implements itself. Output is plain text, exactly as a terminal would
show it; failures come back as MCP tool errors whose text is the bash-style message, e.g.
`cat: home/router.md: No such file or directory`.

Read tools (`readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`):

| Tool | Args | Output |
|---|---|---|
| `ls` | `[-l] [-a] [-R] [path...]` | names, directories with a trailing `/`; `-l` adds size and last-commit date |
| `find` | `[path] [-name P] [-iname P] [-type f\|d] [-maxdepth N]` | one path per line |
| `grep` | `[-r\|-R] [-i] [-n] [-l] [-c] [-w] [-F] [-e P] P [path...]` | `path:line:text`; `-l` lists paths; exit 1 with `grep: no matches` |
| `cat` | `[-n] path...` | file body |
| `head` / `tail` | `[-n N] path` (default 10) | bounded body |
| `tree` | `[path] [-L N]` | classic tree with the summary line |
| `git_log` | `[--oneline] [-n N \| -N] [--author=X] [--since=DATE] [-- path]` | default `--oneline -20` |
| `git_show` | `<sha> [-- path]` | commit header plus unified diffs |
| `git_diff` | `<sha1> [sha2] [-- path]` | unified diff; `sha2` defaults to the head |
| `pwd` | — | `/` plus `# store: owner/repo@branch (head 9f2c1a4)` |

Write tools (`readOnlyHint: false`; `rm` and `git_revert` are `destructiveHint: true`). Each call is
exactly one commit on the branch, built on the current head and pushed with a non-forced ref update.
If the branch moved underneath, the whole read-modify-commit cycle is retried up to three times and
then fails with `error: failed to push: branch advanced concurrently, retry`.

| Tool | Args | Output |
|---|---|---|
| `write` | `[-m MESSAGE] [-a] path` + `content` | `wrote technology/computers.md (+3 -1) @ 9f2c1a4` |
| `mv` | `[-m MESSAGE] src dst` | `renamed a.md -> b.md @ 9f2c1a4`; fails if the destination exists |
| `rm` | `[-m MESSAGE] [-r] path...` | `removed home/old.md @ 9f2c1a4`; a directory needs `-r` |
| `git_revert` | `[-m MESSAGE] <sha>` | `reverted 9f2c1a4 "Record Mac mini RAM" @ e51d0bf`; never rewrites history |

A `write` whose content already matches the file makes no commit. It prints
`wrote <path> (+0 -0) @ <head> (unchanged)`.

Default commit messages: `write <path>`, `mv <src> -> <dst>`, `rm <path>`,
`revert <shortsha>: <original subject>`. Every commit carries a trailer line
`OpenStore-Client: <label>`. The author is whoever the token belongs to.

## Rules the tools enforce

- **Repo-scoped.** Paths are repo-relative. `..`, absolute paths, `//`, backslashes and `~` are
  rejected with `Permission denied`.
- **Text only, and invisible rather than forbidden.** Only `.md .markdown .txt .yml .yaml .json .csv`
  exist as far as these tools are concerned; so do dot-files and dot-directories (`.git`, `.github`,
  `.claude`) not exist. They are never listed, read, written or diffed, and asking for one gives the
  same `No such file or directory` a missing file would. (`ls -a` is accepted for familiarity and
  changes nothing — a store has no visible dot-entries.)
- **Limits.** 128 KiB per file, 64 KiB per tool output (then
  `... (output truncated, N more lines)`), 5,000 visible files (`grep`/`find` then add
  `(search incomplete: file limit reached)`).
- **Logging.** One stderr line per call with the tool name, exit code, duration and byte counts.
  Never content, never paths, never the token.

## Develop

```
npm install
npm run typecheck     # tsc --noEmit
npm test              # vitest against the in-memory store
npm run build         # esbuild -> dist/openstore.mjs, copied to ../plugin/server/
npm run smoke         # live test against a real repo (writes one file, then reverts it)
```

Layout: `src/store/` (the `Store` interface, the GitHub Git Data API implementation, and an
in-memory fake with the same semantics), `src/shell/` (bash tokenizer, flag parser, path rules),
`src/commands/` (one module per tool, pure `(ctx, argv) -> {stdout, exitCode}`), `src/server.ts`
(MCP wiring), `src/oauth/` (sealed tokens, PKCE, the GitHub REST calls the login flow makes),
`src/http/` (the Hono app, the HTML pages, the `/mcp` handler), `src/stdio.ts` and `src/worker.ts` /
`src/http-node.ts` (the three entry points).

Everything outside `src/stdio.ts` and `src/http-node.ts` is free of `node:` imports and of `Buffer`
and `process`, so the same modules run on Cloudflare Workers with no compatibility flags. Byte and
base64 work goes through `src/bytes.ts`, which uses only `TextEncoder`, `TextDecoder`, `atob` and
`btoa`.

## Hosted HTTP mode

The hosted endpoint is an OAuth 2.1 authorization server *and* an MCP protected resource, with no
storage of any kind. Everything a request needs travels inside a **sealed token** the client holds:
AES-256-GCM (WebCrypto) over a JSON payload, written `os1.<base64url iv>.<base64url ciphertext>`.
The server holds one symmetric key (`OPENSTORE_SEAL_KEY`) and the GitHub App's client id and secret.

### Sealed token types

| `t` | Carries | Expires |
|---|---|---|
| `client` | `redirect_uris[]`, `client_name` | never (this is the `client_id`) |
| `state` | client id, redirect URI, code challenge, the client's own state, resource, readonly | 10 min |
| `pick` | everything in `state` + the GitHub token pair, the accessible repo list, the login | 10 min |
| `code` | client id, redirect URI, code challenge, GitHub token pair, repo, readonly | 5 min |
| `access` | client id, GitHub access token, repo, readonly | min(GitHub expiry, 8 h) |
| `refresh` | client id, GitHub refresh token, repo, readonly | 180 days |

`unseal` checks the type tag and the expiry inside the ciphertext and fails every way with one
generic error, so a wrong key, a wrong type, an expired token and a tampered one are
indistinguishable. An authorization code cannot be marked used without state, so replay inside its
five-minute window is prevented only by PKCE binding — the verifier never leaves the client. That is
an honest limitation of being stateless, not an oversight.

### Routes

| Route | What it does |
|---|---|
| `GET /` | small HTML page explaining the endpoint |
| `GET /.well-known/oauth-authorization-server[/mcp[/readonly]]` | issuer, endpoints, `S256`, `none` auth, scopes `store` and `store:readonly` |
| `GET /.well-known/oauth-protected-resource[/mcp[/readonly]]` | resource id and its authorization server |
| `POST /register` | RFC 7591 registration; `client_id` is a sealed `client` token, no secret. Redirect URIs must be https, or http on `localhost`, `127.0.0.1` or `[::1]`, with no credentials and no fragment, at most 512 characters each |
| `GET /authorize` | validates client, exact redirect URI, `S256` PKCE, and (RFC 8707) `resource`; redirects to GitHub with a sealed `state` |
| `GET /callback` | handles both the OAuth return and the App-install return (`installation_id`, `setup_action=install`, our preserved `state`) |
| `POST /callback/confirm` | the returning user's one click: issue the code for the store we found, or fall back to the full setup page |
| `POST /callback/setup` | the setup page's form: create from the template, or use an existing repo |
| `POST /token` | `authorization_code` (verifies PKCE) and `refresh_token` (renews through GitHub) |
| `POST /mcp`, `POST /mcp/readonly` | the MCP protected resource, stateless Streamable HTTP |
| `GET`/`DELETE` on `/mcp*` | `405`: stateless mode has no stream and no session to delete |

Every HTML page here is served `Cache-Control: no-store`, `Referrer-Policy: no-referrer`,
`X-Frame-Options: DENY` and `Content-Security-Policy: default-src 'none'` — the setup and confirmation
pages carry a sealed token in a hidden field and none of these pages contains a script. Both pages
name the client that is connecting and the host its code will go to. Every authorization code this
server issues passes through one of them, so no token is ever handed out without the user seeing who
asked for it.

Errors before the client and its redirect URI are trusted render an HTML page; after that they go
back to the client as RFC 6749 `error=` redirects. `/mcp` without a usable bearer answers `401` with
`WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource"`.
`/mcp/readonly` forces read-only regardless of what the token says.

### The sign-in flow

1. The client registers, then opens `/authorize`; we redirect to GitHub's App authorization.
2. GitHub returns to `/callback`. If the App is not installed anywhere for this user, we show an
   install page pointing at `https://github.com/apps/<slug>/installations/new?state=<sealed>` —
   GitHub preserves `state` across the install and sends the user straight back.
3. If exactly one accessible repository has a `CONTEXT.md` at its default branch root, that is the
   store, and instead of the setup page we show a confirmation page: it names the client and the host
   its code will go to, names the repository, says whether the access is read-only, and offers one
   button. Nothing is issued until that button is pressed. A link on it opens the full setup page.
4. Otherwise the setup page offers one button — **Create my OpenStore**, a private repo generated
   from `intreaction/openstore-template` — with an `Advanced` section for picking an existing
   repository and for read-only access.
5. Template generation is asynchronous, so we poll (about ten seconds) until the new repository's
   default branch resolves, then hand the client its authorization code.

**One GitHub limitation to know about.** `PUT /user/installations/{id}/repositories/{repo_id}`
("Add a repository to an app installation") does *not* work with GitHub App user access tokens —
GitHub documents it as classic-PAT-only. So when an installation is scoped to *selected*
repositories and the new repo does not appear, we cannot add it for the user. The flow ends on a
short page linking to `https://github.com/settings/installations/<id>` with a "continue" button that
re-checks. Installations scoped to *all repositories* never see this page.

### GitHub App permissions

Confirmed against GitHub's REST documentation:

| Endpoint | Available to user access tokens? | Permission |
|---|---|---|
| `POST /repos/{owner}/{repo}/generate` | yes | Administration (write) + Contents (read) |
| `POST /user/repos` (fallback) | yes | Administration (write) |
| `GET /user/installations` | yes | — |
| `GET /user/installations/{id}/repositories` | yes | — |
| `PUT /user/installations/{id}/repositories/{repo_id}` | **no** (classic PAT only) | — |

Plus **Contents: read and write** and **Metadata: read** for the tools themselves. Register the App
with "Request user authorization (OAuth) during installation" and "Expire user authorization tokens"
both on; see `docs/github-app-setup.md`.

### Configure (hosted)

Secrets, set with `wrangler secret put NAME`:

| Secret | Meaning |
|---|---|
| `GITHUB_CLIENT_ID` | the GitHub App's client id |
| `GITHUB_CLIENT_SECRET` | the GitHub App's client secret |
| `OPENSTORE_SEAL_KEY` | 32 bytes, base64 — `npm run gen:seal-key`. Rotating it logs everyone out |

Vars, in `wrangler.toml`: `GITHUB_APP_SLUG`, `GITHUB_APP_ID`, `PUBLIC_SITE_URL`,
`OPENSTORE_TEMPLATE_REPO`, and optionally `PUBLIC_BASE_URL` to pin the advertised issuer.

`GITHUB_APP_ID` is **required**. It is the only thing that tells our installations apart from every
other GitHub App a user has installed, so the server fails closed: while it is unset, `/authorize`,
`/callback`, `/callback/confirm`, `/callback/setup` and `/token` answer "not configured". Discovery and `/mcp` still work,
so `scripts/seal-dev-token.ts` can exercise the tools locally without a registered App.
`wrangler.toml` has **no bindings of any kind** — no KV, no D1, no Durable Object, no R2, no queue —
which is the point: there is nowhere to put anything.

Copy `.dev.vars.example` to `.dev.vars` (git-ignored) for local `wrangler dev`. Keep
`PUBLIC_BASE_URL=http://localhost:8787` in that file: it overrides the production origin in
`wrangler.toml`, so local discovery and GitHub redirects stay on localhost.

### Run it

```
npm run dev           # wrangler dev on :8787 (the real Workers runtime)
npm run dev:node      # the same Hono app on Node, no wrangler needed
npm run deploy        # wrangler deploy
npm run gen:seal-key  # print a fresh OPENSTORE_SEAL_KEY
```

Exercise `/mcp` locally without a registered GitHub App:

```
export OPENSTORE_SEAL_KEY=$(npm run --silent gen:seal-key)
export OPENSTORE_REPO=you/my-openstore
export OPENSTORE_TOKEN=$(gh auth token)
TOKEN=$(npm run --silent seal:dev-token)
curl -s http://localhost:8787/mcp \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

The script never prints the GitHub token — but the sealed token it does print reaches your store, so
treat it as a password.

### Logging

Local diagnostics emit route, method, status, duration, byte count, and for `/mcp` the JSON-RPC
method and tool name. They must never contain tokens, query strings, repository paths, or content.
Production `wrangler.toml` disables Cloudflare observability entirely: automatic invocation logs
include full URLs, so leaving them enabled would retain OAuth codes and sealed state even if
application log lines were sanitized. Do not enable request logging, tracing, or log export on the
hosted endpoint without revisiting the privacy guarantee.

Licensed Apache-2.0.
