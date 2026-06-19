/**
 * Orchestration engine for sequential plan implementation.
 *
 * For each plan file:
 * 1. Record HEAD hash before
 * 2. Build full context (plan content + cross-refs) and spawn pi session
 * 3. After subprocess exits (any reason): check if HEAD changed
 * 4. If HEAD changed → mv to archive + git commit --amend --no-edit
 * 5. If HEAD unchanged → failure, plan stays in place
 *
 * Single-pass per plan. No retry loop. No continuation prompts.
 * Completion is detected by HEAD change, not by agent_end events.
 */

import { readFile } from "node:fs/promises";
import { listPlanFiles, moveToArchive } from "./plan.ts";
import { renderPlanPrompt, spawnPiSession } from "./session.ts";
import { getPlanTimeoutMs } from "./session-types.ts";
import { getHeadHashFull, amendLastCommit } from "./git.ts";
import { basename } from "node:path";
import type { Ctx } from "./orchestration-handlers.ts";
import { buildSummary, type PlanResult, type OrchestrationSummary } from "./orchestration-handlers.ts";

// Re-export types for consumers
export type { PlanResult, OrchestrationSummary };
export type { Ctx };

/**
 * Run orchestration for all plan files in a directory.
 *
 * For each plan file:
 * 1. Read plan content and build context prompt (plan text is embedded inline)
 * 2. Record HEAD_BEFORE
 * 3. Spawn pi session with timeout and log forwarding
 * 4. After subprocess exits (any reason):
 *    a. If HEAD changed → mv to .archive (filesystem rename), git commit --amend --no-edit
 *    b. If HEAD unchanged → failure
 * 5. On failure, stop processing further plans
 * 6. Continue to next plan on success
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

    // ── Read plan content and build prompt ───────────────────
    let planContent: string;
    try {
      planContent = await readFile(filePath, "utf-8");
    } catch (err) {
      const errorMsg = `Failed to read plan file: ${(err as Error).message}`;
      ctx.ui.notify(`✗ ${fileName}: ${errorMsg}`, "error");
      results.push({ file: fileName, success: false, error: errorMsg });
      break;
    }

    // Resolve cross-references (plan → spec → ADR)
    // In the future, cross-ref resolution can be added here.
    // For now, plan content is used as-is.

    // Render prompt with plan content embedded
    const prompt = await renderPlanPrompt(planContent);

    // Record HEAD before spawning
    const headBefore = getHeadHashFull(ctx.cwd);

    // Spawn pi session with timeout and log forwarding
    const spawnResult = await spawnPiSession(prompt, ctx.cwd, {
      timeoutMs: getPlanTimeoutMs(),
      onLog: ctx.logLine,
    });

    // ── Check HEAD after subprocess exits (any reason) ──────
    const headAfter = getHeadHashFull(ctx.cwd);
    const headChanged = headAfter !== "" && headBefore !== headAfter;

    if (headChanged) {
      // ── Success: archive using filesystem rename and amend last commit ──
      try {
        const archived = await moveToArchive(filePath, plansDir);
        ctx.ui.notify(`🗄  Archived: ${basename(archived)}`, "info");
      } catch (err) {
        ctx.ui.notify(
          `  Warning: Archive failed: ${(err as Error).message}`,
          "warning",
        );
      }

      const amendResult = amendLastCommit(ctx.cwd);
      if (amendResult.success) {
        ctx.ui.notify(`  Amended commit`, "info");
      } else {
        ctx.ui.notify(
          `  Warning: Amend failed: ${amendResult.error ?? "unknown"}`,
          "warning",
        );
      }

      results.push({ file: fileName, success: true });
    } else {
      // ── Failure: no changes committed ──────────────────────
      const errorMsg = spawnResult.stderr
        ? `No commits made. Stderr: ${spawnResult.stderr.slice(0, 200)}`
        : "No commits were made during the session.";

      ctx.ui.notify(`✗ ${fileName}: ${errorMsg}`, "error");
      results.push({ file: fileName, success: false, error: errorMsg });
      break;
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
