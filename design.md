# OpenStore Product and Interface Design

Status: v0.1 in progress, September 6, 2026. This document defines intended behavior for the store, the
tools, and the consent model. Components and trust boundaries are in `architecture.md`. Motivation is in
`concept.md`. Sequencing is in `plan.md`.

## 1. Product promise

Your AI's memory is a Git repo you own. OpenStore never holds a copy.

An authorized AI reads and writes a private GitHub repository of plain Markdown. A different authorized AI
reads the same repository in a later conversation. The user can inspect every change in Git history,
correct it, or revert it.

The initial audience is people with a GitHub account. Start with personal and project facts, one private
repository per connection, and Claude Code as the first tested client. Defer shared team administration.

Signing in is the whole setup. The OpenStore GitHub App is the identity: the user authorizes it, we create
their store for them if they do not have one, and their AI is connected. No personal access token, no
copied repository name, no configuration file.

The product does not automatically receive all conversations. Whether a client searches or remembers
depends on its tool access, configuration, and model behavior. Client setup must explain how to use
OpenStore and show a successful recall test.

## 2. Guiding decisions

- The repository is the only source of truth. There is no database and no cache.
- Markdown stays understandable and editable without OpenStore.
- Prefer updating an existing document over duplicating knowledge. Preserve existing organization.
- Writes are direct commits to the configured branch. Consent happens in chat, before the write.
- Undo is a new commit. History is never rewritten and the ref is never force-pushed.
- Tools are bash-like because LLMs already know bash. Arguments are parsed with bash quoting rules. There
  is no real shell, no pipes, and no command execution.
- Service permissions live outside model-editable repository text. Repository prose cannot grant access.
- Make current head, incomplete results, and failure conditions explicit.

## 3. Primary user journeys

### Connect and create your store

This is the first journey, and it is the one the whole hosted design exists to make short. The user never
types a token, never copies a repository name, and never visits GitHub on their own initiative.

1. The user adds OpenStore to their AI. In Claude Code that is the plugin; in Claude.ai and ChatGPT it is
   the hosted MCP URL pasted into a custom connector.
2. The client starts the standard MCP OAuth flow and opens a browser at our `/authorize`.
3. The user signs in with GitHub through the OpenStore GitHub App. If the App is not installed on their
   account yet, we show one page with a single button that sends them to GitHub's install page, and GitHub
   returns them to us with our `state` intact.
4. We show one setup page (section 3.1). The default action creates their store. Advanced picks an
   existing repository or asks for read-only.
5. The browser hands the client its token. The tools work. The user has an OpenStore.

A returning user does not see step 4. If the App installation grants exactly one repository that has
`CONTEXT.md` at the root of its default branch, that is their store, and we show a one-click
confirmation page instead (section 3.2). We never issue a token without a click. Registration is open
to anyone, so a link the user did not start must not be able to finish on its own.

The site never does any of this. It explains the three steps and links to the plugin and connector
instructions. It has no button that touches GitHub, because a button there would need a backend and a
session, and we have neither.

Setup never overwrites an existing file. A repository chosen under Advanced is used exactly as it is; an
empty one is a perfectly valid store that the AI will fill.

#### 3.1 The setup page

One page, one obvious action. Rendered by `GET /callback`, submitted to `POST /callback/setup`, carrying a
sealed `pick` token in a hidden field. What the page actually says:

```text
Create your OpenStore

A new private repository on your GitHub account, made from the public OpenStore template.
It is yours: readable, editable and deletable by you, at any time, with or without any AI.

Connecting <client name> at <this computer | host>. If you did not just ask an AI client
to connect, close this tab - nothing has been created and nothing has been shared.

  Repository name  [ my-openstore                    ]
  Private. Created from intreaction/openstore-template.

  [ Create my OpenStore ]

  > Advanced - use a repository I already have

     ( ) owner/repo
     ( ) owner/other-repo

     [ ] Read-only access - the AI can search and read the store but never write to it.

     [ Use the selected repository ]
```

The "Connecting" line names the client that registered and the host its authorization code will be sent
to, because dynamic client registration means anyone can register a client. It is the one place a user can
notice a connection they did not start. When the client asked for `store:readonly`, the checkbox is shown
ticked and disabled with a line saying the client already fixed it.

When the App installation grants no repositories at all, the Advanced list is replaced by "The OpenStore
app does not have access to any repository yet. Create one above, or grant it access on GitHub and
reconnect."

The create action generates a private repository from the public `intreaction/openstore-template` and
polls for up to about ten seconds until its default branch appears, because template generation is
asynchronous. It cannot add the new repository to a "selected repositories" installation: GitHub's
`PUT /user/installations/{id}/repositories/{id}` works only for classic PATs, never for the user-to-server
token we hold. When the repository stays invisible past the poll, the flow ends on a short page that links
to `https://github.com/settings/installations/<id>` and offers a "I have added it - continue" button that
re-checks. Installations scoped to "all repositories" never reach that page.

Failures re-render the same page with a message above the form, never a stack trace:

| Situation | What the page says |
|---|---|
| Name already taken (GitHub 422) | `GitHub would not create <owner>/<name>: <GitHub's own message>` |
| Permission missing (GitHub 403) | `GitHub refused to create the repository. The OpenStore app needs "Administration: write" on your account to make one for you; you can also create it yourself and pick it under Advanced.` |
| Template unreachable and the fallback also failed | `The OpenStore template could not be reached and the repository could not be created. Try again, or create a repository yourself and pick it under Advanced.` |
| Repository chosen that is not in the sealed list | `Choose one of the repositories the OpenStore app can reach.` |
| Sealed `pick` expired | `That setup page has expired. Setup pages are good for ten minutes. Nothing was created. Start the connection again from your AI client.` |

Every page the flow renders is served with `Cache-Control: no-store`, `Referrer-Policy: no-referrer`,
`X-Frame-Options: DENY` and a content security policy of `default-src 'none'`, because these pages carry a
sealed token in a form field and none of them contain a script.

#### 3.2 The confirmation page

The returning user's page. Rendered by `GET /callback` when exactly one accessible repository already has
`CONTEXT.md`, submitted to `POST /callback/confirm`, carrying the same sealed `pick` token in a hidden
field. There is nothing to choose here, so there is one button. What the page says:

```text
Connect to <client name>

You already have an OpenStore. One click gives this client a token for that one repository
and nothing else. Nothing has been shared yet.

  <client name> at <this computer | host> is connecting.
  Any client can register that name, so check it is the one you just used.

  Store  owner/repo
  Read and write access. The AI can read this store and commit changes to it.
  (or: Read-only access. The AI can search and read this store but never write to it.)

  [ Connect to <client name> ]

  Use a different repository

If you did not just ask an AI client to connect, close this tab. Nothing has been shared
and nothing has been created.
```

This page exists because registration is open. Without it, a returning user who follows a crafted link
is handed a token for a client they never chose, and PKCE does not help: the hostile client holds the
verifier. So no authorization code leaves this server without a page that names who asked for it.

The button posts the sealed `pick` and the repository name. The handler checks that the repository is in
the `pick`'s own sealed list and then issues the code exactly as the setup page does for an existing
repository. Read-only comes from the sealed token, never from the form, so the confirmation cannot widen
what the client asked for. "Use a different repository" posts the same token back and renders the full
setup page, so nothing is lost by saying no. An expired or wrong-typed `pick` gets `That confirmation
page has expired. Confirmation pages are good for ten minutes. Nothing was connected. Start the
connection again from your AI client.`

### Remember a fact

User: "Remember that my Mac mini has 24 GB of RAM."

1. The AI reads `CONTEXT.md`, delivered as the MCP server instructions.
2. It runs `grep -ril 'mac mini'` to find where the fact belongs.
3. It runs `cat technology/computers.md` to read the current document.
4. It shows the user the exact text it intends to write and why it belongs there.
5. After the user agrees, it calls `write` with the whole updated file.
6. The client also prompts before running a write tool, so the user confirms twice.
7. The AI reports the short sha printed by `write`.

The AI must distinguish "written" from "not yet written". A refused or failed write is never described as
remembered.

### Recall from another AI

A second client points at the same repository. It searches with `grep`, lists with `ls` or `tree`, and
reads with `cat`. It cites source paths when explaining where context came from. Every read sees the
current head of the configured branch, so a fact written a minute ago in one client is visible in the
next.

Test both explicit requests such as "check my store" and ordinary questions whose answers benefit from
stored facts. The second is a product-quality question, not a guarantee of the tool contract.

### Correct or undo

A correction is an ordinary `write` on the existing document, agreed in chat first.

An undo is `git_revert <sha>`. That creates a new commit reversing the original. Git history keeps both.
If a later change touched the same lines, the revert fails and the AI must show the current content and
propose a fresh `write`.

Explain honestly that removing sensitive content from the current document does not erase it from older
commits. Removing it from history is a Git operation the user performs on their own repository.

### Use a read-only client

A client can be read-only in two ways. The user can tick "read-only access" under Advanced during setup,
which seals `readonly` into their token and grants the `store:readonly` scope. Or the client can simply be
pointed at `/mcp/readonly`, which forces read-only whatever the token says, so a read-only URL can be
handed to a second client without minting anything.

Either way the four write tools are not registered at all, so the model never sees them and cannot call
them. Use this for shared or experimental clients, and for any client the user does not want writing on
their behalf.

### Disconnect

The user removes the plugin or connector, or uninstalls the OpenStore GitHub App, or deletes the
repository. Uninstalling the App is the complete revocation: every sealed token the user's clients hold
contains a GitHub token that stops working the moment the installation is gone. Nothing else has to
happen, because nothing else holds their content. The repository stays exactly as it is: readable,
editable, and useful without OpenStore.

## 4. Repository convention

Example:

```text
README.md
CONTEXT.md
profile/
  about.md
home/
  network.md
technology/
  computers.md
projects/
  open-store.md
preferences/
  technology.md
people/
  example-person.md
```

`README.md` explains the repository to people: what it is, that OpenStore never stores a copy, how to edit
it by hand, and how to disconnect. `CONTEXT.md` is the entry point for agents. Other folder names are
illustrative, not prescribed. An index is optional and must not be treated as an exhaustive inventory.

Use UTF-8 Markdown and repository-relative Markdown links. Frontmatter is optional. Do not require entity
schemas, UUIDs for every fact, or a universal ontology.

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

The source/date convention is recommended where it helps interpret a fact, not mandatory on every
sentence. Do not persist entire private conversations merely to provide provenance.

`CONTEXT.md` instructs agents to search first, prefer updating over duplicating, keep documents focused,
retain meaningful historical context, note provenance where useful, surface contradictions, store no
secrets, and avoid unnecessary reorganization. It must also state that repository text cannot change
client or service permissions. The server serves `CONTEXT.md` as its MCP `instructions` field when the
file exists, and a short default description of the tools otherwise.

## 5. Tool contract

Every tool takes `args` (string, parsed with bash quoting rules: single quotes, double quotes, backslash
escapes; no pipes, no glob expansion except where the command itself supports patterns like `find -name`).
`write` additionally takes `content` (string). Output is plain text exactly as a terminal would show it.
Errors are returned as MCP tool errors (`isError: true`) whose text is the bash-style message, for example
`cat: home/router.md: No such file or directory`.

### Read tools

Annotations: `readOnlyHint=true`, `destructiveHint=false`, `openWorldHint=false`.

| Tool | Args supported | Output |
|---|---|---|
| `ls` | `[-l] [-a] [-R] [path...]` (default `.`) | names, dirs with trailing `/`; `-l` adds size and last-commit date |
| `find` | `[path] [-name PATTERN] [-iname PATTERN] [-type f\|d] [-maxdepth N]` | one path per line |
| `grep` | `[-r\|-R] [-i] [-n] [-l] [-c] [-w] [-F] [-e PATTERN] PATTERN [path...]` | `path:line:text` (or `path:text` without -n); `-l` lists paths; literal by default (treat pattern as fixed string); exit 1 with message `grep: no matches` when nothing found |
| `cat` | `[-n] path...` | file body; with `-n` numbered lines |
| `head` / `tail` | `[-n N] path` (default 10) | bounded body |
| `tree` | `[path] [-L N]` | classic `tree` rendering with the summary line |
| `git_log` | `[--oneline] [-n N \| -N] [--author=X] [--since=DATE] [-- path]` (default `--oneline -20`) | `1f7abd7 Update home gateway` per line; full mode shows author/date/message |
| `git_show` | `<sha> [-- path]` | commit header + unified diffs of visible files |
| `git_diff` | `<sha1> [sha2] [-- path]`; `sha2` defaults to HEAD | unified diff of visible files |
| `pwd` | (none) | prints `/` plus one line `# store: owner/repo@branch (head 1f7abd7)` |

Short shas are seven characters, the same width `git log --oneline` uses. `--author=X` is passed
through to GitHub, which matches a login or an email address, not a display name.

Two small, deliberate departures from real bash. `grep` searches a directory operand recursively
whether or not `-r`/`-R` is given, because erroring with "Is a directory" would only cost the model a
turn; the flags are accepted for familiarity. `ls -a` is likewise accepted and changes nothing, since
a store has no visible dot-entries.

### Write tools

Annotations: `readOnlyHint=false`; `rm` and `git_revert` carry `destructiveHint=true`.

Each call is exactly ONE commit to the configured branch, created with the current head as parent and
applied with a non-forced ref update. If the ref moved concurrently, the server retries the whole
read-modify-commit cycle up to 3 times, then fails with
`error: failed to push: branch advanced concurrently, retry`.

| Tool | Args | Output |
|---|---|---|
| `write` | `[-m MESSAGE] [-a] path` + `content` | create or replace whole file (`-a` appends). Creates parent folders implicitly. Prints `wrote technology/computers.md (+3 -1) @ 1f7abd7` |
| `mv` | `[-m MESSAGE] src dst` | rename; fails if dst exists; supports moving a directory. Prints `renamed home/old.md -> home/network.md @ 1f7abd7` |
| `rm` | `[-m MESSAGE] [-r] path...` | delete; refuses a directory without `-r`. Prints `removed home/old.md @ 1f7abd7` |
| `git_revert` | `[-m MESSAGE] <sha>` | new commit that reverses that commit's visible-file changes; fails if it would conflict with later changes to the same files. Prints `reverted 1f7abd7 "Record Mac mini RAM" @ e51d0bf` |

Default commit messages when `-m` is omitted: `write <path>`, `mv <src> -> <dst>`, `rm <path>`,
`revert <shortsha>: <original subject>`. Commit author and committer are the token's GitHub user. Every
commit gets a trailer line `OpenStore-Client: <client label>`, where the label comes from config and
defaults to `openstore`.

A `write` whose content already matches the file makes no commit at all. It prints
`wrote <path> (+0 -0) @ <head> (unchanged)` rather than adding an empty commit to history.

Read-only mode: when enabled, the four write tools are not registered at all.

Server info: `serverInfo.name = "openstore"`, version `0.1.0`.

### Example calls and outputs

Locate a fact:

```text
grep  args: -ril "mac mini"
technology/computers.md
```

Read the document:

```text
cat  args: -n technology/computers.md
     1	# Computers
     2	
     3	- Mac mini (M4, 24 GB RAM), used for small local AI projects.
```

Write the agreed change:

```text
write  args: -m "Record Mac mini RAM" technology/computers.md
       content: "# Computers\n\n## Mac mini\n\n- RAM: 24 GB.\n- Main use: small local AI projects.\n"
wrote technology/computers.md (+3 -2) @ 1f7abd7
```

Confirm where you are:

```text
pwd
/
# store: intreaction/my-openstore@main (head 1f7abd7)
```

See recent history:

```text
git_log  args: --oneline -5
1f7abd7 Record Mac mini RAM
41b0de4 write home/network.md
0c7ea23 Update home gateway
77d915b write profile/about.md
e5a5125 Initial store from template
```

Inspect one commit:

```text
git_show  args: 1f7abd7
commit 1f7abd7bd66046599c4cdf42770f60326592e9d2
Author: John Wheeler <john@example.com>
Date:   Sun Sep 6 12:02:00 2026 +0000

    Record Mac mini RAM

    OpenStore-Client: claude-code

diff --git a/technology/computers.md b/technology/computers.md
--- a/technology/computers.md
+++ b/technology/computers.md
@@ -1,3 +1,6 @@
 # Computers
 
-- Mac mini (M4, 24 GB RAM), used for small local AI projects.
+## Mac mini
+
+- RAM: 24 GB.
+- Main use: small local AI projects.
```

Undo it:

```text
git_revert  args: 1f7abd7
reverted 1f7abd7 "Record Mac mini RAM" @ e51d0bf
```

A miss, a missing file, and a path that leaves the repo:

```text
grep  args: -r "sailboat"
grep: no matches

cat  args: home/router.md
cat: home/router.md: No such file or directory

cat  args: ../secrets.md
cat: ../secrets.md: Permission denied
```

There is no staging area, no `git_commit`, no branch switching, no force push, and no shell. Each write
tool commits by itself.

## 6. Sandbox and visibility

Only repository-relative paths are accepted. There are two distinct rejections, and the difference is
deliberate.

**Escaping the sandbox is refused, and says so.** `..`, absolute paths, `//`, backslashes, and a leading
`~` give `Permission denied`. The path never existed inside the store, so saying "not found" would only
teach the model to retry the same shape. `cat: ../secrets.md: Permission denied` tells it to use a
repo-relative path instead.

**Everything else is invisible rather than forbidden.** Dotfiles and dot-directories (`.git`, `.github`,
`.claude`, and the rest) and any file outside the visible types (`.md`, `.markdown`, `.txt`, `.yml`,
`.yaml`, `.json`, `.csv`) report exactly the `No such file or directory` a missing file would. They are
never listed, never read, never written, and never appear in a diff. A model cannot discover what it
cannot see, and an error message never leaks the existence of an excluded file.

`ls -a` is accepted for familiarity and changes nothing, because a store has no visible dot-entries.

## 7. Consent model

Consent has two layers, and neither is a web page.

**In chat.** The model finds the relevant document, shows the user the change it intends to make, and
writes only after the user agrees. The skill instructs the model to do this and to report the resulting
short sha. This is the layer that carries meaning, because it is where the user sees the actual text.

**In the client.** Claude prompts before running a write tool. ChatGPT respects `readOnlyHint` and treats
the unannotated tools as writes. The annotations exist so clients can enforce this without knowing
anything about OpenStore. A read-only deployment removes the question entirely by not registering write
tools.

A boolean such as `approved: true` supplied by the model is not evidence of user approval, so no tool
accepts one. Approval is not a server-side object with a lifetime. There is no proposal to expire, no
review URL to leak, and no pending draft for another client to read.

The user's real backstop is Git. Every write is a commit with a message, an author, a client trailer, and a
diff. Nothing is silent. Anything wrong is revertible.

## 8. Limits and error messages

- Max file size: 128 KiB.
- Max tool output: 64 KiB, then a final line `... (output truncated, N more lines)`.
- Max visible files: 5,000. `grep` and `find` stop and print `(search incomplete: file limit reached)` if
  exceeded.

Errors read like bash, say what to do next, and never invent a result:

| Situation | Message |
|---|---|
| Missing file | `cat: home/router.md: No such file or directory` |
| Invisible file or dot-path | `cat: .github/workflows/ci.yml: No such file or directory` |
| Escaping the repo | `cat: ../secrets.md: Permission denied` |
| Directory without `-r` | `rm: cannot remove 'projects': Is a directory` |
| Existing destination | `mv: cannot move 'profile/about.md' to 'home/network.md': File exists` |
| Unknown flag | `ls: invalid option -- 'z'` |
| Unknown commit | `fatal: bad object deadbeef` |
| No search results | `grep: no matches` (exit 1) |
| Truncated search | `(search incomplete: file limit reached)` |
| Truncated output | `... (output truncated, N more lines)` |
| Concurrent write | `error: failed to push: branch advanced concurrently, retry` |
| Conflicting revert | `error: could not revert 1f7abd7: technology/computers.md has changed since that commit` |
| File too large | `write: technology/computers.md: file too large (max 128 KiB)` |

Never report "no matching context" when the search was incomplete. Never report a write as done when the
push failed.

## 9. Acceptance scenarios

The design is successful when these pass against a real private repository:

1. A fact written through one client is retrieved through another in a fresh conversation.
2. A correction updates the existing document without creating a duplicate or deleting unrelated facts.
3. Every write appears in `git_log` as exactly one commit with a readable message and the client trailer.
4. `git_revert` on that commit restores the previous content as a new commit, and history keeps both.
5. A revert that conflicts with later changes fails clearly instead of clobbering them.
6. Two concurrent writes both land: the second retries against the new head and neither is lost.
7. A read-only client does not expose `write`, `mv`, `rm`, or `git_revert` at all.
8. No tool reaches `.git`, `.github`, a path containing `..`, or a non-text file, and none of them appear
   in any listing.
9. A malicious document in the store cannot change permissions, register a tool, or authorize a write.
10. Output above the limits is truncated with the truncation line rather than silently cut.
11. The repository remains readable and editable after OpenStore is disconnected.
12. A new user with no App installation goes from "add the connector" to a working private store without
    typing a token or a repository name.
13. The same user connecting a second client sees no setup page, because their one store is found. They
    see the confirmation page instead, and no code is issued until they press its button.
14. A client pointed at `/mcp/readonly` gets no write tools even with a token that permits writes.
15. An authorization code fails at `/token` when the `code_verifier` does not match the challenge, and the
    same code presented with the right verifier after five minutes fails as expired.
16. No sealed token is ever accepted in another token's slot: a `state` is not a `client_id`, an `access`
    is not an authorization code, and none of them is a bearer token at `/mcp`.
17. A hostile `client_name` or a hostile message from GitHub is rendered as text, never as markup.
18. A deploy with no `GITHUB_APP_ID` refuses the whole sign-in flow rather than listing another App's
    installations.
19. `POST /callback/confirm` refuses a repository outside the sealed `pick` list, a token of the wrong
    type, and an expired one, and read-only survives the confirmation.

Also evaluate retrieval relevance, unnecessary tool calls, duplicate facts, and organizational churn on a
small realistic corpus. Those are model behavior questions as much as contract questions.

## 10. Open questions

- Confirm that Claude.ai custom connectors and ChatGPT Developer Mode complete our OAuth flow as written,
  including dynamic registration, PKCE, and the resource metadata document.
- Confirmed, not open: `POST /repos/{template}/generate` works with a user-to-server token and needs
  `Administration: write` plus `Contents: read`. The `POST /user/repos` fallback needs the same
  `Administration: write`, so the App cannot create a store without it.
- Decided, not open: a returning user gets a one-click confirmation naming the client before we hand it a
  token. Registration is open to anyone, so a single crafted link used to carry a user who had already
  authorized the App straight through to a token for a client they never chose. PKCE stops a passive
  attacker but not a client the user was tricked into authorizing. Section 3.2 is the page; every
  authorization code now passes a page that names the client and the host it will be sent to.
- Measure real limits: file count, search latency, and output size on a store that has grown for months.
- Decide how much of `git_diff` and `git_show` output is useful to a model versus noise.
- Decide whether the setup page should offer an organization owner as well as the signed-in user.
- Keep self-hosting the honest answer for users who want no operator in the path.
- Decide whether `find` and `grep` need pagination once stores get large.

See `plan.md` for sequencing and `architecture.md` for the trust boundaries these decisions rest on.
