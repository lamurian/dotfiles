import { execSync } from "node:child_process";

/**
 * Result of a git command execution.
 */
export interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Execute a git command synchronously using execSync.
 *
 * Used only by the orchestration engine (not in agent tool context).
 * Keeps git commands out of the pi bash tool to avoid commit-extension
 * interception of `git commit`.
 *
 * @param args - Git arguments.
 * @param cwd  - Working directory for the git command.
 * @returns Combined stdout and stderr.
 * @throws If the git command fails unexpectedly.
 */
function git(args: string[], cwd: string): GitResult {
  try {
    const stdout = execSync("git " + args.join(" "), {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return { stdout, stderr: "", code: 0 };
  } catch (err: unknown) {
    const execErr = err as {
      status?: number;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    return {
      stdout: (execErr.stdout ?? "").toString().trim(),
      stderr: (execErr.stderr ?? execErr.message ?? "").toString().trim(),
      code: execErr.status ?? 1,
    };
  }
}

/**
 * Get the current HEAD commit hash (short form).
 *
 * @param cwd - Working directory.
 * @returns Short hash string, or empty string if no commits.
 */
export function getHeadHash(cwd: string): string {
  const r = git(["rev-parse", "--short", "HEAD"], cwd);
  return r.code === 0 ? r.stdout : "";
}

/**
 * Get the full HEAD commit hash.
 *
 * @param cwd - Working directory.
 * @returns Full hash string, or empty string if no commits.
 */
export function getHeadHashFull(cwd: string): string {
  const r = git(["rev-parse", "HEAD"], cwd);
  return r.code === 0 ? r.stdout : "";
}

/**
 * Get the latest commit message (oneline format).
 *
 * @param cwd - Working directory.
 * @returns Oneline commit message, or empty string.
 */
export function getLastCommitMessage(cwd: string): string {
  const r = git(["log", "-1", "--oneline"], cwd);
  return r.code === 0 ? r.stdout : "";
}

/**
 * Check if the working tree is clean (no uncommitted changes).
 *
 * Returns true if there are no unstaged changes and no untracked files.
 *
 * @param cwd - Working directory.
 * @returns True if working tree is clean.
 */
export function isWorkingTreeClean(cwd: string): boolean {
  const r = git(["status", "--porcelain"], cwd);
  return r.code === 0 && r.stdout === "";
}

/**
 * Stage all changes (git add --all).
 *
 * @param cwd - Working directory.
 * @returns True if staging succeeded.
 */
export function stageAll(cwd: string): boolean {
  const r = git(["add", "--all"], cwd);
  return r.code === 0;
}

/**
 * Stage a specific file (git add <path>).
 *
 * @param filePath - Path to the file to stage.
 * @param cwd      - Working directory.
 * @returns True if staging succeeded.
 */
export function stageFile(filePath: string, cwd: string): boolean {
  const r = git(["add", filePath], cwd);
  return r.code === 0;
}

/**
 * Amend the last commit without changing its message (git commit --amend --no-edit).
 *
 * @param cwd - Working directory.
 * @returns Object with success flag and error message if failed.
 */
export function amendLastCommit(cwd: string): { success: boolean; error?: string } {
  const r = git(["commit", "--amend", "--no-edit"], cwd);
  if (r.code === 0) return { success: true };
  return { success: false, error: r.stderr || r.stdout };
}
