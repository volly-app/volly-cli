// GENERATED from volly-app packages/deploy-contract — do not edit; run infra/scripts/sync-cli-contract.sh
/**
 * The deploy contract: the one vocabulary every deploy surface shares — the
 * api worker writes builds under it, the serve worker reads them back, and the
 * CLI mirrors the wire types and client-side limits. volly-cli consumes a
 * vendored verbatim copy (src/lib/deploy-contract.vendored.ts there, kept in
 * sync by infra/scripts/sync-cli-contract.sh and checked by
 * cli-contract-drift.test.ts here), so this module must stay fully
 * self-contained: no imports, no runtime dependencies.
 */

const MB = 1024 * 1024

// ── Size limits ──────────────────────────────────────────────────────────────
//
// Soft limits enforced in the API, not by R2 (the CLI pre-checks them so
// oversized bundles fail fast client-side; the server stays authoritative).
// The ceilings are bounded by the in-memory pipeline, not product intent: a
// Workers isolate gets 128MB and an upload is held roughly twice while the
// multipart body is parsed, which caps a bare file around 60MB — 30MB keeps
// comfortable headroom. Raising these further needs a streamed path (staged
// R2 upload + streaming unzip), not bigger constants.

export const MAX_SINGLE_FILE_BYTES = 30 * MB
export const MAX_ZIP_UNCOMPRESSED_BYTES = 150 * MB
export const MAX_FILES_PER_APP = 500

// ── Bundle shape ─────────────────────────────────────────────────────────────

/** Every deployed site's entry point: required at the bundle root. */
export const ROOT_INDEX_FILE = 'index.html'

/** The root-index.html rule: a multi-file bundle must serve something at `/`. */
export function hasRootIndex(paths: Iterable<string>): boolean {
  for (const path of paths) {
    if (path === ROOT_INDEX_FILE) {
      return true
    }
  }
  return false
}

// ── Build prefixes ───────────────────────────────────────────────────────────

/**
 * Path segment under an app's r2_prefix holding per-deployment build prefixes.
 * The api worker reserves it in bundle-path validation so a legacy root-served
 * bundle can never collide with it — the `__` naming parallels `__volly`.
 */
export const BUILDS_SEGMENT = '__builds'

/** R2 prefix (no trailing slash) holding one deployment's immutable files. */
export function buildPrefix(r2Prefix: string, deploymentId: string): string {
  return `${r2Prefix}/${BUILDS_SEGMENT}/${deploymentId}`
}

/**
 * buildPrefix's read-side inverse: the R2 prefix (no trailing slash) the serve
 * worker resolves a request from, or null when the draft host has no draft
 * build to show. Live serving falls back to the legacy root (files directly
 * under r2Prefix) for apps that predate per-deployment build prefixes; a draft
 * never has a legacy location.
 */
export function servingPrefix(
  app: { r2Prefix: string; liveDeploymentId: string | null; draftDeploymentId: string | null },
  isDraft: boolean
): string | null {
  if (isDraft) {
    return app.draftDeploymentId ? buildPrefix(app.r2Prefix, app.draftDeploymentId) : null
  }
  return app.liveDeploymentId ? buildPrefix(app.r2Prefix, app.liveDeploymentId) : app.r2Prefix
}

// ── Deploy-job wire types ────────────────────────────────────────────────────
//
// Exactly what the REST deploy endpoints put on the wire (and what the CLI and
// webapp decode): the 202 trigger response and the deploy-job poll read.

/** Lifecycle of a deploy job (mirrors the tenant.deploy_jobs CHECK). */
export type DeployJobStatus = 'queued' | 'validating' | 'uploading' | 'ready' | 'failed'

/** A non-fatal deploy warning (e.g. a Claude host-runtime dependency). */
export interface DeployWarning {
  kind: string
  title: string
  summary: string
  /** Optional prompt a user can paste into their AI tool to fix the app. */
  fixPrompt?: string
}

/** 202 response from triggering a deploy — a job id to poll, not the finished build. */
export interface DeployTrigger {
  jobId: string
  deploymentId: string
  status: DeployJobStatus
  url: string
  draft: boolean
}

/** Poll result for an async deploy job (the deploy-jobs status endpoint). */
export interface DeployJob {
  jobId: string
  status: DeployJobStatus
  draft: boolean
  warnings: DeployWarning[]
  error: string | null
  deploymentId: string | null
  url: string
}
