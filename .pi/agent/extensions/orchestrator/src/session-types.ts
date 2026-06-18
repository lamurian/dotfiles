/**
 * Types and utilities for pi subprocess session management.
 */

/**
 * Result of spawning a pi subprocess.
 */
export interface SpawnResult {
  /** Process exit code. */
  exitCode: number;
  /** stdout output (all text from assistant messages joined). */
  stdout: string;
  /** stderr output. */
  stderr: string;
  /** Whether the process was killed/signal-terminated. */
  killed: boolean;
  /** Whether the process was killed due to a timeout. */
  timedOut: boolean;
  /** Whether agent_end was received (clean completion). */
  completed: boolean;
  /** Text content of each assistant message turn. */
  assistantMessages: string[];
}

/** Options for spawnPiSession. */
export interface SpawnOptions {
  /** AbortSignal to cancel the process. */
  signal?: AbortSignal;
  /** Timeout in milliseconds. Default: 600000 (10 min). */
  timeoutMs?: number;
  /**
   * Callback for log output lines (tool calls, assistant messages).
   * If not provided, falls back to process.stdout.write for backward compatibility.
   */
  onLog?: (line: string) => void;
}

/** Default timeout for plan implementation (10 minutes). */
export const DEFAULT_TIMEOUT_MS = 600_000;

/**
 * Get the effective plan timeout in milliseconds.
 * Reads from ORCHESTRATOR_PLAN_TIMEOUT_MS env var if set, otherwise uses default.
 */
export function getPlanTimeoutMs(): number {
  const env = process.env.ORCHESTRATOR_PLAN_TIMEOUT_MS;
  if (env) {
    const parsed = Number(env);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_TIMEOUT_MS;
}

/**
 * Create an AbortSignal that fires after a timeout, optionally combined
 * with a parent signal. Returns a clear function to cancel the timeout.
 *
 * @param timeoutMs    - Milliseconds before the signal aborts.
 * @param parentSignal - Optional parent signal to combine.
 * @returns Object with `signal` and `clear()` function.
 */
export function createTimeoutSignal(
  timeoutMs: number,
  parentSignal?: AbortSignal,
): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();

  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`Operation timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  const clear = () => {
    clearTimeout(timeoutId);
  };

  if (parentSignal) {
    if (parentSignal.aborted) {
      clearTimeout(timeoutId);
      controller.abort(parentSignal.reason);
    } else {
      parentSignal.addEventListener(
        "abort",
        () => {
          clearTimeout(timeoutId);
          controller.abort(parentSignal.reason);
        },
        { once: true },
      );
    }
  }

  return { signal: controller.signal, clear };
}
