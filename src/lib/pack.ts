/**
 * Turns a deploy target (a directory or a single file) into the upload the
 * API accepts: a bare .html/.zip/.jsx/.tsx file passes through, a directory
 * is zipped in memory (fflate) with an index.html required at its root.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { zipSync } from "fflate";

/** Mirrors the server's MAX_ZIP_UNCOMPRESSED_BYTES so oversized bundles fail
 *  fast client-side (the server stays authoritative). */
export const MAX_UNCOMPRESSED_BYTES = 150 * 1024 * 1024;

export interface Bundle {
  /** Upload filename staged with the deploy. */
  filename: string;
  content: Uint8Array;
  /** Informational (1 for a bare file). */
  fileCount: number;
}

const SINGLE_FILE_EXTS = new Set([".html", ".zip", ".jsx", ".tsx"]);

/**
 * Coerce a filename into one the deploy-uploads route accepts: keep the real
 * (already-validated) extension, slugify the stem, and fall back to "bundle"
 * when nothing safe survives. Only the extension matters server-side.
 */
export function safeUploadName(name: string): string {
  const ext = extname(name).toLowerCase();
  const stem = basename(name, extname(name))
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/^[^a-zA-Z0-9]+/, "");
  return `${stem || "bundle"}${ext}`;
}

/** Entries that never enter a bundle: VCS state, dependencies, the project
 *  config itself, and OS noise. */
function skipped(name: string): boolean {
  return (
    name.startsWith(".") ||
    name === ".DS_Store" ||
    name === "node_modules" ||
    name === "volly.json" ||
    name === "Thumbs.db"
  );
}

export function build(path: string): Bundle {
  const info = statSync(path);

  if (!info.isDirectory()) {
    const ext = extname(path).toLowerCase();
    if (!SINGLE_FILE_EXTS.has(ext)) {
      throw new Error(
        `unsupported file type "${ext}" — deploy a .html, .zip, .jsx, or .tsx file, or a directory`,
      );
    }
    if (info.size > MAX_UNCOMPRESSED_BYTES) {
      throw new Error(
        `${path} is larger than the ${MAX_UNCOMPRESSED_BYTES / (1024 * 1024)} MB deploy limit`,
      );
    }
    return {
      filename: safeUploadName(basename(path)),
      content: readFileSync(path),
      fileCount: 1,
    };
  }

  return buildDir(path);
}

function buildDir(dir: string): Bundle {
  try {
    statSync(join(dir, "index.html"));
  } catch {
    throw new Error(
      `${dir} has no index.html at its root — every deployed site needs one as its entry point`,
    );
  }

  const files: Record<string, Uint8Array> = {};
  let total = 0;
  let count = 0;

  const walk = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (skipped(entry.name)) continue;
      const full = join(current, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(full, rel);
        continue;
      }
      // Symlinks are skipped: their targets may point outside the project.
      if (!entry.isFile()) continue;
      const content = readFileSync(full);
      total += content.byteLength;
      if (total > MAX_UNCOMPRESSED_BYTES) {
        throw new Error(
          `bundle exceeds the ${MAX_UNCOMPRESSED_BYTES / (1024 * 1024)} MB deploy limit`,
        );
      }
      files[rel] = content;
      count++;
    }
  };
  walk(dir, "");

  return { filename: "bundle.zip", content: zipSync(files), fileCount: count };
}
