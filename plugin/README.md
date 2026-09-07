# OpenStore plugin

A Claude Code plugin that gives Claude a durable, user-owned memory: your private GitHub
repository of plain Markdown, read and written through bash-like MCP tools (`ls`, `grep`, `cat`,
`write`, `git_log`, `git_revert`, ...). See `skills/openstore/SKILL.md` for how Claude is
expected to use it, and the project root's `design.md` for the full tool contract.

## How it works

`.mcp.json` points Claude Code at the hosted endpoint over HTTP. There is nothing to run locally
and no environment variables or GitHub tokens to configure:

```json
{
  "mcpServers": {
    "openstore": {
      "type": "http",
      "url": "https://mcp.openstore.sh/mcp"
    }
  }
}
```

The endpoint lives at `mcp.openstore.sh`, a custom domain on the Cloudflare Worker (see
`docs/deploy.md` at the project root). Nothing else in this file changes based on deployment.

Authentication is the standard MCP OAuth flow, handled by Claude Code itself: no token ever goes
in this file, in an environment variable, or in chat.

## Install and connect

1. **Add the marketplace and install the plugin:**
   ```
   claude plugin marketplace add intreaction/open-store
   claude plugin install openstore@openstore
   ```
2. **Run `/mcp`** inside Claude Code. `openstore` shows up needing authentication.
3. **Select it and authenticate.** Your browser opens to OpenStore's hosted endpoint.
4. **Sign in with GitHub.** OpenStore's GitHub App handles the login — you never see or paste a
   token. If you haven't installed the GitHub App yet, you'll be sent to GitHub's install page
   first; approve it and you're brought back automatically.
5. **Set up your store, once.** OpenStore shows one page:
   - **Create your OpenStore** (the default) — creates a new private repo named
     `my-openstore` from the public template and you're done, or
   - **Advanced** — pick an existing repository from the ones the GitHub App can see, and
     optionally check "read-only access" if you only want Claude to look, never write.

   Returning users who already have exactly one store repo don't see this page. They get a
   short confirmation instead, naming the client that is connecting and the repo it will
   reach, with one button. Nothing is issued until you press it.
6. **Talk.** Ask Claude to remember something, or ask what it knows — it reads and writes your
   store repo directly. Every write is a real commit you can see, diff, and revert on GitHub.

There is no personal access token anywhere in this flow. Claude Code stores the session
credential it receives from the OAuth exchange; OpenStore's server itself keeps nothing — see the
trust statement in the project's `README.md`.

### Re-authenticating or switching stores

- `claude mcp get openstore` shows connection status.
- `claude mcp logout openstore` clears the stored credential; running `/mcp` again re-triggers
  sign-in.
- To point at a different repo (e.g. switch from your default store to an existing one under
  Advanced), log out and sign in again — the setup page reappears whenever you have more than one
  eligible repo, or you can revoke the GitHub App's installation on a repo to remove it from the
  list.

### Read-only access

Check "read-only access" on the setup page (or ask an admin to configure it for a shared store)
to register only the read tools (`ls`, `find`, `grep`, `cat`, `head`, `tail`, `tree`, `git_log`,
`git_show`, `git_diff`, `pwd`) — `write`, `mv`, `rm`, and `git_revert` won't be offered at all.

## Uninstall / disconnect

`claude plugin uninstall openstore@openstore` removes the plugin from Claude Code.
`claude mcp logout openstore` drops the stored OAuth credential without uninstalling. Either way,
nothing about your store repo changes — OpenStore never held a copy of it, so the repo, its
history, and every commit stay exactly as they were on GitHub. Revoking the GitHub App's
installation (GitHub → Settings → Applications) cuts off access entirely, from either side.

## Developer / self-host: running the server yourself

The hosted endpoint above is the default path for users. If you'd rather run the MCP server
yourself — over stdio, with a GitHub personal access token you manage — see
[`../server/README.md`](../server/README.md) for the `openstore-mcp` package, its environment
variables (`OPENSTORE_REPO`, `OPENSTORE_TOKEN`, `OPENSTORE_BRANCH`, `OPENSTORE_READONLY`,
`OPENSTORE_CLIENT`), and how to wire a local `.mcp.json` entry that launches it with `node`. That
path is unchanged by the hosted endpoint described above and remains fully supported for
self-hosting.
