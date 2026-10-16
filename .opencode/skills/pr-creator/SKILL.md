---
name: pr-creator
description: Validates the current Git branch, runs project checks, pushes the branch safely, and creates a reviewable GitHub pull request.
---

# Pull Request Creator

## Purpose

Validate the current branch, push it safely, and create a reviewable GitHub pull request.

## Instructions

1. Run `git status`.
2. Confirm the current branch is not `main`, `master`, or another protected branch.
3. Determine the correct base branch.
4. Inspect the complete diff against the base branch.
5. Inspect all commits included in the pull request.
6. Run lint, type-check, tests, and build when available.
7. Check for secrets, debugging code, generated files, and unrelated changes.
8. Push the branch only when explicitly requested or when PR creation was explicitly requested.
9. Use `gh pr create` when GitHub CLI is available.
10. Never merge or approve the pull request.

## Pull request title

Use a concise title, preferably following Conventional Commit style

## Pull request body

```md
## Summary
```

Explain what changed and why.

## Changes

- Main implementation changes

## Validation

- Commands executed
- Results

## Testing notes

Explain how reviewers can verify the change.

## Risks

List known risks, limitations, or compatibility concerns.

## Screenshots

Include only for UI changes.
Before creating the PR

## Report:

- source branch;
- base branch;
- title;
- complete PR body;
- validation results.
- After creating the PR

Return the pull request URL.