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
 * - The workflow_transition tool progresses the workflow to the next phase.
 * - It prompts the user for confirmation via ctx.ui.confirm() (non-bypassable).
 * - When confirmed, it transitions the phase and persists state.
 * - When declined, it returns without transitioning.
 * - No `confirmed` parameter exists — the tool always shows a UI prompt.
 */

let tmpDir: string;

interface MockOptions {
  confirmResult?: boolean;
}

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

function mockCtx(opts?: MockOptions): ExtensionContext {
  const confirmResult = opts?.confirmResult ?? true;
  return {
    cwd: tmpDir,
    hasUI: true,
    sessionManager: {
      getBranch: () => [],
    },
    ui: {
      notify: () => {},
      setStatus: () => {},
      setWidget: () => {},
      theme: { fg: () => "" },
      addAutocompleteProvider: () => {},
      confirm: async (_title: string, _body: string) => confirmResult,
    },
  } as unknown as ExtensionContext;
}

/** Helper: register the tool and return it. */
function registerAndGetTool(pi: ExtensionAPI & { tools: ToolDefinition[] }): ToolDefinition {
  // Re-import clears module cache for fresh registration
  delete require.cache[require.resolve("../workflow-transition.ts")];
  // Use dynamic import for ESM
  return pi.tools[pi.tools.length - 1];
}

describe("workflow_transition tool", () => {
  before(async () => {
    tmpDir = join(tmpdir(), `wf-transition-test-${randomUUID()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("prompts user for confirmation via ui.confirm", async () => {
    let confirmCalled = false;
    const ctx = mockCtx({
      confirmResult: (() => { confirmCalled = true; return true; })(),
    });

    const pi = mockPi();
    const { registerWorkflowTransitionTool } = await import("../workflow-transition.ts");
    registerWorkflowTransitionTool(pi);

    const tool = pi.tools.find((t) => t.name === "workflow_transition");
    assert.ok(tool, "workflow_transition tool should be registered");

    // Override ctx.ui.confirm to capture the call
    const originalConfirm = ctx.ui.confirm;
    ctx.ui.confirm = async (_title: string, _body: string) => {
      confirmCalled = true;
      return true;
    };

    await tool.execute(
      "call-1",
      { phase: "specifying" },
      new AbortController().signal,
      () => {},
      ctx,
    );

    assert.ok(confirmCalled, "ui.confirm should have been called");
    // State should be persisted since user confirmed
    assert.ok(pi.stateEntries.length >= 1, "State should be persisted after confirmation");
    const latestState = pi.stateEntries[pi.stateEntries.length - 1] as Record<string, unknown>;
    assert.equal(latestState.phase, "specifying");
  });

  it("cancels transition when user declines", async () => {
    const pi = mockPi();
    const { registerWorkflowTransitionTool } = await import("../workflow-transition.ts");
    registerWorkflowTransitionTool(pi);

    const tool = pi.tools.find((t) => t.name === "workflow_transition");
    assert.ok(tool, "workflow_transition tool should be registered");

    const ctx = mockCtx({ confirmResult: false });

    const result = await tool.execute(
      "call-2",
      { phase: "specifying" },
      new AbortController().signal,
      () => {},
      ctx,
    );

    assert.ok(result, "Should return a result");
    const text = result.content?.[0]?.text ?? "";
    assert.ok(
      text.toLowerCase().includes("cancelled"),
      `Should indicate cancellation, got: ${text}`,
    );

    // State should NOT be persisted since user declined
    assert.equal(pi.stateEntries.length, 0, "State should not be persisted when user declines");
  });

  it("transitions to specifying when confirmed", async () => {
    const pi = mockPi();
    const { registerWorkflowTransitionTool } = await import("../workflow-transition.ts");
    registerWorkflowTransitionTool(pi);

    const tool = pi.tools.find((t) => t.name === "workflow_transition");
    assert.ok(tool, "workflow_transition tool should be registered");

    const ctx = mockCtx({ confirmResult: true });

    const result = await tool.execute(
      "call-3",
      { phase: "specifying" },
      new AbortController().signal,
      () => {},
      ctx,
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

  it("transitions to planning when confirmed", async () => {
    const pi = mockPi();
    const { registerWorkflowTransitionTool } = await import("../workflow-transition.ts");
    registerWorkflowTransitionTool(pi);

    const tool = pi.tools.find((t) => t.name === "workflow_transition");
    assert.ok(tool);

    const ctx = mockCtx({ confirmResult: true });

    const result = await tool.execute(
      "call-4",
      { phase: "planning" },
      new AbortController().signal,
      () => {},
      ctx,
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

    // Invalid phase should not reach confirm — validated first
    const ctx = mockCtx({ confirmResult: true });

    const result = await tool.execute(
      "call-5",
      { phase: "invalid_phase" },
      new AbortController().signal,
      () => {},
      ctx,
    );

    assert.ok(result.isError, "Invalid phase should return an error");
    assert.equal(pi.stateEntries.length, 0, "State should not be persisted for invalid phase");
  });

  it("transitions to implementing when confirmed", async () => {
    const pi = mockPi();
    const { registerWorkflowTransitionTool } = await import("../workflow-transition.ts");
    registerWorkflowTransitionTool(pi);

    const tool = pi.tools.find((t) => t.name === "workflow_transition");
    assert.ok(tool);

    const ctx = mockCtx({ confirmResult: true });

    const result = await tool.execute(
      "call-6",
      { phase: "implementing" },
      new AbortController().signal,
      () => {},
      ctx,
    );

    assert.ok(result, "Should return a result");
    assert.ok(!result.isError);

    const latestState = pi.stateEntries[pi.stateEntries.length - 1] as Record<string, unknown>;
    assert.equal(latestState.phase, "implementing");
  });

  it("has no confirmed parameter in schema", async () => {
    const pi = mockPi();
    const { registerWorkflowTransitionTool } = await import("../workflow-transition.ts");
    registerWorkflowTransitionTool(pi);

    const tool = pi.tools.find((t) => t.name === "workflow_transition");
    assert.ok(tool);

    // The parameters schema should NOT include a `confirmed` property
    const schema = tool.parameters;
    assert.ok(schema, "Tool should have parameters schema");

    // Convert schema to JSON for inspection
    const schemaJson = JSON.stringify(schema);
    assert.ok(!schemaJson.includes("confirmed"), "Schema should not contain 'confirmed' parameter");
  });
});
