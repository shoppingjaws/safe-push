import { Command } from "commander";
import { loadConfig } from "../config";
import { checkPush, checkVisibility } from "../checker";
import { isGitRepository, hasCommits, execPush } from "../git";
import {
  printError,
  printSuccess,
  printWarning,
  printCheckResultHuman,
  promptConfirm,
} from "./utils";
import { ExitError } from "../types";
import { withSpan } from "../telemetry";

/**
 * pushコマンドを作成
 */
export function createPushCommand(): Command {
  return new Command("push")
    .description("Check and push if allowed")
    .option("-f, --force", "Bypass safety checks")
    .option("--dry-run", "Show what would be pushed without actually pushing")
    .allowUnknownOption()
    .action(async (options: { force?: boolean; dryRun?: boolean }, command: Command) => {
      const gitArgs = command.args;
      await withSpan("safe-push.push", async (rootSpan) => {
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

        // visibility チェック（--force でもバイパスできない）
        if (config.allowedVisibility && config.allowedVisibility.length > 0) {
          try {
            const visibilityResult = await checkVisibility(config.allowedVisibility);
            if (visibilityResult && !visibilityResult.allowed) {
              printError(visibilityResult.reason);
              throw new ExitError(1);
            }
          } catch (error) {
            if (error instanceof ExitError) throw error;
            printError(
              `Failed to check repository visibility. Ensure 'gh' CLI is installed and authenticated.\n  ${error instanceof Error ? error.message : String(error)}`
            );
            throw new ExitError(1);
          }
        }

        // --forceオプションが指定されている場合はチェックをスキップ
        if (options.force) {
          printWarning("Safety checks bypassed with --force");

          if (options.dryRun) {
            printSuccess("Dry run: would push (checks bypassed)");
            throw new ExitError(0);
          }

          const result = await execPush(gitArgs);
          if (result.success) {
            if (result.output) {
              console.log(result.output);
            }
            printSuccess("Push successful");
            return;
          } else {
            printError(`Push failed: ${result.output}`);
            throw new ExitError(1);
          }
        }

        // 通常のチェックを実行
        const checkResult = await checkPush(config);
        printCheckResultHuman(checkResult);

        if (!checkResult.allowed) {
          // onForbiddenの設定に応じて動作を変更
          if (
            config.onForbidden === "prompt" &&
            checkResult.details.hasForbiddenChanges
          ) {
            const confirmed = await promptConfirm(
              "Push is blocked due to forbidden changes. Push anyway?"
            );

            if (confirmed) {
              if (options.dryRun) {
                printSuccess("Dry run: would push (user confirmed)");
                throw new ExitError(0);
              }

              const result = await execPush(gitArgs);
              if (result.success) {
                if (result.output) {
                  console.log(result.output);
                }
                printSuccess("Push successful");
                return;
              } else {
                printError(`Push failed: ${result.output}`);
                throw new ExitError(1);
              }
            } else {
              printError("Push cancelled by user");
              throw new ExitError(1);
            }
          }

          throw new ExitError(1);
        }

        // チェック通過、pushを実行
        if (options.dryRun) {
          printSuccess("Dry run: would push");
          throw new ExitError(0);
        }

        const result = await execPush(gitArgs);
        if (result.success) {
          if (result.output) {
            console.log(result.output);
          }
          printSuccess("Push successful");
          return;
        } else {
          printError(`Push failed: ${result.output}`);
          throw new ExitError(1);
        }
      });
    });
}
