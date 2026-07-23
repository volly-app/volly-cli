import { Builtins, Cli } from "clipanion";

import {
  AppCreateCommand,
  AppDeleteCommand,
  AppGetCommand,
  AppListCommand,
} from "./commands/app.js";
import { LoginCommand, LogoutCommand, WhoamiCommand } from "./commands/auth.js";
import { setCliVersion } from "./commands/base.js";
import { DeployCommand, DraftDiscardCommand, DraftPublishCommand } from "./commands/deploy.js";
import { DeploymentsListCommand } from "./commands/deployments.js";
import { TokenCreateCommand, TokenListCommand, TokenRevokeCommand } from "./commands/token.js";

export function buildCli(version: string): Cli {
  setCliVersion(version);
  const cli = new Cli({
    binaryLabel: "Volly CLI",
    binaryName: "volly",
    binaryVersion: version,
  });

  cli.register(LoginCommand);
  cli.register(LogoutCommand);
  cli.register(WhoamiCommand);
  cli.register(DeployCommand);
  cli.register(AppListCommand);
  cli.register(AppCreateCommand);
  cli.register(AppGetCommand);
  cli.register(AppDeleteCommand);
  cli.register(DraftPublishCommand);
  cli.register(DraftDiscardCommand);
  cli.register(DeploymentsListCommand);
  cli.register(TokenCreateCommand);
  cli.register(TokenListCommand);
  cli.register(TokenRevokeCommand);
  cli.register(Builtins.HelpCommand);
  cli.register(Builtins.VersionCommand);

  return cli;
}
