import { Command, Option } from "clipanion";

import { CliUsageError } from "../lib/errors.js";
import { formatDate, formatTime, renderTable, VollyCommand } from "./base.js";

export class TokenCreateCommand extends VollyCommand {
  static paths = [[`token`, `create`]];
  static usage = Command.Usage({
    description: `Mint a new personal access token`,
    details: `
      A PAT authenticates \`volly\` without a browser — stash one in CI as the
      VOLLY_TOKEN secret. Creating and revoking tokens requires an interactive
      login (a PAT cannot manage tokens).
    `,
    examples: [[`Mint a CI token`, `volly token create --name github-actions`]],
  });

  name = Option.String("--name", {
    description: "label for the token (required)",
  });
  scopes = Option.Array("--scopes", [], {
    description: "scope subset: apps:read, apps:write (default: both)",
  });
  expiresDays = Option.String("--expires-days", {
    description: "expire after N days (default: never)",
  });

  async run(): Promise<void> {
    if (!this.name) throw new CliUsageError("--name is required (e.g. --name github-actions)");
    let expires = 0;
    if (this.expiresDays !== undefined) {
      expires = Number.parseInt(this.expiresDays, 10);
      if (!Number.isInteger(expires) || expires < 1) {
        throw new CliUsageError("--expires-days must be a positive integer");
      }
    }
    // Comma- or repeat-style: --scopes a,b and --scopes a --scopes b both work.
    const scopes = this.scopes.flatMap((s) => s.split(",")).filter(Boolean);

    const { data: created, raw } = await this.client().createToken(this.name, scopes, expires);
    if (this.json) {
      this.printJson(raw);
      return;
    }
    // The token itself is the payload — stdout only, everything else on
    // stderr, so `volly token create … | pbcopy` captures just the secret.
    const expiry = created.expires_at ? `, expires ${formatTime(created.expires_at)}` : "";
    this.log(`Created token "${created.name}" (scopes: ${created.scopes.join(" ")})${expiry}`);
    this.log(
      "This is the only time the token is shown — store it now (e.g. as a VOLLY_TOKEN secret):",
    );
    this.out(created.token);
  }
}

export class TokenListCommand extends VollyCommand {
  static paths = [[`token`, `list`]];
  static usage = Command.Usage({
    description: `List your personal access tokens`,
  });

  async run(): Promise<void> {
    const { data: tokens, raw } = await this.client().listTokens();
    if (this.json) {
      this.printJson(raw);
      return;
    }
    if (tokens.length === 0) {
      this.log(`no tokens — mint one with 'volly token create --name NAME'`);
      return;
    }
    const rows = [["ID", "NAME", "PREFIX", "SCOPES", "LAST USED", "STATUS"]];
    for (const t of tokens) {
      const status = t.revoked_at
        ? "revoked"
        : t.expires_at
          ? `expires ${formatDate(t.expires_at)}`
          : "active";
      rows.push([
        t.id,
        t.name,
        t.token_prefix,
        t.scopes.join(" "),
        t.last_used_at ? formatTime(t.last_used_at) : "-",
        status,
      ]);
    }
    this.out(renderTable(rows));
  }
}

export class TokenRevokeCommand extends VollyCommand {
  static paths = [[`token`, `revoke`]];
  static usage = Command.Usage({
    description: `Revoke a personal access token immediately`,
  });

  id = Option.String();

  async run(): Promise<void> {
    await this.client().revokeToken(this.id);
    this.log(`Revoked ${this.id}`);
  }
}
