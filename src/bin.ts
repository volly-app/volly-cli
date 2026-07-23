#!/usr/bin/env node
import { createRequire } from "node:module";

import { buildCli } from "./cli.js";

const { version } = createRequire(import.meta.url)("../package.json") as {
  version: string;
};

void buildCli(version).runExit(process.argv.slice(2));
