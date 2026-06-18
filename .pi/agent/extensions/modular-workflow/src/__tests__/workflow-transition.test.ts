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
 * - The workflow_transition tool lets the agent automatically progress
 *   through workflow phases without user intervention.
 * - It persists the new phase via the workflow state machine.
 * - After all ADRs are drafted, the agent calls this to enter specifying.
 * - After all specs are created, the agent calls this to enter planning.
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

  it("transitions to specifying phase when called", async () => {
    const pi = mockPi();
    const { registerWorkflowTransitionTool } = await import("../workflow-transition.ts");
    registerWorkflowTransitionTool(pi);

    const tool = pi.tools.find((t) => t.name === "workflow_transition");
    assert.ok(tool, "workflow_transition tool should be registered");

    // Register the tool again and keep a ref to pi for state tracking
    const result = await tool.execute(
      "call-1",
      { phase: "specifying" },
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

  it("transitions to planning phase", async () => {
    const pi = mockPi();
    const { registerWorkflowTransitionTool } = await import("../workflow-transition.ts");
    registerWorkflowTransitionTool(pi);

    const tool = pi.tools.find((t) => t.name === "workflow_transition");
    assert.ok(tool);

    const result = await tool.execute(
      "call-2",
      { phase: "planning" },
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
      "call-3",
      { phase: "invalid_phase" },
      new AbortController().signal,
      () => {},
      mockCtx(),
    );

    assert.ok(result.isError, "Invalid phase should return an error");
  });

  it("transitions to implementing phase", async () => {
    const pi = mockPi();
    const { registerWorkflowTransitionTool } = await import("../workflow-transition.ts");
    registerWorkflowTransitionTool(pi);

    const tool = pi.tools.find((t) => t.name === "workflow_transition");
    assert.ok(tool);

    const result = await tool.execute(
      "call-4",
      { phase: "implementing" },
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
