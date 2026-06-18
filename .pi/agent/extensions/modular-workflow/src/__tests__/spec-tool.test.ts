import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";

/**
 * Tests for the spec_create AI tool.
 *
 * Spec (discussion):
 * - The spec_create tool lets the agent write complete specification files.
 * - It calls createSpec which handles numbering and ADR cross-referencing.
 * - The tool requires adrNumber, title, and content.
 */

let tmpDir: string;

function t(...parts: string[]): string {
  return join(tmpDir, ...parts);
}

/** Mock ExtensionAPI that captures tool registrations. */
function mockPi(): ExtensionAPI & { tools: ToolDefinition[] } {
  const tools: ToolDefinition[] = [];
  return {
    on: () => {},
    registerCommand: () => {},
    appendEntry: () => {},
    sendUserMessage: () => {},
    exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    registerTool: (tool: ToolDefinition) => {
      tools.push(tool);
    },
    tools,
  } as unknown as ExtensionAPI & { tools: typeof tools };
}

/** Minimal ExtensionContext for tool execution. */
function mockCtx(): ExtensionContext {
  return {
    cwd: tmpDir,
    sessionManager: {
      getBranch: () => [],
    },
    ui: {
      notify: () => {},
      setStatus: () => {},
      setWidget: () => {},
      theme: { fg: () => "" },
      addAutocompleteProvider: () => {},
    },
  } as unknown as ExtensionContext;
}

describe("spec_create tool", () => {
  before(async () => {
    tmpDir = join(tmpdir(), `spec-tool-test-${randomUUID()}`);
    await mkdir(tmpDir, { recursive: true });
    await mkdir(join(tmpDir, "docs", "specs"), { recursive: true });
    await mkdir(join(tmpDir, "docs", "ADR"), { recursive: true });

    // Create a dummy ADR so spec creation can reference it
    const { createAdr } = await import("../adr.ts");
    await createAdr(
      {
        title: "Dummy ADR for testing",
        description: "Test ADR to enable spec creation",
        status: "proposed",
        context: "Testing context",
        decision: "Testing decision",
        impact: "Testing impact",
      },
      tmpDir,
    );
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates a spec file when called with required fields", async () => {
    const pi = mockPi();
    const { registerSpecTool } = await import("../spec-tool.ts");
    registerSpecTool(pi);

    const tool = pi.tools.find((t) => t.name === "spec_create");
    assert.ok(tool, "spec_create tool should be registered");

    const result = await tool.execute(
      "call-1",
      {
        adrNumber: 1,
        title: "User Authentication",
        content:
          "# Requirements Specification\n\n- Users must log in via email and password\n- Passwords must be hashed with bcrypt\n\n# Design Principles\n\n- JWT-based stateless authentication\n- Refresh token rotation\n\n# References\n\n",
      },
      new AbortController().signal,
      () => {},
      mockCtx(),
    );

    assert.ok(result, "Should return a result");
    assert.ok(!result.isError, `Should not be an error, got: ${result.content?.[0]?.text}`);

    const text = result.content?.[0]?.text ?? "";
    assert.ok(text.includes("Spec created:"), `Result should mention Spec created, got: ${text}`);
    assert.ok(text.includes("ADR 001"), `Result should reference ADR, got: ${text}`);

    // Verify the file exists on disk
    const files = await import("node:fs/promises").then((fs) =>
      fs.readdir(join(tmpDir, "docs", "specs")),
    );
    const mdFiles = files.filter((f) => f.endsWith(".md") && !f.startsWith("."));
    assert.ok(mdFiles.length >= 1, "Should have created at least one spec file");

    // Verify content
    const specFile = join(tmpDir, "docs", "specs", mdFiles[0]);
    const content = await readFile(specFile, "utf-8");
    assert.ok(content.includes("title: User Authentication"), "Should have title in frontmatter");
    assert.ok(content.includes("Users must log in via email"), "Should have requirements content");
    assert.ok(content.includes("@docs/ADR/001-"), "Should cross-reference the ADR");
  });

  it("returns error when required fields are missing", async () => {
    const pi = mockPi();
    const { registerSpecTool } = await import("../spec-tool.ts");
    registerSpecTool(pi);

    const tool = pi.tools.find((t) => t.name === "spec_create");
    assert.ok(tool);

    const result = await tool.execute(
      "call-2",
      {
        adrNumber: 0,
        title: "",
        content: "",
      },
      new AbortController().signal,
      () => {},
      mockCtx(),
    );

    assert.ok(result.isError, "Missing fields should return an error");
  });

  it("registers both spec_create and spec_list tools", async () => {
    const pi = mockPi();
    const { registerSpecTool } = await import("../spec-tool.ts");
    registerSpecTool(pi);

    const createTool = pi.tools.find((t) => t.name === "spec_create");
    const listTool = pi.tools.find((t) => t.name === "spec_list");
    assert.ok(createTool, "spec_create should be registered");
    assert.ok(listTool, "spec_list should be registered");
  });
});
