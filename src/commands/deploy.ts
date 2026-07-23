import { Command, Option } from "clipanion";
import { statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

import { findProject, saveProject } from "../lib/config.js";
import { CliUsageError, isNotFound } from "../lib/errors.js";
import { build } from "../lib/pack.js";
import { VollyCommand } from "./base.js";

export class DeployCommand extends VollyCommand {
  static paths = [[`deploy`]];
  static usage = Command.Usage({
    description: `Deploy a directory or file to a Volly app`,
    details: `
      PATH is a directory (index.html required at its root; zipped
      automatically), or a single .html, .zip, .jsx, or .tsx file. Defaults to
      the current directory. The target app comes from \`--app\`, or from
      volly.json next to your files; if the app doesn't exist yet it can be
      created on the fly.
    `,
    examples: [
      [`Deploy the current directory`, `volly deploy`],
      [`Stage a draft build`, `volly deploy ./dist --draft -m "try the new nav"`],
      [`CI deploy`, `volly deploy ./dist --yes`],
    ],
  });

  app = Option.String("--app", {
    description: "target app slug (default: volly.json)",
  });
  draft = Option.Boolean("--draft", false, {
    description: "save as a private draft instead of publishing live",
  });
  message = Option.String("-m,--message", {
    description: "release notes for this deploy",
  });
  create = Option.Boolean("--create", false, {
    description: "create the app if it does not exist",
  });
  yes = Option.Boolean("--yes", false, {
    description: "answer yes to all prompts (CI)",
  });
  // Named `target`, not `path` — Command already owns a `path` property.
  target = Option.String({ required: false });

  async run(): Promise<void> {
    const target = this.target ?? ".";

    // Resolve the app slug: --app > volly.json (walking up from the deploy
    // target) > interactive prompt.
    let projectDir = target;
    try {
      if (!statSync(target).isDirectory()) projectDir = dirname(target);
    } catch {
      throw new Error(`${target} does not exist`);
    }
    const project = findProject(projectDir);
    let slug = this.app ?? project?.app ?? "";
    if (!slug) slug = await this.promptForSlug(projectDir);

    const client = this.client();
    const org = await client.orgSlug();

    // Create-if-missing before packing, so a declined create costs nothing.
    let created = false;
    try {
      await client.getApp(org, slug);
    } catch (error) {
      if (!isNotFound(error)) throw error;
      const ok = await this.confirm(
        `App "${slug}" does not exist — create it?`,
        this.create || this.yes,
      );
      if (!ok) {
        this.log("aborted");
        return;
      }
      const { data: app } = await client.createApp(org, slug, slug);
      this.log(`Created ${app.slug} → ${app.url}`);
      created = true;
    }
    // Remember the app for next time, next to the deployed files.
    if (created && !project) {
      try {
        saveProject(resolve(projectDir), slug);
        this.log("Saved volly.json — future deploys here need no --app");
      } catch {
        // best-effort convenience — never fail the deploy over it
      }
    }

    this.log(`Packing ${target}…`);
    const bundle = build(target);

    this.log(`Deploying ${bundle.fileCount} file(s) to ${slug}…`);
    const { data: result, raw } = await client.deploy(
      org,
      slug,
      bundle.filename,
      bundle.content,
      this.message ?? "",
      this.draft,
    );
    if (this.json) {
      this.printJson(raw);
      return;
    }
    if (result.draft) {
      this.out(`Draft saved for ${slug} → ${result.url}`);
      this.log(`Publish it with 'volly draft publish --app ${slug}'`);
    } else {
      this.out(`Deployed ${slug} → ${result.url}`);
    }
  }

  private async promptForSlug(projectDir: string): Promise<string> {
    const suggestion = slugify(basename(resolve(projectDir)));
    if (!this.interactive()) {
      throw new CliUsageError("no app configured — pass --app SLUG (or add volly.json)");
    }
    const answer = (await this.ask(`App slug [${suggestion}]: `)).trim() || suggestion;
    if (!answer) throw new CliUsageError("no app slug provided");
    return answer;
  }
}

/** Derives a valid app slug (lowercase alphanumerics and hyphens) from a
 *  directory name. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replaceAll(/[-_ .]/g, "-")
    .replaceAll(/[^a-z0-9-]/g, "")
    .replaceAll(/-+/g, "-")
    .replaceAll(/^-|-$/g, "");
}

export class DraftPublishCommand extends VollyCommand {
  static paths = [[`draft`, `publish`]];
  static usage = Command.Usage({
    description: `Publish the pending draft to the live URL`,
  });

  app = Option.String("--app", {
    description: "target app slug (default: volly.json)",
  });

  async run(): Promise<void> {
    const slug = resolveAppSlug(this.app);
    const client = this.client();
    const org = await client.orgSlug();
    const { data: result, raw } = await client.publishDraft(org, slug);
    if (this.json) {
      this.printJson(raw);
      return;
    }
    this.out(`Published ${slug} → ${result.url}`);
  }
}

export class DraftDiscardCommand extends VollyCommand {
  static paths = [[`draft`, `discard`]];
  static usage = Command.Usage({ description: `Discard the pending draft` });

  app = Option.String("--app", {
    description: "target app slug (default: volly.json)",
  });

  async run(): Promise<void> {
    const slug = resolveAppSlug(this.app);
    const client = this.client();
    const org = await client.orgSlug();
    await client.discardDraft(org, slug);
    this.log(`Discarded the draft for ${slug}`);
  }
}

/** Resolves the target app for cwd-anchored commands: --app > volly.json. */
export function resolveAppSlug(flag: string | undefined): string {
  if (flag) return flag;
  const project = findProject(process.cwd());
  if (!project?.app) {
    throw new CliUsageError(
      "no app configured — pass --app SLUG (or run from a directory with volly.json)",
    );
  }
  return project.app;
}
