import { unzipSync } from "fflate";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { build } from "./pack.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "volly-pack-"));
}

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

describe("directory bundles", () => {
  it("zips the tree and excludes VCS/dependency/config noise", () => {
    const dir = tempDir();
    writeFile(join(dir, "index.html"), "<h1>hi</h1>");
    writeFile(join(dir, "assets", "app.js"), "js");
    writeFile(join(dir, "volly.json"), '{"app":"x"}');
    writeFile(join(dir, ".git", "HEAD"), "ref");
    writeFile(join(dir, ".env"), "SECRET=1");
    writeFile(join(dir, "node_modules", "pkg", "index.js"), "dep");

    const bundle = build(dir);
    expect(bundle.filename).toBe("bundle.zip");
    expect(bundle.fileCount).toBe(2);
    const entries = Object.keys(unzipSync(bundle.content)).toSorted();
    expect(entries).toEqual(["assets/app.js", "index.html"]);
  });

  it("requires index.html at the root", () => {
    const dir = tempDir();
    writeFile(join(dir, "main.js"), "js");
    expect(() => build(dir)).toThrow(/index\.html/);
  });
});

describe("single files", () => {
  it("passes a bare .html through untouched", () => {
    const dir = tempDir();
    const path = join(dir, "page.html");
    writeFile(path, "<h1>solo</h1>");
    const bundle = build(path);
    expect(bundle.filename).toBe("page.html");
    expect(Buffer.from(bundle.content).toString()).toBe("<h1>solo</h1>");
    expect(bundle.fileCount).toBe(1);
  });

  it("rejects unsupported extensions", () => {
    const dir = tempDir();
    const path = join(dir, "notes.md");
    writeFile(path, "# nope");
    expect(() => build(path)).toThrow(/unsupported file type/);
  });
});
