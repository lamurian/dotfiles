/**
 * Session management for pi subprocess spawning.
 *
 * Spawns pi in JSON mode with the plan context embedded in the prompt,
 * forwards progress via callback or stdout.
 */

import { spawn } from "node:child_process";
import { resolve, basename } from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createTimeoutSignal } from "./session-types.ts";
import type { SpawnResult, SpawnOptions } from "./session-types.ts";
import { DEFAULT_TIMEOUT_MS } from "./session-types.ts";

// Re-export types and utilities for consumers
export type { SpawnResult, SpawnOptions };
export { DEFAULT_TIMEOUT_MS, createTimeoutSignal };

/** Cached absolute path of the package content directory. */
let _contentDir: string | undefined;

/**
 * Get the absolute path to the content directory.
 */
function getContentDir(): string {
  if (!_contentDir) {
    _contentDir = resolve(
      fileURLToPath(new URL("..", import.meta.url)),
      "content",
    );
  }
  return _contentDir;
}

/**
 * Load the plan prompt template from the content directory.
 *
 * @returns The prompt template string.
 */
export async function loadPlanPrompt(): Promise<string> {
  const promptPath = resolve(getContentDir(), "plan-prompt.md");
  return readFile(promptPath, "utf-8");
}

/**
 * Render the plan prompt template with plan content embedded inline.
 *
 * Unlike the old renderPlanPrompt which took a file path, this function
 * takes the actual plan content string and embeds it directly in the
 * prompt. The subprocess no longer needs to call implement_plan to
 * get context — everything is provided upfront.
 *
 * @param planContent - The full content of the plan file.
 * @returns The rendered prompt string with plan content substituted.
 */
export async function renderPlanPrompt(planContent: string): Promise<string> {
  const template = await loadPlanPrompt();
  return template.replaceAll("{{planContent}}", planContent);
}

/**
 * Truncate a string to a maximum length, appending "..." if truncated.
 *
 * @param text   - The text to truncate.
 * @param maxLen - Maximum length before truncation (default 120).
 * @returns The truncated text with "..." suffix if needed.
 */
export function truncateForLog(text: string, maxLen: number = 120): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}

/**
 * Replace newlines and carriage returns in a string for single-line log display.
 * Newlines are replaced with "↵ " (a unicode arrow followed by space).
 * Carriage returns are removed entirely.
 *
 * @param text - The text to sanitize.
 * @returns Sanitized text with newlines replaced.
 */
export function sanitizeLogLine(text: string): string {
  return text.replace(/\n/g, "↵ ").replace(/\r/g, "");
}

/**
 * Callbacks for JSON event handling.
 */
interface JsonEventCallbacks {
  /** Called when an assistant message text block is received. */
  onAssistantMessage?: (text: string) => void;
  /** Called for streaming text deltas during message generation. */
  onAssistantMessageDelta?: (delta: string) => void;
  /** Called when a tool execution starts. */
  onToolCall?: (toolName: string, args: Record<string, unknown>) => void;
  /** Called when a tool execution ends with its result. */
  onToolResult?: (toolName: string, summary: string, isError: boolean) => void;
}

/**
 * Result of processing a single JSON event line.
 */
interface JsonEventResult {
  /** Whether agent_end was received. */
  completed: boolean;
  /** Assistant message text blocks accumulated so far. */
  assistantMessages: string[];
}

/**
 * Parse a single JSON event line from a pi JSON-mode session.
 *
 * Extracts assistant messages and tool call information, invoking
 * callbacks for each. Tracks whether agent_end was received.
 *
 * @param line      - A single JSON event line.
 * @param callbacks - Callbacks for detected events.
 * @returns Result with completion state and accumulated assistant messages.
 */
export function handleJsonEvent(
  line: string,
  callbacks: JsonEventCallbacks,
): JsonEventResult {
  const result: JsonEventResult = {
    completed: false,
    assistantMessages: [],
  };

  if (!line.trim()) return result;

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return result;
  }

  if (event.type === "agent_end") {
    result.completed = true;
  }

  if (
    event.type === "message_end" &&
    typeof event.message === "object" &&
    event.message !== null &&
    (event.message as Record<string, unknown>).role === "assistant"
  ) {
    const content = (event.message as Record<string, unknown>).content;
    if (Array.isArray(content)) {
      const texts: string[] = [];
      for (const item of content) {
        if (
          typeof item === "object" &&
          item !== null &&
          (item as Record<string, unknown>).type === "text"
        ) {
          const text = (item as Record<string, unknown>).text;
          if (typeof text === "string") {
            texts.push(text);
          }
        }
      }
      if (texts.length > 0) {
        const joined = texts.join("\n").trim();
        result.assistantMessages.push(joined);
        callbacks.onAssistantMessage?.(joined);
      }
    }
  }

  if (
    event.type === "message_update" &&
    typeof event.assistantMessageEvent === "object" &&
    event.assistantMessageEvent !== null &&
    (event.assistantMessageEvent as Record<string, unknown>).type === "text_delta"
  ) {
    const delta = (event.assistantMessageEvent as Record<string, unknown>).delta;
    if (typeof delta === "string") {
      callbacks.onAssistantMessageDelta?.(delta);
    }
  }

  if (event.type === "tool_execution_start") {
    const toolName = typeof event.toolName === "string" ? event.toolName : "unknown";
    const args = (event.args as Record<string, unknown>) ?? {};
    callbacks.onToolCall?.(toolName, args);
  }

  if (event.type === "tool_execution_end") {
    const toolName = typeof event.toolName === "string" ? event.toolName : "unknown";
    const isError = event.isError === true;
    let summary = "";
    if (
      typeof event.result === "object" &&
      event.result !== null
    ) {
      const res = event.result as Record<string, unknown>;
      // For read tools, the result content is the file contents — never useful as a log summary
      if (toolName !== "read") {
        if (typeof res.content === "string") {
          summary = res.content.slice(0, 80);
        } else if (
          Array.isArray(res.content) &&
          typeof res.content[0] === "object" &&
          res.content[0] !== null &&
          (res.content[0] as Record<string, unknown>).type === "text"
        ) {
          const text = (res.content[0] as Record<string, unknown>).text;
          summary = typeof text === "string" ? text.slice(0, 80) : "";
        } else if (typeof res.stderr === "string") {
          summary = res.stderr.slice(0, 80);
        }
      }
    }
    callbacks.onToolResult?.(toolName, summary, isError);
  }

  return result;
}

/**
 * Build a set of JSON event callbacks that forward log output through `onLog`.
 *
 * The returned callbacks format messages, deltas, tool calls, and tool results
 * into human-readable log lines and push them through `onLog`. Assistant message
 * text is also collected in the provided arrays for later inspection.
 *
 * @param textParts         - Array collecting full assistant message text.
 * @param assistantMessages - Array collecting each assistant message turn.
 * @param onLog             - Callback for each formatted log line.
 * @returns A JsonEventCallbacks object wired to `onLog`.
 */
export function makeLogCallbacks(
  textParts: string[],
  assistantMessages: string[],
  onLog?: (line: string) => void,
): JsonEventCallbacks {
  const log = (line: string) => {
    if (onLog) {
      onLog(line);
    } else {
      process.stdout.write(line + "\n");
    }
  };

  /**
   * Extract a short argument for display from tool args.
   * For path-based tools (read, write, edit), returns the basename.
   * For bash/explore/grep, returns the first key arg truncated to 80 chars.
   * For others, returns the first string arg value.
   */
  function getShortArg(toolName: string, args: Record<string, unknown>): string {
    // Path-based tools: show basename
    if ((toolName === "read" || toolName === "write" || toolName === "edit") && typeof args.path === "string") {
      return basename(args.path);
    }
    // Other tools: first meaningful string arg
    for (const key of ["command", "instruction", "pattern"]) {
      if (typeof args[key] === "string") {
        const val = args[key] as string;
        return val.length > 80 ? val.slice(0, 80) + "..." : val;
      }
    }
    // Fallback: first string arg
    const firstStr = Object.values(args).find((v): v is string => typeof v === "string");
    if (firstStr) {
      return firstStr.length > 80 ? firstStr.slice(0, 80) + "..." : firstStr;
    }
    return "";
  }

  return {
    onAssistantMessage: (text) => {
      // Collect for spawn result but do NOT log to widget — assistant text is noise
      assistantMessages.push(text);
      textParts.push(text);
    },
    onToolCall: (toolName, args) => {
      const arg = getShortArg(toolName, args);
      const logLine = arg ? `  ${toolName}  ${arg}` : `  ${toolName}`;
      log(sanitizeLogLine(logLine));
    },
    onToolResult: (toolName, summary, isError) => {
      if (isError) {
        const line = summary ? `  ✗ ${toolName}  ${summary}` : `  ✗ ${toolName}`;
        log(sanitizeLogLine(line));
      } else if (summary) {
        log(sanitizeLogLine(`  ✓ ${toolName}  ${summary}`));
      }
      // If success and empty summary (e.g. read tool), skip result line
    },
  };
}

/**
 * Spawn a pi subprocess in JSON mode with the given prompt.
 *
 * Parses JSON events from stdout to detect completion (agent_end) and
 * collect assistant message text. On timeout, the subprocess is killed
 * with SIGKILL.
 *
 * Log output (tool calls and assistant messages) is forwarded via
 * options.onLog callback, falling back to process.stdout.write if
 * no callback is provided.
 *
 * @param prompt  - The prompt text to send to pi (passed as positional arg).
 * @param cwd     - Working directory for the pi process.
 * @param options - Optional spawn options (signal, timeoutMs, onLog).
 * @returns SpawnResult with exit code, completion status, and messages.
 */
export function spawnPiSession(
  prompt: string,
  cwd: string,
  options?: SpawnOptions,
): Promise<SpawnResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolvePromise) => {
    // Build combined timeout + parent signal
    let timeoutClear: (() => void) | null = null;
    let killSignal: AbortSignal | undefined = options?.signal;
    if (timeoutMs > 0) {
      const combined = createTimeoutSignal(timeoutMs, options?.signal);
      killSignal = combined.signal;
      timeoutClear = combined.clear;
    }

    let timedOut = false;
    let proc;
    try {
      // NOTE: Do NOT pass signal to spawn() — Node.js throws an AbortError
      // on the child process before the close event fires, losing signal metadata.
      // Instead, kill manually via the killHandler below.
      proc = spawn("pi", ["--mode", "json", "-p", prompt], {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      timeoutClear?.();
      resolvePromise({
        exitCode: -1,
        stdout: "",
        stderr: "Failed to spawn pi process. Is pi installed and in PATH?",
        killed: false,
        timedOut: false,
        completed: false,
        assistantMessages: [],
      });
      return;
    }

    let stderr = "";
    let buffer = "";
    let completed = false;
    const assistantMessages: string[] = [];
    const textParts: string[] = [];

    // ── Parse JSON events from stdout ──────────────────────────

    const eventCallbacks = makeLogCallbacks(textParts, assistantMessages, options?.onLog);

    const processLine = (line: string) => {
      const result = handleJsonEvent(line, eventCallbacks);

      if (result.completed) {
        completed = true;
      }
    };

    proc.stdout!.on("data", (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) processLine(line);
    });

    proc.stderr!.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    const finalize = (overrides: Partial<SpawnResult> = {}): SpawnResult => {
      if (buffer.trim()) processLine(buffer);
      return {
        exitCode: -1,
        stdout: textParts.join("\n\n"),
        stderr: stderr.trim(),
        killed: false,
        timedOut: false,
        completed,
        assistantMessages,
        ...overrides,
      };
    };

    proc.on("close", (code, signalCode) => {
      timeoutClear?.();
      const wasKilled = signalCode !== null;
      resolvePromise(finalize({
        exitCode: code ?? -1,
        killed: wasKilled || timedOut,
        timedOut,
      }));
    });

    proc.on("error", (err) => {
      timeoutClear?.();
      resolvePromise(finalize({
        exitCode: -1,
        stderr: `Failed to spawn pi process: ${err.message}`,
      }));
    });

    // Kill handler for timeout signal
    if (killSignal) {
      const killHandler = () => {
        timedOut = true;
        if (proc && !proc.killed) {
          proc.kill("SIGKILL");
        }
      };
      if (killSignal.aborted) {
        killHandler();
      } else {
        killSignal.addEventListener("abort", killHandler, { once: true });
      }
    }
  });
}
