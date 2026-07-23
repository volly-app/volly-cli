import { Command, Option } from "clipanion";

import { Client } from "../lib/api.js";
import { open } from "../lib/browser.js";
import { type Credential, deleteCredential, saveCredential } from "../lib/config.js";
import { CliUsageError } from "../lib/errors.js";
import { login } from "../lib/oauth.js";
import { cliVersion, VollyCommand } from "./base.js";

const LOGIN_TIMEOUT_MS = 3 * 60 * 1000;

export class LoginCommand extends VollyCommand {
  static paths = [[`login`]];
  static usage = Command.Usage({
    description: `Sign in to Volly`,
    details: `
      By default this opens your browser for an OAuth sign-in and stores the
      resulting tokens. With \`--with-token\`, a personal access token is read
      from stdin instead (for CI, or a token minted with \`volly token create\`).
    `,
    examples: [
      [`Browser sign-in`, `volly login`],
      [`Paste a token (CI)`, `echo $TOKEN | volly login --with-token`],
    ],
  });

  withToken = Option.Boolean("--with-token", false, {
    description: "read a personal access token from stdin instead of using the browser",
  });

  noBrowser = Option.Boolean("--no-browser", false, {
    description: "print the sign-in URL instead of opening a browser",
  });

  async run(): Promise<void> {
    const base = this.apiUrl();

    let credential: Credential;
    if (this.withToken) {
      credential = { pat: await this.readToken() };
    } else {
      if (!this.noBrowser && !this.interactive()) {
        throw new CliUsageError(
          `no terminal for the browser sign-in — use 'volly login --with-token' or set VOLLY_TOKEN`,
        );
      }
      this.log(`Signing in to ${base} …`);
      const tokens = await login(
        base,
        (url) => {
          if (this.noBrowser) {
            this.log(`Open this URL in a browser on this machine:\n\n  ${url}\n`);
            return;
          }
          if (!open(url)) this.log("Could not open a browser automatically.");
          this.log(`If nothing opened, visit:\n\n  ${url}\n`);
        },
        LOGIN_TIMEOUT_MS,
      );
      credential = {
        client_id: tokens.clientId,
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_at: tokens.expiresAt,
      };
    }

    // Verify before saving so a typo'd token never becomes the stored one.
    const probe = new Client({
      baseUrl: base,
      token: credential.pat ?? credential.access_token ?? "",
      version: cliVersion,
    });
    const { data: me } = await probe.me();
    saveCredential(base, credential);

    const org = me.org ? ` (org: ${me.org.slug})` : "";
    this.log(`Signed in to ${base} as ${me.user.email}${org}`);
  }

  private async readToken(): Promise<string> {
    let token: string;
    if (process.stdin.isTTY) {
      token = (await this.askHidden("Paste your token (input hidden): ")).trim();
    } else {
      token = (await readAll(process.stdin)).split("\n")[0]?.trim() ?? "";
      if (!token) {
        throw new CliUsageError(
          "no token on stdin — pipe it in: echo $TOKEN | volly login --with-token",
        );
      }
    }
    if (!token) throw new CliUsageError("no token provided");
    return token;
  }

  /** Terminal input with echo suppressed (raw mode, chars swallowed). */
  private askHidden(prompt: string): Promise<string> {
    process.stderr.write(prompt);
    return new Promise((resolve, reject) => {
      const chars: string[] = [];
      const stdin = process.stdin;
      stdin.setRawMode?.(true);
      stdin.resume();
      stdin.setEncoding("utf8");
      const onData = (chunk: string) => {
        for (const ch of chunk) {
          if (ch === "\r" || ch === "\n") {
            cleanup();
            process.stderr.write("\n");
            resolve(chars.join(""));
            return;
          }
          if (ch === "\x03") {
            cleanup();
            reject(new Error("aborted"));
            return;
          }
          if (ch === "\x7f" || ch === "\b") {
            chars.pop();
          } else {
            chars.push(ch);
          }
        }
      };
      const cleanup = () => {
        stdin.setRawMode?.(false);
        stdin.pause();
        stdin.off("data", onData);
      };
      stdin.on("data", onData);
    });
  }
}

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString("utf8");
}

export class LogoutCommand extends VollyCommand {
  static paths = [[`logout`]];
  static usage = Command.Usage({
    description: `Forget the stored credential for this API URL`,
  });

  async run(): Promise<void> {
    const base = this.apiUrl();
    deleteCredential(base);
    this.log(`Logged out of ${base}`);
  }
}

export class WhoamiCommand extends VollyCommand {
  static paths = [[`whoami`]];
  static usage = Command.Usage({
    description: `Show the signed-in user and organization`,
  });

  async run(): Promise<void> {
    const { data: me, raw } = await this.client().me();
    if (this.json) {
      this.printJson(raw);
      return;
    }
    const scopes = me.auth.method === "session" ? "" : `, scopes: ${me.auth.scopes.join(" ")}`;
    this.out(`${me.user.email} (${me.auth.method} auth${scopes})`);
    this.out(
      me.org
        ? `org: ${me.org.slug} (${me.org.name})`
        : "org: none — finish onboarding in the web app",
    );
  }
}
