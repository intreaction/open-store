# ContextDB implementation plan

Status: proposed implementation direction, September 6, 2026.

This plan follows `concept.md`. The workspace currently contains the concept brief and no implementation or initialized Git repository. Estimates below are planning estimates for one experienced full-time engineer, not commitments.

## 1. What we should prove first

Build a personal-context product for one person, one private GitHub repository, and two independently connected AI clients. Keep business and team use as future applications of the same format.

The first successful demonstration:

1. The user connects a repository and an AI client.
2. The user says, “Remember that my Mac mini has 24 GB of RAM.”
3. The AI searches existing context and proposes a specific file change.
4. The user reviews and approves the exact diff.
5. The service commits it to GitHub.
6. A second AI client retrieves the fact in a fresh conversation, without being given it again.
7. The user corrects the fact and can inspect and undo the change.

Also test whether clients retrieve relevant context without explicit prompting. MCP access does not itself guarantee that a model will call tools, load repository instructions, or save information from conversations. Ship and test client setup instructions; do not market automatic universal memory before demonstrating that behavior.

## 2. Decisions to make now

| Area | Recommended v0.1 decision |
| --- | --- |
| Audience | Technical individuals with existing GitHub accounts |
| Backend | One private GitHub repository and one configured branch per connection |
| Format | UTF-8 Markdown, root `CONTEXT.md`, optional frontmatter, relative Markdown links |
| Organization | Flexible folders; inspect existing content before creating new structure |
| Naming | Keep ContextDB as a working name; investigate availability before public launch |
| OKF | Identify the exact referenced specification before claiming compatibility; keep v0.1 independently understandable |
| Interface | Explicit structured tools with filesystem concepts, no command-string interpreter |
| Writes | One atomic commit per bounded change set, potentially containing multiple files |
| Approval | Default to proposals; approval happens in an authenticated web page |
| Stronger grants | Explicit user-configured read/write access to approved paths |
| Conflicts | Reject stale changes; reread and regenerate rather than silently overwriting |
| Search | Bounded text and filename search over a known repository revision |
| Hosting | One deployable service, with the same service runnable by self-hosters |
| Local clones | Defer the separate local-filesystem backend until the GitHub implementation works |
| License | Choose MIT or Apache-2.0 before publishing; Apache-2.0 is a reasonable default |

Do not expose raw Git staging as the public abstraction. A hosted service has no natural shared working directory, and one client's unfinished edits must not become another client's commit. Change sets give us explicit ownership, scope, review, and concurrency semantics.

## 3. Architecture

```text
AI clients                         User's browser
    |                                   |
    | authenticated MCP                 | login, grants, review
    v                                   v
              ContextDB service
              - authorization and policy
              - MCP tools and repository conventions
              - change sets and approval
              - bounded search and GitHub adapter
                  |                 |
                  v                 v
           GitHub repository    Small service database
           Markdown + history   identity, grants, proposals,
                                approval and retry state
```

Use TypeScript as a provisional implementation choice, an MCP SDK compatible with the clients we validate, a GitHub API client, and a small relational database. Pin dependencies after the compatibility spike. Keep these as modules in one codebase rather than five independently deployed projects.

The database is operational state, not the authoritative context store. Pending proposals may contain private content: encrypt them at rest, expire them, exclude content from logs, and document retention. Committed knowledge remains recoverable from Git alone. Losing service state may require reconnecting clients and discarding pending proposals.

A strict interpretation of “no duplicate copy” would prevent even useful transient search caches and pending drafts. Refine the promise to “no second authoritative knowledge store.” Make temporary storage explicit and bounded.

## 4. Authentication and permissions

There are two separate boundaries:

1. The AI client authenticates to ContextDB and receives a grant for a particular repository and capability.
2. ContextDB authenticates to GitHub using its installed GitHub App.

A GitHub App installation is not sufficient authentication for the MCP client. Resolve the signed-in user's right to the selected installation/repository on the server; do not trust repository IDs or installation IDs provided by a caller. The MCP authorization specification also prohibits simply passing downstream tokens through as the server's own credentials. [MCP authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)

Use narrowly scoped GitHub App permissions and short-lived installation tokens, retained only on the server. Installation tokens expire after one hour. Account for revoked installations, removed repositories, and user access changes. [GitHub installation authentication](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation)

Ship read-only, propose, and explicitly granted write modes. Enforce permissions in application code on every read, search, history, diff, and write. Repository text must never be able to grant permissions. Restricted paths must not leak through search snippets or history.

## 5. Tool contract and change lifecycle

Start with these operations; final names and schemas belong in the tool contract:

| Tool | Purpose |
| --- | --- |
| `context_info` | Repository instructions, capabilities, limits, and current revision |
| `repo_list` | List permitted files and folders |
| `repo_read` | Read a bounded file or section at a revision |
| `repo_search` | Search names and text; return paths, snippets, and revision |
| `change_propose` | Submit create/replace/move/delete operations against a base revision |
| `change_get` | Retrieve immutable proposed diff, status, and review URL |
| `change_apply` | Commit only when a matching approval or automatic-write grant exists |
| `repo_history` | Read permitted change history |

Prefer whole-file replacement for small Markdown documents initially; defer a general patch parser until needed. Git does not track empty directories, so `mkdir` adds little value. Reverts should create new reviewed changes, never reset or rewrite branch history.

Each change set includes an ID, repository and branch binding, base commit, exact operations, reason, creator identity, content digest, expiry, and idempotency key. Store model/client labels separately from authenticated identity because a model-supplied name is not verified provenance.

Lifecycle: proposed → approved → applied; alternatives are rejected, expired, or conflicted. Approval is bound to the exact content digest and base revision. Editing a proposal invalidates approval. An AI claiming “the user approved” must not substitute for the authenticated approval event.

Build the new Git tree and a commit with the expected base as parent, then advance the branch without force. A competing update must not be overwritten. GitHub supports non-forced reference updates; test races against actual GitHub, including retry after a timeout. If the branch changed, surface a conflict and request a regenerated proposal. Support normal forward-only branch updates in v0.1; history rewrites require reconnection/reconciliation. [GitHub reference API](https://docs.github.com/en/rest/git/refs)

Approval should work even when a client offers no custom UI: return an authenticated review link with Approve/Reject in the browser. In the first version, editing happens by generating a replacement proposal. The browser can perform the approved commit directly so success does not depend on the model returning to finish it.

## 6. Search and knowledge quality

Fetch the repository tree and permitted Markdown at a specific commit; use a bounded disposable cache keyed by repository, revision, and authorization scope. Search titles, paths, tags, and body text. Prefer literal search initially to avoid arbitrary expensive regular expressions. Do not assume GitHub code search is an immediate, complete index of recent writes.

Return snippets and bounded results rather than entire repositories. Expose truncation and pagination. After a successful write, subsequent reads must resolve the new head and avoid stale search results.

Start with explicit limits, for example 1,000 Markdown files, 10 MiB of searchable text, 128 KiB per document, and 20 changed files per proposal. These are provisional engineering limits to validate through measurement, not capacity claims.

Build a sample repository with devices, preferences, a project, related links, an outdated fact, and conflicting notes. Test recall, corrections, duplicate avoidance, and uncertainty. The repository records accepted knowledge, but does not make a factual claim automatically true. Instructions should preserve source/date where relevant and surface unresolved contradictions rather than invent certainty.

## 7. Security and operational requirements

- Reject traversal, absolute paths, symlinks, submodules, unexpected encodings, unsupported file types, and oversized operations. Use dedicated context repositories and block workflows and executable/configuration paths outside the format.
- Treat retrieved text as untrusted data. It cannot instruct the service to expand grants, approve writes, contact another endpoint, or expose credentials. Test malicious documents against the permission boundary.
- Verify authenticated review ownership, prevent CSRF, validate OAuth redirect handling and token audience, and test tenant isolation.
- Detect obvious credentials on write and explain blocked content, while being honest that scanning cannot guarantee a secret-free repository.
- Explain that deletion and revert do not erase sensitive content from Git history. Document incident handling, token rotation, and history cleanup outside ordinary memory operations.
- Add request quotas, GitHub rate-limit handling, bounded retries, idempotent application, metadata-only logs, and alerts for errors and resource use.
- Back up service configuration and operational state. A private GitHub repository and Git history are not an independent backup strategy; document user-controlled clones/backups.

## 8. Delivery sequence and acceptance gates

| Phase | Deliverables | Exit condition | Estimate |
| --- | --- | --- | --- |
| 0. Validate assumptions | Two-client MCP/auth spike; GitHub read/write and race spike; exact OKF reference investigation | Both chosen clients can authenticate and call a minimal endpoint; concurrency approach demonstrated | 3–5 days |
| 1. Specify and scaffold | Format v0.1, tool schemas/errors, sample repository, threat model, license, application skeleton and CI | The router/Mac mini scenario has exact requests, responses, permissions, and expected diffs | 3–5 days |
| 2. Build the core | GitHub adapter, scoped reads/search, change sets, atomic commits, history, meaningful integration tests | API-level read → propose → approve → commit → retrieve succeeds; simultaneous edits cannot lose data | 1–2 weeks |
| 3. Deliver the product loop | GitHub onboarding, hosted MCP authorization, repository grants, review page, revocation handling | Two real clients share a fact; user can reject, correct, inspect, and undo it | 1–2 weeks |
| 4. Private alpha | Deployment, self-host instructions, quota/retention policies, failure testing, 5–10 testers | Users complete the loop without developer intervention; failures preserve data and explain recovery | 1–2 weeks |

Allow roughly 5–8 weeks for a usable private alpha with these assumptions. Client compatibility, hosted authorization, and onboarding are the largest schedule uncertainties. A narrow developer demonstration can arrive earlier. Public multi-tenant operation requires additional hardening based on alpha findings.

Do not start all layers at once: compatibility and concurrency first, then the narrow end-to-end loop, then onboarding polish.

## 9. What we need to supply

- One developer initially, with focused authentication/security review before public launch.
- A GitHub development App and test repositories/accounts, including two identities for isolation tests.
- Access to two target AI clients for real integration tests; record client version/plan and supported connection path.
- A small HTTPS hosting environment, domain, secret storage, database, CI, error monitoring, and an operating budget cap.
- A sample context repository and a repeatable evaluation set of realistic remember/recall/correct scenarios.
- A published license, setup documentation, privacy/retention explanation, and vulnerability reporting contact.

Measure search latency, API calls per user action, proposal approval rate, failed/stale writes, retrieval accuracy, onboarding completion, and actual hosting cost. Free software and a permanently unlimited free hosted endpoint are different promises. Keep self-hosting open; offer a bounded hosted alpha until costs are measured.

## 10. Deferred work

Defer embeddings, attachments, encryption formats, automatic imports, background librarians, team RBAC, additional Git providers, offline synchronization, native local-clone access, large-repository support, rich knowledge editing, and billing.

The immediate next implementation deliverables are `docs/spec-v0.1.md`, `docs/mcp-contract.md`, and `examples/personal-context/`, informed by the small compatibility/concurrency spike. Draft these as a provisional convention and validate them with the reference implementation before presenting the format as an established standard.
