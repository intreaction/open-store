# ContextDB Product and Interface Design

Status: proposed v0.1 design. This document defines intended behavior, not an implemented product. System components and trust boundaries are described in `architecture.md`.

## 1. Product promise

An authorized AI can retrieve and propose changes to context that the user owns in Git. A different authorized AI can use the accepted context in a later conversation. The user can inspect, correct, and recover previous versions.

The initial audience is technical individuals with GitHub accounts. Start with personal and project facts, one private repository per connection, and two tested AI clients. Defer shared team administration.

The product does not automatically receive all conversations. Whether a client searches or remembers depends on its tool access, configuration, and model behavior. Client setup must explain how to use ContextDB and show a successful recall test.

## 2. Guiding decisions

- Preserve existing organization and prefer updating an existing document over duplicating knowledge.
- Let users inspect durable changes before accepting them by default.
- Keep Markdown understandable without ContextDB.
- Make current revision, proposal state, incomplete results, and failure conditions explicit.
- Keep service permissions outside model-editable repository text.
- Use ordinary structured filesystem operations rather than a virtual Bash parser.

## 3. Primary user journeys

### Connect a repository

1. Sign in with GitHub.
2. Install the ContextDB GitHub App on the selected repository.
3. Select the repository and verify access server-side.
4. Inspect existing contents and show any proposed initialization changes.
5. Approve initialization if needed.
6. Connect an AI client with a read-only or propose grant.
7. Run a simple read/remember/recall check.

For v0.1, selecting an existing private repository or one created from a supplied template is sufficient. Do not make automated repository creation a prerequisite: its permissions and empty-repository behavior need separate validation.

Never overwrite existing files during initialization. Show useful instructions for an empty repository, unsupported file types, missing installation access, or an incompatible client.

### Remember a fact

User: “Remember that my Mac mini has 24 GB of RAM.”

1. The AI reads repository guidance and searches for Mac mini information.
2. It reads the relevant document at a known revision.
3. It proposes a precise update and explains why it belongs there.
4. ContextDB returns a diff and review link.
5. The user approves or rejects the exact change in an authenticated browser session.
6. Approval applies the commit; the review page shows the result.
7. The AI can retrieve proposal status and report the saved revision.

The AI must distinguish “proposed” from “saved.” An expired, rejected, or conflicted proposal must never be described as remembered.

### Recall from another AI

The second client searches the same repository and reads relevant documents. It uses source paths and revision information when explaining where context came from. A new unpinned read sees the accepted branch head.

Test both explicit requests such as “check my context” and ordinary questions whose answers benefit from stored facts. The latter is a product-quality evaluation, not a guarantee provided by the storage protocol.

### Correct or undo

A correction follows the same reviewed change flow. History lets the user inspect what changed and who authenticated the request. Undo produces a new proposal that restores selected content; it does not reset Git history.

If a newer change touches the same content, show the conflict and require a fresh proposal. Explain that removing sensitive content from the visible document does not erase old Git revisions.

### Grant automatic writes or disconnect

The user can explicitly grant a client automatic create/update access to approved paths. Show its scope before saving. Keep delete and move approval requirements separate.

The user can revoke a client without disconnecting other clients. Disconnecting the repository revokes its ContextDB connections and explains how to uninstall the GitHub App. Neither action deletes the user's repository.

## 4. Minimum web interface

| View | Required content and actions |
| --- | --- |
| Connection setup | Sign-in state, App installation, repository selection, initialization preview |
| Repository overview | Connection health, configured branch, linked clients, recent proposal outcomes |
| Proposal review | Reason, affected paths, exact diff, author identity, expiry, Approve and Reject |
| Client access | Granted capabilities and paths, revoke action, explicit automatic-write configuration |
| Result/error view | Applied commit link, rejection, expiry, conflict, or recovery instructions |

The review page may approve and apply directly, so the user does not depend on an AI client continuing its turn. For v0.1, changing a proposal means requesting a replacement; a browser Markdown editor is not required.

A rich knowledge browser, note editor, relationship graph, and dashboard analytics are outside the first release.

## 5. Repository convention

Example:

```text
README.md
CONTEXT.md
home/
  network.md
technology/
  computers.md
projects/
  contextdb.md
preferences/
  travel.md
```

`README.md` explains the repository to people. `CONTEXT.md` is the required entry point for the proposed v0.1 convention and explains organization and maintenance to agents. Other folder names are illustrative, not prescribed. An index is optional and must not be treated as an exhaustive inventory unless validated.

Use UTF-8 Markdown and repository-relative Markdown links. Frontmatter is optional. Do not require entity schemas, UUIDs for every fact, or a universal ontology. Wiki-style links may occur in imported content, but v0.1 need not resolve them; prefer standard Markdown for newly generated links.

Example document:

```markdown
---
title: Computers
tags: [devices, local-ai]
updated: 2026-09-06
---

# Computers

## Mac mini

- RAM: 24 GB.
- Main use: small local AI projects.
- Source: user-confirmed on 2026-09-06.

Related: [Local AI project](../projects/local-ai.md).
```

The source/date convention is recommended where it helps interpret facts, not mandatory metadata on every sentence. Do not persist entire private conversations merely to provide provenance.

`CONTEXT.md` should instruct agents to search first, preserve focused documents, retain meaningful historical context, surface contradictions, avoid secrets, and propose broad reorganizations. It must also explain that repository prose cannot override client or service permissions.

The brief's “OKF-inspired” reference remains unresolved. Identify the intended specification before claiming compliance. The ContextDB convention must be understandable without that dependency.

## 6. Proposed MCP interface

All inputs are structured. Callers operate through an authenticated connection; arbitrary repository IDs, branch overrides, shell strings, and executable commands are not accepted.

| Tool | Main input | Main output |
| --- | --- | --- |
| `context_info` | No content input | Instructions, capabilities, limits, current revision |
| `repo_list` | Path, optional revision and cursor | Permitted entries, revision, next cursor |
| `repo_read` | Path, optional revision and line range | Bounded content, revision, truncation metadata |
| `repo_search` | Literal query, optional path/revision/cursor | Ranked matches, snippets, revision, completeness |
| `change_propose` | Base revision, operations, reason, idempotency key | Change-set ID, diff, state, review URL |
| `change_get` | Change-set ID | Permitted diff, state, review URL or applied commit |
| `change_apply` | Change-set ID, idempotency key | Applied commit or actionable error |
| `repo_history` | Optional path and cursor | Permitted commit metadata and bounded changes |

`change_apply` checks an authenticated approval or an explicit automatic-write grant. A boolean such as `approved: true` supplied by the model is not evidence of user approval.

Create, replace, move, and delete are operations inside a change set. Use whole-file replacement for bounded Markdown documents initially. Keep a general diff/patch parser out of the initial contract. Multi-file changes are accepted atomically as one commit.

Example proposal:

```json
{
  "base_revision": "<commit-sha>",
  "operations": [
    {
      "type": "replace",
      "path": "technology/computers.md",
      "content": "# Computers\n\n## Mac mini\n\n- RAM: 24 GB.\n"
    }
  ],
  "reason": "Record the RAM capacity confirmed by the user.",
  "idempotency_key": "<unique-request-id>"
}
```

A real replacement must preserve unrelated existing content. The server checks existence and base revision, and the review diff makes accidental removal visible. Replacement is never an implicit create; moves require an existing source and an unoccupied destination unless a future contract explicitly permits replacement.

There is no shared staging area, global `git_commit`, empty-directory operation, force push, or unrestricted revert tool. Undo is expressed through a fresh change set.

## 7. Permissions and review

| Capability | Read-only | Propose | Scoped write |
| --- | --- | --- | --- |
| Read/search permitted context | Yes | Yes | Yes |
| Create a proposal | No | Yes | Yes |
| Apply create/update | No | After user approval | Automatic within explicit grant |
| Move/delete | No | After user approval | After user approval by default |
| Broad reorganization or undo | No | After user approval | After user approval |
| Change grants/security settings | No | No | No |

Proposals must be reviewable by their authorized owner and accessible only to permitted clients/users. Read-only clients should not receive unrelated pending private drafts.

Edits to `CONTEXT.md` deserve explicit review because they affect future agent behavior; exclude it from default automatic-write scope. Content must not change the actual enforcement policy.

## 8. Proposal state model

```text
proposed → approved → applying → applied
    |          |          |
    |          |          └→ reconcile ambiguous outcome before retry
    |          └→ conflicted / expired
    └→ rejected / expired / conflicted
```

Automatic-write grants authorize the apply transition without a user approval event; record that authorization source explicitly.

Approval binds the proposal ID, content digest, connection, and base revision. New content or a changed base requires a replacement proposal. A conflict preserves the original draft for explanation but cannot be silently resolved and applied under its old approval.

Use clear text in the interface:

- **Proposed:** “Review this change before it is saved.”
- **Applied:** “Saved to your context repository.” Include the commit link.
- **Conflicted:** “Your repository changed after this proposal was prepared. Generate a new proposal from the latest version.”
- **Expired:** “This proposal has expired. Generate a new proposal to continue.”
- **Uncertain:** “We are checking whether GitHub accepted this change.” Do not invite a duplicate submission before reconciliation.

## 9. Limits and errors

Provisional alpha limits: 1,000 Markdown files, 10 MiB searchable text, 128 KiB per document, and 20 affected files per change set. These values require measurement and can change before release.

Specify bounded result sizes, pagination, request quotas, proposal expiry, and draft retention in the final contract. Return structured errors such as `permission_denied`, `invalid_path`, `unsupported_file`, `limit_exceeded`, `stale_revision`, `approval_required`, `proposal_expired`, `rate_limited`, and `upstream_unavailable`.

Errors should indicate whether retry is useful and what the user or model must do next. Do not report “no matching context” when the search was incomplete or unauthorized.

## 10. Acceptance scenarios

The design is successful when these scenarios pass using two real clients:

1. A fact saved through one client is retrieved through another in a fresh conversation.
2. A correction updates the existing document without creating a duplicate or deleting unrelated facts.
3. Rejecting a proposal leaves the accepted branch unchanged.
4. Two concurrent proposals cannot overwrite each other's accepted changes.
5. Retrying an uncertain apply cannot create duplicate commits or apply a different change.
6. Read-only and path-restricted clients cannot mutate or retrieve forbidden content through any tool.
7. Revoking a grant prevents subsequent access.
8. A malicious document cannot change service permissions or approve itself.
9. A user can inspect history and apply a reviewed undo.
10. The repository remains readable and editable after ContextDB is disconnected.

Also evaluate retrieval relevance, unnecessary tool calls, duplicate facts, and organizational churn on a small realistic context corpus. These are model behavior issues as well as API issues.

## 11. Open decisions before building

- Select the first two supported clients and validate their current connection and authorization flows.
- Identify the intended OKF reference or remove the compatibility claim.
- Choose the final license and investigate the public project name.
- Finalize MCP schemas, protocol version compatibility, limits, retention, and permission semantics.
- Validate the GitHub atomic-write and conflict strategy, including branch restrictions and ambiguous network failures.
- Select hosting and framework only after the integration constraints are known.

See `plan.md` for sequencing. No implementation, account registration, deployment, or repository initialization is authorized by these design documents alone.
