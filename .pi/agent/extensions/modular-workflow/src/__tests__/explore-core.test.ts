import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  parseFrontmatter,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

// ── Test utilities ───────────────────────────────────────────────────────────

/** Resolve the package root from the test file location. */
const PACKAGE_ROOT = resolve(import.meta.dirname!, "../..");

/** Create a mock ExtensionContext with configurable model availability. */
function mockCtx(
  cwd: string,
  overrides: Partial<ExtensionContext> = {},
): ExtensionContext {
  return {
    cwd,
    sessionManager: {
      getBranch: () => [],
      getSessionFile: () => null,
    },
    ui: {
      notify: () => {},
      setStatus: () => {},
      setWidget: () => {},
      theme: { fg: () => "" },
      addAutocompleteProvider: () => {},
      confirm: async () => true,
      select: async () => null,
      input: async () => "",
      custom: async () => null,
      editor: async () => "",
      setEditorText: () => {},
      setTitle: () => {},
    },
    mode: "tui",
    hasUI: true,
    model: { provider: "anthropic", id: "claude-sonnet-4-5" },
    modelRegistry: {
      getApiKeyAndHeaders: async () => ({
        ok: true,
        apiKey: "test-key",
        headers: {},
      }),
    },
    signal: undefined as AbortSignal | undefined,
    ...overrides,
  } as unknown as ExtensionContext;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Content files
// ═══════════════════════════════════════════════════════════════════════════════

describe("explore content files", () => {
  it("scout.md exists in content/agents/ with valid frontmatter", async () => {
    const filePath = resolve(PACKAGE_ROOT, "content", "agents", "scout.md");
    const content = await readFile(filePath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(content);

    assert.equal(frontmatter.name, "scout");
    assert.ok(frontmatter.description, "scout.md should have a description");
    assert.ok(frontmatter.tools, "scout.md should specify tools");
    assert.ok(frontmatter.model, "scout.md should specify a model");
    assert.ok(body.length > 50, "scout.md body should contain system prompt instructions");
  });

  it("explore-decompose.md exists and is substantial", async () => {
    const filePath = resolve(PACKAGE_ROOT, "content", "explore-decompose.md");
    const content = await readFile(filePath, "utf-8");
    assert.ok(content.length > 100, "decompose prompt should be substantial");
    assert.match(content, /JSON array/i, "should instruct to return JSON");
  });

  it("explore-synthesis.md exists and is substantial", async () => {
    const filePath = resolve(PACKAGE_ROOT, "content", "explore-synthesis.md");
    const content = await readFile(filePath, "utf-8");
    assert.ok(content.length > 100, "synthesis prompt should be substantial");
    assert.match(content, /summary|synthesis/i, "should instruct to produce a summary");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Agent discovery
// ═══════════════════════════════════════════════════════════════════════════════

describe("discoverEmbeddedAgents", () => {
  it("discovers scout agent from content/agents/ directory", async () => {
    const { discoverEmbeddedAgents } = await import("../subagent-runner.ts");
    const agents = discoverEmbeddedAgents(PACKAGE_ROOT);

    assert.ok(agents.length >= 1, "should discover at least one agent");
    const scout = agents.find((a: { name: string }) => a.name === "scout");
    assert.ok(scout, "should discover the scout agent");
    assert.equal(scout.source, "embedded");
    assert.equal(scout.tools?.join(","), "read,grep,find,ls,bash");
    assert.ok(scout.systemPrompt.length > 50, "scout should have a system prompt");
  });

  it("returns agent with correct AgentConfig shape", async () => {
    const { discoverEmbeddedAgents } = await import("../subagent-runner.ts");
    const agents = discoverEmbeddedAgents(PACKAGE_ROOT);
    const scout = agents.find((a: { name: string }) => a.name === "scout");
    assert.ok(scout);
    assert.equal(typeof scout.name, "string");
    assert.equal(typeof scout.description, "string");
    assert.equal(typeof scout.systemPrompt, "string");
    assert.equal(typeof scout.filePath, "string");
    assert.ok(Array.isArray(scout.tools));
    assert.ok(typeof scout.model === "string" || scout.model === undefined);
  });

  it("returns empty array when agents directory does not exist", async () => {
    const { discoverEmbeddedAgents } = await import("../subagent-runner.ts");
    const agents = discoverEmbeddedAgents("/nonexistent/path");
    assert.deepEqual(agents, []);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Concurrency limiter
// ═══════════════════════════════════════════════════════════════════════════════

describe("mapWithConcurrencyLimit", () => {
  it("runs all items and returns results in order", async () => {
    const { mapWithConcurrencyLimit } = await import("../subagent-runner.ts");
    const input = [1, 2, 3, 4, 5];
    const results = await mapWithConcurrencyLimit(input, 2, async (n) => n * 2);
    assert.deepEqual(results, [2, 4, 6, 8, 10]);
  });

  it("respects max concurrency by tracking concurrent runs", async () => {
    const { mapWithConcurrencyLimit } = await import("../subagent-runner.ts");
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const results = await mapWithConcurrencyLimit(
      [1, 2, 3, 4, 5, 6, 7, 8],
      3,
      async (n) => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await new Promise((r) => setTimeout(r, 10));
        currentConcurrent--;
        return n;
      },
    );

    assert.equal(maxConcurrent, 3, "should not exceed concurrency limit of 3");
    assert.deepEqual(results, [1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("handles empty input", async () => {
    const { mapWithConcurrencyLimit } = await import("../subagent-runner.ts");
    const results = await mapWithConcurrencyLimit([], 4, async (n) => n);
    assert.deepEqual(results, []);
  });

  it("handles single item", async () => {
    const { mapWithConcurrencyLimit } = await import("../subagent-runner.ts");
    const results = await mapWithConcurrencyLimit([42], 4, async (n) => n);
    assert.deepEqual(results, [42]);
  });

  it("when concurrency > items, still works", async () => {
    const { mapWithConcurrencyLimit } = await import("../subagent-runner.ts");
    const results = await mapWithConcurrencyLimit([1, 2], 10, async (n) => n);
    assert.deepEqual(results, [1, 2]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// decomposeInstruction — fallback behavior
// ═══════════════════════════════════════════════════════════════════════════════

describe("decomposeInstruction", () => {
  it("returns fallback single task when model is null", async () => {
    const { decomposeInstruction } = await import("../explore-core.ts");
    const ctx = mockCtx("/tmp/test", {
      model: null as unknown as ExtensionContext["model"],
    });
    const tasks = await decomposeInstruction("find auth code", ctx);

    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].agent, "scout");
    assert.ok(tasks[0].task.includes("auth"), "fallback task should reference the instruction");
  });

  it("returns fallback single task when auth fails", async () => {
    const { decomposeInstruction } = await import("../explore-core.ts");
    const ctx = mockCtx("/tmp/test", {
      modelRegistry: {
        getApiKeyAndHeaders: async () => ({ ok: false, error: "No API key" }),
      },
    });
    const tasks = await decomposeInstruction("find config files", ctx);

    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].agent, "scout");
    assert.ok(tasks[0].task.includes("config"), "fallback should reference instruction");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// synthesizeResults — fallback behavior
// ═══════════════════════════════════════════════════════════════════════════════

describe("synthesizeResults", () => {
  it("returns fallback summary when model is null", async () => {
    const { synthesizeResults } = await import("../explore-core.ts");
    const ctx = mockCtx("/tmp/test", {
      model: null as unknown as ExtensionContext["model"],
    });
    const results = [
      {
        agent: "scout",
        task: "search for auth patterns",
        output: "## Files Examined\n- `src/auth/login.ts`",
        usage: { input: 100, output: 50, cost: 0.002, turns: 2 },
        exitCode: 0,
      },
    ];

    const summary = await synthesizeResults("find auth code", results, ctx);
    assert.ok(summary.length > 10, "summary should be non-trivial");
    assert.match(summary, /auth/i, "summary should reference the topic");
    assert.match(summary, /src\/auth/, "summary should include file paths");
  });

  it("includes partial results when some scouts failed", async () => {
    const { synthesizeResults } = await import("../explore-core.ts");
    const ctx = mockCtx("/tmp/test", {
      model: null as unknown as ExtensionContext["model"],
    });
    const results = [
      {
        agent: "scout",
        task: "search src/",
        output: "## Files Examined\n- `src/main.ts`",
        usage: { input: 100, output: 50, cost: 0.002, turns: 2 },
        exitCode: 0,
      },
      {
        agent: "scout",
        task: "search docs/",
        output: "",
        usage: { input: 50, output: 0, cost: 0.001, turns: 1 },
        exitCode: 1,
        errorMessage: "Process exited with code 1",
      },
    ];

    const summary = await synthesizeResults("find code", results, ctx);
    assert.ok(summary.length > 10);
    assert.match(summary, /search docs/, "should mention failed task");
  });

  it("fallback summary includes file paths from succeeded scouts", async () => {
    const { synthesizeResults } = await import("../explore-core.ts");
    const ctx = mockCtx("/tmp/test", {
      model: null as unknown as ExtensionContext["model"],
    });
    const results = [
      {
        agent: "scout",
        task: "find auth handlers",
        output: "## Files Examined\n- `src/handlers/auth.ts`\n- `src/middleware/auth.ts`",
        usage: { input: 100, output: 50, cost: 0.002, turns: 2 },
        exitCode: 0,
      },
    ];

    const summary = await synthesizeResults("find auth", results, ctx);
    assert.match(summary, /src\/handlers\/auth\.ts/);
    assert.match(summary, /src\/middleware\/auth\.ts/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Integration: phase prompts include exploration guideline
// ═══════════════════════════════════════════════════════════════════════════════

describe("phase prompts include exploration guideline", () => {
  it("phase-discussing.md mentions the explore tool", async () => {
    const { loadContent } = await import("../utils.ts");
    const content = await loadContent("phase-discussing.md");
    assert.match(content, /explore/i, "discuss phase should mention the explore tool");
  });

  it("phase-requirements.md mentions the explore tool", async () => {
    const { loadContent } = await import("../utils.ts");
    const content = await loadContent("phase-requirements.md");
    assert.match(content, /explore/i, "requirements phase should mention the explore tool");
  });
});
