import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadContent, renderTemplate } from "./utils.ts";
import { readLatestAdr } from "./adr.ts";
import {
  type WorkflowState,
  transitionTo,
  updateUi,
} from "./state.ts";

/**
 * Start the TDD implementation phase.
 *
 * 1. Builds a TDD system prompt from the specification
 * 2. Transitions state to "implementing"
 * 3. Injects the TDD context into the next agent turn
 *   via pi.sendUserMessage
 *
 * The actual TDD enforcement (test-first, run tests) is driven
 * by the system prompt injected in before_agent_start.
 *
 * @param spec - Full specification text (usually from an ADR).
 * @param pi   - ExtensionAPI reference.
 * @param ctx  - Current extension context.
 */
export async function startTdd(
  spec: string,
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<void> {
  const state: WorkflowState = {
    phase: "implementing",
    specText: spec,
    adrFiles: [],
  };

  const latestAdr = await readLatestAdr(ctx.cwd);
  if (latestAdr) {
    state.adrFiles = [latestAdr.title];
  }

  transitionTo(pi, state, "implementing");
  updateUi(state, ctx);

  const tddPrompt = await buildTddPrompt(spec);

  ctx.ui.notify("Starting TDD implementation.", "info");

  // Send the TDD prompt as a user message to kick off the agent
  pi.sendUserMessage(tddPrompt, { deliverAs: "steer" });
}

/**
 * Build the TDD-mode system prompt by loading the template
 * and substituting the specification.
 *
 * @param spec - Specification text to inject.
 * @returns The rendered TDD prompt string.
 */
export async function buildTddPrompt(spec: string): Promise<string> {
  const template = await loadContent("tdd-prompt.md");
  return renderTemplate(template, { spec });
}

/**
 * Generate an end-of-implementation report.
 *
 * Reads test results from state and compares against the spec.
 *
 * @param state - Current workflow state with test results.
 * @param ctx   - Extension context.
 * @returns A markdown report string.
 */
export async function generateReport(
  state: WorkflowState,
  _ctx: ExtensionContext,
): Promise<string> {
  const template = await loadContent("report-template.md");
  const results = state.lastTestResults;

  const coverageRows = state.adrFiles
    .map((f) => `| ${f} | Implemented |`)
    .join("\n");

  return renderTemplate(template, {
    summary: "Implementation complete. See details below.",
    coverageRows: coverageRows || "| (no ADR reference) | Implemented |",
    passed: String(results?.passed ?? 0),
    failed: String(results?.failed ?? 0),
    coveragePercent: String(results?.coveragePercent ?? 0),
    gaps: "Review the ADR for any unimplemented edge cases.",
  });
}

/**
 * Detect the project's test command by checking for common config files.
 *
 * @param cwd - Project working directory.
 * @returns [command, args[]] tuple, or ["npm", ["test"]] as fallback.
 */
function detectTestCommand(cwd: string): [string, string[]] {
  if (existsSync(resolve(cwd, "vitest.config.ts"))) return ["npx", ["vitest", "run"]];
  if (existsSync(resolve(cwd, "jest.config.ts"))) return ["npx", ["jest"]];
  if (existsSync(resolve(cwd, "jest.config.js"))) return ["npx", ["jest"]];
  if (existsSync(resolve(cwd, ".mocharc.yml"))) return ["npx", ["mocha"]];
  return ["npm", ["test"]];
}

/**
 * Run the project's test command and return results.
 *
 * Detects common test frameworks by checking for config files.
 * Falls back to "npm test". Parses output for pass/fail counts.
 *
 * @param pi  - ExtensionAPI reference for execution.
 * @param ctx - Extension context (for cwd).
 * @returns Object with pass/fail counts.
 */
export async function runTests(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<{ passed: number; failed: number; coveragePercent?: number }> {
  ctx.ui.notify("Running tests...", "info");

  const [cmd, args] = detectTestCommand(ctx.cwd);
  try {
    const result = await pi.exec(cmd, args, { cwd: ctx.cwd, timeout: 120_000 });
    const stdout = result.stdout ?? "";

    // Parse test counts from common output formats (Mocha/Jest)
    const passMatch = stdout.match(/(\d+)\s+passing/);
    const failMatch = stdout.match(/(\d+)\s+failing/);
    // Parse coverage from istanbul/lcov summary line
    const coverageMatch = stdout.match(/All files\s+\|[^|]+\|[^|]+\|\s*([\d.]+)/);

    return {
      passed: passMatch ? parseInt(passMatch[1], 10) : 0,
      failed: failMatch ? parseInt(failMatch[1], 10) : 0,
      coveragePercent: coverageMatch ? parseFloat(coverageMatch[1]) : undefined,
    };
  } catch {
    return { passed: 0, failed: 1 };
  }
}

/**
 * Get the "Not Yet Implemented" gaps from the session.
 *
 * @param _ctx - Extension context.
 * @returns Array of gap descriptions.
 */
export async function getGaps(
  _ctx: ExtensionContext,
): Promise<string[]> {
  // TODO: scan session for unimplemented items vs ADR
  return [];
}
