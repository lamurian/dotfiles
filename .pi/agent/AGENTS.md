# Pi Coding Conventions

These rules apply to all code written in this environment.

## Language & Style
- Use **TypeScript** for all pi extensions and tools; otherwise, use the language as the project dictate.
- Each file must be **≤ 300 lines**. Split into modules when exceeding.
- Every exported function must have a **JSDoc comment** describing purpose, parameters, and return value.
- Use `import type` for type-only imports. Prefer `interface` over `type` for object shapes.
- Use `const` over `let` where possible. Avoid `any` — use `unknown` and narrow.

## Extension Structure
- Extensions go in `~/.pi/agent/extensions/<name>/src/index.ts`.
- Use the directory-with-index.ts pattern for multi-file extensions.
- Content files (templates, prompts) go in `content/` as `.md` or `.txt`, loaded at runtime via `readFile`.
- Skills go in `skills/<name>/SKILL.md` with frontmatter.

## Commits
- Use conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, etc.
- Describe what and why, not how. Keep the subject line under 75 characters.

## Naming
- Files: `kebab-case.ts`
- Functions: `camelCase`
- Classes/types: `PascalCase`
- Constants: `UPPER_SNAKE_CASE`
- Variables: `camelCase`
