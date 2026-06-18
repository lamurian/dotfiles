/**
 * Orchestration engine for sequential plan implementation.
 *
 * For each plan file, spawns a pi session, detects completion via JSON events,
 * and handles timeouts with retries and continuation.
 */

import { listPlanFiles } from "./plan.ts";
import {
  renderPlanPrompt,
  renderContinuationPrompt,
  spawnPiSession,
} from "./session.ts";
import { getPlanTimeoutMs } from "./session-types.ts";
import type { SpawnResult } from "./session-types.ts";
import {
  handleSessionOutcome,
  handleTimeoutWithCommit,
  handleTimeoutExhausted,
  handleSpawnError,
  buildSummary,
} from "./orchestration-handlers.ts";
import type { PlanResult, OrchestrationSummary, Ctx } from "./orchestration-handlers.ts";
import { getHeadHashFull, isWorkingTreeClean } from "./git.ts";
import { basename } from "node:path";

// Re-export types for consumers
export type { PlanResult, OrchestrationSummary };
export type { Ctx };

/** Maximum number of retries for a timed-out plan. */
const MAX_RETRIES = 3;

/**
 * Run orchestration for all plan files in a directory.
 *
 * For each plan file:
 * 1. Record HEAD hash before
 * 2. Spawn a pi session with the plan prompt
 * 3. Parse JSON events to detect completion (agent_end)
 * 4. If timed out with no commit: retry up to MAX_RETRIES with continuation context
 * 5. If timed out with commit: archive and treat as completed
 * 6. If clean completion: check git state, archive, amend
 * 7. On non-zero exit or user kill: analyze, report, stop
 *
 * @param plansDir - Absolute path to the plans directory.
 * @param ctx      - Extension context (for cwd and UI).
 * @returns Summary of the orchestration run.
 */
export async function runOrchestration(
  plansDir: string,
  ctx: Ctx,
): Promise<OrchestrationSummary> {
  const files = await listPlanFiles(plansDir);
  const results: PlanResult[] = [];

  if (files.length === 0) {
    return { results: [], total: 0, implemented: 0, failed: 0 };
  }

  ctx.ui.notify(`Orchestrating ${files.length} plan(s)...`, "info");

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    const fileName = basename(filePath);

    ctx.ui.setStatus(
      "orchestrator",
      `Implementing ${fileName} (${i + 1}/${files.length})`,
    );
    ctx.ui.notify(
      `[${i + 1}/${files.length}] Implementing ${fileName}...`,
      "info",
    );

    // ── Retry loop ─────────────────────────────────────────────
    let retries = 0;
    let previousMessages: string[] = [];
    let planResult: PlanResult | null = null;

    while (retries <= MAX_RETRIES) {
      const headBefore = getHeadHashFull(ctx.cwd);

      // Determine prompt based on retry count
      const prompt =
        retries === 0
          ? await renderPlanPrompt(filePath)
          : await renderContinuationPrompt(filePath, previousMessages);

      // Spawn pi session with timeout and log forwarding
      const spawnResult = await spawnPiSession(prompt, ctx.cwd, {
        timeoutMs: getPlanTimeoutMs(),
        onLog: ctx.logLine,
      });

      // Collect assistant messages for potential continuation
      if (spawnResult.assistantMessages.length > 0) {
        previousMessages = spawnResult.assistantMessages;
      }

      // ── Case 1: Killed by user / non-timeout kill ──────────
      if (spawnResult.killed && !spawnResult.timedOut) {
        planResult = {
          file: fileName,
          success: false,
          error: "Pi session was killed (cancelled).",
        };
        break;
      }

      // ── Case 2: Clean completion (agent_end received) ─────
      if (spawnResult.completed) {
        planResult = await handleSessionOutcome(
          filePath, plansDir, fileName,
          headBefore, spawnResult, ctx,
        );
        break;
      }

      // ── Case 3: Timeout ────────────────────────────────────
      if (spawnResult.timedOut) {
        const headAfter = getHeadHashFull(ctx.cwd);
        const headChanged = headAfter !== "" && headBefore !== headAfter;
        const treeClean = isWorkingTreeClean(ctx.cwd);

        if (headChanged) {
          planResult = await handleTimeoutWithCommit(
            filePath, plansDir, fileName, headAfter, ctx,
          );
          break;
        }

        retries++;

        if (retries <= MAX_RETRIES) {
          ctx.ui.notify(
            `⏱ ${fileName} timed out (attempt ${retries}/${MAX_RETRIES}). Retrying...`,
            "warning",
          );
          continue;
        }

        planResult = await handleTimeoutExhausted(
          filePath, plansDir, fileName, ctx,
        );
        break;
      }

      // ── Case 4: Non-zero exit (spawn failed) ───────────────
      if (spawnResult.exitCode !== 0 && !spawnResult.completed) {
        planResult = await handleSpawnError(
          filePath, fileName, spawnResult, ctx,
        );
        break;
      }

      // ── Case 5: No agent_end but exitCode=0 ───────────────
      retries++;
      if (retries <= MAX_RETRIES) {
        ctx.ui.notify(
          `⏱ ${fileName} did not complete (attempt ${retries}/${MAX_RETRIES}). Retrying...`,
          "warning",
        );
        continue;
      }

      planResult = await handleTimeoutExhausted(
        filePath, plansDir, fileName, ctx,
      );
      break;
    }

    // ── Process result ────────────────────────────────────────
    if (planResult) {
      results.push(planResult);

      if (!planResult.success && !planResult.error?.includes("timed out")) {
        ctx.ui.notify(`✗ ${fileName}: ${planResult.error}`, "error");
        break;
      }
    }
  }

  ctx.ui.setStatus("orchestrator", undefined);
  return buildSummary(results);
}

/**
 * Format the orchestration summary as a human-readable string.
 *
 * @param summary - The orchestration results.
 * @returns Formatted summary string.
 */
export function formatSummary(summary: OrchestrationSummary): string {
  const lines: string[] = [];
  lines.push("=== Orchestration Summary ===");
  lines.push("");

  for (const r of summary.results) {
    const icon = r.success ? "✅" : "❌";
    const status = r.success ? "Implemented and archived" : "FAILED";
    lines.push(`${icon} ${r.file} - ${status}`);
    if (r.error) {
      lines.push(`   Error: ${r.error}`);
    }
    if (r.analysis) {
      lines.push(`   Analysis: ${r.analysis}`);
    }
    lines.push("");
  }

  lines.push(
    `Total: ${summary.total} | Implemented: ${summary.implemented} | Failed: ${summary.failed}`,
  );

  if (summary.failed > 0) {
    lines.push("");
    lines.push("Orchestration stopped due to failure. Fix the issue and re-run.");
  }

  return lines.join("\n");
}
