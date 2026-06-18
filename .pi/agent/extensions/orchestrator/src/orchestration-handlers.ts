/**
 * Handler functions and types for the orchestration engine.
 *
 * Types and helpers only. All handler logic moved to orchestrator.ts.
 */

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

/** Minimal extension context interface. */
export interface Ctx {
  cwd: string;
  ui: {
    notify: (msg: string, type: string) => void;
    setStatus: (key: string, value: string | undefined) => void;
  };
  /**
   * Callback for detailed log output lines (tool calls, assistant messages).
   */
  logLine?: (line: string) => void;
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
