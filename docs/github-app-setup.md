# GitHub App setup

This is the one-time registration step an operator (John, for the hosted `intreaction` deployment,
or anyone self-hosting) does by hand at https://github.com/settings/apps/new. OpenStore's login flow
(section 4 of `plan.md` / the phase-1 brief) depends on the exact settings below — get them wrong and
the callback either can't identify the installation or can't create repos.

The hosted App is now registered as **OpenStore MCP**, slug `openstore-mcp`, App ID `4855603`,
owned by `intreaction`. `OpenStore` is reserved for the `@openstore` account. The instructions
below remain the registration reference for self-hosters.

## 1. Register the app

Go to **https://github.com/settings/apps/new** and fill in:

| Field | Value |
|---|---|
| **GitHub App name** | `OpenStore`. If taken, use `OpenStore MCP` (the app name only has to be unique across all of GitHub; it does not need to match the App slug used in URLs). |
| **Description** | e.g. "Sign in to your OpenStore — a private GitHub repo your AI reads and writes as durable memory." |
| **Homepage URL** | `https://openstore.sh` (the GitHub Pages site on its custom domain — `PUBLIC_SITE_URL`). |
| **Callback URL** | Add **two**: `https://mcp.openstore.sh/callback` (the deployed Worker origin + `/callback`) and `http://localhost:8787/callback` (local `wrangler dev`). GitHub allows multiple callback URLs on an App; the OAuth callback used for any given flow is whichever `redirect_uri` you pass to `/login/oauth/authorize`, or the first one listed if you pass none. |
| **Expire user authorization tokens** | **Yes** (checked). Without this, user access tokens never expire, which defeats the `access` token's `min(gh_exp, 8h)` expiry design and makes revocation weaker. |
| **Request user authorization (OAuth) during installation** | **Yes** (checked). This is what makes GitHub redirect the user to the **User authorization callback URL** (not the Setup URL) after installation, carrying a `code` you exchange for a user access token in the same round trip as the install. See section 3. |
| **Setup URL** | Leave **empty**. We don't use a separate post-install page — the callback above (`/callback`) does everything, driven by `setup_action` and `installation_id` when GitHub sends us there straight from an install. |
| **Webhook** | **Uncheck "Active."** OpenStore is stateless and has nothing to react to asynchronously; we never receive webhooks. |
| **Where can this GitHub App be installed?** | **Any account** (so any user can install it on their own personal account or org — this is a multi-tenant login app, not a single-org internal tool). |

### Repository permissions

Set under **Permissions & events -> Repository permissions**:

| Permission | Access | Why |
|---|---|---|
| **Contents** | Read and write | Reading/writing the store's Markdown files via the Git Data API (blobs, trees, commits, refs) — this is the whole product. |
| **Metadata** | Read-only | Mandatory baseline permission GitHub adds to every App; also what `GET /user/installations/{id}/repositories` needs on the token (see below). |
| **Administration** | Read and write | Required by both repo-creation endpoints the setup flow calls — see the verification below. Without this, "Create your OpenStore" fails for every user. |

Do not add any organization permissions, and leave **Account permissions** alone — the flow never
reads a user's email, profile, or anything beyond what `Contents`/`Metadata`/`Administration` cover.

Leave **User permissions** (the "requests permission on behalf of the user" block some App forms show
for account-level scopes like email) untouched — none are needed.

## 2. Verified against the GitHub docs

BRIEF2 asked for the repository-creation permission to be confirmed, not assumed. Fetched directly
from docs.github.com on 2026-09-06:

**`POST /repos/{template_owner}/{template_repo}/generate`** (create-your-OpenStore default path),
from https://docs.github.com/en/rest/repos/repos:

> "This endpoint works with the following fine-grained token types: GitHub App user access tokens,
> GitHub App installation access tokens, Fine-grained personal access tokens. The fine-grained token
> must have the following permission set: "Administration" repository permissions (write) and
> "Contents" repository permissions (read)"

**`POST /user/repos`** (the documented fallback if `generate` doesn't fit — plain repo creation, then
we'd copy the template tree ourselves via the Git Data API), same page:

> "This endpoint works with the following fine-grained token types: GitHub App user access tokens,
> Fine-grained personal access tokens. The fine-grained token must have the following permission set:
> "Administration" repository permissions (write)"

Both endpoints work with **GitHub App user access tokens** (the user-to-server token our callback
holds) — good, no fallback to a PAT is needed. But **both need `Administration: write`**, which the
original brief did not list alongside Contents/Metadata. `generate` additionally needs `Contents:
read` (already covered by our `Contents: read and write`). **Conclusion: add `Administration: read
and write` to the App's repository permissions**, or "Create your OpenStore" will fail with a 403 for
every user on first login.

From https://docs.github.com/en/rest/authentication/endpoints-available-for-github-app-user-access-tokens
and https://docs.github.com/en/rest/apps/installations, the other endpoints the callback uses:

> "List app installations accessible to the user access token ... The fine-grained token does not
> require any permissions." (`GET /user/installations`)

> "List repositories accessible to the user access token ... The fine-grained token must have the
> following permission set: "Metadata" repository permissions (read)" (`GET /user/installations/{id}/repositories`)

**Open issue found during verification, not in the original brief:** `PUT
/user/installations/{installation_id}/repositories/{repository_id}` ("Add a repository to an app
installation," used to grant a "selected repositories" installation access to a newly-created repo):

> "This endpoint only works for PATs (classic) with the repo scope. ... This endpoint does not work
> with GitHub App user access tokens, GitHub App installation access tokens, or fine-grained personal
> access tokens."

So the callback/setup handler **cannot** call this endpoint with the user-to-server token it holds —
it has no way to programmatically add the newly-created repo to a "selected repositories"
installation. Two ways to avoid the dead end, in order of preference:
1. Tell installers in the app's own description/README to choose **"All repositories"** during
   install (the natural choice for a personal-memory app anyway) — new repos are then automatically
   in scope, no API call needed.
2. If a user picked "Only select repositories" and the store repo isn't in that list, the callback
   should detect this (the repo won't appear via `GET /user/installations/{id}/repositories` even
   though it was just created) and render an HTML page linking to
   `https://github.com/settings/installations/<installation_id>` telling them to add the repo by hand,
   then retry.

**State parameter through the install hand-off**, verified against
https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app
and confirmed by GitHub's own resolution of a past bug report
(https://github.com/orgs/community/discussions/61291, which was specifically about the separate
*Setup URL* not preserving `state` — not the OAuth callback we use):

> "state string — Strongly recommended. When specified, the value should contain a random string to
> protect against forgery attacks, and it can also contain any other arbitrary data."

> "If you specified redirect_uri in the previous step, that callback URL will be used. Otherwise, the
> first callback URL on your app's settings page will be used. If you specified the state parameter in
> the previous step, GitHub will also include a state parameter."

Practically: when our `/authorize` handler redirects to
`https://github.com/apps/<slug>/installations/new?state=<sealed-state>` (the no-installation path) or
to `https://github.com/login/oauth/authorize?...&state=<sealed-state>` (the has-installation path),
GitHub carries that `state` value through to whichever flow actually runs and returns it, unchanged,
on the query string of our `/callback`. What the callback receives differs by path:

- **Plain OAuth authorize** (installation already existed): `?code=...&state=<sealed-state>`.
- **Install-then-authorize** (no installation yet, "Request user authorization during installation"
  is on, no Setup URL configured): GitHub redirects to the **User authorization callback URL**
  (`/callback`) with `?code=...&installation_id=<id>&setup_action=install&state=<sealed-state>` — the
  same code-for-token exchange applies; `installation_id` and `setup_action` are extra fields the
  `/callback` handler should read to skip the "no installation" branch it would otherwise take.

## 3. Where each value goes

After registering, GitHub shows the **App ID**, the app's **slug** (from the URL,
`github.com/settings/apps/<slug>`), and lets you generate a **Client ID** and **Client secret** for
user-to-server OAuth (under "Generate a new client secret").

| Value | Destination |
|---|---|
| App ID | `wrangler.toml` var `GITHUB_APP_ID` (non-secret; used to filter `GET /user/installations` down to installations of *this* app). **Required** — the server fails closed and refuses `/authorize`, `/callback`, `/callback/setup` and `/token` while it is empty, rather than listing another App's installations. |
| App slug | `wrangler.toml` var `GITHUB_APP_SLUG` (non-secret; used to build `https://github.com/apps/<slug>/installations/new`). |
| Client ID | `wrangler secret put GITHUB_CLIENT_ID` (treat as secret even though GitHub calls client IDs public — keeping it alongside the client secret means one `wrangler secret list` shows both are set). |
| Client secret | `wrangler secret put GITHUB_CLIENT_SECRET`. |
| Seal key (generated locally, not from GitHub — see `scripts/gen-seal-key.mjs`) | `wrangler secret put OPENSTORE_SEAL_KEY`. |

Local development (`server/.dev.vars`, copied from `server/.dev.vars.example` and never committed —
it's in `.gitignore`):

```
GITHUB_APP_ID=123456
GITHUB_APP_SLUG=openstore
GITHUB_CLIENT_ID=Iv1.xxxxxxxxxxxxxxxx
GITHUB_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
OPENSTORE_SEAL_KEY=<output of scripts/gen-seal-key.mjs>
PUBLIC_SITE_URL=https://openstore.sh/
OPENSTORE_TEMPLATE_REPO=intreaction/openstore-template
PUBLIC_BASE_URL=http://localhost:8787
```

`PUBLIC_SITE_URL` is the human-facing project site the HTML pages link to, not the endpoint's own
origin. Local `PUBLIC_BASE_URL` overrides the production value inherited from `wrangler.toml`.
`server/.dev.vars.example` is the full list with comments.

`wrangler dev` reads `.dev.vars` automatically; it is never read in production (production vars come
from `wrangler.toml` `[vars]` and secrets come from `wrangler secret put`, both described in
`docs/deploy.md`).

## 4. Sanity check after registering

- `https://github.com/apps/<slug>` should load the public install page.
- `GET https://api.github.com/app` with a JWT signed by the App's private key is unnecessary for this
  flow (we never authenticate *as the app*, only user-to-server) — if you never generated a private
  key, that's expected and fine.
- Installing the App on a scratch account and watching the callback URL query string is the fastest
  way to confirm the `state`/`installation_id`/`setup_action` behavior above matches what your
  deployed `/callback` expects, before wiring up real users.
