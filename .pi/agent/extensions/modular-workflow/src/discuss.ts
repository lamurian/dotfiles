import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { WorkflowState } from "./state.ts";
import { transitionTo, updateUi } from "./state.ts";

/**
 * Start a discussion session about an issue, bug, chore, or small fix.
 *
 * The LLM acts as an engineer who:
 * 1. Clarifies the user's intention
 * 2. Proposes an implementation approach
 * 3. Iterates with user feedback
 * 4. Presents a finalized implementation strategy
 *
 * Unlike /brainstorm, /discuss does NOT write any files (ADRs, specs, plans).
 * The plan is streamed in the conversation session.
 * The user can then run `/implement` to execute the agreed plan.
 *
 * @param args - The topic or issue to discuss.
 * @param pi   - ExtensionAPI reference.
 * @param ctx  - Current extension context.
 */
export async function runDiscussion(
  args: string,
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<void> {
  const topic = args.trim() || "Let's discuss this issue.";

  const state: WorkflowState = {
    phase: "discussing",
    specText: topic,
    adrFiles: [],
    specFiles: [],
    planFiles: [],
  };

  transitionTo(pi, state, "discussing");
  updateUi(state, ctx);

  ctx.ui.notify(
    "Starting discussion. I'll help clarify the issue and plan the implementation.",
    "info",
  );

  pi.sendUserMessage(topic, { deliverAs: "steer" });
}
