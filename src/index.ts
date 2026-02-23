#!/usr/bin/env bun
import { Command } from "commander";
import { createCheckCommand } from "./commands/check";
import { createPushCommand } from "./commands/push";
import { createConfigCommand } from "./commands/config";
import { initTelemetry, shutdownTelemetry } from "./telemetry";
import { loadConfig } from "./config";
import { ExitError } from "./types";
import packageJson from "../package.json";

const program = new Command();

program
  .name("safe-push")
  .description("Git push safety checker - blocks pushes to forbidden areas")
  .version(packageJson.version)
  .option("--trace [exporter]", "Enable OpenTelemetry tracing (otlp|console)");

program.hook("preAction", async () => {
  const traceOpt = program.opts().trace;

  // CLI フラグ優先、なければ config を参照
  let exporter: "otlp" | "console" | undefined;
  if (traceOpt) {
    exporter = traceOpt === "otlp" ? "otlp" : "console";
  } else {
    const config = loadConfig();
    if (config.trace) {
      exporter = config.trace;
    }
  }

  if (exporter) {
    await initTelemetry(exporter);
  }
});

program.addCommand(createCheckCommand());
program.addCommand(createPushCommand());
program.addCommand(createConfigCommand());

let exitCode = 0;
try {
  await program.parseAsync();
} catch (error) {
  if (error instanceof ExitError) {
    exitCode = error.exitCode;
  } else {
    throw error;
  }
} finally {
  await shutdownTelemetry();
}
process.exit(exitCode);
