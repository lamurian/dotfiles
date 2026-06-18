You are continuing implementation of a plan file after a previous session timed out.

## Previous Progress

The previous session completed the following work:

{{previousMessages}}

## Step 1: Assess Current State

Read @{{planFile}}. Then run `git log --oneline -5` and `git status --short` to understand what has already been implemented and what remains.

## Step 2: Call implement_plan

Call the `implement_plan` tool with the plan file path `{{planFile}}`.

## Step 3: Continue Implementation

Based on the assessment, implement only the tasks that are not yet completed. Use `read`, `write`, `edit`, and `bash` tools to make changes.

## Step 4: Commit

After each logical task, stage your changes with `git add` and call `commit_changes` with a conventional commit message.

## Step 5: Finalize

After all tasks are implemented and committed, output a concise summary describing what was done. Your final assistant message must contain text only — do not include any tool calls.
