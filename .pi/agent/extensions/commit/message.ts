/**
 * Programmatic commit message generation from git diff.
 *
 * Analyzes changed file paths and diff content to determine:
 * - Conventional commit type (feat, fix, docs, etc.)
 * - Scope (top-level directory when files share one)
 * - Imperative description
 *
 * No subagent or API call needed — works fully offline.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CommitMessage {
	type: string;
	scope?: string;
	description: string;
	body?: string;
}

// ─── Type Detection ──────────────────────────────────────────────────────────

/**
 * Detect the conventional commit type from changed files and diff content.
 */
function detectType(files: string[], addLines: number, delLines: number, lowerDiff: string): string {
	const lowerFiles = files.map((f) => f.toLowerCase());

	// CI / workflow config
	if (lowerFiles.some((f) => f.includes(".github/") || f.includes(".gitlab") || f.includes("/ci") || f.includes("dockerfile") || f.includes("docker-compose"))) {
		return "ci";
	}

	// Build / dependency config
	if (lowerFiles.some((f) =>
		f.endsWith("package.json") || f.endsWith("package-lock.json") ||
		f.includes("webpack") || f.includes("vite.config") || f.includes("tsconfig") ||
		f.endsWith(".npmrc"),
	)) {
		return "build";
	}

	// Test changes (when test files dominate)
	const testFiles = lowerFiles.filter((f) =>
		f.includes("test") || f.includes("spec") || f.includes("__tests") ||
		f.includes("mock") || f.includes("fixture") || f.includes("__snapshots"),
	);
	if (testFiles.length > 0 && testFiles.length >= files.length / 2) {
		return "test";
	}

	// Pure documentation changes
	if (files.every((f) => f.endsWith(".md")) || lowerFiles.every((f) => f.includes("doc/") || f.includes("docs/"))) {
		return "docs";
	}

	// Config / dotfiles
	if (lowerFiles.every((f) => f.startsWith(".") || f.includes("config") || f.includes("setting") || f.includes("preference"))) {
		return "chore";
	}

	// Bug fix patterns
	if (lowerFiles.some((f) => f.includes("fix") || f.includes("bug") || f.includes("hotfix") || f.includes("error") || f.includes("crash"))) {
		return "fix";
	}
	if (lowerDiff.includes("fix") || lowerDiff.includes("bug") || lowerDiff.includes("issue") || lowerDiff.includes("crash") || lowerDiff.includes("regression")) {
		return "fix";
	}

	// Style / formatting (balanced small changes)
	if (lowerFiles.some((f) => f.includes(".prettier") || f.includes(".eslint") || f.includes(".stylelint") || f.includes("editorconfig"))) {
		return "style";
	}
	if (addLines === delLines && addLines < 20 && files.length <= 3) {
		return "style";
	}

	// Performance
	if (lowerFiles.some((f) => f.includes("perf") || f.includes("perform")) || lowerDiff.includes("performance") || lowerDiff.includes("optimize") || lowerDiff.includes("bottleneck")) {
		return "perf";
	}

	// Feature detection: new exports, new files, significant additions
	const hasNewExports = lowerDiff.includes("+export ");
	const hasNewFunctions = lowerDiff.includes("+function ") || lowerDiff.includes("+async function ");
	const isNewFile = lowerDiff.includes("new file mode");
	const hasAddImport = lowerDiff.includes("+import ");

	if (isNewFile || hasNewExports || hasNewFunctions) {
		return "feat";
	}
	if (addLines > delLines * 2 && addLines > 10) {
		return "feat";
	}

	// Refactor / chore boundary
	if (addLines + delLines < 10) return "chore";

	// Revert detection
	if (lowerFiles.some((f) => f.includes("revert")) || lowerDiff.includes("this reverts commit")) {
		return "revert";
	}

	return "refactor";
}

// ─── Scope Detection ─────────────────────────────────────────────────────────

/**
 * Detect a scope from the common top-level directory of changed files.
 * Returns undefined when files span multiple directories.
 */
function detectScope(files: string[]): string | undefined {
	const dirs = new Set<string>();
	for (const f of files) {
		const parts = f.split("/");
		if (parts.length > 1 && !parts[0].startsWith(".")) {
			dirs.add(parts[0]);
		}
	}
	return dirs.size === 1 ? [...dirs][0] : undefined;
}

// ─── Description Generation ──────────────────────────────────────────────────

/**
 * Strip extension and kebab/snake-case from a filename for use in prose.
 */
function humanName(file: string): string {
	const name = file.split("/").pop() || file;
	return name
		.replace(/\.\w+$/, "")           // strip extension
		.replace(/[-_]/g, " ")           // dashes/underscores to spaces
		.replace(/([a-z])([A-Z])/g, "$1 $2") // camelCase separation
		.toLowerCase();
}

/**
 * Generate an imperative description from changed files and diff stats.
 */
function generateDescription(
	files: string[],
	type: string,
	addLines: number,
	delLines: number,
): string {
	const verb = (t: string): string => {
		switch (t) {
			case "feat":     return "add";
			case "fix":      return "fix";
			case "docs":     return "update";
			case "style":    return "format";
			case "refactor": return "refactor";
			case "perf":     return "improve";
			case "test":     return "add tests for";
			case "build":    return "update";
			case "ci":       return "update";
			case "chore":    return "update";
			case "revert":   return "revert";
			default:         return "update";
		}
	};

	const v = verb(type);

	if (files.length === 1) {
		const base = humanName(files[0]);
		return `${v} ${base}`;
	}

	if (files.length <= 3) {
		const names = files.map(humanName).join(", ");
		return `${v} ${names}`;
	}

	// Many files: summarize by directory
	const dirs = [...new Set(
		files.map((f) => f.split("/")[0]).filter((d) => !d.startsWith(".")),
	)];
	if (dirs.length <= 2) {
		const scope = dirs.join(" and ");
		if (type === "feat") return `${v} ${scope} features`;
		if (type === "test") return `${v} ${scope}`;
		return `${v} ${scope}`;
	}

	return `${v} ${files.length} files`;
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

/**
 * Generate a conventional commit message from the staged diff.
 *
 * @param stagedDiff - Full diff --cached output.
 * @param statText   - diff --stat --cached output.
 * @param files      - List of changed file paths.
 * @returns A CommitMessage with type, optional scope, description, and optional body.
 */
export function generateCommitMessage(
	stagedDiff: string,
	statText: string,
	files: string[],
): CommitMessage {
	const lowerDiff = stagedDiff.toLowerCase();

	// Count additions / deletions from diff lines
	const addLines = stagedDiff.split("\n").filter((l) => l.startsWith("+")).length;
	const delLines = stagedDiff.split("\n").filter((l) => l.startsWith("-")).length;

	const type = detectType(files, addLines, delLines, lowerDiff);
	const scope = detectScope(files);
	const description = generateDescription(files, type, addLines, delLines);

	// Generate body for non-obvious commits
	let body: string | undefined;
	if (type === "refactor" && delLines > addLines) {
		body = `Simplify by removing ${delLines - addLines} lines.`;
	} else if (type === "fix") {
		const issueRef = lowerDiff.match(/(close[sd]?|fix(ed|es)?)\s+#?\d+/i);
		if (issueRef) {
			body = issueRef[0];
		}
	}

	return { type, scope, description, body };
}
