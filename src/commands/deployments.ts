import { Command, Option } from "clipanion";

import { CliUsageError } from "../lib/errors.js";
import { formatTime, orDash, renderTable, VollyCommand } from "./base.js";
import { resolveAppSlug } from "./deploy.js";

export class DeploymentsListCommand extends VollyCommand {
  static paths = [[`deployments`, `list`]];
  static usage = Command.Usage({
    description: `List an app's deployments, newest first`,
  });

  app = Option.String("--app", {
    description: "target app slug (default: volly.json)",
  });
  limit = Option.String("--limit", "20", {
    description: "maximum rows (1-100)",
  });

  async run(): Promise<void> {
    const limit = Number.parseInt(this.limit, 10);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new CliUsageError("--limit must be an integer between 1 and 100");
    }
    const slug = resolveAppSlug(this.app);
    const client = this.client();
    const org = await client.orgSlug();
    const { data: page, raw } = await client.listDeployments(org, slug, limit);
    if (this.json) {
      this.printJson(raw);
      return;
    }
    if (page.deployments.length === 0) {
      this.log("no deployments yet");
      return;
    }
    const rows = [["DEPLOYED", "BY", "DRAFT", "MESSAGE"]];
    for (const d of page.deployments) {
      rows.push([
        formatTime(d.deployed_at),
        orDash(d.deployed_by),
        d.is_draft ? "draft" : "",
        orDash(d.message),
      ]);
    }
    this.out(renderTable(rows));
    if (page.total_count > page.deployments.length) {
      this.log(
        `showing ${page.deployments.length} of ${page.total_count} — raise --limit for more`,
      );
    }
  }
}
