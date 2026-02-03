import { Command } from "commander";
import { loadConfig } from "../config";
import { checkPush } from "../checker";
import { isGitRepository, hasCommits } from "../git";
import { printError, printCheckResultJson, printCheckResultHuman } from "./utils";

/**
 * checkコマンドを作成
 */
export function createCheckCommand(): Command {
  return new Command("check")
    .description("Check if push is allowed")
    .option("--json", "Output result as JSON")
    .action(async (options: { json?: boolean }) => {
      try {
        // Gitリポジトリ内か確認
        if (!(await isGitRepository())) {
          printError("Not a git repository");
          process.exit(1);
        }

        // コミットが存在するか確認
        if (!(await hasCommits())) {
          printError("No commits found");
          process.exit(1);
        }

        const config = loadConfig();
        const result = await checkPush(config);

        if (options.json) {
          printCheckResultJson(result);
        } else {
          printCheckResultHuman(result);
        }

        process.exit(result.allowed ? 0 : 1);
      } catch (error) {
        printError(
          `Check failed: ${error instanceof Error ? error.message : String(error)}`
        );
        process.exit(1);
      }
    });
}
