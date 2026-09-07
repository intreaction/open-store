# OpenStore Concept

Status: v0.1 in progress, September 6, 2026.

Companion documents: `architecture.md` (components and data flow), `design.md` (tool contract and
implementation detail), `plan.md` (phases and sequencing).

---

## 1. What OpenStore is

OpenStore gives any AI a durable, user-owned **store**: a private GitHub repository of plain Markdown
that the AI reads and writes through MCP using bash-like tools.

The one-line promise:

> **Your AI's memory is a Git repo you own. OpenStore never holds a copy.**

The repository is the only source of truth. The server is a stateless pass-through. There is no
database, no cache, and no second copy of your knowledge anywhere.

---

## 2. Thesis

AI memory today is fragmented. A person may have ChatGPT memory, Claude memory, local-model memory,
project notes in Obsidian, business context in Notion, and technical context in GitHub. Each system
builds its own partial picture.

That fragmentation causes real problems:

1. **Lock-in.** Context stored in one vendor's memory is not available to another.
2. **Duplication.** The same facts get retyped into every tool.
3. **Opacity.** You cannot see exactly what was remembered or how to correct it.
4. **Poor portability.** Switching models means losing accumulated context.
5. **Unclear authority.** Different systems hold conflicting versions of the same fact.
6. **Bloat.** Many useful facts are too obscure to belong in an always-loaded memory layer.

OpenStore separates durable context from the model consuming it. The model becomes replaceable. The
context remains.

The long-term goal is not another proprietary memory platform. It is a small open convention for
persistent AI context.

---

## 3. Why Git

Git gives the project several things for free that would otherwise require infrastructure.

- **History.** Every change is traceable to a commit.
- **Rollback.** A bad write is undone with a new commit that reverses it.
- **Diff.** You can see exactly what an AI changed.
- **Provenance.** A commit records who wrote, when, and why.
- **Portability.** Clone it anywhere. Move it to another host.
- **Synchronization.** Multi-device replication is already solved.
- **Privacy.** A private GitHub repo is already private, already backed up, already authenticated.

Because Git does the hard parts, OpenStore itself can stay tiny and free.

One consequence matters more than the rest. If OpenStore disappears tomorrow, your store is still a
folder of Markdown files with full history. Nothing needs to be exported.

---

## 4. Why Markdown

Markdown is readable by people and by models with no adapter in between.

You can clone the store and edit it in VS Code, in Obsidian, in a text editor, or directly on
github.com. Directories carry subject grouping. Links connect related documents. Optional YAML
frontmatter adds light metadata. A root `CONTEXT.md` explains the store to agents.

The content carries most of the meaning. That is the point. There is no proprietary binary format
standing between you and your own knowledge.

---

## 5. User flow

1. Visit the OpenStore site.
2. Click "Create your store". GitHub creates a private repository from the OpenStore template.
3. Install the OpenStore plugin in Claude. Claude Code first, other clients later.
4. Talk normally.

Behind the conversation, the AI searches the store to recall and commits to remember. There is no
separate app to visit, no inbox of pending changes, and nothing to approve on a web page.

Recall looks like this:

```text
grep -ril "router"
cat home/network.md
```

Remembering looks like this:

```text
write -m "Update home gateway" home/network.md
wrote home/network.md (+1 -1) @ 1f7abd7
```

Consent happens in the conversation. The model shows the exact change, then writes after you agree.
Claude and ChatGPT also prompt before running write tools, so there is a second gate at the client.
Undo is `git_revert`, which adds a new commit. History is never rewritten and the branch is never
force-pushed.

---

## 6. Zero access and no retention, stated honestly

The hosted server holds nothing between requests. No database, no key-value store, no SQLite, no
disk files, no in-memory state that outlives a single tool call. Content and credentials pass through
process memory during a request and are never written down. Logs record the tool name, exit code,
duration, and byte counts. Never content.

Here is the honest part. A hosted operator *could* read traffic in flight. Any pass-through service
could. What OpenStore promises is that nothing is retained, and that you can remove even the
in-flight exposure by running the same code yourself.

What backs the claim:

- Open source under Apache-2.0, so the code can be read.
- A deploy configuration with no storage bindings at all.
- Reproducible builds.
- One-click self-hosting of the identical server.

A private GitHub repository is private. It is not a secrets vault. Passwords, API keys, private
keys, identity documents, and financial or medical credentials do not belong in a store. Preferences,
equipment, projects, procedures, and durable facts do.

---

## 7. Bash-like tools as the deliberate interface

Models already know bash. They have read millions of lines of it. So the store speaks bash.

The tools are `ls`, `find`, `grep`, `cat`, `head`, `tail`, `tree`, `pwd`, `git_log`, `git_show`,
`git_diff` for reading, and `write`, `mv`, `rm`, `git_revert` for changing. Output is plain text
exactly as a terminal would print it. Errors read like bash errors, for example
`cat: home/router.md: No such file or directory`.

This is not a real shell, and that is deliberate. Each tool takes an `args` string that the server
parses with bash quoting rules. There are no pipes, no subprocesses, and no host filesystem. Only
repo-relative paths resolve. Paths with `..`, absolute paths, `//`, backslashes, and a leading `~`
are refused with `Permission denied`. Dot-directories and every file type outside
`.md .markdown .txt .yml .yaml .json .csv` are invisible rather than forbidden: asking for one
returns the same `No such file or directory` a missing file would.

The gain is that no domain-specific vocabulary has to be invented. There is no `get_vehicle()` or
`update_customer()` to learn. A model that can use a terminal can use a store on its first try.

Each write tool call is exactly one commit on the branch. `design.md` carries the full contract.

---

## 8. Soft schema

Traditional databases demand a schema up front. A store uses a soft one.

The rule is simple:

> Follow the organizational patterns already present in the store.

A model inspects before it decides. Told "I replaced my router with a UDM Pro Max", it searches for
existing network notes, reads `home/network.md`, and updates that file rather than creating a second
one. If no relevant structure exists, it creates one.

A personal store may grow toward `home/`, `technology/`, `projects/`, `preferences/`, `people/`. A
company store may grow toward `customers/`, `products/`, `policies/`, `decisions/`. A research store
may grow toward `papers/`, `experiments/`, `findings/`. The organization emerges from the information
being stored.

This avoids inventing a universal ontology for people, businesses, and projects. Human knowledge is
too varied for one, and LLMs are already good at pulling structure out of prose.

---

## 9. LLM as librarian

The model is not only querying the store. It can keep it.

Librarian work includes deciding where information belongs, merging duplicates, updating stale facts,
creating topic files, linking related documents, splitting oversized files, and surfacing
contradictions.

One rule keeps this from going wrong:

> Preserve existing organization unless a change gives a clear retrieval or maintenance benefit.

Without it, each model reorganizes the store to its own taste, and the history fills with churn.
Continuity beats tidiness.

The standing instructions live in the store itself, in `CONTEXT.md`, which the server also serves as
its MCP instructions. Text in the store can shape organization. It can never change permissions.

---

## 10. What this is for

The same design serves several kinds of context.

- **Personal.** Devices, home network, preferences, recurring projects, people, durable notes.
- **Business.** Customers, vendors, products, policies, procedures, decisions, meeting summaries.
- **Project.** Architecture decisions, requirements, research, open questions, experiments.
- **Agent.** Goals, operating procedures, prior decisions, tool notes, lessons learned.

For business use the audit trail matters most. A commit says which agent changed a customer record,
when, and what the previous value was. Traditional AI memory offers nothing comparable.

---

## 11. Not a database, not a note app

OpenStore is not a note-taking app, a wiki, a memory SaaS, a vector database, an ontology, or a CRM.
Users already have good editors, and embeddings are not the core problem. Ordinary text search over a
few thousand Markdown files works well, and no embedding index gets added until real usage proves
plain search is insufficient.

The differentiator is a portable, writable, authoritative context layer shared across AI systems. The
interesting problem is not retrieval. It is deciding what from a conversation deserves to become
durable, and writing that down where the user can see it.

---

## 12. Open source, standard before product

The reference implementation is Apache-2.0 and public. Anyone can read it, fork it, or run it.

The more valuable artifact may be the convention rather than the hosted service. The format is small
enough to state in full:

1. Context lives in human-readable files.
2. Markdown is the preferred format.
3. A root manifest explains the store to agents.
4. Agents inspect existing organization before creating new structure.
5. Agents prefer updating existing knowledge over creating duplicates.
6. Git history is preserved and never rewritten.
7. Secrets are not stored.
8. Implementations must prevent access from escaping the store root.
9. Tool behavior is consistent across implementations.
10. Users retain full ownership and portability.

Anyone can build a compatible implementation against that. The three artifacts that matter are the
store convention, the tool contract, and one reference server. Everything else is optional.

Sustainability follows from the architecture. GitHub provides storage, auth, sync, history, and
backups. The user's AI provider provides inference. OpenStore provides a thin translation layer with
no state to pay for. There is no vector database, no GPU, and no hosted user database to fund.

---

## 13. Naming note

This project was formerly called ContextDB, and before that MeDB. Both names were retired.
"Database" implied SQL, rigid schemas, and a system that holds your data. OpenStore holds nothing.
The name says what it is: an open store that you own.

---

## 14. Design principles

1. The user owns the bytes.
2. The Git repository is the only source of truth.
3. The server keeps nothing between requests.
4. Markdown stays human-readable without our software.
5. Tools behave like bash because models already know bash.
6. Writes are ordinary commits, one per tool call.
7. History is append-only. Undo is a revert, never a rewrite.
8. Existing organization is respected by default.
9. Implementations are replaceable, and self-hosting is a first-class path.
10. No infrastructure is added until real usage proves it necessary.
11. The core stays free and open.
12. Context survives model and vendor changes.

---

## 15. Open questions

- How much autonomy should a model have to restructure a store?
- Should frontmatter and wiki-style links be standardized or left optional?
- When two agents write at once, is retry-on-conflict enough, or should conflicts surface in chat?
- Should encrypted files or secret references ever be supported, or is "no secrets" the permanent answer?
- Do non-GitHub backends (GitLab, Gitea, local Git) justify the abstraction cost?
- Is plain text search sufficient at ten thousand files, and what is the honest ceiling?

---

## 16. North star

> Applications should not each own an isolated AI memory. People and organizations should own an
> authoritative store that any authorized AI can use.

Or more simply:

> **Your AI changes. Your context doesn't.**
