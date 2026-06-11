import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

// ─── Types ─────────────────────────────────────────────────────────────────────

/** Configuration for a subagent. */
export interface AgentConfig {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  systemPrompt: string;
  source: "embedded" | "user" | "project";
  filePath: string;
}

/** Result from a single scout process execution. */
export interface ScoutResult {
  agent: string;
  task: string;
  output: string;
  usage: { input: number; output: number; cost: number; turns: number };
  exitCode: number;
  errorMessage?: string;
}

// ─── Agent discovery ───────────────────────────────────────────────────────────

/**
 * Discover agents embedded in the extension's content/agents/ directory.
 *
 * Reads all `.md` files from `<packageRoot>/content/agents/`, parses their
 * YAML frontmatter, and returns AgentConfig entries.
 *
 * @param packageRoot - Absolute path to the extension package root.
 * @returns Array of discovered agent configurations.
 */
export function discoverEmbeddedAgents(packageRoot: string): AgentConfig[] {
  const agentsDir = resolve(packageRoot, "content", "agents");
  const agents: AgentConfig[] = [];

  let dirEntries;
  try {
    dirEntries = readdirSync(agentsDir, { withFileTypes: true });
  } catch {
    return agents;
  }

  for (const entry of dirEntries) {
    if (!entry.name.endsWith(".md")) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;

    const filePath = join(agentsDir, entry.name);
    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content);
    if (!frontmatter.name || !frontmatter.description) {
      continue;
    }

    const tools = frontmatter.tools
      ?.split(",")
      .map((t: string) => t.trim())
      .filter(Boolean);

    agents.push({
      name: frontmatter.name,
      description: frontmatter.description,
      tools: tools && tools.length > 0 ? tools : undefined,
      model: frontmatter.model || undefined,
      systemPrompt: body,
      source: "embedded",
      filePath,
    });
  }

  return agents;
}

// ─── Concurrency limiter ───────────────────────────────────────────────────────

/**
 * Run an async function over an array of items with a maximum concurrency limit.
 *
 * Tasks are dispatched up to `concurrency` at a time. Results are returned
 * in the same order as the input array.
 *
 * @param items       - Array of input items.
 * @param concurrency - Maximum number of concurrent async operations.
 * @param fn          - Async function to apply to each item.
 * @returns Promise resolving to an array of results in input order.
 */
export async function mapWithConcurrencyLimit<TIn, TOut>(
  items: TIn[],
  concurrency: number,
  fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results: TOut[] = new Array(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) return;
      results[current] = await fn(items[current], current);
    }
  };

  const workers = new Array(limit).fill(null).map(() => worker());
  await Promise.all(workers);
  return results;
}
