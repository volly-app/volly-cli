/**
 * Everything the CLI persists or resolves outside a single invocation: the
 * global config file, stored credentials, and the per-project volly.json.
 * Precedence for every setting is flags > environment > volly.json > global
 * config > defaults.
 */
import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";

export const DEFAULT_API_URL = "https://app.volly.so";

/**
 * The CLI's config directory. Mirrors Go's os.UserConfigDir so credentials
 * written by earlier builds keep working: ~/Library/Application Support on
 * macOS, %AppData% on Windows, $XDG_CONFIG_HOME (or ~/.config) elsewhere.
 */
export function configDir(): string {
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "volly");
  }
  if (process.platform === "win32" && process.env.APPDATA) {
    return join(process.env.APPDATA, "volly");
  }
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "volly");
}

/** Loads path as JSON into T; a missing file yields the fallback. */
function readJson<T>(path: string, fallback: T): T {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${(error as Error).message}`, { cause: error });
  }
}

/** Atomic write (temp file + rename) with the given mode. */
function writeJson(path: string, value: unknown, mode: number): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.volly-${randomBytes(6).toString("hex")}`);
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode });
  chmodSync(tmp, mode);
  renameSync(tmp, path);
}

// ---- Global config (config.json) ----

export interface GlobalConfig {
  api_url?: string;
}

export function loadGlobal(): GlobalConfig {
  return readJson<GlobalConfig>(join(configDir(), "config.json"), {});
}

export function saveGlobal(config: GlobalConfig): void {
  writeJson(join(configDir(), "config.json"), config, 0o644);
}

// ---- Credentials (credentials.json, 0600) ----

/**
 * One stored login, keyed by API URL so prod/staging/local coexist. Exactly
 * one of `pat` or the OAuth triple is populated.
 */
export interface Credential {
  pat?: string;
  client_id?: string;
  access_token?: string;
  refresh_token?: string;
  expires_at?: string;
}

export type Credentials = Record<string, Credential>;

function credentialsPath(): string {
  return join(configDir(), "credentials.json");
}

export function loadCredentials(): Credentials {
  return readJson<Credentials>(credentialsPath(), {});
}

export function saveCredential(apiUrl: string, credential: Credential): void {
  const all = loadCredentials();
  all[apiUrl] = credential;
  writeJson(credentialsPath(), all, 0o600);
}

export function deleteCredential(apiUrl: string): void {
  const all = loadCredentials();
  if (!(apiUrl in all)) return;
  delete all[apiUrl];
  writeJson(credentialsPath(), all, 0o600);
}

/** CI-first override: VOLLY_TOKEN (a PAT) beats every stored credential. */
export function envToken(): string | undefined {
  return process.env.VOLLY_TOKEN || undefined;
}

// ---- Project file (volly.json) ----

/** volly.json, checked into the app's directory so `volly deploy` needs no
 *  arguments there. */
export interface Project {
  app: string;
  /** Where the file was found (not serialized). */
  dir: string;
}

const PROJECT_FILE = "volly.json";

/** Walks from dir toward the filesystem root; null when no volly.json. */
export function findProject(dir: string): Project | null {
  let current = resolve(dir);
  for (;;) {
    const path = join(current, PROJECT_FILE);
    let exists = false;
    try {
      exists = statSync(path).isFile();
    } catch {
      // keep walking
    }
    if (exists) {
      const parsed = readJson<{ app?: string }>(path, {});
      return { app: parsed.app ?? "", dir: current };
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function saveProject(dir: string, app: string): void {
  writeJson(join(dir, PROJECT_FILE), { app }, 0o644);
}
