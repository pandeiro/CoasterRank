---
name: worktree-workflow
description: Creating and cleaning up CoasterRank git worktrees in .worktrees/ — use when the user asks for a worktree, a feature sandbox, or says they are done with one.
---

# Worktree workflow (CoasterRank)

Worktrees live in `.worktrees/` (gitignored). Each gets its own branch, a
symlinked `.env`, and a fresh `npm install`.

## Creating a worktree

Derive name, type, and provenance from context — do not ask three separate
questions. Try:

- **Name**: infer from the request ("let's work on park dedup" →
  `park-dedup`). Only ask if the intent is unclear.
- **Type**: infer from wording (`feat`, `fix`, `refactor`, `chore`, `docs`,
  `ui`). If ambiguous, ask with a short list.
- **Provenance**: default to latest `main`. Check `git log --oneline -5` — if
  the user is mid-feature on the current branch, offer to branch from there.
  When a worktree already exists and its PR merged, reuse it with a new
  branch off `origin/main` instead of making another.

Keep it to one concise question max; combine when possible.

```bash
git fetch origin main
git worktree add .worktrees/<name> -b <type>/<name> <base>
ln -s ../../.env .worktrees/<name>/.env   # relative path for portability
```

Then re-home the session (all subsequent commands run from the worktree
root), install, and verify:

```bash
npm run install:all   # app + scripts + packages/bt
npm run gates         # must pass before any work
```

If node/npm are missing in the new shell, see the user-level **node-mise**
skill (`export PATH="$HOME/.local/share/mise/shims:$PATH"`).

## Cleaning up a worktree

When the user says they're done with one:

1. **Check the branch was pushed**: `git log origin/<branch>..HEAD` — warn if
   there are unpushed commits.
2. **Check for unfinished work**: `git status --short` — warn if there are
   uncommitted or untracked changes.
3. **If clean and pushed**: move the working directory back to the repo root,
   `git worktree remove .worktrees/<name>`, then `git worktree prune`.
4. **If not clean**: do not remove; prompt the user to commit, stash, or
   discard.

Multiple worktrees can coexist (e.g. one per open PR); ask before removing
one that still has an open PR.
