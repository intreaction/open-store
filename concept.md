# ContextDB / MeDB Concept Brief

## 1. Executive Summary

**ContextDB** is a free, open, Git-backed context repository for AI systems.

The core idea is simple:

> Give any AI a durable, user-controlled context repository that survives across models, vendors, devices, and sessions.

Instead of relying on each AI provider's proprietary memory layer, ContextDB uses a Git repository as the durable source of truth. The repository contains human-readable Markdown files organized using an OKF-inspired structure. An MCP server provides consistent read/write access to that repository so ChatGPT, Claude, local models, coding agents, business agents, and other MCP-compatible systems can all work against the same context.

The repository may contain personal, project, team, or business knowledge. The model is allowed to read, search, create, update, reorganize, and delete information within defined permissions. Git provides storage, history, rollback, provenance, synchronization, and portability.

The service itself should remain as thin as possible.

The long-term goal is not to create another proprietary AI memory platform. The goal is to define a simple, open convention for persistent AI context.

---

## 2. Core Thesis

AI memory is currently fragmented.

A user may have:

- ChatGPT memory
- Claude memory
- local-model memory
- project-specific memory
- notes in Obsidian
- business context in Notion
- technical context in GitHub
- personal facts scattered across files and apps

Each system develops its own partial representation of the user, business, or project.

This creates several problems:

1. **Vendor lock-in**  
   Context stored in one AI's memory system is not automatically available to another.

2. **Duplication**  
   The same facts are stored repeatedly across tools.

3. **Opacity**  
   Users may not know exactly what an AI has remembered, how it organized that information, or how to correct it.

4. **Poor portability**  
   Switching models or vendors means losing accumulated context.

5. **Unclear authority**  
   Different systems may hold conflicting versions of the same fact.

6. **Bloated memory systems**  
   Many useful facts are too obscure or infrequently relevant to belong in a model's always-loaded memory layer.

ContextDB addresses these problems by separating **durable context** from **the model consuming it**.

The model becomes replaceable.

The context remains.

---

## 3. Product Definition

ContextDB is:

> **An open, Git-backed context repository exposed to AI systems through MCP.**

The core stack is:

```text
Git        = durable storage, synchronization, versioning, rollback
Markdown   = human-readable and AI-readable knowledge representation
OKF        = organizational frame / interoperability convention
MCP        = standard access layer for AI systems
LLM        = librarian, organizer, reader, and editor
```

The simplest possible architecture is:

```text
AI Client
   |
   | MCP
   v
ContextDB MCP Server
   |
   | GitHub API / Git operations
   v
User-owned Git repository
```

The Git repository is the source of truth.

ContextDB does not need to own the user's data.

---

## 4. Intended Use Cases

The same system should work for multiple kinds of context.

### 4.1 Personal context

Examples:

- computers and devices
- car information
- home network
- preferences
- recurring projects
- household information
- education context
- travel preferences
- hobby information
- important relationships
- durable personal notes

Example:

```text
personal/
├── profile/
├── home/
├── technology/
├── preferences/
├── projects/
├── education/
└── people/
```

### 4.2 Business context

Examples:

- customers
- vendors
- products
- policies
- operating procedures
- strategic decisions
- projects
- organizational knowledge
- meeting summaries
- sales information
- implementation notes

Example:

```text
company/
├── customers/
├── vendors/
├── products/
├── policies/
├── processes/
├── decisions/
├── projects/
└── meetings/
```

### 4.3 Project context

Examples:

- architecture decisions
- requirements
- research
- design notes
- open questions
- implementation history
- experiments
- decisions

### 4.4 Agent context

An agent could maintain its own durable repository containing:

- goals
- operating procedures
- previous decisions
- tool notes
- workflows
- lessons learned
- long-running task state

---

## 5. Product Philosophy

### 5.1 The user owns the bytes

Context should live in infrastructure controlled by the user.

For the initial implementation, that is likely a private GitHub repository.

The project may later support:

- GitLab
- Gitea
- Forgejo
- local Git
- self-hosted Git servers
- other Git-compatible backends

### 5.2 The AI provider does not own the memory

ChatGPT, Claude, local models, and other AI systems should all be clients of the same context repository.

```text
                    Context Repository
                           |
          +----------------+----------------+
          |                |                |
       ChatGPT          Claude          Local AI
```

### 5.3 Context should remain useful without ContextDB

If the software disappears, the repository still contains ordinary Markdown files.

The user should be able to:

- clone it
- browse it
- edit it in VS Code
- edit it in Obsidian
- inspect history with Git
- move it to another Git provider
- build another MCP server against it

There should be no proprietary binary database required to recover the user's knowledge.

### 5.4 Prefer convention over platform

ContextDB should define a small, understandable convention rather than become a large SaaS platform.

The protocol and repository format should be more important than any hosted implementation.

---

## 6. Repository as the Database

The Git repository functions as the durable database.

Example:

```text
context/
├── README.md
├── index.md
├── profile/
├── people/
├── places/
├── things/
├── projects/
├── decisions/
├── preferences/
└── archive/
```

However, this structure should not be rigid.

A major principle is:

> **The LLM may decide how to organize information within the OKF/context framework.**

A personal repository may evolve toward:

```text
home/
school/
technology/
projects/
preferences/
```

A company repository may evolve toward:

```text
customers/
operations/
products/
people/
policies/
decisions/
```

A research repository may evolve toward:

```text
papers/
experiments/
datasets/
findings/
questions/
```

The organization should emerge from the information being stored.

---

## 7. OKF-Inspired Frame

ContextDB should avoid inventing a large ontology.

Instead, it should use a lightweight OKF-inspired frame:

- Markdown is the primary representation.
- Directories establish subject grouping.
- Links connect related documents.
- Optional YAML frontmatter provides lightweight metadata.
- A root README or manifest explains the repository to agents.
- The content itself carries most of the semantics.

Example file:

```markdown
---
type: device
title: Mac mini
tags:
  - computer
  - local-ai
updated: 2026-09-06
---

# Mac mini

M4 Mac mini with 24 GB RAM.

Primarily used for personal projects and small-scale local AI work.

## Related

- [[home-network]]
- [[local-ai-projects]]
```

The framework should not require a complete schema for every possible human or business concept.

LLMs are already good at extracting structure from prose.

---

## 8. Soft Schema

Traditional databases require predefined schema.

ContextDB can use a **soft schema**.

The rule is:

> Follow the organizational patterns already present in the repository.

The LLM should inspect the repository before deciding where new information belongs.

For example, when told:

> "I replaced my router with a UDM Pro Max."

The model might:

```text
find network
read home/network.md
```

Then decide that the existing file should be updated rather than creating another document.

If no relevant structure exists, the model may create one:

```text
home/
└── network.md
```

This gives the system adaptability without requiring a universal ontology for people, businesses, or projects.

---

## 9. LLM as Librarian

The LLM is not merely querying the repository.

It can act as its librarian.

Responsibilities may include:

- deciding where information belongs
- merging duplicate information
- updating stale facts
- maintaining indexes
- creating new topic files
- linking related information
- archiving obsolete information
- splitting oversized files
- detecting contradictory facts
- identifying structural problems

However, the system should favor continuity over unnecessary reorganization.

A useful guiding instruction:

> Preserve existing organization unless a change provides a clear retrieval or maintenance benefit.

Otherwise, different models may repeatedly reorganize the repository according to their own preferences.

---

## 10. MCP Interface

The MCP server should expose repository operations in a form that LLMs already understand naturally.

The strongest model is **safe Bash-like access** rather than arbitrary raw shell execution.

### 10.1 Why shell-like semantics

Models already understand commands such as:

```text
ls
find
grep
cat
mkdir
mv
cp
rm
```

This reduces the need to create domain-specific tools like:

```text
get_vehicle()
update_customer()
find_preference()
```

The model can instead work directly with the repository.

### 10.2 Do not expose unrestricted Bash

The system should not provide arbitrary host shell access.

Raw Bash introduces unnecessary risks:

- host filesystem access
- environment-variable leakage
- SSH key access
- arbitrary network requests
- package installation
- subprocess execution
- command injection
- privilege escalation
- accidental destructive commands

Instead, expose a virtual, repository-scoped shell.

Example MCP operations:

```text
pwd
ls
find
grep
cat
head
tail

mkdir
mv
cp
rm
write
patch

git_status
git_diff
git_log
git_commit
git_revert
```

The MCP server interprets these operations safely.

---

## 11. Structured Tool Alternative

Rather than accepting raw shell strings, tools may be structured.

Example:

```json
{
  "command": "grep",
  "args": ["-R", "Mac mini", "technology/"]
}
```

or:

```json
{
  "command": "read",
  "path": "home/network.md"
}
```

Structured commands make it easier to:

- validate paths
- enforce permissions
- prevent shell injection
- audit operations
- restrict destructive behavior

The model still experiences familiar filesystem semantics.

---

## 12. Core MCP Tool Set

A minimal first version could expose:

### Navigation

```text
repo_list(path)
repo_find(query, path?)
repo_search(query)
repo_read(path)
```

### Mutation

```text
repo_create(path, content)
repo_patch(path, patch)
repo_move(source, destination)
repo_delete(path)
repo_mkdir(path)
```

### Git

```text
git_status()
git_diff()
git_log(path?)
git_commit(message)
git_revert(commit)
```

### Higher-level optional tools

```text
propose_update(...)
review_structure()
find_duplicates()
rebuild_index()
```

The project should begin with the smallest reliable tool surface possible.

---

## 13. Git as the Transaction and History Layer

Git provides several important capabilities for free.

### Version history

Every change can be traced.

```text
commit abc123
Author: chatgpt
Update home network gateway
```

### Rollback

Bad AI changes can be reverted.

### Diff

Users can see exactly what an AI changed.

```diff
- Gateway: Amplifi Alien
+ Gateway: UDM Pro Max
```

### Provenance

A commit can identify:

- which model made a change
- when it occurred
- why it occurred
- what files changed

### Portability

The repo can be cloned anywhere.

### Synchronization

Git already solves multi-device replication.

This avoids building a custom synchronization service.

---

## 14. Mutation Model

A key design choice is whether AI systems may write automatically.

ContextDB should support multiple permission levels.

### Read only

The model may search and retrieve context.

### Read + propose

The model can prepare changes but requires user approval before committing.

### Read + write

The model may update approved portions of the repository automatically.

### Administrative

The model may:

- restructure directories
- delete files
- perform broad refactors
- revert history

A good default is likely:

> **Read automatically; propose durable changes.**

More trusted agents can be granted stronger permissions.

---

## 15. GitHub Authentication

The simplest user experience is:

1. Sign in with GitHub.
2. Install the ContextDB GitHub App.
3. Grant it access to one selected repository.
4. Create or select the context repository.
5. Connect an AI client.

A GitHub App is likely preferable to broad OAuth permissions because repository access can be narrowly scoped.

The desired permission is approximately:

```text
Repository contents: Read and write
```

Potential additional permissions should be minimized.

The application should not require access to unrelated repositories.

---

## 16. User Experience

The ideal onboarding experience should be extremely simple.

```text
Connect GitHub
      ↓
Choose repository
      ↓
Initialize Context Repository
      ↓
Connect AI
      ↓
Done
```

The initial user should not need to understand:

- Git internals
- YAML
- MCP implementation details
- embeddings
- databases
- vector search

Advanced users can work directly with the repository.

---

## 17. ContextDB Does Not Need to Look Like GitHub

A lightweight management UI could present the repository as knowledge rather than files.

Example:

```text
YOUR CONTEXT

Home
  Network
  Devices
  Maintenance

Technology
  Computers
  AI Projects
  Software Preferences

Projects
  ContextDB
  Pocket Watch
  Local AI

Preferences
  Travel
  Technology
  Food
```

Behind the interface, changes remain ordinary Markdown commits.

The UI is optional.

The repository remains authoritative.

---

## 18. Hosted Architecture

A public hosted MCP endpoint may exist for users who do not have an always-running computer.

Example:

```text
ChatGPT / Claude
        |
        | MCP
        v
Hosted ContextDB MCP
        |
        | GitHub API
        v
Private GitHub Repository
```

The hosted service should remain thin.

Ideally it stores only:

- authentication/session state
- GitHub App installation identifiers
- minimal configuration
- permissions metadata

It should not maintain a duplicate copy of the user's context.

---

## 19. Local Architecture

Advanced users should also be able to run ContextDB locally.

Example:

```text
Claude Desktop
      |
      | MCP
      v
Local ContextDB Server
      |
      v
Local Git Clone
      |
      v
GitHub
```

Potential invocation:

```bash
npx contextdb-mcp
```

or:

```bash
docker run contextdb/mcp
```

The local and hosted implementations should follow the same protocol.

---

## 20. Free and Open Goal

A major project objective is:

> **ContextDB should remain free and openly accessible.**

The architecture makes this plausible because expensive infrastructure is avoided.

### GitHub provides

- repository storage
- authentication
- synchronization
- version history
- API
- backups
- private repositories

### The user's AI provider provides

- inference
- reasoning
- organization
- summarization
- retrieval reasoning

### ContextDB provides

- MCP translation
- permission enforcement
- repo conventions
- optional UI
- lightweight authentication bridge

No central vector database is required.

No GPU infrastructure is required.

No permanent hosted user database is required.

No always-running home server is required.

---

## 21. Open Source Model

The project should be open source.

Potential license:

- MIT
- Apache 2.0

Core components:

```text
contextdb-spec
contextdb-mcp
contextdb-github
contextdb-cli
contextdb-web
```

Not all components are required initially.

The most important artifacts are:

1. repository convention
2. MCP tool contract
3. reference implementation

---

## 22. Standard Before Product

A useful framing is that ContextDB may be more valuable as a **standard/convention** than as a SaaS product.

The project could define:

> ContextDB Context Format v0.1

This might specify only a few rules:

1. Context is stored in human-readable files.
2. Markdown is the preferred knowledge format.
3. A root manifest explains the repository.
4. Agents inspect existing organization before creating new structure.
5. Git history is preserved.
6. Agents should prefer updating existing knowledge over creating duplicates.
7. Secrets should not be stored by default.
8. Implementations must prevent repository access from escaping the approved root.
9. MCP operations should behave consistently across implementations.
10. Users retain full ownership and portability.

Anyone could then create a compatible implementation.

---

## 23. Security Model

The system should distinguish **context** from **secrets**.

Appropriate information may include:

- preferences
- equipment
- project details
- business context
- operating procedures
- non-sensitive customer notes
- home information
- durable facts

Information that should generally not be stored without stronger encryption controls:

- passwords
- API keys
- private keys
- Social Security numbers
- identity documents
- sensitive financial credentials
- highly sensitive medical records
- authentication secrets

A private GitHub repository is private, but it should not automatically be treated as a secrets vault.

Future versions could support encrypted files or secret references.

---

## 24. Path Safety

All file operations must be sandboxed to the selected repository.

For example:

```text
../../.ssh/id_rsa
```

must never be valid.

Protections should include:

- canonical path validation
- symlink restrictions
- repository-root enforcement
- file size limits
- operation limits
- blocked executable paths
- blocked arbitrary subprocesses
- no raw host-shell access

---

## 25. Deletion and Destructive Operations

Destructive operations should be more restricted than normal writes.

Potential policy:

```text
read                → automatic
create/update        → automatic or permission based
move                 → permission based
delete               → propose by default
mass restructure     → explicit approval
git revert           → explicit approval
```

Git provides recovery, but user consent still matters.

---

## 26. Search

The first version should avoid unnecessary infrastructure.

Search can begin with:

- filename search
- Markdown text search
- grep-like search
- GitHub code search where appropriate
- LLM-driven iterative retrieval

Example:

```text
find "router"
grep "UDM"
read home/network.md
```

Semantic/vector search can be added later if needed.

A major design principle should be:

> Do not add embeddings until actual usage demonstrates that ordinary repository search is insufficient.

This keeps the system free and simple.

---

## 27. LLM-Managed Organization

The LLM should be permitted to decide how to organize knowledge, within constraints.

A potential agent instruction:

```text
This repository contains durable context.

When adding information:

1. Search for existing relevant information first.
2. Prefer updating an existing document over creating a duplicate.
3. Follow the repository's existing organizational patterns.
4. Create a new file only when the topic is meaningfully distinct.
5. Keep documents focused and readable.
6. Link related documents when useful.
7. Preserve historically relevant information.
8. Avoid unnecessary reorganizations.
9. Do not store credentials or secrets.
10. Make changes in clear Git commits.
```

This instruction may be stored in:

```text
README.md
```

or:

```text
CONTEXT.md
```

or an OKF-compatible manifest.

---

## 28. Structural Review

Over time, repositories may become messy.

A model could periodically run a structural review.

Possible operation:

```text
review_structure()
```

The review might identify:

- duplicate files
- duplicate facts
- stale indexes
- orphan documents
- oversized files
- inconsistent naming
- contradictory facts
- obsolete sections
- opportunities to merge or split documents

The system should **propose** broad reorganizations rather than automatically performing them.

---

## 29. Personal Example

Repository:

```text
john-context/
├── README.md
├── home/
│   ├── network.md
│   └── maintenance.md
├── technology/
│   ├── computers.md
│   └── local-ai.md
├── education/
│   └── graduate-program.md
├── projects/
│   ├── contextdb.md
│   └── pocket-watch.md
└── preferences/
    └── technology.md
```

User says:

> My Mac mini has 24 GB of RAM and I mostly use it for small local AI projects.

The model:

```text
search "Mac mini"
read technology/computers.md
patch technology/computers.md
git_diff
git_commit "Update Mac mini context"
```

Later, Claude asks about local model recommendations.

It queries the same repository and sees the updated context.

The fact is no longer tied to ChatGPT memory.

---

## 30. Business Example

Repository:

```text
acme-context/
├── README.md
├── customers/
├── products/
├── policies/
├── processes/
├── vendors/
├── decisions/
├── projects/
└── meetings/
```

A sales agent updates:

```text
customers/example-corp.md
```

A management agent later reads the same file.

A coding agent reads:

```text
products/api.md
```

A support agent reads:

```text
policies/refunds.md
```

All agents operate against one durable knowledge source.

---

## 31. Why Git Matters for Business Use

Git provides an audit trail that traditional AI memory systems often lack.

Example:

```text
commit 7ac80f
Author: sales-agent
Update Example Corp renewal status

commit b9913a
Author: John
Correct contract value
```

This enables:

- accountability
- correction
- history
- auditability
- model attribution
- rollback
- review workflows

These capabilities may become especially valuable for business use.

---

## 32. Potential Naming

The original concept started as **MeDB**, focused on personal context.

Because the design applies equally well to business, projects, teams, and agents, a broader name may be preferable.

Working concepts:

- ContextDB
- ContextRepo
- OpenContext
- Agent Context Repository
- ContextFS
- ContextGit
- ContextBase
- GitContext
- OpenContextDB

The project name should communicate:

- durable context
- interoperability
- openness
- repository ownership

"Database" may be technically accurate but may imply SQL and rigid schemas.

"Context Repository" may better describe the mental model.

---

## 33. Primary Differentiator

The project is not fundamentally:

- a note-taking application
- a wiki
- an AI memory SaaS
- a vector database
- an ontology
- a CRM
- a document management system

The differentiator is:

> **A portable, writable, authoritative context layer shared across AI systems.**

The key idea is not merely retrieval.

It is **shared durable context plus controlled mutation**.

---

## 34. Important Design Principle: Consentful Mutation

Many systems can read Markdown.

The more interesting challenge is deciding:

> What information from a conversation deserves to become durable context?

A useful pattern is:

```text
User:
I replaced my router with a UDM Pro Max.

AI:
I found that home/network.md still lists your previous gateway.

Proposed change:
- Amplifi Alien
+ UDM Pro Max

[Approve] [Edit] [Reject]
```

After approval:

```text
git commit -m "Update home gateway"
```

This creates explicit, inspectable memory rather than opaque model memory.

---

## 35. Authority Model

The repository should be authoritative.

AI memories may be temporary or derived.

The rule should be:

> **The repository is the durable source of truth.**

If multiple models disagree, they should inspect the repository.

If a fact changes, the repository is updated.

Git history preserves the previous state.

---

## 36. Interoperability Goal

A central requirement is universal access.

The same repository should be usable by:

- ChatGPT
- Claude
- local LLMs
- IDE agents
- coding agents
- voice agents
- business agents
- automation systems
- future AI products

MCP is the initial interoperability layer.

The repository itself should remain useful even for clients that do not support MCP.

---

## 37. MVP

The first version should remain extremely small.

### MVP requirements

1. GitHub login
2. GitHub App installation
3. Select one private repository
4. Initialize minimal context structure
5. Hosted MCP endpoint
6. Repository-scoped filesystem operations
7. Git status/diff/commit support
8. Read/write permission modes
9. Root repository instructions
10. Open-source reference implementation

### Explicitly avoid in v0.1

- vector database
- embeddings
- custom AI model
- complex ontology
- multi-provider Git support
- billing
- enterprise RBAC
- elaborate web UI
- autonomous background agents
- custom sync engine

---

## 38. Possible v0.1 Repository

```text
context/
├── README.md
├── index.md
└── topics/
```

That may be enough.

The model can evolve the repository as needed.

The specification should resist over-design.

---

## 39. Possible v0.1 MCP API

```text
list(path)
read(path)
search(query)
write(path, content)
patch(path, diff)
move(source, destination)
delete(path)

status()
diff()
history(path?)
commit(message)
```

Everything else can be added after real usage.

---

## 40. Hosting Model

The project should support two modes from the beginning conceptually.

### Hosted

A free public endpoint for convenience.

```text
mcp.contextdb.org
```

Advantages:

- works with cloud-hosted AI
- no always-running computer
- easy onboarding

### Self-hosted

Users can run their own implementation.

Advantages:

- zero dependency on project infrastructure
- maximum control
- ideal for advanced users and businesses
- protects the project's "free forever" philosophy

The protocol should make hosted implementations replaceable.

---

## 41. Sustainability

The goal is free access, but the project should avoid depending on indefinite founder-funded infrastructure.

Possible future funding models that preserve a free core:

- GitHub Sponsors
- donations
- grants
- sponsorships
- enterprise deployment support
- managed organizational hosting
- compliance features
- advanced administration
- paid support
- consulting

The context format, MCP contract, and self-hosted implementation should remain open.

---

## 42. What the Project Should Not Become

Avoid drifting into:

### A proprietary memory cloud

That defeats the portability goal.

### A universal ontology

Human and business knowledge is too varied.

### A vector database company

Embeddings may be useful but are not the core problem.

### A note-taking application

Users already have excellent editors.

### An AI vendor-specific integration

The main value is independence from AI providers.

### A giant SaaS platform

The system is strongest when the core remains small.

---

## 43. Core Design Principles

1. **User owns the context.**
2. **Git repository is the durable authority.**
3. **Markdown remains human-readable.**
4. **MCP provides standard AI access.**
5. **The LLM may organize the repository.**
6. **Existing structure should be respected.**
7. **Writes are inspectable Git changes.**
8. **Permissions control mutation.**
9. **Implementations must be replaceable.**
10. **No always-running personal computer is required.**
11. **No proprietary storage layer is required.**
12. **Keep the core free and open.**
13. **Avoid infrastructure until usage proves it necessary.**
14. **Context should survive model and vendor changes.**

---

## 44. One-Sentence Product Definition

> **ContextDB is an open-source MCP layer that turns a user-owned Git repository into persistent, writable context shared across AI systems.**

---

## 45. Alternative Short Definition

> **Git for AI context.**

---

## 46. Longer Product Pitch

AI systems increasingly remember information about people, projects, and organizations, but that memory is fragmented across vendors and applications.

ContextDB provides a shared context repository that the user owns.

Knowledge is stored as ordinary Markdown in Git. AI systems connect through MCP and can search, read, propose changes, update files, and organize the repository within controlled permissions.

Git provides storage, history, rollback, synchronization, and provenance. Markdown keeps the information understandable without proprietary software. MCP makes the context accessible across AI providers.

The result is a persistent context layer that remains available even when the user's preferred AI changes.

---

## 47. Open Questions

The project still needs decisions around:

### Repository format
- How closely should ContextDB conform to OKF?
- Is a manifest required?
- Should frontmatter be required or optional?
- Should wiki-style links be standardized?

### MCP API
- One general repository execution tool or multiple explicit tools?
- How shell-like should operations appear?
- Should Git operations be exposed directly?

### Mutation
- Should write access be automatic by default?
- Should `propose_update` be the preferred primitive?
- How should user approval work across different MCP clients?

### Authentication
- GitHub App vs OAuth App?
- How should hosted MCP sessions authenticate?
- How are GitHub installation tokens handled?

### Git behavior
- One commit per operation?
- One commit per conversational task?
- Should AI identity appear in commit metadata?
- Should branches or pull requests be used for proposed changes?

### Search
- Is ordinary text search enough?
- When should semantic indexing be introduced?
- Could local disposable indexes improve performance without becoming authoritative?

### Sensitive data
- Should encrypted files be supported?
- Should ContextDB define secret references?
- Should sensitive categories be explicitly discouraged?

### Multi-agent conflicts
- What happens when two agents edit simultaneously?
- How should merge conflicts be surfaced?
- Should writes use optimistic concurrency checks?

### Organization
- How much autonomy should models have to reorganize?
- Should major structural changes require approval?
- Should periodic structural reviews be part of the standard?

---

## 48. Suggested Next Step

Before implementing code, create three artifacts:

1. **ContextDB v0.1 Specification**  
   Defines repository rules, safety constraints, and interoperability requirements.

2. **MCP Tool Contract**  
   Defines the exact operations available to AI clients.

3. **Reference Repository**  
   A small example personal or project context repo showing how the system should behave.

Only after those are coherent should the first GitHub App / MCP reference implementation be built.

---

## 49. North Star

The long-term idea can be summarized as:

> **Applications should not each own their own isolated AI memory. People and organizations should own an authoritative context repository that any authorized AI can use.**

Or more simply:

> **Your AI changes. Your context doesn't.**
