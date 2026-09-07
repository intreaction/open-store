# OpenStore

OpenStore gives any AI a durable memory that you own: a private GitHub repository of plain Markdown
that the AI reads and writes over MCP using bash-like tools (`grep`, `cat`, `tree`, `write`,
`git_log`, `git_revert`, and the rest). There is no database, no cache, and no second copy. The repo
is the only source of truth, every change is an ordinary Git commit you can read, diff, and revert,
and if you disconnect the AI tomorrow you are left holding a folder of Markdown that is still
perfectly useful on its own.

> **Your AI's memory is a Git repo you own. OpenStore never holds a copy.**

The hosted server is a stateless pass-through: content and credentials live in process memory for
the length of one request and are never written anywhere. Its deployment config has no storage
binding of any kind — no KV, no D1, no Durable Object, no R2, no queue. Cloudflare's persisted
logs and traces are disabled: automatic invocation logs would otherwise retain OAuth URLs.
Local diagnostics contain only request metadata, never content. An operator *could* read traffic
in flight, as any pass-through could; self-hosting removes that operator from the path.

## Quick start

**1. Add OpenStore to Claude Code.**

```
claude plugin marketplace add intreaction/open-store
claude plugin install openstore@openstore
```

**2. Run `/mcp`, pick `openstore`, and sign in.** Claude Code opens your browser and starts the
standard MCP OAuth flow against the hosted endpoint. You sign in with GitHub through the OpenStore
GitHub App — no token to create, copy, or paste. If the App is not on your account yet, GitHub's
install page appears first and returns you to the flow.

**3. Let OpenStore make your store.** One setup page appears with a name prefilled as
`my-openstore` and one button. Press it and OpenStore creates that private repository in your
account from the public template
[`intreaction/openstore-template`](https://github.com/intreaction/openstore-template). Under
*Advanced* you can instead pick an existing repository the App can see, and tick *read-only* if you
want the AI to be able to read the store but never write to it. Come back later and OpenStore
recognizes your store and skips this page entirely.

**4. Talk.** Ask Claude "what do you know about my Mac mini?" and watch it `grep` the store. Tell it
"remember that I switched to a UDM Pro Max" and it will show you the exact text first, write one
commit after you agree, and report the short sha. `git log` in your store repo shows every change,
each carrying an `OpenStore-Client:` trailer. Undo anything with `git_revert <sha>`, which adds a
new commit; history is never rewritten and the branch is never force-pushed.

Claude.ai (Settings → Connectors → Add custom connector) and ChatGPT (Settings → Apps → Developer
mode → Create app) take the same MCP URL and run the same sign-in.

Run `/mcp` inside Claude Code to inspect `plugin:openstore:openstore` and manage its authentication.
Plugin-provided servers do not appear in the standalone `claude mcp login` command's server list.

## Developer / self-host: the stdio path

The server also runs locally over stdio, configured entirely from environment variables and a
GitHub token you supply yourself. There is no operator at all on this path: the server runs on your
machine and talks only to GitHub. This is the way to hack on the tools, and the way to use
OpenStore without trusting anyone's hosted endpoint.

```
cd server && npm install && npm test && npm run build   # writes plugin/server/openstore.mjs
export OPENSTORE_REPO=you/my-openstore
export OPENSTORE_TOKEN=$(gh auth token)                 # or a fine-grained PAT, Contents: read/write
node plugin/server/openstore.mjs                        # speaks MCP on stdio
```

`OPENSTORE_BRANCH`, `OPENSTORE_READONLY`, `OPENSTORE_CLIENT`, and `GITHUB_API_URL` are the
remaining knobs. Full details, plus how to run the hosted endpoint locally and how to deploy your
own copy, are in [`server/README.md`](server/README.md), [`docs/deploy.md`](docs/deploy.md), and
[`docs/github-app-setup.md`](docs/github-app-setup.md).

To start a store by hand rather than through the sign-in flow, use the template repository's
**Use this template** button, or copy [`template/`](template/) into a fresh private repo.

## Repository layout

| Path | What it is |
| --- | --- |
| `concept.md` | Why OpenStore exists and what it is not |
| `architecture.md` | Components, per-call data flow, concurrency, trust boundaries |
| `design.md` | The full tool contract, output formats, consent model, limits |
| `plan.md` | Phases, decisions, risks |
| `docs/github-app-setup.md` | Exact settings for registering the OpenStore GitHub App |
| `docs/deploy.md` | Deploying the Worker, setting secrets, enabling Pages, smoke checks |
| `server/` | The `openstore-mcp` server: bash-like tools, the stdio entry, and the hosted endpoint (sealed-token OAuth, `/mcp`, `/mcp/readonly`) on Cloudflare Workers |
| `plugin/` | The Claude Code plugin: manifest, hosted HTTP `.mcp.json`, the `openstore` skill, and the stdio bundle for self-hosting |
| `.claude-plugin/marketplace.json` | Marketplace entry pointing at `./plugin` |
| `site/` | The GitHub Pages landing page (HTML + CSS with a clipboard helper), deployed by `.github/workflows/pages.yml` |
| `template/` | The contents of a fresh store; published as `intreaction/openstore-template` |

## Status

Hosted plugin v0.3.0, September 6, 2026.

**Phase 0 (stdio server, plugin, template, personal store) is done and in daily use:** 15 tools, an
esbuild single-file bundle, and a smoke test that writes and reverts against a real repository. The
suite covers the tools, the sealed-token scheme, the OAuth flow, and the hosted `/mcp` handler,
including adversarial tests for token type confusion, redirect validation, read-only downgrade,
and HTML injection.

**The hosted endpoint is live at `https://mcp.openstore.sh/mcp`.** The public GitHub App is
[`OpenStore MCP`](https://github.com/apps/openstore-mcp), with no application storage bindings and
Cloudflare persisted logs/traces disabled. Claude Code completed real GitHub OAuth, installed the
App on a selected private repository, and created, read, and deleted a temporary Markdown file
through the hosted MCP tools. The default connection supports both reading and writing.
The in-flow setup also created a new private repository from the template and connected Claude
Code to it, without a token or repository URL supplied by the user.

The source is published at [`intreaction/open-store`](https://github.com/intreaction/open-store);
the plugin uses HTTP OAuth without environment variables. The local stdio path remains available
for self-hosting. Deployment and App settings are documented in [`docs/deploy.md`](docs/deploy.md)
and [`docs/github-app-setup.md`](docs/github-app-setup.md).

**Still unverified:** real Claude.ai and ChatGPT connector logins. Both require signed-in accounts
with custom connector access; Claude Code verification does not establish their compatibility.

Formerly explored under the names ContextDB and MeDB.

## License

Apache-2.0. See [LICENSE](LICENSE).
