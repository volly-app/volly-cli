import { mkdirSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  configDir,
  deleteCredential,
  findProject,
  loadCredentials,
  saveCredential,
  saveProject,
} from "./config.js";

/** Point the config dir at a temp directory for the test's duration. */
function tempConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "volly-config-"));
  if (process.platform === "darwin") {
    vi.stubEnv("HOME", dir); // os.homedir() reads $HOME
  } else if (process.platform === "win32") {
    vi.stubEnv("APPDATA", dir);
  } else {
    vi.stubEnv("XDG_CONFIG_HOME", dir);
  }
  return dir;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("credentials", () => {
  it("round-trips per-API-URL entries with a 0600 file", () => {
    tempConfigDir();

    saveCredential("https://app.volly.so", {
      client_id: "client-1",
      access_token: "at",
      refresh_token: "rt",
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    saveCredential("http://localhost:8787", { pat: "volly_pat_x_y" });

    const all = loadCredentials();
    expect(all["https://app.volly.so"]?.refresh_token).toBe("rt");
    expect(all["http://localhost:8787"]?.pat).toBe("volly_pat_x_y");

    deleteCredential("http://localhost:8787");
    expect(loadCredentials()["http://localhost:8787"]).toBeUndefined();
  });

  it.skipIf(process.platform === "win32")("stores the secrets file with 0600", () => {
    tempConfigDir();
    saveCredential("https://app.volly.so", { pat: "volly_pat_x_y" });
    const mode = statSync(join(configDir(), "credentials.json")).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

describe("project file", () => {
  it("walks up from nested directories to the nearest volly.json", () => {
    const root = mkdtempSync(join(tmpdir(), "volly-project-"));
    const nested = join(root, "a", "b");
    mkdirSync(nested, { recursive: true });
    saveProject(root, "my-app");

    const project = findProject(nested);
    expect(project?.app).toBe("my-app");
    expect(project?.dir).toBe(root);

    expect(findProject(mkdtempSync(join(tmpdir(), "volly-none-")))).toBeNull();
  });
});
