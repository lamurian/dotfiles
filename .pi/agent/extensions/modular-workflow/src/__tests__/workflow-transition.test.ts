import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";

/**
 * Tests for the workflow_transition AI tool.
 *
 * Spec (discussion):
 * - The tool accepts `phase` (required), `outline` (optional), `force` (optional)
 * - If outline provided: runs atomicity check, returns report, does NOT transition
 * - If force provided: shows confirmation popup, transitions on confirm
 * - If both outline and force: error
 * - If neither: error
 * - Phase validation runs first (before outline/force checks)
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

describe("workflow_transition tool", () => {
  before(async () => {
    tmpDir = join(tmpdir(), `wf-transition-test-${randomUUID()}`);
    await mkdir(tmpDir, { recursive: true });
    await mkdir(join(tmpDir, "docs", "ADR"), { recursive: true });
    await mkdir(join(tmpDir, "docs", "specs"), { recursive: true });
    await mkdir(join(tmpDir, "docs", "plans"), { recursive: true });

    // Create sample ADRs for atomicity check tests
    await writeFile(
      join(tmpDir, "docs", "ADR", "001-database-choice.md"),
      "---\ntitle: Database Choice\ndescription: Use PostgreSQL\nstatus: proposed\n---\n\n# Decision\n\nUse PostgreSQL.",
      "utf-8",
    );
    await writeFile(
      join(tmpDir, "docs", "specs", "001-user-auth.md"),
      "---\ntitle: User Auth\ndescription: Auth system\nstatus: proposed\n---\n\n# Requirements\n\nAuth requirements.",
      "utf-8",
    );
    await writeFile(
      join(tmpDir, "docs", "plans", "001-create-auth.md"),
      "---\ntitle: Create Auth\ndescription: Build auth\nstatus: proposed\n---\n\n# Goals\n\nBuild auth system.",
      "utf-8",
    );
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── Parameter validation ──

  it("returns error when neither outline nor force is provided", async () => {
    const pi = mockPi();
    const { registerWorkflowTransitionTool } = await import("../workflow-transition.ts");
    registerWorkflowTransitionTool(pi);

    const tool = pi.tools.find((t) => t.name === "workflow_transition");
    assert.ok(tool);

    const ctx = mockCtx();
    const result = await tool.execute(
      "call-1",
      { phase: "specifying" },
      new AbortController().signal,
      () => {},
      ctx,
    );

    assert.ok(result.isError, "Should return an error when neither outline nor force");
    const text = result.content?.[0]?.text ?? "";
    assert.ok(
      text.includes("outline") || text.includes("force"),
      `Error should mention outline or force, got: ${text}`,
    );
    assert.equal(pi.stateEntries.length, 0, "State should not be persisted");
  });

  it("returns error when both outline and force are provided", async () => {
    const pi = mockPi();
    const { registerWorkflowTransitionTool } = await import("../workflow-transition.ts");
    registerWorkflowTransitionTool(pi);

    const tool = pi.tools.find((t) => t.name === "workflow_transition");
    assert.ok(tool);

    const ctx = mockCtx();
    const result = await tool.execute(
      "call-2",
      { phase: "specifying", outline: "ADR 001 — DB\n  Decision: Use PG", force: true },
      new AbortController().signal,
      () => {},
      ctx,
    );

    assert.ok(result.isError, "Should return an error when both outline and force");
    const text = result.content?.[0]?.text ?? "";
    assert.ok(
      text.includes("cannot") || text.includes("both"),
      `Error should mention both, got: ${text}`,
    );
    assert.equal(pi.stateEntries.length, 0, "State should not be persisted");
  });

  it("returns error for invalid phase names", async () => {
    const pi = mockPi();
    const { registerWorkflowTransitionTool } = await import("../workflow-transition.ts");
    registerWorkflowTransitionTool(pi);

    const tool = pi.tools.find((t) => t.name === "workflow_transition");
    assert.ok(tool);

    const ctx = mockCtx({ confirmResult: true });

    const result = await tool.execute(
      "call-3",
      { phase: "invalid_phase", force: true },
      new AbortController().signal,
      () => {},
      ctx,
    );

    assert.ok(result.isError, "Invalid phase should return an error");
    assert.equal(pi.stateEntries.length, 0, "State should not be persisted for invalid phase");
  });

  // ── Atomicity check (outline) ──

  it("returns atomicity report when outline is provided and items are atomic", async () => {
    const pi = mockPi();
    const { registerWorkflowTransitionTool } = await import("../workflow-transition.ts");
    registerWorkflowTransitionTool(pi);

    const tool = pi.tools.find((t) => t.name === "workflow_transition");
    assert.ok(tool);

    const ctx = mockCtx();
    const result = await tool.execute(
      "call-4",
      {
        phase: "specifying",
        outline: [
          "ADR 001 — Database Choice",
          "  Decision: Use PostgreSQL for persistence",
        ].join("\n"),
      },
      new AbortController().signal,
      () => {},
      ctx,
    );

    // Should NOT be an error — clean outline
    assert.ok(result, "Should return a result");
    assert.ok(!result.isError, "Clean outline should not be an error");

    const text = result.content?.[0]?.text ?? "";
    assert.ok(text.includes("Atomicity"), `Should mention atomicity, got: ${text}`);
    assert.ok(text.includes("✓"), `Should show checkmark for atomic items, got: ${text}`);

    // Should NOT transition
    assert.equal(pi.stateEntries.length, 0, "State should not be persisted during outline check");
  });

  it("blocks when outline has item with multiple decisions", async () => {
    const pi = mockPi();
    const { registerWorkflowTransitionTool } = await import("../workflow-transition.ts");
    registerWorkflowTransitionTool(pi);

    const tool = pi.tools.find((t) => t.name === "workflow_transition");
    assert.ok(tool);

    const ctx = mockCtx();
    const result = await tool.execute(
      "call-5",
      {
        phase: "specifying",
        outline: [
          "ADR 001 — Database Choice",
          "  Decision: Use PostgreSQL",
          "  Decision: Use Redis for cache",
        ].join("\n"),
      },
      new AbortController().signal,
      () => {},
      ctx,
    );

    // Should be an error — multiple decisions
    assert.ok(result.isError, "Multi-decision outline should return an error");
    const text = result.content?.[0]?.text ?? "";
    assert.ok(
      text.includes("2 Decision") || text.includes("declared"),
      `Should mention multiple decisions, got: ${text}`,
    );
    assert.equal(pi.stateEntries.length, 0, "State should not be persisted");
  });

  it("blocks when outline has item with missing decision", async () => {
    const pi = mockPi();
    const { registerWorkflowTransitionTool } = await import("../workflow-transition.ts");
    registerWorkflowTransitionTool(pi);

    const tool = pi.tools.find((t) => t.name === "workflow_transition");
    assert.ok(tool);

    const ctx = mockCtx();
    const result = await tool.execute(
      "call-6",
      {
        phase: "specifying",
        outline: "ADR 001 — Database Choice\n  No decision here",
      },
      new AbortController().signal,
      () => {},
      ctx,
    );

    assert.ok(result.isError, "Missing decision should return an error");
    const text = result.content?.[0]?.text ?? "";
    assert.ok(
      text.includes("No Decision") || text.includes("add exactly one"),
      `Should mention missing decision, got: ${text}`,
    );
    assert.equal(pi.stateEntries.length, 0, "State should not be persisted");
  });

  it("checks spec→plan outline for atomicity", async () => {
    const pi = mockPi();
    const { registerWorkflowTransitionTool } = await import("../workflow-transition.ts");
    registerWorkflowTransitionTool(pi);

    const tool = pi.tools.find((t) => t.name === "workflow_transition");
    assert.ok(tool);

    const ctx = mockCtx();
    const result = await tool.execute(
      "call-7",
      {
        phase: "planning",
        outline: [
          "Spec 001 — User Auth",
          "  DoD: Auth endpoints work",
          "Spec 002 — User Profiles",
          "  DoD: Profile CRUD works",
        ].join("\n"),
      },
      new AbortController().signal,
      () => {},
      ctx,
    );

    assert.ok(result, "Should return a result");
    assert.ok(!result.isError, "Clean spec outline should not be an error");
    const text = result.content?.[0]?.text ?? "";
    assert.ok(text.includes("✓"), `Should show checkmarks, got: ${text}`);
    assert.equal(pi.stateEntries.length, 0, "State should not be persisted");
  });

  it("reports title conjunction warnings but does not block", async () => {
    const pi = mockPi();
    const { registerWorkflowTransitionTool } = await import("../workflow-transition.ts");
    registerWorkflowTransitionTool(pi);

    const tool = pi.tools.find((t) => t.name === "workflow_transition");
    assert.ok(tool);

    const ctx = mockCtx();
    const result = await tool.execute(
      "call-8",
      {
        phase: "specifying",
        outline: [
          "ADR 001 — Database and Cache",
          "  Decision: Use PostgreSQL and Redis",
        ].join("\n"),
      },
      new AbortController().signal,
      () => {},
      ctx,
    );

    assert.ok(result, "Should return a result");
    assert.ok(!result.isError, "Conjunction warnings should not block");
    const text = result.content?.[0]?.text ?? "";
    assert.ok(text.includes("⚠️") || text.includes("warning") || text.includes("conjunction"),
      `Should warn about conjunction, got: ${text}`);
    assert.equal(pi.stateEntries.length, 0, "State should not be persisted");
  });

  it("rejects outline with 0 parsed items (unparseable text)", async () => {
    const pi = mockPi();
    const { registerWorkflowTransitionTool } = await import("../workflow-transition.ts");
    registerWorkflowTransitionTool(pi);

    const tool = pi.tools.find((t) => t.name === "workflow_transition");
    assert.ok(tool);

    const ctx = mockCtx();
    const result = await tool.execute(
      "call-9",
      {
        phase: "specifying",
        outline: "This is just some random text without any ADR or Spec markers.",
      },
      new AbortController().signal,
      () => {},
      ctx,
    );

    assert.ok(result.isError, "Unparseable outline should be rejected");
    const text = result.content?.[0]?.text ?? "";
    assert.ok(
      text.includes("0 items") || text.includes("could not parse") || text.includes("unparseable"),
      `Should mention 0 items or unparseable, got: ${text}`,
    );
    assert.equal(pi.stateEntries.length, 0, "State should not be persisted");
  });

  // ── Phase pre-condition gates ──

  it("blocks transition to specifying with no ADRs present", async () => {
    const pi = mockPi();
    const { registerWorkflowTransitionTool } = await import("../workflow-transition.ts");
    registerWorkflowTransitionTool(pi);

    const tool = pi.tools.find((t) => t.name === "workflow_transition");
    assert.ok(tool);

    // Use a fresh tmp dir with no ADR directory at all
    const emptyDir = join(tmpdir(), `wf-empty-adr-${randomUUID()}`);
    await mkdir(emptyDir, { recursive: true });

    const ctx = mockCtx({ confirmResult: true });
    ctx.cwd = emptyDir;
    const result = await tool.execute(
      "call-pre-1",
      { phase: "specifying", force: true },
      new AbortController().signal,
      () => {},
      ctx,
    );

    await rm(emptyDir, { recursive: true, force: true });

    assert.ok(result.isError, "Transition without ADRs should be blocked");
    const text = result.content?.[0]?.text ?? "";
    assert.ok(
      text.includes("no ADRs") || text.includes("No ADR") || text.includes("ADR"),
      `Should mention missing ADRs, got: ${text}`,
    );
    assert.equal(pi.stateEntries.length, 0, "State should not be persisted");
  });

  it("blocks transition to specifying with only implemented ADRs", async () => {
    const pi = mockPi();
    const { registerWorkflowTransitionTool } = await import("../workflow-transition.ts");
    registerWorkflowTransitionTool(pi);

    const tool = pi.tools.find((t) => t.name === "workflow_transition");
    assert.ok(tool);

    // Use isolated dir — only implemented ADRs
    const implOnlyDir = join(tmpdir(), `wf-impl-only-${randomUUID()}`);
    const { createAdr } = await import("../adr.ts");
    const adrPath = await createAdr(
      { title: "Old", description: "Done", status: "implemented", context: "C", decision: "D", impact: "I" },
      implOnlyDir,
    );
    await import("../adr.ts").then((m) => m.updateAdrStatus(adrPath, "implemented"));

    const ctx = mockCtx({ confirmResult: true });
    ctx.cwd = implOnlyDir;
    const result = await tool.execute(
      "call-pre-2",
      { phase: "specifying", force: true },
      new AbortController().signal,
      () => {},
      ctx,
    );

    await rm(implOnlyDir, { recursive: true, force: true });

    assert.ok(result.isError, "Transition without proposed ADRs should be blocked");
    assert.equal(pi.stateEntries.length, 0, "State should not be persisted");
  });

  it("allows transition to specifying when proposed ADRs exist", async () => {
    const pi = mockPi();
    const { registerWorkflowTransitionTool } = await import("../workflow-transition.ts");
    registerWorkflowTransitionTool(pi);

    const tool = pi.tools.find((t) => t.name === "workflow_transition");
    assert.ok(tool);

    // Use isolated dir with a proposed ADR
    const proposedDir = join(tmpdir(), `wf-proposed-${randomUUID()}`);
    const { createAdr } = await import("../adr.ts");
    await createAdr(
      { title: "New", description: "Needs specs", status: "proposed", context: "C", decision: "D", impact: "I" },
      proposedDir,
    );

    const ctx = mockCtx({ confirmResult: true });
    ctx.cwd = proposedDir;
    const result = await tool.execute(
      "call-pre-3",
      { phase: "specifying", force: true },
      new AbortController().signal,
      () => {},
      ctx,
    );

    await rm(proposedDir, { recursive: true, force: true });

    assert.ok(result, "Should return a result");
    assert.ok(!result.isError, "Transition with proposed ADRs should be allowed");
    assert.ok(pi.stateEntries.length >= 1, "State should be persisted");
  });

  it("blocks transition to planning when ADR has remaining > 0", async () => {
    const pi = mockPi();
    const { registerWorkflowTransitionTool } = await import("../workflow-transition.ts");
    registerWorkflowTransitionTool(pi);

    const tool = pi.tools.find((t) => t.name === "workflow_transition");
    assert.ok(tool);

    // Isolated dir with ADR that has remaining > 0
    const remainDir = join(tmpdir(), `wf-remain-${randomUUID()}`);
    const { createAdr } = await import("../adr.ts");
    const adrPath = await createAdr(
      { title: "Unspeced", description: "No specs", status: "proposed", context: "C", decision: "D", impact: "I" },
      remainDir,
    );
    await import("../adr.ts").then((m) => m.updateAdrField(adrPath, "remaining", 1));

    const ctx = mockCtx({ confirmResult: true });
    ctx.cwd = remainDir;
    const result = await tool.execute(
      "call-pre-4",
      { phase: "planning", force: true },
      new AbortController().signal,
      () => {},
      ctx,
    );

    await rm(remainDir, { recursive: true, force: true });

    assert.ok(result.isError, "Transition with ADR remaining > 0 should be blocked");
    const text = result.content?.[0]?.text ?? "";
    assert.ok(
      text.includes("remaining") || text.includes("Pre-condition"),
      `Should mention remaining count, got: ${text}`,
    );
  });



  it("allows transition to planning when all ADRs have remaining === 0", async () => {
    const pi = mockPi();
    const { registerWorkflowTransitionTool } = await import("../workflow-transition.ts");
    registerWorkflowTransitionTool(pi);

    const tool = pi.tools.find((t) => t.name === "workflow_transition");
    assert.ok(tool);

    // Use fresh dir with a clean ADR (remaining defaults to 0)
    const freshDir = join(tmpdir(), `wf-plan-ok-${randomUUID()}`);
    await mkdir(join(freshDir, "docs", "ADR"), { recursive: true });
    await mkdir(join(freshDir, "docs", "specs"), { recursive: true });
    const { createAdr } = await import("../adr.ts");
    await createAdr(
      { title: "Ready", description: "Has specs", status: "proposed", context: "C", decision: "D", impact: "I" },
      freshDir,
    );

    const ctx = mockCtx({ confirmResult: true });
    ctx.cwd = freshDir;
    const result = await tool.execute(
      "call-pre-5",
      { phase: "planning", force: true },
      new AbortController().signal,
      () => {},
      ctx,
    );

    await rm(freshDir, { recursive: true, force: true });

    assert.ok(result, "Should return a result");
    assert.ok(!result.isError, "Transition with all ADRs at remaining=0 should be allowed");
    assert.ok(pi.stateEntries.length >= 1, "State should be persisted");
  });

  it("blocks transition to implementing when spec has remaining > 0", async () => {
    const pi = mockPi();
    const { registerWorkflowTransitionTool } = await import("../workflow-transition.ts");
    registerWorkflowTransitionTool(pi);

    const tool = pi.tools.find((t) => t.name === "workflow_transition");
    assert.ok(tool);

    // Create ADR + spec with remaining > 0
    const freshDir = join(tmpdir(), `wf-impl-block-${randomUUID()}`);
    await mkdir(join(freshDir, "docs", "ADR"), { recursive: true });
    await mkdir(join(freshDir, "docs", "specs"), { recursive: true });
    const { createAdr } = await import("../adr.ts");
    const adrPath = await createAdr(
      { title: "NeedsImpl", description: "Needs plans", status: "proposed", context: "C", decision: "D", impact: "I" },
      freshDir,
    );
    await import("../adr.ts").then((m) => m.updateAdrField(adrPath, "remaining", 1));
    const { createSpec } = await import("../spec.ts");
    const specPath = await createSpec(1, "Needs Plan", "# Requirements\n\nTest\n\n# Design\n\nTest\n\n# References\n\n", freshDir);
    await import("../spec.ts").then((m) => m.updateSpecField(specPath, "remaining", 2));

    const ctx = mockCtx({ confirmResult: true });
    ctx.cwd = freshDir;
    const result = await tool.execute(
      "call-pre-6",
      { phase: "implementing", force: true },
      new AbortController().signal,
      () => {},
      ctx,
    );

    await rm(freshDir, { recursive: true, force: true });

    assert.ok(result.isError, "Transition with spec remaining > 0 should be blocked");
    const text = result.content?.[0]?.text ?? "";
    assert.ok(
      text.includes("remaining") || text.includes("Pre-condition"),
      `Should mention remaining count, got: ${text}`,
    );
  });

  it("allows transition to implementing when all specs have remaining === 0", async () => {
    const pi = mockPi();
    const { registerWorkflowTransitionTool } = await import("../workflow-transition.ts");
    registerWorkflowTransitionTool(pi);

    const tool = pi.tools.find((t) => t.name === "workflow_transition");
    assert.ok(tool);

    // Use fresh dir with fully planned ADR + spec
    const freshDir = join(tmpdir(), `wf-impl-ok-${randomUUID()}`);
    await mkdir(join(freshDir, "docs", "ADR"), { recursive: true });
    await mkdir(join(freshDir, "docs", "specs"), { recursive: true });
    const { createAdr } = await import("../adr.ts");
    await createAdr(
      { title: "ReadyImpl", description: "Has plans", status: "proposed", context: "C", decision: "D", impact: "I" },
      freshDir,
    );
    const { createSpec } = await import("../spec.ts");
    await createSpec(1, "Planned", "# Requirements\n\nTest\n\n# Design\n\nTest\n\n# References\n\n", freshDir);

    const ctx = mockCtx({ confirmResult: true });
    ctx.cwd = freshDir;
    const result = await tool.execute(
      "call-pre-7",
      { phase: "implementing", force: true },
      new AbortController().signal,
      () => {},
      ctx,
    );

    await rm(freshDir, { recursive: true, force: true });

    assert.ok(result, "Should return a result");
    assert.ok(!result.isError, "Transition with all specs at remaining=0 should be allowed");
  });

  // ── Force confirmation ──

  it("prompts user for confirmation when force is true", async () => {
    let confirmCalled = false;
    const ctx = mockCtx();
    ctx.ui.confirm = async (_title: string, _body: string) => {
      confirmCalled = true;
      return true;
    };

    const pi = mockPi();
    const { registerWorkflowTransitionTool } = await import("../workflow-transition.ts");
    registerWorkflowTransitionTool(pi);

    const tool = pi.tools.find((t) => t.name === "workflow_transition");
    assert.ok(tool);

    const result = await tool.execute(
      "call-9",
      { phase: "specifying", force: true },
      new AbortController().signal,
      () => {},
      ctx,
    );

    assert.ok(confirmCalled, "ui.confirm should have been called");
    assert.ok(result, "Should return a result");
    assert.ok(!result.isError, "Confirmed transition should not be an error");
    assert.ok(pi.stateEntries.length >= 1, "State should be persisted after confirmation");
    const latestState = pi.stateEntries[pi.stateEntries.length - 1] as Record<string, unknown>;
    assert.equal(latestState.phase, "specifying");
  });

  it("cancels transition when user declines confirmation", async () => {
    const pi = mockPi();
    const { registerWorkflowTransitionTool } = await import("../workflow-transition.ts");
    registerWorkflowTransitionTool(pi);

    const tool = pi.tools.find((t) => t.name === "workflow_transition");
    assert.ok(tool);

    const ctx = mockCtx({ confirmResult: false });

    const result = await tool.execute(
      "call-10",
      { phase: "specifying", force: true },
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
    assert.equal(pi.stateEntries.length, 0, "State should not be persisted when user declines");
  });

  it("transitions and returns phase-appropriate guidance for specifying", async () => {
    const pi = mockPi();
    const { registerWorkflowTransitionTool } = await import("../workflow-transition.ts");
    registerWorkflowTransitionTool(pi);

    const tool = pi.tools.find((t) => t.name === "workflow_transition");
    assert.ok(tool);

    const ctx = mockCtx({ confirmResult: true });

    const result = await tool.execute(
      "call-11",
      { phase: "specifying", force: true },
      new AbortController().signal,
      () => {},
      ctx,
    );

    assert.ok(result, "Should return a result");
    assert.ok(!result.isError);
    const text = result.content?.[0]?.text ?? "";
    assert.ok(text.includes("specifying"), `Should mention specifying, got: ${text}`);
    assert.ok(text.includes("spec_create"), `Should mention spec_create, got: ${text}`);
  });

  it("transitions and returns phase-appropriate guidance for planning", async () => {
    const pi = mockPi();
    const { registerWorkflowTransitionTool } = await import("../workflow-transition.ts");
    registerWorkflowTransitionTool(pi);

    const tool = pi.tools.find((t) => t.name === "workflow_transition");
    assert.ok(tool);

    const ctx = mockCtx({ confirmResult: true });

    const result = await tool.execute(
      "call-12",
      { phase: "planning", force: true },
      new AbortController().signal,
      () => {},
      ctx,
    );

    assert.ok(result, "Should return a result");
    assert.ok(!result.isError);
    const text = result.content?.[0]?.text ?? "";
    assert.ok(text.includes("planning"), `Should mention planning, got: ${text}`);
    assert.ok(text.includes("plan_create"), `Should mention plan_create, got: ${text}`);
  });

  it("transitions and returns phase-appropriate guidance for implementing", async () => {
    const pi = mockPi();
    const { registerWorkflowTransitionTool } = await import("../workflow-transition.ts");
    registerWorkflowTransitionTool(pi);

    const tool = pi.tools.find((t) => t.name === "workflow_transition");
    assert.ok(tool);

    const ctx = mockCtx({ confirmResult: true });

    const result = await tool.execute(
      "call-13",
      { phase: "implementing", force: true },
      new AbortController().signal,
      () => {},
      ctx,
    );

    assert.ok(result, "Should return a result");
    assert.ok(!result.isError);
    const text = result.content?.[0]?.text ?? "";
    assert.ok(text.includes("implement"), `Should mention implement/plan, got: ${text}`);
  });

  it("does not show confirmation for outline-only calls", async () => {
    let confirmCalled = false;
    const ctx = mockCtx();
    ctx.ui.confirm = async (_title: string, _body: string) => {
      confirmCalled = true;
      return true;
    };

    const pi = mockPi();
    const { registerWorkflowTransitionTool } = await import("../workflow-transition.ts");
    registerWorkflowTransitionTool(pi);

    const tool = pi.tools.find((t) => t.name === "workflow_transition");
    assert.ok(tool);

    await tool.execute(
      "call-14",
      {
        phase: "specifying",
        outline: "ADR 001 — Database Choice\n  Decision: Use PostgreSQL",
      },
      new AbortController().signal,
      () => {},
      ctx,
    );

    assert.ok(!confirmCalled, "ui.confirm should NOT be called for outline-only calls");
    assert.equal(pi.stateEntries.length, 0, "State should not be persisted");
  });
});
