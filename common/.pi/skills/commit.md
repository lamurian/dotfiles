---
description: Smart git commit with pre-commit hook handling
agent: build
permission:
  bash:
    "git status *": "allow"
    "git diff *": "allow"
    "git log *": "allow"
    "git push *": "deny"
    "git commit *": "ask"
  edit: "deny"
---

# Commit

Use the `commit` tool to stage changes and commit with conventional commit messages.

## Workflow

1. **Commit**: Call `commit` (all parameters are optional):
   - `type`: commit type (feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert) — auto-detected from changes
   - `scope`: optional scope (e.g., component name)
   - `description`: short imperative description — auto-generated from diff
   - `body`: only when "why" isn't obvious from subject. Why over what.
   - `addAll`: stage all unstaged changes (default: true)
   - `files`: specific files to stage instead of --all

2. The tool:
   - Shows `git diff --stat` preview
   - Prompts to confirm staging (interactive mode)
   - Generates or uses the provided commit message
   - Asks for confirmation before committing
   - Runs `git commit` (without `--no-verify` to respect pre-commit hooks)

3. **On success**: commit hash and summary shown.

4. **On pre-commit failure** -> **analyze -> fix -> retry**:
   - Launches reviewer subagent to analyze the error and propose a fix plan
   - Presents the plan to you for approval
   - Applies common formatter/linter fixes (prettier, eslint, black, rustfmt, gofmt, etc.)
   - Re-stages all changes
   - Retries the commit automatically

## Commit Message Convention

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

| Type       | Description              |
| ---------- | ------------------------ |
| `feat`     | Features                 |
| `fix`      | Bug Fixes                |
| `docs`     | Documentation            |
| `style`    | Styles                   |
| `refactor` | Code Refactoring         |
| `perf`     | Performance Improvements |
| `test`     | Tests                    |
| `build`    | Builds                   |
| `ci`       | Continuous Integrations  |
| `chore`    | Chores                   |
| `revert`   | Reverts                  |

Subject: <75 chars, imperative, lowercase after type. No punctuation at end of subject.
Body: only when 'why' isn't obvious from subject. Explain why, not what.

## Restrictions

- `git push` is denied. Do not push.
- `git commit` via bash requires confirmation. Prefer the `commit` tool instead.
- Editing files is denied. Use other available tools to fix issues.
