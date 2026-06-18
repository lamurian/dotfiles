import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { listPlanFiles, moveToArchive } from "./plan.ts";
import { renderPlanPrompt, spawnPiSession, loadPlanPrompt } from "./session.ts";
import {
  getHeadHash,
  getHeadHashFull,
  getLastCommitMessage,
  isWorkingTreeClean,
  stageAll,
  stageFile,
  amendLastCommit,
} from "./git.ts";
import { basename } from "node:path";

/**
 * Status of a single plan's implementation attempt.
 */
export interface PlanResult {
  /** Plan file name (e.g., "001-task.md"). */
  file: string;
  /** Whether the plan was successfully implemented. */
  success: boolean;
  /** Error message if failed. */
  error?: string;
  /** Detailed analysis of failure (set when error analysis ran). */
  analysis?: string;
}

/**
 * Summary of the full orchestration run.
 */
export interface OrchestrationSummary {
  /** Per-plan results in order. */
  results: PlanResult[];
  /** Total number of plans processed. */
  total: number;
  /** Number of successfully implemented plans. */
  implemented: number;
  /** Number of failed plans. */
  failed: number;
}

/**
 * Run orchestration for all plan files in a directory.
 *
 * For each plan file:
 * 1. Record HEAD hash before
 * 2. Spawn a pi session with the plan prompt
 * 3. Wait for completion
 * 4. Check git status and HEAD
 * 5. If successful: archive the plan, git add, amend
 * 6. If failed: analyze, report, stop
 *
 * @param plansDir - Absolute path to the plans directory.
 * @param ctx      - Extension context (for cwd and UI).
 * @returns Summary of the orchestration run.
 */
export async function runOrchestration(
  plansDir: string,
  ctx: ExtensionContext,
): Promise<OrchestrationSummary> {
  const files = await listPlanFiles(plansDir);
  const results: PlanResult[] = [];

  if (files.length === 0) {
    return {
      results: [],
      total: 0,
      implemented: 0,
      failed: 0,
    };
  }

  ctx.ui.notify(`Orchestrating ${files.length} plan(s)...`, "info");

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    const fileName = basename(filePath);

    ctx.ui.setStatus("orchestrator", `Implementing ${fileName} (${i + 1}/${files.length})`);
    ctx.ui.notify(`[${i + 1}/${files.length}] Implementing ${fileName}...`, "info");

    // Record HEAD before
    const headBefore = getHeadHashFull(ctx.cwd);

    // Render prompt and spawn pi session
    const prompt = await renderPlanPrompt(filePath);

    const spawnResult = await spawnPiSession(prompt, ctx.cwd);

    if (spawnResult.killed) {
      const result: PlanResult = {
        file: fileName,
        success: false,
        error: "Pi session was killed (cancelled).",
      };
      results.push(result);
      ctx.ui.notify(`✗ ${fileName}: Session killed`, "error");
      break; // Stop orchestration
    }

    // Check implementation result
    const headAfter = getHeadHashFull(ctx.cwd);
    const treeClean = isWorkingTreeClean(ctx.cwd);
    const lastCommit = getLastCommitMessage(ctx.cwd);

    const headChanged = headAfter !== "" && headBefore !== headAfter;

    if (spawnResult.exitCode !== 0) {
      // Non-zero exit — analyze the failure
      const analysis = await analyzeFailure(filePath, spawnResult, ctx);
      const result: PlanResult = {
        file: fileName,
        success: false,
        error: `Pi session exited with code ${spawnResult.exitCode}`,
        analysis,
      };
      results.push(result);
      ctx.ui.notify(`✗ ${fileName}: Failed (exit code ${spawnResult.exitCode})`, "error");
      break; // Stop on first failure
    }

    if (!headChanged && !treeClean) {
      // HEAD didn't change and there are uncommitted changes
      const analysis = await analyzeFailure(filePath, spawnResult, ctx);
      const result: PlanResult = {
        file: fileName,
        success: false,
        error: "Implementation was not committed; changes left uncommitted.",
        analysis,
      };
      results.push(result);
      ctx.ui.notify(`✗ ${fileName}: Changes not committed`, "error");
      break; // Stop on first failure
    }

    if (headChanged) {
      // Implementation completed and committed
      // Archive the plan file
      const archived = await moveToArchive(filePath, plansDir);
      ctx.ui.notify(`  Archived: ${basename(archived)}`, "info");

      // Git add the archived file
      const staged = stageFile(archived, ctx.cwd);
      if (!staged) {
        ctx.ui.notify(`  Warning: Failed to stage archived file`, "warning");
      }

      // Amend the last commit to include the archived file
      const amendResult = amendLastCommit(ctx.cwd);
      if (amendResult.success) {
        ctx.ui.notify(`  Amended commit: ${lastCommit}`, "info");
      } else {
        ctx.ui.notify(
          `  Warning: Amend failed: ${amendResult.error ?? "unknown"}`,
          "warning",
        );
      }

      results.push({
        file: fileName,
        success: true,
      });
    } else if (treeClean) {
      // HEAD unchanged and tree clean — might mean the plan was already implemented
      // or the pi session did nothing. Archive anyway.
      const archived = await moveToArchive(filePath, plansDir);
      const staged = stageFile(archived, ctx.cwd);
      if (staged) {
        amendLastCommit(ctx.cwd);
      }
      results.push({
        file: fileName,
        success: true,
        error: undefined,
      });
    }
  }

  ctx.ui.setStatus("orchestrator", undefined);

  return buildSummary(results);
}

/**
 * Build a summary from per-plan results.
 */
function buildSummary(results: PlanResult[]): OrchestrationSummary {
  const implemented = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  return {
    results,
    total: results.length,
    implemented,
    failed,
  };
}

/**
 * Analyze why a plan implementation failed.
 *
 * Spawns a pi subprocess to analyze the failure, reads the analysis,
 * and returns the findings.
 *
 * @param planFile    - Absolute path to the plan file.
 * @param spawnResult - Result of the failed pi session.
 * @param ctx         - Extension context.
 * @returns Analysis text.
 */
async function analyzeFailure(
  planFile: string,
  spawnResult: { stdout: string; stderr: string; exitCode: number },
  ctx: ExtensionContext,
): Promise<string> {
  const analysisPrompt = [
    `You are analyzing why a plan implementation failed.`,
    ``,
    `Plan file: ${planFile}`,
    `Pi session exit code: ${spawnResult.exitCode}`,
    ``,
    `Pi session stderr:`,
    spawnResult.stderr || "(empty)",
    ``,
    `Pi session stdout (last 2000 chars):`,
    spawnResult.stdout.slice(-2000) || "(empty)",
    ``,
    `Current git status:`,
    `Run \`git status --short\` and \`git log -3 --oneline\` to inspect the state.`,
    ``,
    `Read the plan file and diagnose the root cause of the failure.`,
    `Suggest a fix in 2-3 sentences.`,
  ].join("\n");

  const result = await spawnPiSession(analysisPrompt, ctx.cwd);
  return result.stdout || result.stderr || "Unable to analyze failure.";
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

  lines.push(`Total: ${summary.total} | Implemented: ${summary.implemented} | Failed: ${summary.failed}`);

  if (summary.failed > 0) {
    lines.push("");
    lines.push("Orchestration stopped due to failure. Fix the issue and re-run.");
  }

  return lines.join("\n");
}
