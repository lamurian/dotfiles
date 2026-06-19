import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { type WorkflowState, loadState, transitionTo, updateUi } from "./state.ts";
import { loadDirectoriesConfig } from "./paths.ts";
import { listAdrs, updateAdrField } from "./adr.ts";
import { updateSpecField } from "./spec.ts";

/**
 * Valid workflow phases that can be transitioned to via this tool.
 * Excludes "idle" and "discussing" which require user-initiated commands,
 * and "testing"/"reporting" which are post-implementation phases.
 */
const VALID_PHASES = [
  "requirements",
  "specifying",
  "planning",
  "implementing",
] as const;

/**
 * Auto-compute remaining counts for all non-implemented specs and ADRs.
 *
 * Called when transitioning to the "implementing" phase. Scans active
 * (non-archived) plans for each spec and active specs for each ADR,
 * updating only those whose status is NOT "implemented".
 *
 * @param cwd - Project working directory.
 */
export async function autoUpdateRemaining(cwd: string): Promise<void> {
  const config = await loadDirectoriesConfig(cwd);
  const specsDir = join(cwd, config.specs.path);
  const plansDir = join(cwd, config.plans.path);

  // ── Update non-implemented specs ──
  if (existsSync(specsDir)) {
    const specFiles = await readdir(specsDir);
    for (const file of specFiles) {
      if (!file.endsWith(".md") || !/^\d{3}-/.test(file)) continue;

      const specPath = join(specsDir, file);
      const content = await readFile(specPath, "utf-8");

      // Skip if already implemented
      const status = content.match(/^status:\s*(\S+)/m)?.[1] ?? "";
      if (status === "implemented") continue;

      // Count active (non-archived) plans referencing this spec
      const specNum = file.slice(0, 3);
      const refPattern = `@docs/specs/${specNum}`;
      let count = 0;

      if (existsSync(plansDir)) {
        const planFiles = await readdir(plansDir);
        for (const pf of planFiles) {
          if (pf === ".archive" || !pf.endsWith(".md")) continue;
          const planContent = await readFile(join(plansDir, pf), "utf-8");
          if (planContent.includes(refPattern)) count++;
        }
      }

      await updateSpecField(specPath, "remaining", count);
    }
  }

  // ── Update non-implemented ADRs ──
  const adrFiles = await listAdrs(cwd);
  for (const adrPath of adrFiles) {
    const content = await readFile(adrPath, "utf-8");

    // Skip if already implemented
    const status = content.match(/^status:\s*(\S+)/m)?.[1] ?? "";
    if (status === "implemented") continue;

    // Count active (non-archived) specs referencing this ADR
    const baseName = adrPath.split("/").pop() ?? "";
    const adrNum = baseName.slice(0, 3);
    const refPattern = `@docs/ADR/${adrNum}`;
    let count = 0;

    if (existsSync(specsDir)) {
      const specFiles = await readdir(specsDir);
      for (const sf of specFiles) {
        if (sf === ".archive" || !sf.endsWith(".md")) continue;
        const specContent = await readFile(join(specsDir, sf), "utf-8");
        if (specContent.includes(refPattern)) count++;
      }
    }

    await updateAdrField(adrPath, "remaining", count);
  }
}

/**
 * Register the `workflow_transition` AI tool so the agent can
 * automatically progress through workflow phases.
 *
 * After completing all documents in the current phase, the agent
 * calls this tool to move to the next phase. The user is prompted
 * for confirmation via a UI dialog that the LLM cannot bypass.
 *
 * @param pi - ExtensionAPI reference.
 */
export function registerWorkflowTransitionTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "workflow_transition",
    label: "Transition Phase",
    description:
      "Progress the workflow to the next phase. " +
      "Call this after completing ALL documents in the current phase. " +
      "The user will be prompted for confirmation automatically. " +
      "Valid transitions: requirements → specifying → planning → implementing.",

    parameters: Type.Object({
      phase: Type.String({
        description:
          "Target phase. Valid values: " + VALID_PHASES.join(", ") + ". " +
          "requirements → after all ADRs drafted. " +
          "specifying → after all specs created. " +
          "planning → after all plans created. " +
          "implementing → ready to start implementing.",
      }),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { phase } = params;

      // Validate phase
      if (!VALID_PHASES.includes(phase as typeof VALID_PHASES[number])) {
        return {
          content: [
            {
              type: "text",
              text:
                `Error: Invalid phase "${phase}". ` +
                `Valid phases: ${VALID_PHASES.join(", ")}.`,
            },
          ],
          isError: true,
        };
      }

      // Prompt user for confirmation via UI dialog (non-bypassable)
      const ok = await ctx.ui.confirm(
        "Phase Transition",
        `Transition to "${phase}" phase?`,
      );
      if (!ok) {
        return {
          content: [
            {
              type: "text",
              text: `Transition to "${phase}" was cancelled.`,
            },
          ],
        };
      }

      // Auto-compute remaining counts for non-implemented specs/ADRs
      if (phase === "implementing") {
        await autoUpdateRemaining(ctx.cwd);
      }

      // Read current state from session
      const currentState = loadState(ctx);

      if (!currentState) {
        // No existing state — create a minimal one
        const newState: WorkflowState = {
          phase: phase as WorkflowState["phase"],
          specText: "",
          adrFiles: [],
          specFiles: [],
          planFiles: [],
        };
        transitionTo(pi, newState, phase as WorkflowState["phase"]);
        updateUi(newState, ctx);
      } else {
        transitionTo(pi, currentState, phase as WorkflowState["phase"]);
        updateUi(currentState, ctx);
      }

      return {
        content: [
          {
            type: "text",
            text:
              `Phase transitioned to "${phase}". ` +
              `The system will load the ${phase} phase prompt on the next turn. ` +
              (phase === "specifying"
                ? "Now read the ADR files and create specs using spec_create."
                : phase === "planning"
                ? "Now read the spec files and create plans using plan_create."
                : phase === "implementing"
                ? "Run /implement to start implementing."
                : ""),
          },
        ],
      };
    },
  });
}
