# OpenStore implementation plan

Status: v0.1 in progress, September 6, 2026.

This plan follows `concept.md`. `architecture.md` describes the moving parts. `design.md` holds the exact
tool contract and file format. Estimates are planning estimates for one experienced engineer, not
commitments.

## 1. What we prove first

One person, one private GitHub repository, two independently connected AI clients. Business and team use
are future applications of the same format.

The first successful demonstration:

1. The user installs the OpenStore plugin, signs in with GitHub when the client asks, and gets a private
   store repository created for them.
2. The user says "Remember that my Mac mini has 24 GB of RAM."
3. The AI runs `grep -ril mac mini` and `cat` to find where that belongs.
4. The AI shows the exact change it intends to write.
5. After the user agrees, the AI calls `write` and reports the short sha.
6. A second client recalls the fact in a fresh conversation, without being told again.
7. The user corrects it with another `write`, and can inspect it with `git_log` and `git_show` and undo it
   with `git_revert`.

Also test whether clients retrieve context without being prompted. MCP access does not guarantee that a
model calls tools, reads the server instructions, or decides to save anything. Ship and test client setup
instructions. Do not market automatic universal memory before we have watched that behavior happen.

## 2. Decisions for v0.1

| Area | Decision |
| --- | --- |
| Audience | People who have, or will make, a GitHub account |
| Identity | The OpenStore GitHub App. User-to-server OAuth with expiring tokens. The user never enters a token |
| Setup | Our app creates the store from the public template by default. Picking an existing repo is under Advanced |
| Backend | One private GitHub repository and one configured branch per connection |
| Storage | None on the server. No database, no cache, no disk. Nothing survives a tool call |
| Format | UTF-8 Markdown, root `CONTEXT.md`, optional frontmatter, relative links |
| Organization | Flexible folders. Look at what exists before inventing structure |
| Name | OpenStore. Repo `intreaction/open-store` |
| Interface | Bash-like tools with parsed arguments and bash-like text output. No real shell |
| Writes | Direct commits to the configured branch. One tool call is one commit |
| Consent | In chat. The model shows the change and writes after the user agrees. Clients also prompt on write tools |
| Undo | `git_revert` creates a new commit. History is never rewritten. Never force-push |
| Conflicts | Non-forced ref update. On a race, redo the read-modify-commit cycle up to 3 times, then fail loudly |
| Visibility | Repo-relative paths only. Text types only. Everything else is invisible, not forbidden |
| Search | Literal `grep` and `find` over one resolved head, with hard limits |
| Hosting | One Cloudflare Worker with zero storage bindings. The same code self-hosts, and stdio with a PAT stays the developer path |
| Session state | Sealed into AES-256-GCM tokens the client holds. No rows, anywhere |
| Authorization | No code is issued without a click. Every code passes a page that names the client and the host it goes to, a returning user included |
| Local clones | Defer the local-filesystem backend until GitHub works |
| License | Apache-2.0 |

Why bash-like tools instead of a bespoke schema. Models already know `ls`, `grep`, `cat`, and `git log`.
They compose those verbs without being taught. We parse the argument string ourselves with bash quoting
rules, so there is no interpreter, no pipes, and no subprocess. The familiarity is the interface. The
sandbox is real.

Why direct commits instead of proposals. A hosted service has no shared working directory, and an approval
page is a second surface to build, secure, and keep online. Git already gives us an audit log and a
reversible change. The chat is where consent belongs, because that is where the user already is.

## 3. Phases

| Phase | Deliverables | Exit condition | Estimate |
| --- | --- | --- | --- |
| 0. Server, plugin, template, personal store | TypeScript MCP server over the GitHub Git Data API, vitest suite against an in-memory store, esbuild bundle, Claude Code plugin with skill and marketplace entry, `template/`, seeded private store `intreaction/my-openstore` | Done in this build. `pwd`, `tree`, `grep`, `write`, `git_log`, `git_show`, `git_revert` all work against the live repo | done |
| 1. Hosted endpoint with GitHub App login | Cloudflare Worker, sealed-token OAuth, GitHub App install, in-flow store creation, returning-user confirmation, and read-only connections | Real GitHub OAuth, hosted read/write, and new private-store creation verified in Claude Code | deployed |
| 2. Landing site | GitHub Pages `site/`, static HTML, no build. Purely informational: what OpenStore is, the trust statement, and the three steps to connect it. No button that touches GitHub | A stranger reads one screen and knows exactly what to paste into their client | 2-3 days |
| 3. Other clients | Claude.ai custom connector, ChatGPT Developer Mode validation, per-client setup docs | The same store is read and written from two different vendors' clients | 1-2 weeks |
| 4. Directory submissions | Listings in the MCP and connector directories, whatever review each one requires | Accepted, or a written reason we were not | unknown |

The Worker is deployed at `https://mcp.openstore.sh/mcp`. GitHub App `openstore-mcp` (ID `4855603`)
is public and registered with Contents write, Administration write, and Metadata read. Three
secrets are installed on the Worker; no secrets are published with the source.

Real Claude Code authentication completed the GitHub OAuth exchange and selected-repository App
installation. A hosted tool smoke check created, read, and deleted a temporary Markdown file,
with both commits verified on GitHub. The live client exposed a scope-negotiation bug: Claude
requests both advertised scopes, so `store` must take precedence over `store:readonly` for `/mcp`.
The explicit `/mcp/readonly` resource still forces read-only access.
The setup flow created a new private template-backed repository and connected Claude Code to it
without token pasting or a user-supplied repository URL.

Plugin `0.3.0` uses the hosted HTTP endpoint. `template/` is published as
`intreaction/openstore-template`. The public source repository and GitHub Pages configuration
are in place; the apex points to Pages and `mcp` is the Worker's custom domain.

Remaining client validation: Claude.ai and ChatGPT custom connectors need authenticated accounts.
Their compatibility is not implied by the successful Claude Code login.

## 4. What we need to supply

- One developer, with a focused security review of the hosted endpoint before it is public.
- The OpenStore GitHub App, registered per `docs/github-app-setup.md`, plus a second GitHub identity with
  no installation, for isolation and first-run tests.
- The public `intreaction/openstore-template` repository, marked as a template.
- Accounts on the target clients for real integration tests. Record client version and plan.
- A Cloudflare account, a domain, and a budget cap. No database, so nothing to back up but config, and the
  only durable secrets are the App credentials and the seal key.
- A sample store and a repeatable set of remember, recall, correct, and undo scenarios.
- Published license, setup docs, an honest privacy statement, and a vulnerability contact.

## 5. Metrics

Measure latency per tool call, GitHub API calls per user action, failed writes from concurrent updates,
retrieval accuracy on the scenario set, onboarding completion, and hosting cost per active user. Free
software and a permanently free hosted endpoint are different promises. Self-hosting stays open. The
hosted endpoint stays bounded until costs are measured.

## 6. Deferred

Embeddings, attachments, encryption formats, automatic imports, background cleanup agents, team access
control, Git providers other than GitHub, offline sync, native local-clone access, large-repository
support, and billing.

## 7. Honest risks

- **An authorization code can be replayed inside its five-minute window.** With no storage there is nowhere
  to record that a code was already redeemed, so single use cannot be enforced. The mitigation is PKCE: the
  code is bound to an S256 challenge and the verifier never leaves the client that created it, so a
  captured code is not enough. The window is short and the code is sealed and expiring. We state this
  rather than implying single use, and we would revisit it before recommending the hosted endpoint for
  anything beyond personal notes.
- **Repository creation needs `Administration: write`, which is more than the brief assumed.** GitHub
  documents `POST /repos/{template_owner}/{template_repo}/generate` as available to user-to-server tokens,
  and the `POST /user/repos` fallback too, but both require `Administration` (write) on top of `Contents`
  (read and write) and `Metadata` (read). Registering the App with only Contents and Metadata makes the
  default "create my store" action fail with a 403, leaving only Advanced. `docs/github-app-setup.md` has
  the corrected permission table.
- **A newly created repository cannot be added to a "selected repositories" installation.**
  `PUT /user/installations/{id}/repositories/{repository_id}` works only for classic PATs, so the flow
  polls for visibility and then asks the user to add it on GitHub. Installations scoped to "all
  repositories" never hit that page. It has not been exercised against a real installation.
- **Claude.ai and ChatGPT OAuth compatibility is unvalidated.** Claude Code plugins work. Claude.ai custom
  connectors and ChatGPT Developer Mode each implement discovery, dynamic registration, PKCE, and resource
  indicators slightly differently, and they change. Our authorization server is written to the spec, not to
  any one client, and it has not yet completed a flow with either. Phase 3 may find that one of them cannot
  connect as designed.
- **A public listing means GitHub App review.** Making the App installable by any account and listing it in
  the GitHub Marketplace or the MCP directories brings requirements we have not read: branding, a support
  contact, a privacy policy, sometimes a security questionnaire. Phase 4 has no estimate for that reason,
  and none of it is code.
- **Models may not call the tools.** The store is useless if the model never greps it. This is a prompting
  and skill-design problem as much as an engineering one, and it is the reason phase 0 shipped a skill.
- **A hosted operator could read traffic in flight.** We retain nothing and log only tool name, exit code,
  duration, and byte counts. That is a real guarantee about retention, not about interception. Self-hosting
  is the answer for anyone who needs more.
- **Git history is permanent.** `rm` and `git_revert` add commits. They do not erase what was written. Users
  who commit a secret need history surgery outside OpenStore, and the docs must say so.
