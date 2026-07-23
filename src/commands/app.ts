import { Command, Option } from "clipanion";

import { formatDate, formatTime, orDash, renderTable, VollyCommand } from "./base.js";

export class AppListCommand extends VollyCommand {
  static paths = [[`app`, `list`]];
  static usage = Command.Usage({
    description: `List your organization's apps`,
  });

  search = Option.String("--search", {
    description: "filter by name, slug, or owner",
  });

  async run(): Promise<void> {
    const client = this.client();
    const org = await client.orgSlug();
    const { data: apps, raw } = await client.listApps(org, this.search);
    if (this.json) {
      this.printJson(raw);
      return;
    }
    if (apps.length === 0) {
      this.log(`no apps yet — deploy one with 'volly deploy'`);
      return;
    }
    const rows = [["SLUG", "NAME", "VISIBILITY", "DEPLOYED", "OWNER"]];
    for (const app of apps) {
      rows.push([
        app.slug,
        app.name,
        app.visibility,
        app.deployed_at ? formatDate(app.deployed_at) : "-",
        app.ownedByMe ? "you" : orDash(app.author_name),
      ]);
    }
    this.out(renderTable(rows));
  }
}

export class AppCreateCommand extends VollyCommand {
  static paths = [[`app`, `create`]];
  static usage = Command.Usage({ description: `Create an app` });

  name = Option.String("--name", {
    description: "display name (default: the slug)",
  });
  visibility = Option.String("--visibility", {
    description: "private, unlisted, or org",
  });
  slug = Option.String();

  async run(): Promise<void> {
    const client = this.client();
    const org = await client.orgSlug();
    const { data: created, raw } = await client.createApp(
      org,
      this.slug,
      this.name ?? this.slug,
      this.visibility,
    );
    if (this.json) {
      this.printJson(raw);
      return;
    }
    this.out(`Created ${created.slug} → ${created.url}`);
  }
}

export class AppGetCommand extends VollyCommand {
  static paths = [[`app`, `get`]];
  static usage = Command.Usage({ description: `Show an app's details` });

  slug = Option.String();

  async run(): Promise<void> {
    const client = this.client();
    const org = await client.orgSlug();
    const { data: app, raw } = await client.getApp(org, this.slug);
    if (this.json) {
      this.printJson(raw);
      return;
    }
    this.out(`${app.name} (${app.slug})`);
    this.out(`  url:        ${app.url}`);
    this.out(`  visibility: ${app.visibility}`);
    this.out(`  deployed:   ${app.deployed_at ? formatTime(app.deployed_at) : "never"}`);
    if (app.has_draft && app.draft_url) {
      this.out(`  draft:      ${app.draft_url}`);
    }
  }
}

export class AppDeleteCommand extends VollyCommand {
  static paths = [[`app`, `delete`]];
  static usage = Command.Usage({
    description: `Delete an app and its deployed files`,
  });

  yes = Option.Boolean("--yes", false, {
    description: "skip the confirmation prompt",
  });
  slug = Option.String();

  async run(): Promise<void> {
    const client = this.client();
    const org = await client.orgSlug();
    const ok = await this.confirm(`Delete ${this.slug} and all of its deployments?`, this.yes);
    if (!ok) {
      this.log("aborted");
      return;
    }
    await client.deleteApp(org, this.slug);
    this.log(`Deleted ${this.slug}`);
  }
}
