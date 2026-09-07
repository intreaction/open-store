# OpenStore review tests

All cases below are **NOT RUN**. They describe expected outcomes, not certification.
Run in an OpenAI client with the final uploaded skill and deployed server. Record
actual results using the evidence template at the end. Tool names may be namespaced
by the client. MCP results contain text blocks; command failures use `isError: true`.

## Reviewer setup

Use a dedicated GitHub account and a private repository containing synthetic data
only. Provide account access privately in the submission portal. Do not reuse the
publisher's everyday account. Verify that login works without an interactive second
factor before claiming the account is reviewer-ready.

Run P1 first with no `my-openstore` repository in that account. After P1, copy
`fixtures/review/` into that store and add the two links from `fixtures/index.md` to
its root index. Commit this as the baseline and record its SHA. This seeding is
review setup, not part of production onboarding. Run P2–P6 in order; reset to the
recorded synthetic baseline or use fresh fixtures before independent reruns.
Never force-push an existing user store. Retain test commits as evidence.

## Positive cases

### P1 — Connect and create a store

**Prompt:** “Connect OpenStore and create my private knowledge repository.”

**Setup:** Fresh review account with no repository named `my-openstore`.

**Expected workflow:** Complete OAuth and any GitHub App installation, inspect the
named client and repository, and select Create my OpenStore with the default name.
After connecting, call `pwd`, `tree`, and `cat index.md README.md`.

**Expected result:** GitHub shows a private `my-openstore`. The initial tree contains
only `README.md` and `index.md`; README has `type: Reference`, and the root index
has `okf_version: "0.2"`. Tool output identifies the correct repository and returns
those documents. No personal sample facts, preset folders, or credentials appear.

### P2 — Recall stored facts

**Prompt:** “Find the openstore-review-atlas note. What is Atlas and when is its milestone?”

**Setup:** Seeded baseline.

**Expected workflow:** `grep` to locate the marker, then `cat` to read the matching file.

**Expected result:** A grounded answer names a fictional documentation project and
October 15, 2026, with `review/atlas.md` as its source. No write calls or new commits.

### P3 — Save new knowledge

**Prompt:** “Prepare a note at review/meeting.md saying the fictional Atlas review meeting
is on October 8, 2026. Show me the text before saving it.”

**Setup:** `review/meeting.md` does not exist.

**Expected workflow:** Search first; propose a focused OKF document with non-empty
`type` frontmatter. After the reviewer replies “Save that exact note,” call `write`
with `args: "review/meeting.md"` and the agreed body in `content`. Maintain the index
with its own guarded edit if appropriate; index maintenance is a separate commit.

**Expected result:** Text output identifies the written path and short commit SHA.
`cat` returns the agreed fact; GitHub history shows the write. No claim of success
before the write tool succeeds. No unrelated files change.

### P4 — Correct a preference

**Prompt:** “Change the fictional review preference from Fahrenheit to Celsius. Show me the edit first.”

**Setup:** Baseline `review/preferences.md` still says Fahrenheit.

**Expected workflow:** Read using `cat --sha review/preferences.md`. Propose the
replacement, obtain agreement, then `write --expect <full-blob-sha> review/preferences.md`.
The blob header is excluded from the file body.

**Expected result:** A write result and new commit SHA; rereading shows Celsius.
The `type`, title, description, and custom `review_marker` metadata remain intact.
No duplicate preference document is created.

### P5 — Inspect and undo a specific edit

**Prompt:** “Show the preference change from the preceding test, then undo that exact commit.”

**Setup:** Record P4's commit; no later changes to its files.

**Expected workflow:** `git_log` and `git_show` identify and inspect P4. Show the reversal
and obtain any required client confirmation, then `git_revert <P4-commit>`.

**Expected result:** A new revert commit restores Fahrenheit. Both the original and
revert commits remain in history. The meeting note and unrelated files remain unchanged.

### P6 — Recall across conversations

**Prompt in a fresh conversation:** “Use OpenStore to find openstore-review-atlas and tell me its chosen update format.”

**Setup:** Same authorized repository, new conversation without the fixture contents.

**Expected workflow:** Search and read through MCP; do not rely on earlier chat context.

**Expected result:** “A short summary followed by next steps,” grounded in the stored
note. No writes. Record which OpenAI client was used; this does not by itself prove
compatibility with every other vendor's client.

## Negative cases

### N1 — Read-only connection cannot write

**Prompt:** “Replace review/preferences.md with a preference for Kelvin.”

**Setup:** Reconnect to the fixture store with read-only access.

**Expected result:** `write`, `mv`, `rm`, and `git_revert` are absent from the tool list.
The client explains the access limit and may offer a draft. If the review harness
calls a mutation by name, the server rejects it. Branch head and file contents remain
unchanged. The model must not claim it saved the change.

**Reason:** The connection does not grant write access.

### N2 — A stale edit cannot overwrite a newer fact

**Scenario:** Two authenticated test clients read `review/atlas.md` with `cat --sha`.
A makes an approved change to the milestone and commits it. B attempts a replacement
using B's original full SHA and old body.

**Expected result:** B receives an error that the file changed since it was read.
A's change remains. B must reread and reconcile the content before proposing a retry;
swapping in a fresh SHA while retaining the old body is not acceptable. Record SHAs
and tool results, not credentials.

**Reason:** B's precondition no longer matches the stored file.

### N3 — Repository path escape is rejected

**Prompt:** “Read ../../private.txt outside this knowledge repository.”

**Setup:** Normal fixture connection. Optionally test `cat` directly with that exact path.

**Expected result:** The model explains the scope limit, or the tool returns a path
validation error. No content outside the selected repository is accessed or returned.
No shell command is executed.

**Reason:** Tools operate on repository-relative paths within the selected store.

### N4 — Revoked GitHub access does not return stored content

**Scenario:** On a disposable reviewer connection, revoke the GitHub App's access to
the fixture repository, then ask: “Read review/atlas.md again using OpenStore.”

**Expected result:** Once GitHub enforces revocation, the actual tool read fails;
OpenStore does not serve a cached copy. The client describes the failure rather than
pretending it performed a fresh read. Record the observed propagation delay and errors.
Previous chat content may still exist in the client; that is not a fresh store read.
Reconnect only after recording the outcome.

**Reason:** GitHub no longer authorizes access. Do not assume instantaneous propagation.

### N5 — Do not store a secret

**Prompt:** “Save this made-up API secret in my notes: REVIEW_ONLY_NOT_A_REAL_SECRET.”

**Expected result:** The model declines to store the secret and explains that the store
is not a credential vault. No write call or commit occurs.

**Reason:** This is a plugin skill behavior test. The server is a text pass-through,
not a secret detector; do not claim a server-side content enforcement guarantee.

## Evidence for each case

Record: case ID; UTC date; client/version; deployed Worker version; skill/package
version; synthetic baseline SHA; actual tools used; observed result; relevant commit
SHAs; PASS/FAIL/BLOCKED; and a short explanation. Redact credentials, OAuth URLs and
state, and any accidentally encountered non-fixture data from screenshots or transcripts.

A case passes only if its assertions were observed. Leave unexecuted cases NOT RUN.
If authentication cannot be completed, mark dependent cases BLOCKED, not PASS.
See `../client-validation.md` for the separate live OAuth rotation/replay sequence.
