import { readFile } from "node:fs/promises";
import { resolve, isAbsolute } from "node:path";

/** Result of resolving cross-references in a document. */
export interface ResolvedRefs {
  /** The full content of the resolved document. */
  content: string;
  /** Resolved file paths in the order they were visited (document first). */
  chain: string[];
  /** Errors encountered during resolution. */
  errors: string[];
}

/**
 * Extract all @path/to/file references from text content.
 *
 * Matches `@` followed by a file path (relative or absolute).
 *
 * @param content - Text content to scan.
 * @returns Array of referenced file paths (with @ prefix stripped).
 */
export function extractRefs(content: string): string[] {
  const refs: string[] = [];
  const regex = /@(\S+(?:\.md|\.ts|\.js|\.json|\.yaml|\.yml))/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    refs.push(match[1]);
  }
  return refs;
}

/**
 * Resolve a file path relative to the project root.
 *
 * If the path is already absolute, it is returned as-is.
 *
 * @param ref  - The file path from an @ reference.
 * @param cwd  - Project working directory.
 * @returns The absolute file path.
 */
function resolveRef(ref: string, cwd: string): string {
  return isAbsolute(ref) ? ref : resolve(cwd, ref);
}

/**
 * Recursively resolve cross-references in a document.
 *
 * Reads the document at `filePath`, scans for @path references,
 * and recursively reads each referenced file. The result includes
 * the full content of all resolved files concatenated in order.
 *
 * Cycle detection prevents infinite loops — if a file has already
 * been visited, it is skipped.
 *
 * @param filePath - Absolute path to the entry document.
 * @param cwd      - Project working directory.
 * @param visited  - Set of already-visited paths (for cycle detection).
 * @returns Resolved content, chain, and any errors.
 */
export async function resolveCrossReferences(
  filePath: string,
  cwd: string,
  visited: Set<string> = new Set(),
): Promise<ResolvedRefs> {
  const absPath = isAbsolute(filePath)
    ? filePath
    : resolve(cwd, filePath);

  if (visited.has(absPath)) {
    return { content: "", chain: [], errors: [] };
  }
  visited.add(absPath);

  let content: string;
  try {
    content = await readFile(absPath, "utf-8");
  } catch (err) {
    return {
      content: "",
      chain: [],
      errors: [`Failed to read ${absPath}: ${(err as Error).message}`],
    };
  }

  const chain = [absPath];
  const errors: string[] = [];

  // Recursively resolve @ refs in the content
  const refs = extractRefs(content);
  for (const ref of refs) {
    const refAbs = resolveRef(ref, cwd);
    if (visited.has(refAbs)) continue;

    const resolved = await resolveCrossReferences(refAbs, cwd, visited);
    errors.push(...resolved.errors);

    // Append referenced content after the current content
    if (resolved.content) {
      content += `\n\n---\n### Referenced: ${ref}\n\n${resolved.content}`;
    }
    chain.push(...resolved.chain);
  }

  return { content, chain, errors };
}
