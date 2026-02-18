import { Command } from "commander";
import { loadConfig } from "../config";
import { checkPush, checkVisibility } from "../checker";
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

        // visibility チェック
        if (config.allowedVisibility && config.allowedVisibility.length > 0) {
          try {
            const visibilityResult = await checkVisibility(config.allowedVisibility);
            if (visibilityResult) {
              result.details.repoVisibility = visibilityResult.visibility;
              result.details.visibilityAllowed = visibilityResult.allowed;
              if (!visibilityResult.allowed) {
                result.allowed = false;
                result.reason = visibilityResult.reason;
              }
            }
          } catch (error) {
            result.details.repoVisibility = "unknown";
            result.details.visibilityAllowed = false;
            result.allowed = false;
            result.reason = `Failed to check repository visibility. Ensure 'gh' CLI is installed and authenticated.`;
          }
        }

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
