# Deploying the hosted OpenStore endpoint

Prerequisite: the GitHub App is registered per `docs/github-app-setup.md` and you have its App ID,
slug, client ID, and client secret in hand.

## 1. Log in to Cloudflare

```
cd server
npx wrangler login
```

This opens a browser to authorize the `wrangler` CLI against your Cloudflare account. No account-level
secrets are stored in this repo; wrangler keeps its own OAuth token in its global config dir.

## 2. Set the non-secret vars

`server/wrangler.toml` carries the plain vars directly in `[vars]` — edit them in the file and they
deploy with the next `wrangler deploy`. There is nothing to run for these; they are not secrets.

| Var | Value |
| --- | --- |
| `GITHUB_APP_SLUG` | the App's URL slug, from `https://github.com/apps/<slug>` |
| `GITHUB_APP_ID` | **required.** The App's numeric id, from its settings page |
| `PUBLIC_SITE_URL` | the project site the HTML pages link to |
| `OPENSTORE_TEMPLATE_REPO` | `intreaction/openstore-template` |
| `PUBLIC_BASE_URL` | `https://mcp.openstore.sh`, the one public origin. Pinned so the OAuth issuer never varies by hostname; remove it only for a temporary workers.dev test |

The hosted App ID and slug are set in `wrangler.toml`. Self-hosters must replace both with their own
App's values. `GITHUB_APP_ID` tells our installations apart from every other GitHub App the user
has installed; if it is empty, sign-in routes fail closed. Discovery alone is not a readiness check.

## 3. Set the secrets

Each of these prompts for a value on stdin (nothing is echoed, nothing is written to shell history):

```
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put OPENSTORE_SEAL_KEY
```

Generate the seal key first if you don't have one yet:

```
node scripts/gen-seal-key.mjs
```

This prints a fresh base64-encoded 32-byte key. Paste that into the `OPENSTORE_SEAL_KEY` prompt above.
Keep a copy somewhere safe outside the repo — losing it invalidates every sealed token in flight
(users just re-run the OAuth flow; nothing is lost server-side because nothing is stored
server-side), and rotating it is exactly this same command run again.

Verify what's set (values are never shown, only names):

```
npx wrangler secret list
```

## 4. Deploy

```
npm run deploy
```

This runs `wrangler deploy`, which bundles `src/worker.ts` and publishes it. Confirm
`server/wrangler.toml` has no `[[kv_namespaces]]`, `[[d1_databases]]`, `[[durable_objects]]`, `[[r2_buckets]]`,
or any other storage binding before deploying — the hard constraint is zero storage bindings, and
`wrangler deploy` will happily create one if it's in the file.

Keep `[observability] enabled = false`. Cloudflare's automatic invocation logs include full
request URLs; OAuth callback codes and sealed state must not be persisted there. No application
storage bindings alone is insufficient: review the source and the platform logging settings too.

Cloudflare's zone-level Network Error Logging (NEL) is separate from Worker observability. Its
browser reports can carry failed request URLs. Disable it using the zone dashboard or
`PATCH /zones/{zone_id}/settings/nel` with a token allowed to edit zone settings; Wrangler's
standard OAuth token does not grant that permission. Verify the public response headers afterward.
The hosted zone still emits a NEL policy: the dashboard API rejected the attempted opt-out, and
the Wrangler token lacks the required permission. Do not claim that all Cloudflare telemetry is off.
See [Cloudflare's NEL privacy documentation](https://developers.cloudflare.com/network-error-logging/#privacy).

## 5. Put the domain on Cloudflare and attach `mcp.openstore.sh`

`wrangler.toml` binds the Worker to the custom domain `mcp.openstore.sh` and disables the
`workers.dev` preview hostname, so the endpoint has exactly one origin. That origin is also pinned
as `PUBLIC_BASE_URL`, so the OAuth issuer never varies with the request hostname. The GitHub App's
callback URL must match it exactly.

Custom domains only attach when the `openstore.sh` zone is on Cloudflare:

1. In the Cloudflare dashboard, **Add a site** -> `openstore.sh` (the Free plan is enough).
2. Point the registrar's nameservers at the two Cloudflare nameservers it shows you. Wait until the
   zone reads **Active**.
3. `npm run deploy`. Wrangler creates the `mcp` DNS record and certificate itself; nothing to add by
   hand. The deploy output ends with `https://mcp.openstore.sh`.

If the zone is not on Cloudflare yet, the deploy fails on the route. To test before DNS moves,
temporarily set `workers_dev = true` and comment out `routes` and `PUBLIC_BASE_URL`, deploy, and use
the printed `workers.dev` URL, adding it as a second callback URL on the GitHub App. Revert before
the real launch so there is a single origin again.

## 6. Hosted plugin configuration

`plugin/.mcp.json` points at `https://mcp.openstore.sh/mcp`; plugin and marketplace version `0.3.0`
ship HTTP OAuth as the default. The bundled stdio server remains available for self-hosters.
When changing the endpoint URL for a self-hosted plugin, update this file and its documentation.

- The registered hosted App is `openstore-mcp` (`https://github.com/apps/openstore-mcp`, App ID
  `4855603`). Self-hosters must update the site link and `GITHUB_APP_SLUG` together.

## 7. Publish the site at `openstore.sh`

The site publishes via Actions from `site/`, and `site/CNAME` names the custom domain.

1. On `github.com/intreaction/open-store` -> **Settings -> Pages**.
2. Under **Build and deployment -> Source**, choose **GitHub Actions**.
3. Under **Custom domain**, enter `openstore.sh`, save, and tick **Enforce HTTPS** once the
   certificate is issued (a few minutes after DNS resolves).
4. In the Cloudflare DNS for `openstore.sh`, add these records with the proxy **off** (grey cloud),
   because GitHub issues the certificate and needs to reach the apex directly:

   | Type | Name | Value |
   | --- | --- | --- |
   | A | `@` | `185.199.108.153` |
   | A | `@` | `185.199.109.153` |
   | A | `@` | `185.199.110.153` |
   | A | `@` | `185.199.111.153` |
   | AAAA | `@` | the four IPv6 addresses from GitHub's docs (optional) |
   | CNAME | `www` | `intreaction.github.io` |

   Copy the current values from GitHub's docs page "Managing a custom domain for your GitHub Pages
   site" before saving; they change rarely, but they do change.
5. Push to `main`. `.github/workflows/pages.yml` uploads `site/` and deploys it. The site is live at
   `https://openstore.sh` when Settings -> Pages shows a green check next to the domain.

## 8. Confirm the template repo is marked as a template

This is already done: `intreaction/openstore-template` is public and marked as a template. Re-check it
after any repository settings change.

`intreaction/openstore-template` must have "Template repository" checked, or
`POST /repos/intreaction/openstore-template/generate` (the create-your-OpenStore path) will 404/422
for every user. Check with:

```
gh api repos/intreaction/openstore-template --jq .is_template
```

Expected: `true`. If not:

```
gh repo edit intreaction/openstore-template --template
```

## 9. Smoke checklist

Run these against `https://mcp.openstore.sh` after every deploy:

**Metadata endpoint** — should return JSON, not an error, and advertise the right routes:

```
curl -s https://mcp.openstore.sh/.well-known/oauth-authorization-server | jq .
```

Expect `authorization_endpoint`, `token_endpoint`, `registration_endpoint` all pointing at the same
origin, `code_challenge_methods_supported: ["S256"]`, `token_endpoint_auth_methods_supported: ["none"]`.

**`GITHUB_APP_ID` actually landed** — the metadata document does not need it, so check a route that does:

```
curl -s -o /dev/null -w '%{http_code}\n' \
  'https://mcp.openstore.sh/authorize?response_type=code&client_id=x'
```

Expect `400` (an unknown client). A `500` means `GITHUB_APP_ID`, `GITHUB_CLIENT_ID` or
`GITHUB_CLIENT_SECRET` is missing and the whole sign-in flow is dead.

**`/mcp` requires auth** — an unauthenticated POST must 401 with a spec-correct challenge header:

```
curl -s -i -X POST https://mcp.openstore.sh/mcp \
  -H 'content-type: application/json' -d '{}' | grep -i www-authenticate
```

Expect a `401` status and a header shaped like:
`WWW-Authenticate: Bearer resource_metadata="https://mcp.openstore.sh/.well-known/oauth-protected-resource"`

**Full login from Claude Code via `/mcp`** — the end-to-end check that actually exercises the GitHub
App:

1. Point a Claude Code plugin install (or a local `.mcp.json`) at the deployed `/mcp` URL.
2. Run `/mcp` inside Claude Code and choose to authenticate.
3. Confirm the browser opens, GitHub shows either the App's install page (first time) or the sign-in/
   authorize prompt (returning installs), and after approving you land back in Claude Code connected.
4. Run a read tool (e.g. `pwd` or `tree`) through the connected server and confirm it reflects the
   real store repo contents.
5. If you have no App installed yet in a disposable test account, `scripts/seal-dev-token.ts` lets you
   skip steps 1-3 and hit `/mcp` directly with a hand-sealed `access` token built from
   `OPENSTORE_SEAL_KEY`, `OPENSTORE_REPO`, and a real GitHub token (`gh auth token`) — useful for
   testing the MCP surface in isolation from the OAuth dance, never for testing the OAuth dance itself.

If any of the three checks fail, re-check (in order): the secrets are actually set
(`wrangler secret list`), the App's callback URLs match the deployed origin exactly, and the App has
`Contents: read & write`, `Metadata: read`, and `Administration: read & write` (see
`docs/github-app-setup.md` section 2 for why `Administration` is required).
