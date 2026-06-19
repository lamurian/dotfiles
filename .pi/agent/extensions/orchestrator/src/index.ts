/**
 * Orchestrator Extension
 *
 * Registers:
 * - `/orchestrate <directory>` — orchestrate sequential plan implementation
 * - `implement_plan` tool — gate for spawned pi sessions to get TDD instructions
 *
 * The extension spawns separate pi subprocesses for each plan file,
 * then verifies implementation via git state, archives the plan, and amends.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolve, isAbsolute } from "node:path";
import { readFile } from "node:fs/promises";
import { ensureArchiveDir } from "./plan.ts";
import { runOrchestration, formatSummary } from "./orchestrator.ts";
import { truncateToWidth } from "@earendil-works/pi-tui";

// ── Widget Helpers ────────────────────────────────────────────

/**
 * Render log lines as an array of widget strings.
 * Each line is truncated to fit within the given terminal width.
 *
 * @param logBuffer - Array of log messages.
 * @param maxVisible - Maximum number of visible lines.
 * @param width - Terminal width in columns.
 * @param theme - Theme object for styling.
 * @returns Array of rendered lines (themed, truncated).
 */
export function renderWidgetLines(
  logBuffer: string[],
  maxVisible: number,
  width: number,
  theme: { fg: (color: string, text: string) => string; bold: (text: string) => string },
): string[] {
  if (logBuffer.length === 0) return [];
  const lines = logBuffer.slice(-maxVisible);
  return [
    theme.fg("accent", theme.bold(truncateToWidth("── Orchestrator ──", width))),
    ...lines.map((l) => theme.fg("dim", truncateToWidth(l, width))),
    theme.fg("muted", truncateToWidth(`  ${logBuffer.length} events`, width)),
  ];
}

export default function (pi: ExtensionAPI): void {
  // ── implement_plan tool ──────────────────────────────────────
  pi.registerTool({
    name: "implement_plan",
    label: "Implement Plan",
    description:
      "Read a plan file and return TDD implementation instructions. " +
      "Call this tool with the path to a plan file. It will read the " +
      "plan content, resolve cross-references, and return implementation instructions. " +
      "Follow the returned instructions exactly, using commit_changes after each task.",
    promptSnippet:
      "Read a plan file and return implementation instructions. Call this first when implementing a plan.",
    promptGuidelines: [
      "Call implement_plan with the plan file path before starting implementation. " +
        "It returns the full implementation context.",
    ],

    parameters: Type.Object({
      planFile: Type.String({
        description: "Path to the plan file to implement (e.g., docs/plans/001-task.md)",
      }),
    }),

    async execute(
      _toolCallId: string,
      params: { planFile: string },
      _signal: AbortSignal | undefined,
      _onUpdate: ((update: { content: { type: string; text: string }[] }) => void) | undefined,
      ctx: { cwd: string },
    ) {
      const planPath = isAbsolute(params.planFile)
        ? params.planFile
        : resolve(ctx.cwd, params.planFile);

      let planContent: string;
      try {
        planContent = await readFile(planPath, "utf-8");
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Could not read plan file at ${planPath}: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }

      const instructions = [
        `# Implementation Instructions`,
        ``,
        `You are implementing the following plan.`,
        `Follow TDD rules: write a failing test first, implement, run tests, repeat.`,
        ``,
        `## Plan Content`,
        ``,
        planContent,
        ``,
        `## Rules`,
        ``,
        `1. Read and understand the plan before coding.`,
        `2. For each task in the plan:`,
        `   a. Write a failing test that describes the behavior`,
        `   b. Implement the minimum code to make the test pass`,
        `   c. Run tests and fix any failures`,
        `   d. Commit with commit_changes using a conventional commit message`,
        `3. Do not skip tasks or add behavior not in the plan.`,
        `4. After all tasks are done, verify everything works.`,
      ].join("\n");

      return {
        content: [{ type: "text", text: instructions }],
        details: {
          planFile: params.planFile,
          planSize: planContent.length,
        },
      };
    },
  });

  // ── /orchestrate command ─────────────────────────────────────
  pi.registerCommand("orchestrate", {
    description:
      "Sequentially implement all plan files in a directory. " +
      "Usage: /orchestrate <directory> (e.g., /orchestrate docs/plans). " +
      "Each plan file is implemented in order via a spawned pi session. " +
      "On success, the plan is archived and the last commit is amended. " +
      "On failure, analysis is reported and orchestration stops.",

    handler: async (args, ctx) => {
      const dirArg = args.trim() || "docs/plans";
      const plansDir = isAbsolute(dirArg) ? dirArg : resolve(ctx.cwd, dirArg);

      // Verify directory exists
      try {
        const stat = await import("node:fs/promises").then((fs) => fs.stat(plansDir));
        if (!stat.isDirectory()) {
          ctx.ui.notify(`Not a directory: ${plansDir}`, "error");
          return;
        }
      } catch {
        ctx.ui.notify(`Directory not found: ${plansDir}`, "error");
        return;
      }

      // Ensure archive directory exists
      await ensureArchiveDir(plansDir);

      // ── Live log widget above the editor ────────────────────
      const MAX_VISIBLE = 15;
      const MAX_TOTAL = 1000;
      const logBuffer: string[] = [];

      let requestRender: (() => void) | undefined;

      ctx.ui.setWidget("orchestrator-log", (tui, theme) => {
        requestRender = () => tui.requestRender();
        return {
          render: (width: number) => renderWidgetLines(logBuffer, MAX_VISIBLE, width, theme),
          invalidate: () => {},
        };
      });

      const summary = await runOrchestration(plansDir, {
        ...ctx,
        logLine: (line: string) => {
          logBuffer.push(line);
          if (logBuffer.length > MAX_TOTAL) {
            logBuffer.splice(0, logBuffer.length - MAX_VISIBLE * 3);
          }
          requestRender?.();
        },
      });

      // Clear the widget
      ctx.ui.setWidget("orchestrator-log", undefined);

      // Print the summary
      const formatted = formatSummary(summary);
      ctx.ui.notify(formatted, "info");

      // Include last log lines on failure for diagnostics
      if (summary.failed > 0) {
        const tail = logBuffer.slice(-8).join("\n");
        const msg = tail
          ? `Orchestration stopped. Last events:\n${tail}`
          : `Orchestration stopped. Fix the reported issue and re-run /orchestrate.`;
        ctx.ui.notify(msg, "warning");
      }
    },
  });
}
