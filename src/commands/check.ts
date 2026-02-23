import { Command } from "commander";
import { loadConfig } from "../config";
import { checkPush, checkVisibility } from "../checker";
import { isGitRepository, hasCommits } from "../git";
import { printError, printCheckResultJson, printCheckResultHuman } from "./utils";
import { ExitError } from "../types";
import { withSpan } from "../telemetry";

/**
 * checkコマンドを作成
 */
export function createCheckCommand(): Command {
  return new Command("check")
    .description("Check if push is allowed")
    .option("--json", "Output result as JSON")
    .action(async (options: { json?: boolean }) => {
      await withSpan("safe-push.check", async (rootSpan) => {
        // Gitリポジトリ内か確認
        if (!(await isGitRepository())) {
          printError("Not a git repository");
          throw new ExitError(1);
        }

        // コミットが存在するか確認
        if (!(await hasCommits())) {
          printError("No commits found");
          throw new ExitError(1);
        }

        const config = loadConfig();

        rootSpan.addEvent("config.loaded", {
          forbiddenPaths: JSON.stringify(config.forbiddenPaths),
          onForbidden: config.onForbidden,
          hasVisibilityRule: !!(config.allowedVisibility && config.allowedVisibility.length > 0),
        });

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
            if (error instanceof ExitError) throw error;
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

        if (!result.allowed) {
          throw new ExitError(1);
        }
      });
    });
}
