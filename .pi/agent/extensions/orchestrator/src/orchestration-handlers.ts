/**
 * Handler functions for the orchestration engine.
 *
 * These are called by runOrchestration for each plan outcome.
 */

import type { SpawnResult } from "./session-types.ts";
import { spawnPiSession } from "./session.ts";
import { moveToArchive } from "./plan.ts";
import {
  getHeadHashFull,
  getLastCommitMessage,
  isWorkingTreeClean,
  stageFile,
  amendLastCommit,
} from "./git.ts";
import { basename } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

// ─── Shared types ─────────────────────────────────────────────────

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

/** Minimal extension context interface for handler functions. */
export interface Ctx {
  cwd: string;
  ui: {
    notify: (msg: string, type: string) => void;
    setStatus: (key: string, value: string | undefined) => void;
  };
  /**
   * Callback for detailed log output lines (tool calls, assistant messages).
   * When set, log lines are forwarded here instead of process.stdout.
   */
  logLine?: (line: string) => void;
}

/**
 * Handle clean completion (agent_end received).
 */
export async function handleSessionOutcome(
  filePath: string,
  plansDir: string,
  fileName: string,
  headBefore: string,
  spawnResult: SpawnResult,
  ctx: Ctx,
): Promise<PlanResult> {
  const headAfter = getHeadHashFull(ctx.cwd);
  const treeClean = isWorkingTreeClean(ctx.cwd);
  const lastCommit = getLastCommitMessage(ctx.cwd);
  const headChanged = headAfter !== "" && headBefore !== headAfter;

  if (spawnResult.exitCode !== 0) {
    const analysis = await analyzeFailure(filePath, spawnResult, ctx);
    ctx.ui.notify(
      `✗ ${fileName}: Failed (exit code ${spawnResult.exitCode})`,
      "error",
    );
    return {
      file: fileName,
      success: false,
      error: `Pi session exited with code ${spawnResult.exitCode}`,
      analysis,
    };
  }

  if (!headChanged && !treeClean) {
    const analysis = await analyzeFailure(filePath, spawnResult, ctx);
    ctx.ui.notify(`✗ ${fileName}: Changes not committed`, "error");
    return {
      file: fileName,
      success: false,
      error: "Implementation was not committed; changes left uncommitted.",
      analysis,
    };
  }

  if (headChanged) {
    return await archiveAndAmend(filePath, plansDir, fileName, lastCommit, ctx);
  }

  if (treeClean) {
    const archived = await moveToArchive(filePath, plansDir);
    await trackProgress(archived);

    const staged = stageFile(archived, ctx.cwd);
    if (staged) {
      amendLastCommit(ctx.cwd);
    }

    ctx.ui.notify(`  Archived (no changes): ${basename(archived)}`, "info");
    return { file: fileName, success: true };
  }

  return { file: fileName, success: false, error: "Unexpected state." };
}

/**
 * Handle timeout where work was committed (HEAD changed).
 */
export async function handleTimeoutWithCommit(
  filePath: string,
  plansDir: string,
  fileName: string,
  _headAfter: string,
  ctx: Ctx,
): Promise<PlanResult> {
  const lastCommit = getLastCommitMessage(ctx.cwd);

  ctx.ui.notify(
    `⏱ ${fileName} timed out after committing partial work. Archiving...`,
    "warning",
  );

  return await archiveAndAmend(filePath, plansDir, fileName, lastCommit, ctx);
}

/**
 * Handle timeout where no commit was made and retries exhausted.
 */
export async function handleTimeoutExhausted(
  filePath: string,
  plansDir: string,
  fileName: string,
  ctx: Ctx,
): Promise<PlanResult> {
  ctx.ui.notify(
    `⏱ ${fileName} timed out after ${3} attempts. Archiving...`,
    "warning",
  );

  const archived = await moveToArchive(filePath, plansDir);
  await trackProgress(archived);

  return {
    file: fileName,
    success: false,
    error: `Timed out after ${3} attempts. No changes were committed.`,
  };
}

/**
 * Handle spawn error (non-zero exit, failed to spawn pi).
 */
export async function handleSpawnError(
  filePath: string,
  fileName: string,
  spawnResult: SpawnResult,
  ctx: Ctx,
): Promise<PlanResult> {
  const analysis = await analyzeFailure(filePath, spawnResult, ctx);

  ctx.ui.notify(
    `✗ ${fileName}: Failed (exit code ${spawnResult.exitCode})`,
    "error",
  );

  return {
    file: fileName,
    success: false,
    error: `Pi session exited with code ${spawnResult.exitCode}`,
    analysis,
  };
}

/**
 * Archive the plan file, stage, amend, and track progress.
 */
export async function archiveAndAmend(
  filePath: string,
  plansDir: string,
  fileName: string,
  lastCommit: string,
  ctx: Ctx,
): Promise<PlanResult> {
  const archived = await moveToArchive(filePath, plansDir);
  ctx.ui.notify(`  Archived: ${basename(archived)}`, "info");

  await trackProgress(archived);

  const staged = stageFile(archived, ctx.cwd);
  if (!staged) {
    ctx.ui.notify(`  Warning: Failed to stage archived file`, "warning");
  }

  const amendResult = amendLastCommit(ctx.cwd);
  if (amendResult.success) {
    ctx.ui.notify(`  Amended commit: ${lastCommit}`, "info");
  } else {
    ctx.ui.notify(
      `  Warning: Amend failed: ${amendResult.error ?? "unknown"}`,
      "warning",
    );
  }

  return { file: fileName, success: true };
}

/**
 * Track implementation progress if modular-workflow is available.
 */
async function trackProgress(archivedPath: string): Promise<void> {
  try {
    const { onPlanImplemented } = await import(
      "../../modular-workflow/src/plan.ts"
    );
    await onPlanImplemented(archivedPath, process.cwd());
  } catch {
    // Modular-workflow not available; skip tracking
  }
}

/**
 * Analyze why a plan implementation failed.
 *
 * Spawns a pi subprocess to analyze the failure.
 */
export async function analyzeFailure(
  planFile: string,
  spawnResult: { stdout: string; stderr: string; exitCode: number },
  ctx: Ctx,
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
 * Build a summary from per-plan results.
 */
export function buildSummary(
  results: PlanResult[],
): { results: PlanResult[]; total: number; implemented: number; failed: number } {
  const implemented = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  return { results, total: results.length, implemented, failed };
}
