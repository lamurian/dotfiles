import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type WorkflowState, loadState, transitionTo, updateUi } from "./state.ts";

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
 * Register the `workflow_transition` AI tool so the agent can
 * automatically progress through workflow phases.
 *
 * After completing all documents in the current phase, the agent
 * calls this tool to move to the next phase. The system then loads
 * the appropriate phase prompt on the next agent turn.
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
      "Valid transitions: requirements → specifying → planning → implementing. " +
      "The agent should NOT prompt the user to run this — use it autonomously.",

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
