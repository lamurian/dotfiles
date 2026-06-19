import { readdir, mkdir, rename } from "node:fs/promises";
import { join, basename } from "node:path";

/**
 * List all markdown plan files in a directory, sorted by filename.
 *
 * Returns only `.md` files, excluding the `.archive` subdirectory.
 *
 * @param dirPath - Absolute path to the plans directory.
 * @returns Sorted array of absolute file paths.
 */
export async function listPlanFiles(dirPath: string): Promise<string[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  return entries
    .filter(
      (e) =>
        e.isFile() &&
        e.name.endsWith(".md") &&
        basename(e.name) !== ".archive",
    )
    .map((e) => join(dirPath, e.name))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Get the archive directory path inside a plans directory.
 *
 * @param plansDir - Absolute path to the plans directory.
 * @returns Absolute path to the archive subdirectory.
 */
export function archiveDirPath(plansDir: string): string {
  return join(plansDir, ".archive");
}

/**
 * Ensure the archive directory exists.
 *
 * @param plansDir - Absolute path to the plans directory.
 * @returns Absolute path to the archive directory.
 */
export async function ensureArchiveDir(plansDir: string): Promise<string> {
  const archive = archiveDirPath(plansDir);
  await mkdir(archive, { recursive: true });
  return archive;
}

/**
 * Move a plan file to the archive directory.
 *
 * Creates the archive directory if it doesn't exist.
 * Uses filesystem rename (not git-aware).
 *
 * @param filePath - Absolute path to the plan file.
 * @param plansDir - Absolute path to the plans directory.
 * @returns Absolute path to the archived file.
 */
export async function moveToArchive(
  filePath: string,
  plansDir: string,
): Promise<string> {
  const archive = await ensureArchiveDir(plansDir);
  const dest = join(archive, basename(filePath));
  await rename(filePath, dest);
  return dest;
}


