# Your OpenStore

This repo is your AI's memory. It's plain Markdown files in a private GitHub repository that
**you** own. When you connect an AI to OpenStore, it reads these files to recall things about you
and writes commits here to remember new ones.

**OpenStore never holds a copy.** There's no database and no cache on the server side — every
request reads and writes this repo directly, live. If you delete this repo, or revoke the AI's
access to it, everything is gone from the AI's side too. Nothing lingers anywhere else.

## What's in here

- `CONTEXT.md` — instructions for the AI: how it should organize files, search before writing,
  and what it should never do. Read it if you're curious how the AI "thinks" about this repo.
- `profile/`, `home/`, `technology/`, `projects/`, `preferences/`, `people/` — starter folders,
  each with one tiny example file. The AI will add files, edit these, and create new folders as
  it learns more about you. There's no fixed schema — organize however makes sense.

## Editing by hand

This is just a Git repo of Markdown. Clone it, edit files in any editor, commit and push like
normal. The AI will see your edits next time it reads. You can also edit files directly on
GitHub.com.

Nothing here can grant the AI extra permissions — text in these files is content, never
instructions to your GitHub account or any other system.

## Undoing a change

Every write the AI makes is one commit. Look at `git log` (or ask the AI to run `git_log`) to see
history, and revert any commit the normal Git way (or ask the AI to `git_revert <sha>`). History
is never rewritten and nothing is ever force-pushed, so your full history stays intact.

## Disconnecting

Revoke the AI's access (remove the deploy key / OAuth grant / PAT, or uninstall the plugin) and it
loses access immediately — there is nothing else to clean up, because nothing was ever copied
anywhere else. You can keep, export, or delete this repo independently at any time.
