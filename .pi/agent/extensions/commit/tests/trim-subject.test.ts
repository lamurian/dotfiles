/**
 * Tests for trimSubject — commit subject line formatter.
 */
import { expect, test, mock } from "bun:test";

mock.module("@earendil-works/pi-coding-agent", () => ({
	createLocalBashOperations: () => ({
		exec: async () => ({ exitCode: 0 }),
	}),
}));

import { trimSubject } from "../git.ts";

test("keeps subject under 75 chars unchanged", () => {
	const result = trimSubject("feat: add login page");
	expect(result).toBe("feat: add login page");
});

test("lowercases first word after colon", () => {
	const result = trimSubject("Feat: Add login page");
	expect(result).toBe("feat: add login page");
});

test("removes trailing period", () => {
	const result = trimSubject("feat: add login page.");
	expect(result).toBe("feat: add login page");
});

test("truncates subject over 75 chars with ellipsis", () => {
	const long = "feat: " + "a".repeat(70);
	const result = trimSubject(long);
	expect(result).toMatch(/\.\.\.$/);
	expect(result.length).toBeLessThanOrEqual(75);
});

test("handles subject without colon", () => {
	const result = trimSubject("just a regular message");
	expect(result).toBe("just a regular message");
});

test("truncates long subject without colon", () => {
	const long = "a".repeat(80);
	const result = trimSubject(long);
	expect(result).toMatch(/\.\.\.$/);
	expect(result.length).toBeLessThanOrEqual(75);
});
