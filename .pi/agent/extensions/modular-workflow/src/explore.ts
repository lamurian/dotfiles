import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  decomposeInstruction,
  runParallelExploration,
  synthesizeResults,
  createLoader,
} from "./explore-core.ts";

// ─── /explore command registration ────────────────────────────────────────────

/**
 * Register the `/explore` slash command.
 *
 * Usage: /explore <instruction>
 *
 * The command:
 * 1. Decomposes the instruction into parallel search tasks
 * 2. Runs them concurrently via scout subprocesses
 * 3. Synthesizes results into a structured summary
 * 4. Injects the summary into the conversation via sendUserMessage
 *
 * @param pi - ExtensionAPI reference.
 */
export function registerExploreCommand(pi: ExtensionAPI): void {
  pi.registerCommand("explore", {
    description:
      "Explore the codebase using parallel searches. " +
      "Usage: /explore <instruction>",
    handler: async (args, ctx) => {
      const instruction = args.trim();
      if (!instruction) {
        ctx.ui.notify("Usage: /explore <instruction>", "warning");
        return;
      }

      ctx.ui.notify("Decomposing exploration into parallel searches...", "info");

      // Phase 1: Decompose
      const tasks = await decomposeInstruction(instruction, ctx, ctx.signal);
      ctx.ui.notify(
        `Running ${tasks.length} parallel search${tasks.length > 1 ? "es" : ""}...`,
        "info",
      );

      // Phase 2: Execute in parallel
      const loader = createLoader(instruction);
      loader.update("Running scouts...");
      const results = await runParallelExploration(
        tasks,
        ctx.cwd,
        ctx.signal,
        (partial) => {
          const done = partial.filter((r) => r.exitCode >= 0).length;
          loader.update(`${done}/${partial.length} scouts complete`);
        },
      );

      const successCount = results.filter((r) => r.exitCode === 0).length;
      ctx.ui.notify(
        `Exploration complete: ${successCount}/${results.length} tasks succeeded. Synthesizing...`,
        "info",
      );
      loader.done();

      // Phase 3: Synthesize
      const summary = await synthesizeResults(instruction, results, ctx, ctx.signal);

      // Phase 4: Inject into conversation
      pi.sendUserMessage(summary, { deliverAs: "steer" });
    },
  });
}

// ─── explore tool registration ─────────────────────────────────────────────────

/**
 * Register the `explore` tool for LLM-initiated use.
 *
 * The tool accepts an `instruction` parameter and returns synthesized
 * exploration results directly as tool output.
 *
 * @param pi - ExtensionAPI reference.
 */
export function registerExploreTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "explore",
    label: "Explore",
    description:
      "Explore the codebase using parallel searches. " +
      "Provide an instruction describing what to find. " +
      "Runs multiple scouts concurrently with different search strategies " +
      "and returns a structured summary with relative file paths.",
    parameters: Type.Object({
      instruction: Type.String({
        description: "What to explore in the codebase",
      }),
    }),

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const instruction = params.instruction.trim();
      if (!instruction) {
        return {
          content: [{ type: "text", text: "No instruction provided." }],
          isError: true,
        };
      }

      // Phase 1: Decompose
      const tasks = await decomposeInstruction(instruction, ctx, signal);

      // Phase 2: Execute
      const results = await runParallelExploration(tasks, ctx.cwd, signal);

      // Phase 3: Synthesize
      const summary = await synthesizeResults(instruction, results, ctx, signal);

      return {
        content: [{ type: "text", text: summary }],
      };
    },
  });
}
