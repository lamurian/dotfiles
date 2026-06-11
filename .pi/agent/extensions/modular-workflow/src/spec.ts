import { mkdir, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, basename } from "node:path";
import { existsSync } from "node:fs";
import { loadContent, renderTemplate, formatDate, shortSlug } from "./utils.ts";
import { loadDirectoriesConfig, ARCHIVE_SUBDIR } from "./paths.ts";

/**
 * Get the absolute path to the specs directory.
 *
 * @param cwd - Project working directory.
 */
async function specsDirPath(cwd: string): Promise<string> {
  const config = await loadDirectoriesConfig(cwd);
  return join(cwd, config.specs.path);
}

/**
 * Get the absolute path to the archive directory inside specs.
 *
 * @param cwd - Project working directory.
 */
async function archiveDirPath(cwd: string): Promise<string> {
  const config = await loadDirectoriesConfig(cwd);
  return join(cwd, config.specs.path, ARCHIVE_SUBDIR);
}

/**
 * Ensure the specs directory and archive exist.
 *
 * @param cwd - Project working directory.
 */
export async function ensureSpecsDir(cwd: string): Promise<void> {
  await mkdir(await specsDirPath(cwd), { recursive: true });
  await mkdir(await archiveDirPath(cwd), { recursive: true });
}

/**
 * Compute the next spec number by scanning existing files.
 *
 * Scans existing spec files and returns the next sequential number
 * (3-digit padded).
 *
 * @param _adrNumber - Kept for backward compatibility (ignored).
 * @param cwd        - Project working directory.
 * @returns The next spec number (e.g. 1, 2, 3...).
 */
export async function nextSpecNumber(
  _adrNumber: number,
  cwd: string,
): Promise<number> {
  const dir = await specsDirPath(cwd);
  if (!existsSync(dir)) return 1;

  const files = await readdir(dir);
  let max = 0;

  for (const f of files) {
    const match = f.match(/^(\d{3})-/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > max) max = num;
    }
  }

  return max + 1;
}

/**
 * Create a spec file for an ADR.
 *
 * Renders the unified spec template with frontmatter and content body.
 * Uses uniform naming: xxx-short-slug.md where xxx is a 3-digit
 * sequential number and slug is ≤20 characters.
 *
 * @param adrNumber  - ADR number.
 * @param title      - Spec title (<5 words).
 * @param content    - Spec markdown body (Requirements, Design, References).
 * @param cwd        - Project working directory.
 * @param description - One-sentence summary (defaults to title).
 * @returns Absolute path to the created spec file.
 */
export async function createSpec(
  adrNumber: number,
  title: string,
  content: string,
  cwd: string,
  description?: string,
): Promise<string> {
  await ensureSpecsDir(cwd);

  const specNum = await nextSpecNumber(adrNumber, cwd);
  const slug = shortSlug(title, 20);
  const filename = `${String(specNum).padStart(3, "0")}-${slug}.md`;
  const filePath = join(await specsDirPath(cwd), filename);

  // Auto-append @ cross-reference to the ADR if not present
  const hasRef = /@docs\/ADR\//i.test(content);
  const body = hasRef
    ? content
    : `${content}\n\nThis spec implements @docs/ADR/${String(adrNumber).padStart(3, "0")}-*.md`;

  const template = await loadContent("spec-template.md");
  const fullContent = renderTemplate(template, {
    title,
    description: description ?? title,
    date: formatDate(),
    content: body,
  });

  await writeFile(filePath, fullContent, "utf-8");
  return filePath;
}

/**
 * List all active (non-archived) spec files.
 *
 * @param _adrNumber - Kept for backward compatibility (ignored).
 * @param cwd        - Project working directory.
 * @returns Array of absolute file paths, sorted.
 */
export async function listSpecs(
  _adrNumber: number,
  cwd: string,
): Promise<string[]> {
  const dir = await specsDirPath(cwd);
  if (!existsSync(dir)) return [];

  const files = await readdir(dir);
  return files
    .filter((f) => /^\d{3}-.+\.md$/.test(f))
    .sort((a, b) => a.localeCompare(b))
    .map((f) => join(dir, f));
}

/**
 * Move a spec file to the archive directory.
 *
 * @param specPath - Absolute path to the spec file.
 * @param cwd      - Project working directory.
 * @returns The new path in the archive.
 */
export async function archiveSpec(
  specPath: string,
  cwd: string,
): Promise<string> {
  await ensureSpecsDir(cwd);
  const archivePath = join(await archiveDirPath(cwd), basename(specPath));

  const content = await readFile(specPath, "utf-8");
  await writeFile(archivePath, content, "utf-8");
  await rm(specPath);

  return archivePath;
}
