---
name: git-committer
description: Inspects Git changes, runs relevant project validations, stages only related files, and creates a focused commit using Conventional Commits.
---

# Git Committer

## Purpose

Analyze the current Git changes and create a safe, focused commit.

## Instructions

1. Run `git status`.
2. Inspect staged and unstaged changes.
3. Exclude unrelated, generated, temporary, or sensitive files.
4. Run the relevant lint, type-check, tests, and build commands.
5. Stage only files related to the requested change.
6. Use Conventional Commits.
7. Do not push unless explicitly requested.
8. Never amend, rebase, force-push, or rewrite history unless explicitly requested.

## Commit format

```text
<type>(<scope>): <description>
```

### Allowed types:

- feat
- fix
- refactor
- test
- docs
- style
- chore
- build
- ci
- perf

### Before committing

### Report:

- files to be committed;
- excluded files;
- validation commands executed;
- proposed commit message.
- After committing

## Report:

- commit hash;
- commit message;
- final Git status.

## Examples:

- feat(app): added new feature
- fix(ci): fix ci