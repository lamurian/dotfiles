import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { loadContent, renderTemplate, formatDate, shortSlug } from "./utils.ts";
import { findExistingAdrDirs, detectAdrDir } from "./adr-detect.ts";

/** Architecture Decision Record matching the unified template. */
export interface Adr {
  /** Short descriptive title (<5 words). */
  title: string;
  /** One sentence summarizing the decision. */
  description: string;
  /** Decision status. */
  status: "proposed" | "accepted" | "deprecated" | "superseded";
  /** Date in YYYY-MM-DD format (defaults to today). */
  date?: string;
  /** Problem statement or user story. */
  context: string;
  /** Chosen approach and rationale. */
  decision: string;
  /** Trade-offs, costs, benefits. */
  impact: string;
}

// ── Overlap detection ──────────────────────────────────────

/**
 * Check whether an ADR with a similar title already exists.
 *
 * Compares the proposed title against all existing ADR frontmatter titles
 * using a case-insensitive substring match.
 *
 * @param title  - Proposed ADR title.
 * @param adrDir - Absolute path to the ADR directory.
 * @returns The filename of a similar ADR, or `null` if no overlap.
 */
async function findOverlappingAdr(
  title: string,
  adrDir: string,
): Promise<string | null> {
  if (!existsSync(adrDir)) return null;

  const lowerTitle = title.toLowerCase();
  const files = await readdir(adrDir);
  const mdFiles = files.filter((f) => f.endsWith(".md")).sort();

  for (const file of mdFiles) {
    try {
      const content = await readFile(join(adrDir, file), "utf-8");
      const frontmatterTitle = content.match(/^title:\s*(.+)/m)?.[1];
      if (frontmatterTitle) {
        const lowerExisting = frontmatterTitle.toLowerCase();
        if (
          lowerExisting.includes(lowerTitle) ||
          lowerTitle.includes(lowerExisting)
        ) {
          return file;
        }
      }
    } catch {
      // Ignore unreadable files
    }
  }
  return null;
}

// ── Numbering ──────────────────────────────────────────────

/**
 * Compute the next ADR number by scanning existing files across
 * all detected directories.
 *
 * @param cwd - Project working directory.
 * @returns The next sequential number.
 */
async function nextAdrNumber(cwd: string): Promise<number> {
  const adrDirs = await findExistingAdrDirs(cwd);
  let max = 0;

  for (const adrDir of adrDirs) {
    try {
      const files = await readdir(adrDir);
      for (const f of files) {
        const match = f.match(/^(\d{3})-/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > max) max = num;
        }
      }
    } catch {
      // Ignore
    }
  }

  return max + 1;
}

// ── CRUD operations ─────────────────────────────────────────

/**
 * Create a new ADR file in the project.
 *
 * Detects the active ADR directory (or creates `docs/ADR` as default),
 * reads existing ADRs to check for title overlap, and renders from
 * the unified ADR template.
 *
 * @param adr - The ADR data.
 * @param cwd - Project working directory.
 * @returns The absolute path to the created file.
 */
export async function createAdr(adr: Adr, cwd: string): Promise<string> {
  const adrDir = await detectAdrDir(cwd);
  await mkdir(adrDir, { recursive: true });

  const overlap = await findOverlappingAdr(adr.title, adrDir);
  if (overlap) {
    throw new Error(
      `Overlapping ADR detected: "${overlap}" already covers a similar topic. ` +
        "Review and either update the existing record or choose a different title.",
    );
  }

  const number = await nextAdrNumber(cwd);
  const slug = shortSlug(adr.title, 60);
  const filename = `${String(number).padStart(3, "0")}-${slug}.md`;
  const filePath = join(adrDir, filename);

  const template = await loadContent("adr-template.md");
  const content = renderTemplate(template, {
    title: adr.title,
    description: adr.description,
    status: adr.status,
    date: adr.date ?? formatDate(),
    context: adr.context || "TBD",
    decision: adr.decision || "TBD",
    impact: adr.impact || "TBD",
  });

  await writeFile(filePath, content, "utf-8");
  return filePath;
}

/**
 * Read the most recent ADR from the detected ADR directory.
 *
 * @param cwd - Project working directory.
 * @returns Parsed ADR or null if none exists.
 */
export async function readLatestAdr(cwd: string): Promise<Adr | null> {
  const adrDirs = await findExistingAdrDirs(cwd);
  if (adrDirs.length === 0) return null;

  const allFiles: { path: string; name: string }[] = [];
  for (const dir of adrDirs) {
    try {
      const files = await readdir(dir);
      for (const f of files.filter((f) => f.endsWith(".md"))) {
        allFiles.push({ path: join(dir, f), name: f });
      }
    } catch {
      // Ignore
    }
  }

  if (allFiles.length === 0) return null;

  allFiles.sort((a, b) => a.name.localeCompare(b.name));
  const latest = allFiles[allFiles.length - 1];
  const content = await readFile(latest.path, "utf-8");
  return parseAdr(content, latest.name);
}

/**
 * List all ADR file paths across all detected directories.
 *
 * @param cwd - Project working directory.
 * @returns Sorted array of absolute ADR file paths.
 */
export async function listAdrs(cwd: string): Promise<string[]> {
  const adrDirs = await findExistingAdrDirs(cwd);
  if (adrDirs.length === 0) return [];

  const allFiles: string[] = [];
  for (const dir of adrDirs) {
    try {
      const files = await readdir(dir);
      for (const f of files.filter((f) => f.endsWith(".md")).sort()) {
        allFiles.push(join(dir, f));
      }
    } catch {
      // Ignore
    }
  }

  return allFiles.sort();
}

/**
 * Update an existing ADR file's status in frontmatter.
 *
 * Replaces the `status:` line in the ADR frontmatter.
 *
 * @param filePath - Absolute path to the ADR file.
 * @param status   - New status value.
 */
export async function updateAdrStatus(
  filePath: string,
  status: Adr["status"],
): Promise<void> {
  const content = await readFile(filePath, "utf-8");
  const updated = content.replace(/^status:\s*.+/m, `status: ${status}`);
  await writeFile(filePath, updated, "utf-8");
}

// ── Parsing ────────────────────────────────────────────────

/**
 * Minimal ADR parser — extracts key fields from frontmatter + markdown.
 *
 * @param content  - Raw markdown content.
 * @param filename - Filename for fallback title.
 * @returns Parsed Adr object.
 */
function parseAdr(content: string, filename: string): Adr {
  const frontmatter = (key: string): string => {
    const regex = new RegExp(`^${key}:\\s*(.+)`, "m");
    const match = content.match(regex);
    return match ? match[1].trim() : "";
  };

  const section = (heading: string): string => {
    const regex = new RegExp(`^# ${heading}\\n+([^#]+)`, "m");
    const match = content.match(regex);
    return match ? match[1].trim() : "";
  };

  return {
    title: frontmatter("title") || filename.replace(/\.md$/, ""),
    description: frontmatter("description") || "",
    status: (frontmatter("status").toLowerCase() as Adr["status"]) || "proposed",
    date: frontmatter("date"),
    context: section("Context"),
    decision: section("Decision"),
    impact: section("Impact"),
  };
}
