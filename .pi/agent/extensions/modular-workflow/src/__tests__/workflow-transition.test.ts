import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";

/**
 * Tests for the workflow_transition AI tool.
 *
 * Spec (discussion):
 * - The workflow_transition tool lets the agent progress through workflow phases.
 * - It now requires user confirmation via the `confirmed` parameter.
 * - Without confirmed: true, it returns a message asking for confirmation.
 * - Only with confirmed: true does it actually transition and persist state.
 */

let tmpDir: string;

/** Capture tool registrations and state transitions. */
function mockPi(): ExtensionAPI & { tools: ToolDefinition[]; stateEntries: unknown[] } {
  const tools: ToolDefinition[] = [];
  const stateEntries: unknown[] = [];
  return {
    on: () => {},
    registerCommand: () => {},
    appendEntry: (_type: string, data: unknown) => {
      stateEntries.push(data);
    },
    sendUserMessage: () => {},
    exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    registerTool: (tool: ToolDefinition) => {
      tools.push(tool);
    },
    tools,
    stateEntries,
  } as unknown as ExtensionAPI & { tools: typeof tools; stateEntries: typeof stateEntries };
}

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

describe("workflow_transition tool", () => {
  before(async () => {
    tmpDir = join(tmpdir(), `wf-transition-test-${randomUUID()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("refuses transition without confirmed flag", async () => {
    const pi = mockPi();
    const { registerWorkflowTransitionTool } = await import("../workflow-transition.ts");
    registerWorkflowTransitionTool(pi);

    const tool = pi.tools.find((t) => t.name === "workflow_transition");
    assert.ok(tool, "workflow_transition tool should be registered");

    const result = await tool.execute(
      "call-1",
      { phase: "specifying" },
      new AbortController().signal,
      () => {},
      mockCtx(),
    );

    assert.ok(result, "Should return a result");
    assert.ok(!result.isError, "Missing confirmation should not be an error message");
    const text = result.content?.[0]?.text ?? "";
    assert.ok(
      text.includes("confirm") || text.includes("confirmation"),
      `Should ask for confirmation, got: ${text}`,
    );

    // State should NOT be persisted since the transition was not confirmed
    assert.equal(pi.stateEntries.length, 0, "State should not be persisted without confirmation");
  });

  it("transitions with confirmed flag", async () => {
    const pi = mockPi();
    const { registerWorkflowTransitionTool } = await import("../workflow-transition.ts");
    registerWorkflowTransitionTool(pi);

    const tool = pi.tools.find((t) => t.name === "workflow_transition");
    assert.ok(tool, "workflow_transition tool should be registered");

    const result = await tool.execute(
      "call-2",
      { phase: "specifying", confirmed: true },
      new AbortController().signal,
      () => {},
      mockCtx(),
    );

    assert.ok(result, "Should return a result");
    assert.ok(!result.isError, `Should not be an error, got: ${result.content?.[0]?.text}`);

    const text = result.content?.[0]?.text ?? "";
    assert.ok(text.includes("specifying"), `Should mention target phase, got: ${text}`);

    // State should be persisted
    assert.ok(pi.stateEntries.length >= 1, "State should be persisted");
    const latestState = pi.stateEntries[pi.stateEntries.length - 1] as Record<string, unknown>;
    assert.equal(latestState.phase, "specifying");
  });

  it("transitions to planning phase with confirmed flag", async () => {
    const pi = mockPi();
    const { registerWorkflowTransitionTool } = await import("../workflow-transition.ts");
    registerWorkflowTransitionTool(pi);

    const tool = pi.tools.find((t) => t.name === "workflow_transition");
    assert.ok(tool);

    const result = await tool.execute(
      "call-3",
      { phase: "planning", confirmed: true },
      new AbortController().signal,
      () => {},
      mockCtx(),
    );

    assert.ok(result, "Should return a result");
    assert.ok(!result.isError);

    const latestState = pi.stateEntries[pi.stateEntries.length - 1] as Record<string, unknown>;
    assert.equal(latestState.phase, "planning");
  });

  it("returns error for invalid phase names", async () => {
    const pi = mockPi();
    const { registerWorkflowTransitionTool } = await import("../workflow-transition.ts");
    registerWorkflowTransitionTool(pi);

    const tool = pi.tools.find((t) => t.name === "workflow_transition");
    assert.ok(tool);

    const result = await tool.execute(
      "call-4",
      { phase: "invalid_phase", confirmed: true },
      new AbortController().signal,
      () => {},
      mockCtx(),
    );

    assert.ok(result.isError, "Invalid phase should return an error");
  });

  it("transitions to implementing phase with confirmed flag", async () => {
    const pi = mockPi();
    const { registerWorkflowTransitionTool } = await import("../workflow-transition.ts");
    registerWorkflowTransitionTool(pi);

    const tool = pi.tools.find((t) => t.name === "workflow_transition");
    assert.ok(tool);

    const result = await tool.execute(
      "call-5",
      { phase: "implementing", confirmed: true },
      new AbortController().signal,
      () => {},
      mockCtx(),
    );

    assert.ok(result, "Should return a result");
    assert.ok(!result.isError);

    const latestState = pi.stateEntries[pi.stateEntries.length - 1] as Record<string, unknown>;
    assert.equal(latestState.phase, "implementing");
  });
});
