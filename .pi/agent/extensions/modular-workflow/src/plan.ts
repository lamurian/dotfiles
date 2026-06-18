import { mkdir, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, basename } from "node:path";
import { existsSync } from "node:fs";
import { loadContent, renderTemplate, formatDate, shortSlug } from "./utils.ts";
import { loadDirectoriesConfig, ARCHIVE_SUBDIR } from "./paths.ts";

/**
 * Get absolute path to the plans directory.
 *
 * @param cwd - Project working directory.
 */
async function plansDirPath(cwd: string): Promise<string> {
  const config = await loadDirectoriesConfig(cwd);
  return join(cwd, config.plans.path);
}

/**
 * Get absolute path to the archive directory inside plans.
 *
 * @param cwd - Project working directory.
 */
async function archiveDirPath(cwd: string): Promise<string> {
  const config = await loadDirectoriesConfig(cwd);
  return join(cwd, config.plans.path, ARCHIVE_SUBDIR);
}

/**
 * Ensure the plans directory and archive exist.
 *
 * @param cwd - Project working directory.
 */
export async function ensurePlansDir(cwd: string): Promise<void> {
  await mkdir(await plansDirPath(cwd), { recursive: true });
  await mkdir(await archiveDirPath(cwd), { recursive: true });
}

/**
 * Compute the next plan number by scanning existing files.
 *
 * Scans existing plan files and returns the next sequential number
 * (3-digit padded).
 *
 * @param _specNumber - Kept for backward compatibility (ignored).
 * @param cwd         - Project working directory.
 * @returns The next plan number (e.g. 1, 2, 3...).
 */
export async function nextPlanNumber(
  _specNumber: string,
  cwd: string,
): Promise<number> {
  const dir = await plansDirPath(cwd);
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
 * Create a plan file for a spec.
 *
 * Renders the unified plan template with frontmatter and content body.
 * Uses uniform naming: xxx-short-slug.md where xxx is a 3-digit
 * sequential number and slug is ≤20 characters.
 *
 * @param specNumber  - Spec number in 3-digit format (e.g. "001" for spec 001).
 * @param title       - Plan title (<5 words).
 * @param content     - Plan markdown body (Overview, Goals, Steps, Risks, UAT, References).
 * @param cwd         - Project working directory.
 * @param description - One-sentence summary (defaults to title).
 * @returns Absolute path to the created plan file.
 */
export async function createPlan(
  specNumber: string,
  title: string,
  content: string,
  cwd: string,
  description?: string,
): Promise<string> {
  await ensurePlansDir(cwd);

  const planNum = await nextPlanNumber(specNumber, cwd);
  const slug = shortSlug(title, 60);
  const filename = `${String(planNum).padStart(3, "0")}-${slug}.md`;
  const filePath = join(await plansDirPath(cwd), filename);

  // Normalize specNumber to 3-digit format for cross-reference safety
  const normalizedSpecNum = String(parseInt(specNumber, 10)).padStart(3, "0");

  // Auto-append @ cross-reference to the spec if not present
  const hasRef = /@docs\/specs\//i.test(content);
  const body = hasRef
    ? content
    : `${content}\n\nThis plan implements @docs/specs/${normalizedSpecNum}-*.md`;

  const template = await loadContent("plan-template.md");
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
 * List all active (non-archived) plan files.
 *
 * @param _specNumber - Kept for backward compatibility (ignored).
 * @param cwd         - Project working directory.
 * @returns Array of absolute file paths, sorted.
 */
export async function listPlans(
  _specNumber: string,
  cwd: string,
): Promise<string[]> {
  const dir = await plansDirPath(cwd);
  if (!existsSync(dir)) return [];

  const files = await readdir(dir);
  return files
    .filter((f) => /^\d{3}-.+\.md$/.test(f))
    .sort((a, b) => a.localeCompare(b))
    .map((f) => join(dir, f));
}

/**
 * Move a plan file to the archive directory.
 *
 * @param planPath - Absolute path to the plan file.
 * @param cwd      - Project working directory.
 * @returns The new path in the archive.
 */
export async function archivePlan(
  planPath: string,
  cwd: string,
): Promise<string> {
  await ensurePlansDir(cwd);
  const archivePath = join(await archiveDirPath(cwd), basename(planPath));

  const content = await readFile(planPath, "utf-8");
  await writeFile(archivePath, content, "utf-8");
  await rm(planPath);

  return archivePath;
}

/**
 * Mark a task as completed in a plan file.
 *
 * Replaces `- [ ] task` with `- [x] task` by task index.
 * Matches task items under any heading in the plan.
 *
 * @param planPath  - Absolute path to the plan file.
 * @param taskIndex - Zero-based index of the task.
 */
export async function completeTask(
  planPath: string,
  taskIndex: number,
): Promise<void> {
  const content = await readFile(planPath, "utf-8");
  const lines = content.split("\n");
  let found = 0;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(\s*-\s+\[) (\]\s+)/);
    if (match) {
      if (found === taskIndex) {
        lines[i] = `${match[1]}x${match[2]}`;
        break;
      }
      found++;
    }
  }

  await writeFile(planPath, lines.join("\n"), "utf-8");
}
