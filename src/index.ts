#!/usr/bin/env bun
import { Command } from "commander";
import { createCheckCommand } from "./commands/check";
import { createPushCommand } from "./commands/push";
import { createConfigCommand } from "./commands/config";
import { initTelemetry, shutdownTelemetry } from "./telemetry";
import { ExitError } from "./types";

const program = new Command();

program
  .name("safe-push")
  .description("Git push safety checker - blocks pushes to forbidden areas")
  .version("0.3.0")
  .option("--trace [exporter]", "Enable OpenTelemetry tracing (otlp|console)");

program.hook("preAction", async (_thisCommand, actionCommand) => {
  const traceOpt = program.opts().trace;
  if (traceOpt) {
    const exporter: "otlp" | "console" =
      traceOpt === "otlp" ? "otlp" : "console";
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
