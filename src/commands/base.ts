import { Command, Option } from "clipanion";
import { createInterface } from "node:readline/promises";

import { Client } from "../lib/api.js";
import {
  DEFAULT_API_URL,
  envToken,
  loadCredentials,
  loadGlobal,
  saveCredential,
} from "../lib/config.js";
import { ApiError, CliUsageError, exitCode } from "../lib/errors.js";
import { refresh } from "../lib/oauth.js";

/** Stamped by the bin entry before the Cli runs. */
export let cliVersion = "dev";
export function setCliVersion(version: string): void {
  cliVersion = version;
}

/**
 * Base for every volly command: the shared --api-url/--json flags, the
 * authenticated API client (with OAuth refresh + rotated-token persistence),
 * prompting, and the exit-code contract (0 ok · 1 error · 2 usage · 3 auth ·
 * 4 not found). Subclasses implement run(); execute() maps thrown errors to
 * exit codes so every command reports failures the same way.
 */
export abstract class VollyCommand extends Command {
  apiUrlFlag = Option.String("--api-url", {
    description: "Volly API origin (default https://app.volly.so; env VOLLY_API_URL)",
  });

  json = Option.Boolean("--json", false, {
    description: "print the raw API response as JSON",
  });

  abstract run(): Promise<number | void>;

  async execute(): Promise<number | void> {
    try {
      return await this.run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.context.stderr.write(`error: ${message}\n`);
      return exitCode(error);
    }
  }

  apiUrl(): string {
    const raw =
      this.apiUrlFlag || this.context.env.VOLLY_API_URL || loadGlobal().api_url || DEFAULT_API_URL;
    return raw.replace(/\/+$/, "");
  }

  /**
   * The authenticated API client. VOLLY_TOKEN (CI) beats the stored
   * credential; an OAuth credential gets a refresh hook that persists the
   * rotated tokens immediately — without that, the next invocation is locked
   * out.
   */
  client(): Client {
    const baseUrl = this.apiUrl();

    const env = envToken();
    if (env) return new Client({ baseUrl, token: env, version: cliVersion });

    const credential = loadCredentials()[baseUrl];
    if (!credential || (!credential.pat && !credential.access_token)) {
      throw new ApiError(401, "");
    }
    if (credential.pat) {
      return new Client({
        baseUrl,
        token: credential.pat,
        version: cliVersion,
      });
    }
    return new Client({
      baseUrl,
      token: credential.access_token ?? "",
      version: cliVersion,
      refresh: async () => {
        const rotated = await refresh(
          baseUrl,
          credential.client_id ?? "",
          credential.refresh_token ?? "",
        );
        saveCredential(baseUrl, {
          client_id: rotated.clientId,
          access_token: rotated.accessToken,
          refresh_token: rotated.refreshToken,
          expires_at: rotated.expiresAt,
        });
        return rotated.accessToken;
      },
    });
  }

  /** Whether prompting is possible (stdin and stderr are a terminal). */
  interactive(): boolean {
    return Boolean(process.stdin.isTTY && process.stderr.isTTY);
  }

  /** Prompts on the terminal; non-interactive without assumeYes errors (exit 2). */
  async confirm(prompt: string, assumeYes: boolean): Promise<boolean> {
    if (assumeYes) return true;
    if (!this.interactive()) {
      throw new CliUsageError(`${prompt} — pass --yes to proceed non-interactively`);
    }
    const answer = (await this.ask(`${prompt} [y/N]: `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  }

  /** One line from the terminal, prompt on stderr. */
  async ask(prompt: string): Promise<string> {
    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    try {
      return await rl.question(prompt);
    } finally {
      rl.close();
    }
  }

  /** Emits a raw API response body on stdout (the --json contract). */
  printJson(raw: string): void {
    try {
      this.context.stdout.write(`${JSON.stringify(JSON.parse(raw), null, 2)}\n`);
    } catch {
      this.context.stdout.write(`${raw}\n`);
    }
  }

  log(message: string): void {
    this.context.stderr.write(`${message}\n`);
  }

  out(message: string): void {
    this.context.stdout.write(`${message}\n`);
  }
}

// ---- Shared formatting helpers ----

export function orDash(value: string | null | undefined): string {
  return value || "-";
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Local "YYYY-MM-DD HH:mm". */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Local "YYYY-MM-DD". */
export function formatDate(iso: string): string {
  return formatTime(iso).slice(0, 10);
}

/** Minimal aligned table (tabwriter equivalent), written to stdout. */
export function renderTable(rows: string[][]): string {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, cell.length);
    });
  }
  return rows
    .map((row) =>
      row
        .map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i] ?? 0)))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}
