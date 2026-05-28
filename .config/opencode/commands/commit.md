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
  
Generate a terse commit message for the current staged changes. Conventional Commits format. Subject: <75 chars, imperative, lowercase after type. Body: only when 'why' isn't obvious from subject. Why over what. No punctuation on subject.
  
## Process  
  
1. **Attempt Commit**: Run `git commit` (without --no-verify to respect pre-commit hooks)  
2. **Success Handling**: If commit succeeds, report success and show commit hash  
3. **Pre-commit Failure**: If commit fails due to pre-commit hooks:  
   - Use Task tool to launch review agent to analyze changes and errors  
   - Use Task tool to launch plan agent to create resolution strategy  
   - Present the plan to user for approval  
  
## Execution  
  
First, attempt the commit:  
  
`git add --all && git commit -m <commit_message>`  

Commit message must follow the commit message convention:

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

Commit types:

| Commit Type | Description              |
| ----------- | ------------------------ |
| `feat`      | Features                 |
| `fix`       | Bug Fixes                |
| `docs`      | Documentation            |
| `style`     | Styles                   |
| `refactor`  | Code Refactoring         |
| `perf`      | Performance Improvements |
| `test`      | Tests                    |
| `build`     | Builds                   |
| `ci`        | Continuous Integrations  |
| `chore`     | Chores                   |
| `revert`    | Reverts                  |
  
If the commit fails with pre-commit hook errors, analyze the situation:  
  
1. Use the Task tool to launch the review agent:

   ```
   Task({
     description: "Review commit failure",
     prompt: "The git commit failed due to pre-commit hook errors. Review the staged changes and the error output to identify what needs to be fixed. Focus on: 1) Code quality issues, 2) Test failures, 3) Linting errors, 4) Security concerns. Provide specific recommendations for fixing each issue.",
     subagent_type: "review"
   })
   ```

2. Use the Task tool to launch the plan agent:  

   ```
   Task({
     description: "Plan commit resolution",
     prompt: "Based on the review agent's analysis of the pre-commit hook failures, create a detailed plan to resolve all issues and successfully commit the changes. Include specific steps, file modifications needed, and verification commands.",
     subagent_type: "plan"
   })
   ```
