import { Command } from "commander";
import {
  getConfigPath,
  loadConfig,
  initConfig,
  configExists,
} from "../config";
import { printSuccess, printError, printInfo } from "./utils";

/**
 * configサブコマンドを作成
 */
export function createConfigCommand(): Command {
  const config = new Command("config").description("Manage configuration");

  config
    .command("init")
    .description("Initialize configuration file")
    .option("-f, --force", "Overwrite existing configuration")
    .action((options: { force?: boolean }) => {
      try {
        const result = initConfig(undefined, options.force);

        if (result.created) {
          printSuccess(`Configuration file created at: ${result.path}`);
        } else {
          printInfo(`Configuration file already exists at: ${result.path}`);
          printInfo("Use --force to overwrite");
        }
      } catch (error) {
        printError(
          `Failed to initialize config: ${error instanceof Error ? error.message : String(error)}`
        );
        process.exit(1);
      }
    });

  config
    .command("show")
    .description("Show current configuration")
    .option("--json", "Output as JSON")
    .action((options: { json?: boolean }) => {
      try {
        const configPath = getConfigPath();
        const exists = configExists();
        const configData = loadConfig();

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                path: configPath,
                exists,
                config: configData,
              },
              null,
              2
            )
          );
        } else {
          console.log("");
          console.log("Configuration:");
          console.log(`  Path: ${configPath}`);
          console.log(`  Exists: ${exists ? "Yes" : "No (using defaults)"}`);
          console.log("");
          console.log("Settings:");
          console.log(
            `  forbiddenPaths: ${JSON.stringify(configData.forbiddenPaths)}`
          );
          console.log(`  onForbidden: ${configData.onForbidden}`);
          console.log("");
        }
      } catch (error) {
        printError(
          `Failed to load config: ${error instanceof Error ? error.message : String(error)}`
        );
        process.exit(1);
      }
    });

  config
    .command("path")
    .description("Show configuration file path")
    .action(() => {
      console.log(getConfigPath());
    });

  return config;
}
