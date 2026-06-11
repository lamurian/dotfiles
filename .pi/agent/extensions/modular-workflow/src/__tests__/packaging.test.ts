import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const PKG_PATH = new URL("../../package.json", import.meta.url);

describe("package.json packaging", () => {
  it("should not declare peerDependencies (pi provides them via jiti aliases)", async () => {
    const pkg = JSON.parse(await readFile(PKG_PATH, "utf-8"));
    assert.equal(
      pkg.peerDependencies,
      undefined,
      "peerDependencies should be removed. " +
        "Pi's jiti loader aliases @earendil-works/*, typebox, and @sinclair/typebox " +
        "to its own bundled packages at runtime.",
    );
  });

  it("should retain fast-glob as a direct dependency", async () => {
    const pkg = JSON.parse(await readFile(PKG_PATH, "utf-8"));
    assert.ok(
      pkg.dependencies?.["fast-glob"],
      "fast-glob is a third-party dependency not provided by pi, so it must remain",
    );
  });
});
