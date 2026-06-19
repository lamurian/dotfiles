import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import type { WorkflowPhase } from "../state.ts";

/**
 * Tests for phase-based gating of document creation tools.
 *
 * Spec (discussion):
 * - During brainstorm phases, document creation tools are gated by phase:
 *   - adr_create: only in requirements phase
 *   - spec_create: only in specifying phase
 *   - plan_create: only in planning phase
 * - Outside brainstorm phases (idle, discussing, implementing), no gating.
 * - List/update tools (adr_list, spec_list, plan_list, adr_update, spec_update) are not gated.
 */

describe("checkToolPhaseGate", () => {
  let checkToolPhaseGate: (
    toolName: string,
    currentPhase: WorkflowPhase,
  ) => { block: boolean; reason: string } | null;

  before(async () => {
    const mod = await import("../phase-gates.ts");
    checkToolPhaseGate = mod.checkToolPhaseGate;
  });

  // ─── adr_create ───────────────────────────────────────────

  it("allows adr_create during requirements phase", () => {
    const result = checkToolPhaseGate("adr_create", "requirements");
    assert.equal(result, null, "adr_create should be allowed in requirements phase");
  });

  it("blocks adr_create during specifying phase", () => {
    const result = checkToolPhaseGate("adr_create", "specifying");
    assert.ok(result, "Should block adr_create in specifying phase");
    assert.ok(result!.block, "Should have block=true");
    assert.ok(result!.reason.includes("requirements"), "Reason should mention requirements");
  });

  it("blocks adr_create during planning phase", () => {
    const result = checkToolPhaseGate("adr_create", "planning");
    assert.ok(result);
    assert.ok(result!.block);
  });

  // ─── spec_create ──────────────────────────────────────────

  it("allows spec_create during specifying phase", () => {
    const result = checkToolPhaseGate("spec_create", "specifying");
    assert.equal(result, null, "spec_create should be allowed in specifying phase");
  });

  it("blocks spec_create during requirements phase", () => {
    const result = checkToolPhaseGate("spec_create", "requirements");
    assert.ok(result, "Should block spec_create in requirements phase");
    assert.ok(result!.block);
    assert.ok(result!.reason.includes("specifying"), "Reason should mention specifying");
  });

  it("blocks spec_create during planning phase", () => {
    const result = checkToolPhaseGate("spec_create", "planning");
    assert.ok(result);
    assert.ok(result!.block);
  });

  // ─── plan_create ──────────────────────────────────────────

  it("allows plan_create during planning phase", () => {
    const result = checkToolPhaseGate("plan_create", "planning");
    assert.equal(result, null, "plan_create should be allowed in planning phase");
  });

  it("blocks plan_create during requirements phase", () => {
    const result = checkToolPhaseGate("plan_create", "requirements");
    assert.ok(result, "Should block plan_create in requirements phase");
    assert.ok(result!.block);
    assert.ok(result!.reason.includes("planning"), "Reason should mention planning");
  });

  it("blocks plan_create during specifying phase", () => {
    const result = checkToolPhaseGate("plan_create", "specifying");
    assert.ok(result);
    assert.ok(result!.block);
  });

  // ─── Non-gated tools ──────────────────────────────────────

  it("allows adr_list in any brainstorm phase", () => {
    assert.equal(checkToolPhaseGate("adr_list", "requirements"), null);
    assert.equal(checkToolPhaseGate("adr_list", "specifying"), null);
    assert.equal(checkToolPhaseGate("adr_list", "planning"), null);
  });

  it("allows spec_list in any brainstorm phase", () => {
    assert.equal(checkToolPhaseGate("spec_list", "requirements"), null);
    assert.equal(checkToolPhaseGate("spec_list", "specifying"), null);
    assert.equal(checkToolPhaseGate("spec_list", "planning"), null);
  });

  it("allows plan_list in any brainstorm phase", () => {
    assert.equal(checkToolPhaseGate("plan_list", "requirements"), null);
    assert.equal(checkToolPhaseGate("plan_list", "specifying"), null);
    assert.equal(checkToolPhaseGate("plan_list", "planning"), null);
  });

  it("allows adr_update in any brainstorm phase", () => {
    assert.equal(checkToolPhaseGate("adr_update", "requirements"), null);
    assert.equal(checkToolPhaseGate("adr_update", "specifying"), null);
    assert.equal(checkToolPhaseGate("adr_update", "planning"), null);
  });

  it("allows spec_update in any brainstorm phase", () => {
    assert.equal(checkToolPhaseGate("spec_update", "requirements"), null);
    assert.equal(checkToolPhaseGate("spec_update", "specifying"), null);
    assert.equal(checkToolPhaseGate("spec_update", "planning"), null);
  });

  it("allows workflow_transition in any brainstorm phase", () => {
    assert.equal(checkToolPhaseGate("workflow_transition", "requirements"), null);
    assert.equal(checkToolPhaseGate("workflow_transition", "specifying"), null);
    assert.equal(checkToolPhaseGate("workflow_transition", "planning"), null);
  });

  // ─── Non-brainstorm phases ────────────────────────────────

  it("allows all tools during idle phase (no gating)", () => {
    assert.equal(checkToolPhaseGate("adr_create", "idle"), null);
    assert.equal(checkToolPhaseGate("spec_create", "idle"), null);
    assert.equal(checkToolPhaseGate("plan_create", "idle"), null);
  });

  it("allows all tools during discussing phase (no gating)", () => {
    assert.equal(checkToolPhaseGate("adr_create", "discussing"), null);
    assert.equal(checkToolPhaseGate("spec_create", "discussing"), null);
    assert.equal(checkToolPhaseGate("plan_create", "discussing"), null);
  });

  it("allows all tools during implementing phase (no gating)", () => {
    assert.equal(checkToolPhaseGate("adr_create", "implementing"), null);
    assert.equal(checkToolPhaseGate("spec_create", "implementing"), null);
    assert.equal(checkToolPhaseGate("plan_create", "implementing"), null);
  });

  // ─── Unknown tools ────────────────────────────────────────

  it("allows unknown tools in any brainstorm phase", () => {
    assert.equal(checkToolPhaseGate("unknown_tool", "requirements"), null);
    assert.equal(checkToolPhaseGate("another_tool", "specifying"), null);
  });
});
