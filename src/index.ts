#!/usr/bin/env bun
import { Command } from "commander";
import { createCheckCommand } from "./commands/check";
import { createPushCommand } from "./commands/push";
import { createConfigCommand } from "./commands/config";

const program = new Command();

program
  .name("safe-push")
  .description("Git push safety checker - blocks pushes to forbidden areas")
  .version("0.1.0");

program.addCommand(createCheckCommand());
program.addCommand(createPushCommand());
program.addCommand(createConfigCommand());

program.parse();
